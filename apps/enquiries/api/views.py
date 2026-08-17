"""API views for Asset Enquiry (1404 / 1414)."""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.clients.models.models import Client
from apps.enquiries.models import AssetEnquiryLog, EnquiryKind
from apps.enquiries.services.enquiry import build_asset_report, search_assets
from .serializers import (
    AssetEnquiryLogCreateSerializer,
    AssetEnquiryLogSerializer,
    AssetEnquiryReportQuerySerializer,
    AssetEnquirySearchSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()

_ENQUIRY_ROLES = (
    "admin",
    "client_admin",
    "client_user",
    "company_client",
    "individual_client",
)


class CanAccessAssetEnquiry(permissions.BasePermission):
    """Staff/superuser, or a user with an enquiry-capable role."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser or user.is_staff:
            return True
        return user.roles.filter(name__in=_ENQUIRY_ROLES).exists()


class AssetEnquiryLogCreateView(APIView):
    """Create an enquiry session log (required for external / billable enquiries)."""

    permission_classes = [IsAuthenticated, CanAccessAssetEnquiry]

    def post(self, request: Request) -> Response:
        serializer = AssetEnquiryLogCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        requester = None
        client = None
        client_name = data.get("client_name") or ""
        branch_label = data.get("branch_label") or ""

        if data["kind"] == EnquiryKind.EXTERNAL:
            requester = get_object_or_404(User, pk=data["requester_id"])
            if data.get("client_id"):
                client = get_object_or_404(Client, pk=data["client_id"])
            elif requester.client_id:
                client = requester.client
            if client and not client_name:
                client_name = client.name or ""
            if not branch_label and client:
                linked = getattr(client, "client_object", None)
                branch_label = str(linked) if linked else ""

        elif not request.user.is_staff and getattr(request.user, "client_id", None):
            client = request.user.client
            client_name = client.name if client else ""

        log = AssetEnquiryLog.objects.create(
            kind=data["kind"],
            performed_by=request.user,
            requester=requester,
            client=client,
            client_name=client_name,
            branch_label=branch_label,
        )
        return Response(
            AssetEnquiryLogSerializer(log).data,
            status=status.HTTP_201_CREATED,
        )


class AssetEnquirySearchView(APIView):
    """Cross-registry search for Asset Enquiry."""

    permission_classes = [IsAuthenticated, CanAccessAssetEnquiry]

    def get(self, request: Request) -> Response:
        serializer = AssetEnquirySearchSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        hits = search_assets(data["q"], data["search_field"])

        log_id = data.get("enquiry_log_id")
        if log_id:
            AssetEnquiryLog.objects.filter(pk=log_id).update(
                search_query=data["q"],
                search_field=data["search_field"],
                result_found=bool(hits),
            )

        return Response(
            {
                "count": len(hits),
                "results": [
                    {
                        "source": h.source,
                        "id": h.record_id,
                        "agreement_number": h.agreement_number,
                        "reg_number_serial": h.reg_or_serial,
                        "asset_description": h.description,
                    }
                    for h in hits
                ],
            }
        )


class AssetEnquiryReportView(APIView):
    """Masked Asset Report for a searched hit (Clear / Encumbered variants)."""

    permission_classes = [IsAuthenticated, CanAccessAssetEnquiry]

    def get(self, request: Request) -> Response:
        serializer = AssetEnquiryReportQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            unmasked = bool(
                request.user.is_staff or request.user.is_superuser
            )
            report = build_asset_report(
                data["source"], data["id"], unmasked=unmasked
            )
        except Exception as exc:
            logger.exception("Asset enquiry report failed: %s", exc)
            return Response(
                {"error": "Asset report could not be generated."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(report)


class RequesterLookupView(APIView):
    """
    Search users for the external-enquiry Requester field.
    Returns client name + branch hint for autofill.
    Staff only (Fincheck-on-behalf-of-client flow).
    """

    permission_classes = [IsAuthenticated, CanAccessAssetEnquiry]

    def get(self, request: Request) -> Response:
        if not (request.user.is_staff or request.user.is_superuser):
            return Response(
                {"error": "Only staff can look up requesters."},
                status=status.HTTP_403_FORBIDDEN,
            )

        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response([])

        qs = (
            User.objects.filter(is_active=True)
            .select_related("client")
            .filter(
                Q(username__icontains=q)
                | Q(email__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )[:25]
        )
        results = []
        for user in qs:
            client = user.client
            branch = ""
            if client:
                linked = getattr(client, "client_object", None)
                branch = str(linked) if linked else ""
            display = (
                f"{user.get_full_name() or user.username} ({user.email})"
                if user.email
                else (user.get_full_name() or user.username)
            )
            results.append(
                {
                    "id": user.id,
                    "label": display,
                    "client_id": client.id if client else None,
                    "client_name": client.name if client else "",
                    "branch_label": branch,
                }
            )
        return Response(results)
