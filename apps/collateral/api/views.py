"""
views.py — Collateral

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
from apps.common.utils.helpers import (
    extract_error_message,
    scope_registry_to_client_portfolio,
)
from apps.users.utils.permissions import HasRole, roles_allowed
from apps.asset_management.api.views import StandardResultsSetPagination
from apps.collateral.models.models import CollateralRegistration
from apps.common.api.views import BaseViewSet
from apps.common.utils.caching import CacheService
from apps.common.utils.registry_cache import (
    COLLATERAL_REGISTRY,
    invalidate_registry_caches,
)

# from apps.users.services.audit_service import create_audit_log
from .serializers import (
    CollateralDashboardSerializer,
    CollateralDischargeSerializer,
    CollateralRegistrationListSerializer,
    CollateralRegistrationSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Collateral Registry ViewSet
# ---------------------------------------------------------------------------


class CollateralRegistrationViewSet(BaseViewSet):
    """
    CRUD ViewSet for the Collateral Registry.
    """

    serializer_class = CollateralRegistrationSerializer
    permission_classes = [IsAuthenticated, HasRole]
    required_roles = [
        "admin",
        "client_admin",
        "client_user",
        "company_client",
        "individual_client",
    ]
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
        "individual_debtor",
        "company_debtor",
        "is_discharged",
        "currency",
        "debtor_type",
    ]
    SEARCH_FIELD_MAP: dict[str, list[str]] = {
        "agreement_number": ["agreement_number"],
        "debtor": [
            "individual_debtor__first_name",
            "individual_debtor__last_name",
            "individual_debtor__identification_number",
            "company_debtor__branch_name",
            "company_debtor__company__registration_name",
            "company_debtor__company__trading_name",
        ],
        "reg_serial_number": [
            "serial_number",
            "asset_registration_number",
            "chassis_number",
        ],
        "financier": ["financier__name", "financier__external_client_id"],
    }
    DEFAULT_SEARCH_FIELDS: list[str] = [
        "agreement_number",
        "individual_debtor__first_name",
        "individual_debtor__last_name",
        "individual_debtor__identification_number",
        "company_debtor__branch_name",
        "company_debtor__company__registration_name",
        "company_debtor__company__trading_name",
        "serial_number",
        "asset_registration_number",
        "chassis_number",
        "financier__name",
        "financier__external_client_id",
    ]
    ordering_fields: list[str] = [
        "lodge_date",
        "agreement_start_date",
        "agreement_end_date",
        "total_debt",
    ]
    ordering: list[str] = ["-lodge_date"]

    @property
    def search_fields(self) -> list[str]:
        """
        Scopes ``SearchFilter`` to the fields backing the selected
        ``search_field`` criteria (e.g. "Agreement Number", "Debtor",
        "Reg/Serial Number"). Any unrecognised/absent value searches the
        full default field set.
        """
        search_field = self.request.query_params.get("search_field")
        return self.SEARCH_FIELD_MAP.get(search_field, self.DEFAULT_SEARCH_FIELDS)

    def get_serializer_class(self):
        """
        Return the appropriate serializer class based on the requested action.
        We return the lighter ListSerializer for list actions for performance.
        """
        if self.action == "list":
            return CollateralRegistrationListSerializer
        return super().get_serializer_class()

    def get_queryset(self) -> QuerySet[CollateralRegistration]:
        """
        Returns all collateral records with party relations eagerly loaded via
        ``select_related`` to prevent N+1 queries when list responses render
        ``financier_display`` and ``debtor_display``.

        Client users only see records belonging to their own portfolio, i.e.
        records where their client is the ``financier``. This mirrors the
        filter used by ``stats()`` so the list total and headline counts
        never disagree.
        """
        qs = CollateralRegistration.objects.select_related(
            "financier",
            "individual_debtor",
            "company_debtor",
            "company_debtor__company",
            "currency",
            "created_by",
        ).all()
        qs = scope_registry_to_client_portfolio(qs, self.request.user)

        # The main dashboard table should only surface active and
        # pending-discharge agreements; already-discharged records are
        # excluded from the list (but remain reachable directly by id for
        # retrieve/update/delete/discharge).
        if self.action == "list":
            qs = qs.filter(is_discharged=False)

        return qs

    @CacheService.cached(tag_prefix="collateral:list", vary_on_user=True)
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @CacheService.cached(tag_prefix="collateral:{pk}", vary_on_user=True)
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
                registries=[COLLATERAL_REGISTRY], record_pk=instance.pk
            )
            return self._create_rendered_response(
                serializer.data, status.HTTP_201_CREATED
            )

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

        except Exception as e:
            logger.error("Error creating collateral registration: %s", e)
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
                registries=[COLLATERAL_REGISTRY], record_pk=instance.pk
            )
            return self._create_rendered_response(serializer.data)

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

        except Exception as e:
            logger.error("Error updating collateral registration: %s", e)
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def destroy(self, request, *args, **kwargs):
        try:
            instance = self.get_object()
            record_pk = instance.pk
            self.perform_destroy(instance)
            invalidate_registry_caches(
                registries=[COLLATERAL_REGISTRY], record_pk=record_pk
            )
            logger.info(
                "Collateral registration with agreement number %s deleted by user %s",
                instance.agreement_number,
                request.user,
            )
            return Response(status=status.HTTP_204_NO_CONTENT)

        except Exception as e:
            logger.error("Error deleting collateral registration: %s", e)
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # def perform_destroy(self, instance):
    #     resource_id = instance.pk
    #     agreement_number = str(instance.agreement_number)
    #     super().perform_destroy(instance)
    #     create_audit_log(
    #         request=self.request,
    #         action="collateral_registration.delete",
    #         resource_type="CollateralRegistration",
    #         resource_id=resource_id,
    #         details={"agreement_number": agreement_number},
    #         logger=logger,
    #     )

    # ------------------------------------------------------------------
    # Custom actions
    # ------------------------------------------------------------------
    @roles_allowed(["admin", "client_admin"])
    @action(detail=True, methods=["patch"], url_path="discharge")
    def discharge(self, request: Request, pk: int | None = None) -> Response:
        """
        Marks a collateral record as officially discharged.

        A dedicated ``CollateralDischargeSerializer`` is used so that this
        PATCH endpoint is scoped to only the ``is_discharged`` flag.  This
        prevents a client from accidentally overwriting unrelated fields (e.g.,
        ``total_debt``) by piggybacking on a discharge call.

        The serializer's ``update()`` method automatically stamps
        ``discharge_confirmed_at`` to guard against a client supplying a
        fabricated timestamp.
        """
        try:
            instance: CollateralRegistration = self.get_object()
            serializer = CollateralDischargeSerializer(
                instance,
                data=request.data,
                partial=True,
            )
            serializer.is_valid(raise_exception=True)
            instance = serializer.save()
            invalidate_registry_caches(
                registries=[COLLATERAL_REGISTRY], record_pk=instance.pk
            )
            # create_audit_log.delay(
            #     request=request,
            #     action="collateral_registration.discharge",
            #     resource_type="CollateralRegistration",
            #     resource_id=instance.pk,
            #     details={"agreement_number": str(instance.agreement_number)},
            #     logger=logger,
            # )
            return self._create_rendered_response(serializer.data)

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @CacheService.cached(tag_prefix="collateral:stats", vary_on_user=True)
    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request: Request) -> Response:
        """
        Returns the two headline statistics shown at the top of the Collateral

        """
        today = timezone.now().date()
        qs = scope_registry_to_client_portfolio(
            CollateralRegistration.objects.all(),
            request.user,
        )

        active_filter = Q(
            agreement_start_date__lte=today,
            agreement_end_date__gte=today,
            is_discharged=False,
        )
        aggregates: dict = qs.aggregate(
            active_agreements=Count("id", filter=active_filter),
            pending_discharge_confirmation=Count(
                "id",
                filter=Q(
                    agreement_end_date__lt=today,
                    is_discharged=False,
                ),
            ),
            total_active_loan_value=Sum("total_debt", filter=active_filter),
        )
        if aggregates["total_active_loan_value"] is None:
            aggregates["total_active_loan_value"] = 0

        serializer = CollateralDashboardSerializer(data=aggregates)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
