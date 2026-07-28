# apps/companies/api/views.py
from rest_framework import viewsets, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction, IntegrityError
from django.contrib.contenttypes.models import ContentType
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound
from rest_framework.filters import SearchFilter, OrderingFilter
from django_filters.rest_framework import DjangoFilterBackend
from apps.common.api.views import BaseViewSet
from apps.common.utils.caching import CacheService
from apps.common.api.serializers import DocumentSerializer
from apps.companies.models.models import Company, CompanyBranch
from apps.companies.api.serializers import (
    # CompanyClaimSerializer,
    CompanyCreateSerializer,
    CompanyUpdateSerializer,
    CompanyDetailSerializer,
    CompanyMinimalSerializer,
    CompanyBranchSearchSerializer,
    CompanyBranchSerializer,
    CompanyBranchDetailSerializer,
    CompanyBranchMinimalSerializer,
    CompanyBranchLeaseDetailSerializer,
)
from apps.companies.utils.filters import CompanyBranchFilter
from apps.common.utils import extract_error_message
from apps.common.services.external_registry import ExternalRegistryClient
from apps.companies.services.external_import import import_external_company
from rest_framework import serializers
import logging
from celery.result import AsyncResult

logger = logging.getLogger("companies")


class ExternalImportSerializer(serializers.Serializer):
    external_reference = serializers.CharField(required=True)


class CompanyViewSet(BaseViewSet):
    """
    ViewSet for managing Company instances.
    Handles CRUD operations and company-specific actions.
    """

    queryset = (
        Company.objects.filter(is_deleted=False)
        .prefetch_related("addresses", "profile", "branches")
        .order_by("-date_created")
    )
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    search_fields = [
        "registration_name",
        "trading_name",
        "registration_number",
    ]

    def get_serializer_class(self):
        """Return appropriate serializer based on action"""
        if self.action == "list":  # List of Companies, not branches
            return CompanyMinimalSerializer
        elif self.action == "create":
            return CompanyCreateSerializer
        elif self.action in [
            "update",
            "partial_update",
            "toggle_active",
            "toggle_verified",
            "soft_delete",
        ]:
            return CompanyUpdateSerializer
        elif self.action == "retrieve":
            return CompanyDetailSerializer
        elif self.action == "search":
            return CompanyMinimalSerializer  # For company search results
        return (
            CompanyDetailSerializer  # Default for other specific actions if not caught
        )

    def create(self, request, *args, **kwargs):
        """Create a new company and its HQ branch."""
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)

            company = serializer.instance
            hq_branch = company.branches.filter(is_headquarters=True).first()
            if hq_branch:
                response_serializer = CompanyBranchDetailSerializer(hq_branch)
                return self._create_rendered_response(
                    response_serializer.data, status.HTTP_201_CREATED
                )
            else:
                return self._create_rendered_response(
                    {"error": "Company created but HQ branch not found"},
                    status.HTTP_201_CREATED,
                )
        except Exception as e:
            logger.error(f"Error creating company: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @CacheService.cached(tag_prefix="company:{pk}")
    def retrieve(self, request, *args, **kwargs):
        """Retrieve full Company details, with caching."""
        try:
            company = self.get_object()  # self.get_object() uses self.queryset
            logger.info(f"Fetching company {company.id} from the DB....")
            serializer = self.get_serializer(company)
            return self._create_rendered_response(serializer.data)
        except Company.DoesNotExist:
            raise NotFound({"error": "Company not found"})

    def update(self, request, *args, **kwargs):
        """Update company (PUT request), using perform_update from BaseViewSet."""
        try:
            partial = kwargs.pop("partial", False)
            instance = self.get_object()  # This is the Company instance now
            serializer = self.get_serializer(
                instance, data=request.data, partial=partial
            )
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)  # This saves the company

            # Return the updated Company details, not just HQ branch
            detail_serializer = CompanyDetailSerializer(
                instance
            )  # Serialize the company itself
            return self._create_rendered_response(detail_serializer.data)

        except Exception as e:
            logger.error(
                f"Error updating company {kwargs.get('pk', 'unknown')}: {str(e)}"
            )
            return self._create_rendered_response(
                {"error": "Failed to update company", "details": str(e)},
                status.HTTP_400_BAD_REQUEST,
            )

    @CacheService.cached(tag_prefix="companies:list")
    def list(self, request, *args, **kwargs):
        """List companies with minimal data, with caching."""
        try:
            queryset = self.filter_queryset(self.get_queryset())
            page = self.paginate_queryset(queryset)
            logger.info(f"Listing companies, total count: {queryset.count()}")

            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = self.get_serializer(queryset, many=True)
            return self._create_rendered_response(serializer.data)
        except Exception as e:
            logger.error(f"Error listing companies: {str(e)}")
            return self._create_rendered_response(
                {"error": "Failed to list companies", "details": str(e)},
                status.HTTP_400_BAD_REQUEST,
            )

    def destroy(self, request, *args, **kwargs):
        """
        Soft delete a company and all its associated branches.
        """
        try:
            company = self.get_object()
            logger.info(f"Soft deleting company with ID: {company.id}")

            with transaction.atomic():
                company.is_deleted = True
                company.is_active = False
                company.save()

                company.branches.filter(is_deleted=False).update(is_deleted=True)

            return self._create_rendered_response(
                {"message": "Company and all branches deleted successfully"},
                status.HTTP_204_NO_CONTENT,
            )
        except Company.DoesNotExist:
            logger.error(
                f"Company with ID {kwargs.get('pk', 'unknown')} not found for deletion."
            )
            raise NotFound({"error": "Company not found"})
        except Exception as e:
            logger.error(
                f"Error soft deleting company {kwargs.get('pk', 'unknown')}: {str(e)}"
            )
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=["post"], url_path="toggle-active")
    def toggle_active(self, request, pk=None):
        """Toggle company active/deleted status"""
        try:
            company = self.get_object()
            company.is_active = not company.is_active
            company.is_deleted = not company.is_active
            company.save()
            serializer = self.get_serializer(company)
            return self._create_rendered_response(
                {
                    "message": f"Company has been {'activated' if company.is_active else 'deactivated'}",
                    "company": serializer.data,
                },
                status.HTTP_200_OK,
            )
        except Company.DoesNotExist:
            raise NotFound({"error": "Company not found"})

    @action(detail=False, methods=["get"], url_path="company-branches")
    def company_branches(self, request):
        """Get all branches for all companies."""
        company = request.query_params.get("company_id")
        try:
            branches = (
                CompanyBranch.objects.filter(company__id=company, is_deleted=False)
                .select_related("company")
                .order_by("-date_created")
            )
            serializer = CompanyBranchSearchSerializer(branches, many=True)
            return self._create_rendered_response(serializer.data)
        except Exception as e:
            logger.error(f"Error fetching company branches: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=["post"], url_path="toggle-verified")
    def toggle_verified(self, request, pk=None):
        """Toggle company verified status"""
        company = self.get_object()
        company.is_verified = not company.is_verified
        company.save()

        serializer = self.get_serializer(company)
        return self._create_rendered_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="add-documents")
    def add_document(self, request, pk=None):
        try:
            company = self.get_object()
            serializer = DocumentSerializer(
                data=request.data,
                context={
                    "content_type": ContentType.objects.get_for_model(Company),
                    "object_id": company.id,
                },
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return self._create_rendered_response(
                serializer.data, status.HTTP_201_CREATED
            )
        except Exception as e:
            logger.error(f"Error adding document to company {pk}: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=["post"], url_path="import-external")
    def import_external(self, request, *args, **kwargs):
        serializer = ExternalImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            branch = import_external_company(
                serializer.validated_data["external_reference"],
                created_by=request.user,
            )
            return self._create_rendered_response(
                CompanyBranchDetailSerializer(branch).data,
                status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return self._create_rendered_response(
                {"error": str(exc)}, status.HTTP_404_NOT_FOUND
            )
        except Exception as exc:
            logger.error("Error importing external company: %s", exc)
            return self._create_rendered_response(
                {"error": "Something went wrong"},
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class CompanyBranchViewSet(BaseViewSet):
    """
    ViewSet for managing CompanyBranch instances.
    Handles CRUD operations for branches.
    """

    queryset = (
        CompanyBranch.objects.filter(is_deleted=False, company__is_deleted=False)
        .select_related("company")
        .prefetch_related("addresses")
    )
    serializer_class = CompanyBranchSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = CompanyBranchFilter
    filterset_fields = [
        "company",
        "is_headquarters",
        "is_deleted",
        "company__is_verified",
        "company__legal_status",
    ]

    search_fields = [
        "branch_name",
        "email",
        "phone",
        "company__trading_name",
        "company__registration_name",
        "company__registration_number",
    ]

    ordering_fields = [
        "branch_name",
        "company__registration_name",
        "company__trading_name",
        "date_created",
        "company__date_of_incorporation",
    ]
    ordering = ["-date_created"]

    def get_serializer_class(self):
        """Return appropriate serializer based on action"""
        if self.action == "list":
            return CompanyBranchMinimalSerializer
        elif self.action == "retrieve":
            return CompanyBranchDetailSerializer
        elif self.action in ["create", "update", "partial_update"]:
            return CompanyBranchSerializer
        elif self.action == "branches_by_company":
            return CompanyBranchSerializer
        return CompanyBranchMinimalSerializer

    def create(self, request, *args, **kwargs):
        """Create a new branch."""
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            branch = serializer.save()
            return self._create_rendered_response(
                CompanyBranchMinimalSerializer(branch).data, status.HTTP_201_CREATED
            )
        except IntegrityError:
            return self._create_rendered_response(
                {"error": "A branch with this name already exists for this company."},
                status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logger.error(f"Error creating branch: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    def retrieve(self, request, pk=None):
        """Retrieve details of a specific branch."""
        try:
            branch = self.get_queryset().get(pk=pk)
            serializer = self.get_serializer(branch)
            return self._create_rendered_response(serializer.data)
        except CompanyBranch.DoesNotExist:
            raise NotFound({"error": "Branch not found"})
        except Exception as e:
            logger.error(f"Error retrieving branch {pk}: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    def update(self, request, pk=None, *args, **kwargs):
        """Update a specific branch."""
        try:
            branch = self.get_queryset().get(pk=pk)
            partial = kwargs.pop("partial", False)
            serializer = self.get_serializer(
                branch, data=request.data, partial=partial, context={"request": request}
            )

            serializer.is_valid(raise_exception=True)
            updated_branch = serializer.save()

            response_serializer = self.get_serializer(updated_branch)
            return self._create_rendered_response(response_serializer.data)
        except CompanyBranch.DoesNotExist:
            raise NotFound({"error": "Branch not found"})
        except Exception as e:
            logger.error(f"Error updating branch {pk}: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    def destroy(self, request, pk=None):
        """Soft delete a specific branch."""
        try:
            branch = self.get_queryset().get(pk=pk)
            branch.is_deleted = True
            branch.save()
            return self._create_rendered_response(
                {"message": "Branch deleted successfully"}, status.HTTP_204_NO_CONTENT
            )
        except CompanyBranch.DoesNotExist:
            raise NotFound({"error": "Branch not found"})
        except Exception as e:
            logger.error(f"Error soft deleting branch {pk}: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=["delete"], url_path="permanent")
    def permanent_delete(self, request, pk=None):
        """Permanently delete a specific branch."""
        try:
            branch = get_object_or_404(CompanyBranch.objects.all(), pk=pk)
            branch.delete()
            return self._create_rendered_response(
                {"message": "Branch deleted successfully"}, status.HTTP_204_NO_CONTENT
            )
        except Exception as e:
            logger.error(f"Error permanently deleting branch {pk}: {str(e)}")
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=["get"], url_path="search")
    def search(self, request):
        """Search company branches by name or associated company details."""
        search_term = request.query_params.get("q", "").strip()

        if not search_term:
            return self._create_rendered_response(
                {"error": "Search term (q) is required"}, status.HTTP_400_BAD_REQUEST
            )

        branches = (
            self.get_queryset()
            .filter(
                Q(branch_name__icontains=search_term)
                | Q(company__trading_name__icontains=search_term)
                | Q(company__registration_number__icontains=search_term)
            )
            .select_related("company", "company__profile")
            .prefetch_related(
                "company__addresses",
                "company__addresses__country",
                "company__addresses__province",
                "company__addresses__city",
                "company__addresses__suburb",
                "addresses",
                "addresses__country",
                "addresses__province",
                "addresses__city",
                "addresses__suburb",
            )
        )

        if branches.exists():
            page = self.paginate_queryset(branches)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = self.get_serializer(branches, many=True)
            return self._create_rendered_response(serializer.data)

        client = ExternalRegistryClient()
        if client.is_configured:
            external_results = client.search_companies(search_term)[:25]
            return self._create_rendered_response(external_results)

        return self._create_rendered_response([])

    @action(detail=False, methods=["get"], url_path="claims")
    def claims(self, request, pk=None):
        """Get all claims associated with a company's branches."""
        try:
            queryset = self.get_queryset()
            queryset = self.filter_queryset(queryset)
            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)
            serializer = self.get_serializer(queryset, many=True)
            return self._create_rendered_response(serializer.data, status.HTTP_200_OK)
        except Exception as e:
            logger.error(f"Error retrieving company claims: {extract_error_message(e)}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )
