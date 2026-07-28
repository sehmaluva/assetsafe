"""
views.py — Hire Purchase

"""

from __future__ import annotations

import logging

from django.db.models import Count, Q, QuerySet, Sum
from django.utils import timezone
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from django_filters.rest_framework import DjangoFilterBackend

from apps.asset_management.api.views import StandardResultsSetPagination
from apps.common.api.views import BaseViewSet
from apps.common.utils.caching import CacheService
from apps.common.utils.registry_cache import (
    HIRE_PURCHASE_REGISTRY,
    invalidate_registry_caches,
)
from apps.common.utils.helpers import (
    extract_error_message,
    scope_registry_to_client_portfolio,
)
from apps.hire_purchase.models.models import HirePurchaseRegistration
from apps.users.services.audit_service import create_audit_log
from apps.users.utils.permissions import HasRole, roles_allowed
from .serializers import (
    HirePurchaseClosureSerializer,
    HirePurchaseDashboardSerializer,
    HirePurchaseRegistrationListSerializer,
    HirePurchaseRegistrationSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Hire Purchase Registry ViewSet
# ---------------------------------------------------------------------------


class HirePurchaseRegistrationViewSet(BaseViewSet):
    """
    CRUD ViewSet for the Hire Purchase Registry.
    """

    serializer_class = HirePurchaseRegistrationSerializer
    permission_classes = [IsAuthenticated, HasRole]
    pagination_class = StandardResultsSetPagination
    filter_backends = [
        DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]

    filterset_fields: list[str] = [
        "asset_category",
        "asset_type",
        "financier",
        "purchaser_type",
        "purchaser_individual",
        "purchaser_company",
        "closure_confirmed",
        "currency",
    ]
    SEARCH_FIELD_MAP: dict[str, list[str]] = {
        "agreement_number": ["agreement_number"],
        "purchaser": [
            "purchaser_individual__first_name",
            "purchaser_individual__last_name",
            "purchaser_company__branch_name",
            "purchaser_company__company__trading_name",
            "purchaser_company__company__registration_name",
        ],
        "reg_serial_number": [
            "serial_number",
            "mv_registration_number",
            "chassis_number",
        ],
        "financier": ["financier__name"],
    }
    DEFAULT_SEARCH_FIELDS: list[str] = [
        "agreement_number",
        "purchaser_individual__first_name",
        "purchaser_individual__last_name",
        "purchaser_company__branch_name",
        "purchaser_company__company__trading_name",
        "purchaser_company__company__registration_name",
        "serial_number",
        "mv_registration_number",
        "chassis_number",
        "financier__name",
        "make",
        "model",
    ]
    ordering_fields: list[str] = [
        "lodge_date",
        "agreement_start_date",
        "agreement_end_date",
        "purchase_amount",
    ]
    ordering: list[str] = ["-lodge_date"]

    @property
    def search_fields(self) -> list[str]:
        """
        Scopes ``SearchFilter`` to the fields backing the selected
        ``search_field`` criteria (e.g. "Agreement Number", "Purchaser Name",
        "Reg/Serial Number"). Any unrecognised/absent value searches the
        full default field set.
        """
        search_field = self.request.query_params.get("search_field")
        return self.SEARCH_FIELD_MAP.get(search_field, self.DEFAULT_SEARCH_FIELDS)

    def get_serializer_class(self):
        """
        Return the appropriate serializer class based on the requested action.
        We return the lighter ListSerializer for list actions for performance,
        matching the Collateral and Asset Registry list endpoints.
        """
        if self.action == "list":
            return HirePurchaseRegistrationListSerializer
        return super().get_serializer_class()

    def get_queryset(self) -> QuerySet[HirePurchaseRegistration]:
        """
        Returns all HP records eagerly loaded via ``select_related``.

        Client users only see records belonging to their own portfolio, i.e.
        records where their client is the ``financier``. This mirrors the
        filter used by ``stats()`` so the list total and headline counts
        never disagree.

        The main dashboard table should only surface active and
        pending-closure agreements; already-closed records are excluded
        from the list (but remain reachable directly by id for
        retrieve/update/delete/confirm-closure).
        """
        qs = HirePurchaseRegistration.objects.select_related(
            "financier",
            "purchaser_individual",
            "purchaser_company",
            "purchaser_company__company",
        ).all()

        qs = scope_registry_to_client_portfolio(qs, self.request.user)

        if self.action == "list":
            qs = qs.filter(closure_confirmed=False)

        return qs

    @CacheService.cached(tag_prefix="hire-purchase:list", vary_on_user=True)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @CacheService.cached(tag_prefix="hire-purchase:{pk}", vary_on_user=True)
    def retrieve(self, request, *args, **kwargs):
        return super().retrieve(request, *args, **kwargs)

    # ------------------------------------------------------------------
    # Audit-logged CRUD hooks
    # ------------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            instance = serializer.save()
            invalidate_registry_caches(
                registries=[HIRE_PURCHASE_REGISTRY], record_pk=instance.pk
            )
            return self._create_rendered_response(
                serializer.data, status.HTTP_201_CREATED
            )

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

        except Exception as e:
            logger.error(f"Error creating hire purchase registration: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"},
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def update(self, request, *args, **kwargs):
        try:
            partial = kwargs.pop("partial", False)
            instance = self.get_object()
            serializer = self.get_serializer(
                instance, data=request.data, partial=partial
            )
            serializer.is_valid(raise_exception=True)
            instance = serializer.save()
            invalidate_registry_caches(
                registries=[HIRE_PURCHASE_REGISTRY], record_pk=instance.pk
            )
            return self._create_rendered_response(serializer.data)

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

        except Exception as e:
            logger.error(f"Error updating hire purchase registration: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def destroy(self, request, *args, **kwargs):
        try:
            instance = self.get_object()
            record_pk = instance.pk
            self.perform_destroy(instance)
            invalidate_registry_caches(
                registries=[HIRE_PURCHASE_REGISTRY], record_pk=record_pk
            )
            logger.info(
                f"Hire purchase registration with agreement number {instance.agreement_number} deleted by user {request.user}"
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        except Exception as e:
            logger.error(f"Error deleting hire purchase registration: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # ------------------------------------------------------------------
    # Custom actions
    # ------------------------------------------------------------------

    @roles_allowed(["admin", "client_admin"])
    @action(detail=True, methods=["patch"], url_path="confirm-closure")
    def confirm_closure(self, request: Request, pk: int | None = None) -> Response:
        """
        Allows a financier to confirm that an HP agreement has closed.

        A dedicated ``HirePurchaseClosureSerializer`` limits the writable
        surface to the ``closure_confirmed`` flag only, preventing
        unintentional overwrites of other fields.

        The serializer's ``update()`` method stamps ``closure_confirmed_at``
        server-side, removing any possibility of a client supplying a
        fabricated closure timestamp.
        """
        instance: HirePurchaseRegistration = self.get_object()
        serializer = HirePurchaseClosureSerializer(
            instance,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        invalidate_registry_caches(
            registries=[HIRE_PURCHASE_REGISTRY], record_pk=instance.pk
        )
        create_audit_log(
            request=request,
            action="hire_purchase_registration.confirm_closure",
            resource_type="HirePurchaseRegistration",
            resource_id=instance.pk,
            details={"agreement_number": str(instance.agreement_number)},
            logger=logger,
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @CacheService.cached(tag_prefix="hire-purchase:stats", vary_on_user=True)
    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request: Request) -> Response:
        """
        Returns the three headline statistics shown at the top of the HP
        dashboard.
        """
        today = timezone.now().date()
        qs = scope_registry_to_client_portfolio(
            HirePurchaseRegistration.objects.all(),
            request.user,
        )

        active_filter = Q(agreement_end_date__gte=today, closure_confirmed=False)
        # Single aggregate call for the headline metrics. `active_agreements`
        # excludes already-closed records so it can never disagree with the
        # main table, which only ever shows open (non-closed) agreements.
        aggregates: dict = qs.aggregate(
            active_agreements=Count("id", filter=active_filter),
            pending_closure_confirmation=Count(
                "id",
                filter=Q(
                    agreement_end_date__lt=today,
                    closure_confirmed=False,
                ),
            ),
            total_active_loan_value=Sum("purchase_amount", filter=active_filter),
        )
        if aggregates["total_active_loan_value"] is None:
            aggregates["total_active_loan_value"] = 0

        # Distinct-financier count: cannot be folded into the aggregate above
        # without a subquery, so a second lightweight query is used.
        number_of_financiers: int = qs.values("financier_id").distinct().count()

        serializer = HirePurchaseDashboardSerializer(
            data={
                **aggregates,
                "number_of_financiers": number_of_financiers,
            }
        )
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
