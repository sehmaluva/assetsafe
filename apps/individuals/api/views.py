from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError

from apps.individuals.api.serializers import (
    IndividualAddressSerializer,
    # IndividualClaimSerializer,
    IndividualSerializer,
    IndividualCreateSerializer,
    IndividualSearchSerializer,
    IndividualMinimalSerializer,
)
from apps.individuals.models import Individual
from apps.common.api.views import BaseViewSet
from apps.common.utils import CacheService, extract_error_message
from apps.individuals.services.tasks import process_individuals_csv
from apps.common.services.external_registry import ExternalRegistryClient
from apps.individuals.services.external_import import import_external_individual
from rest_framework import serializers

import logging

logger = logging.getLogger("individuals")


class ExternalImportSerializer(serializers.Serializer):
    external_reference = serializers.CharField(required=True)


class IndividualViewSet(BaseViewSet):
    """ViewSet for managing individuals.
    Supports CRUD operations and additional actions like search, verify, activate, and retrieve full details.
    1. list: List all individuals with optional search functionality.
    2. create: Create a new individual.
    3. retrieve: Retrieve a specific individual by ID.
    4. update: Update an existing individual.
    5. partial_update: Partially update an existing individual.
    6. destroy: Soft delete an individual.
    7. search: Search individuals by first name, last name, or identification number.
    8. verify_individual: Toggle the verification status of an individual.
    9. activate_individual: Toggle the active status of an individual.
    10. un_delete: Restore a soft-deleted individual.
    """

    permission_classes = [IsAuthenticated]
    queryset = Individual.objects.filter(is_active=True, is_deleted=False)

    def get_queryset(self):
        search_key = (
            self.request.query_params.get("q", "").strip()
            or self.request.query_params.get("search", "").strip()
        )
        if search_key:
            first_name, *last_name_parts = search_key.split()
            last_name = " ".join(last_name_parts) if last_name_parts else first_name
            return self.queryset.filter(
                Q(first_name__icontains=first_name)
                | Q(last_name__icontains=last_name)
                | Q(identification_number__icontains=search_key)
            ).prefetch_related(
                "addresses",
                "employment_details",
                "next_of_kin",
                "notes",
                "documents",
                "contact_details",
            )
        return self.queryset.prefetch_related(
            "addresses",
            "employment_details",
            "next_of_kin",
            "notes",
            "documents",
            "contact_details",
        ).order_by("-date_created")

    def get_serializer_class(self):
        if self.action in ["update", "partial_update", "create"]:
            return IndividualCreateSerializer
        elif self.action in ["search_individuals", "details", "list"]:
            return IndividualSearchSerializer
        elif self.action == "retrieve_full_individual_details":
            return IndividualSerializer
        elif self.action == "search":
            return IndividualSearchSerializer
        elif self.action == "claims":
            return IndividualClaimSerializer
        return IndividualMinimalSerializer

    def create(self, request, *args, **kwargs):
        try:

            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return self._create_rendered_response(
                serializer.data, status.HTTP_201_CREATED
            )

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )

        except Exception as e:
            logger.error(f"Error creating individual: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def update(self, request, *args, **kwargs):
        try:
            partial = kwargs.pop("partial", False)
            instance = self.get_object()
            serializer = self.get_serializer(
                instance, data=request.data, partial=partial
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return self._create_rendered_response(serializer.data, status.HTTP_200_OK)

        except ValidationError as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)}, status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Error updating individual: {extract_error_message(e)}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @CacheService.cached(tag_prefix="individual:list")
    def list(self, *args, **kwargs):
        try:
            queryset = self.get_queryset()
            page = self.paginate_queryset(queryset)
            logger.info(f"Listing individuals, total count: {queryset.count()}")
            if page is not None:
                serializer = IndividualSearchSerializer(page, many=True)
                return self.get_paginated_response(serializer.data)
        except Exception as e:
            logger.error(f"Error listing individuals: {str(e)}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @CacheService.cached(tag_prefix="individual:{pk}")
    def retrieve(self, request, *args, **kwargs):
        try:
            individual = self.get_object()
            serializer = self.get_serializer(individual)
            return self._create_rendered_response(serializer.data, status.HTTP_200_OK)
        except Individual.DoesNotExist:
            logger.error(f"Individual with ID {id} Does not exist")
            return self._create_rendered_response(
                {"error": "Individual does not exist"},
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        except Exception as e:
            logger.error(f"Failed to retrieve individual: {str(e)} ")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def destroy(self, request, *args, **kwargs):
        logger.info(f"Soft deleting individual with ID: {kwargs.get('pk', 'unknown')}")
        try:
            instance = self.get_object()
            instance.is_deleted = True
            instance.is_active = False
            instance.save()
            logger.info(f"Individual {instance.pk} soft deleted by user {request.user}")
            return self._create_rendered_response({instance.data}, status.HTTP_200_OK)
        except Individual.DoesNotExist:
            return self._create_rendered_response(
                {"error": "Individual not found"}, status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"Error deleting individual: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=["get"], url_path="search")
    def search(self, request, *args, **kwargs):
        search_key = (
            request.query_params.get("q", "").strip()
            or request.query_params.get("search", "").strip()
        )
        if not search_key:
            return self._create_rendered_response([], status.HTTP_200_OK)

        queryset = self.filter_queryset(self.get_queryset())[:25]
        if queryset.exists():
            serializer = self.get_serializer(queryset, many=True)
            return self._create_rendered_response(serializer.data, status.HTTP_200_OK)

        client = ExternalRegistryClient()
        if client.is_configured:
            external_results = client.search_individuals(search_key)[:25]
            return self._create_rendered_response(
                external_results, status.HTTP_200_OK
            )

        return self._create_rendered_response([], status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="import-external")
    def import_external(self, request, *args, **kwargs):
        serializer = ExternalImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            individual = import_external_individual(
                serializer.validated_data["external_reference"],
                created_by=request.user,
            )
            return self._create_rendered_response(
                IndividualSearchSerializer(individual).data,
                status.HTTP_201_CREATED,
            )
        except ValueError as exc:
            return self._create_rendered_response(
                {"error": str(exc)}, status.HTTP_404_NOT_FOUND
            )
        except Exception as exc:
            logger.error("Error importing external individual: %s", exc)
            return self._create_rendered_response(
                {"error": "Something went wrong"},
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["PUT", "PATCH"], url_path="verify")
    def verify_individual(self, request, pk=None):
        try:
            individual = Individual.objects.get(pk=pk)
            individual.is_verified = not individual.is_verified
            individual.save()
            return self._create_rendered_response(
                {
                    "message": f"Individual has been {'verified'  if individual.is_active else 'unverified'}"
                }
            )
        except Individual.DoesNotExist:
            return self._create_rendered_response(
                {"error": "Individual not found"}, status.HTTP_404_NOT_FOUND
            )

        except Exception as e:
            logger.error(f"Error verifying individual: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=["PUT", "PATCH"], url_path="activate")
    def activate_individual(self, request, pk=None):
        try:
            individual = Individual.objects.get(pk=pk)
            individual.is_active = not individual.is_active
            individual.save()

            serializer = IndividualSearchSerializer(individual)
            return self._create_rendered_response(
                {
                    "message": f"Individual has been {'activated'  if individual.is_active else 'deactivated'}"
                }
            )
        except Individual.DoesNotExist:
            return self._create_rendered_response(
                {"error": "Individual not found"}, status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"Error activating individual: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=["PATCH"], url_path="un-delete")
    def un_delete(self, request, pk=None):
        try:
            if individual := Individual.objects.filter(id=pk).first():
                if individual.is_deleted == True:
                    individual.is_deleted = False
                    individual.is_active = True
                    individual.save()
                    logger.info(f"Individual {pk} has been un deleted")
                    return self._create_rendered_response(
                        "Individual has been activated successfully"
                    )
                else:
                    return self._create_rendered_response(
                        "This Individual Is already active"
                    )
            else:
                return self._create_rendered_response("Individual does not exist")
        except Exception as e:
            logger.error(f"Error Deleting individual: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=["GET"], url_path="view-deleted")
    def view_deleted(self, request, pk=None):
        try:
            if individuals := Individual.objects.filter(is_deleted=True):
                serializer = IndividualSearchSerializer(individuals, many=True)
                return self._create_rendered_response(
                    serializer.data, status.HTTP_200_OK
                )
            else:
                return self._create_rendered_response(
                    {"message": "No deleted individuals found"},
                    status.HTTP_404_NOT_FOUND,
                )
        except Exception as e:
            logger.error(f"Error fetching deleted individuals: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @CacheService.cached(tag_prefix="individual:{pk}:full-details")
    @action(detail=True, methods=["GET"], url_path="full-details")
    def retrieve_full_individual_details(self, request, pk=None):
        """Retrieve full detailed information about an individual."""
        try:
            individual = self.get_queryset().get(pk=pk)
            serializer = IndividualSerializer(individual)
            return self._create_rendered_response(serializer.data, status.HTTP_200_OK)

        except Individual.DoesNotExist:
            logger.error(f"Individual with ID {pk} does not exist.")
            return self._create_rendered_response(
                {"error": "Individual not found"}, status.HTTP_404_NOT_FOUND
            )

        except Exception as e:
            logger.error(f"Error fetching individual full details: {e}")
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=["get"], url_path="claims")
    def claims(self, request, pk=None):
        """Retrieve all claims associated with individuals."""
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
            logger.error(
                f"Error retrieving claims for individuals: {extract_error_message(e)}"
            )
            return self._create_rendered_response(
                {"error": "Something went wrong"}, status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class BulkUpload(BaseViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="run")
    def post(self, request):
        file = request.FILES.get("file")
        import os
        import tempfile

        if not file:
            return self._create_rendered_response(
                {"error": "No file uploaded"}, status.HTTP_400_BAD_REQUEST
            )

        ext = file.name.split(".")[-1].lower()
        if ext != "csv":
            return self._create_rendered_response(
                {"error": "Unsupported file type. Please upload .csv files"},
                status.HTTP_400_BAD_REQUEST,
            )

        try:
            # Save the uploaded file to a temporary location
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
                for chunk in file.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name

            process_individuals_csv.delay(tmp_path)

        except Exception as e:
            return self._create_rendered_response(
                {"error": extract_error_message(e)},
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return self._create_rendered_response(
            {"message": "File processing started successfully"}, status.HTTP_200_OK
        )
