# apps/common/api/views.py
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.exceptions import ValidationError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from apps.common.models import (
    Country,
    Province,
    City,
    Suburb,
    Currency,
    CollateralAssetType,
    CustodyType,
    LookupOption,
)
from apps.individuals.models import Individual
from apps.companies.models.models import Company
from apps.common.api.serializers import (
    CountrySerializer,
    CurrencySerializer,
    ProvinceSerializer,
    CitySerializer,
    SuburbSerializer,
    SuburbViewSerializer,
)
from apps.common.api.lookup_serializers import LookupOptionSerializer
from rest_framework.renderers import JSONRenderer
from apps.common.utils.caching import CacheService
from apps.common.utils.lookups import list_lookup_choices
import logging

logger = logging.getLogger("locations")


class BaseViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context.update(
            {
                "request": self.request,
                "created_by": (
                    self.request.user if self.request.user.is_authenticated else None
                ),
            }
        )
        return context

    def perform_create(self, serializer):
        if (
            hasattr(serializer.Meta.model, "created_by")
            and self.request.user.is_authenticated
        ):
            serializer.save(created_by=self.request.user, updated_by=self.request.user)
        else:
            serializer.save()

        if (
            hasattr(serializer.Meta.model, "created_by")
            and not self.request.user.is_authenticated
        ):
            logger.warning(
                f"Creating {serializer.Meta.model.__name__} without authenticated user"
            )

    def perform_update(self, serializer):
        if (
            hasattr(serializer.Meta.model, "created_by")
            and self.request.user.is_authenticated
        ):
            serializer.save(updated_by=self.request.user)
        else:
            serializer.save()

    def _create_rendered_response(self, data, status_code=status.HTTP_200_OK):
        """
        Helper to create and render a DRF Response for consistent caching.
        This method ensures the response content is rendered into a string/bytes
        before it's returned, making it safe for caching backends that pickle.
        """
        response = Response(data, status=status_code)

        if hasattr(self, "get_renderers") and self.get_renderers():
            response.accepted_renderer = self.get_renderers()[0]
            response.accepted_media_type = response.accepted_renderer.media_type
        else:
            response.accepted_renderer = JSONRenderer()
            response.accepted_media_type = "application/json"

        response.renderer_context = self.get_renderer_context()

        try:
            response.render()
        except Exception as e:
            logger.error(f"Failed to render response: {e}")

        return response


class BaseSoftDeleteViewSet(BaseViewSet):

    def get_queryset(self):
        queryset = super().get_queryset()
        if hasattr(self.get_serializer_class().Meta.model, "is_active"):
            return queryset.filter(is_active=True)
        return queryset

    def perform_destroy(self, instance):
        if hasattr(instance, "is_active"):
            instance.is_active = False
            if hasattr(instance, "created_by") and self.request.user.is_authenticated:
                instance.created_by = self.request.user
            instance.save(request=self.request)
            logger.info(
                f"Soft deleted {instance.__class__.__name__} with id {instance.pk}"
            )
        else:
            super().perform_destroy(instance)


class LocationViewSet(BaseViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer

    def get_serializer_class(self):
        if self.action in ["countries", "country_detail"]:
            return CountrySerializer
        elif self.action in ["provinces", "create_province", "province_detail"]:
            return ProvinceSerializer
        elif self.action in ["cities", "create_city", "city_detail"]:
            return CitySerializer
        elif self.action in ["suburbs", "create_suburb", "suburb_detail"]:
            return SuburbSerializer
        return super().get_serializer_class()

    def get_serializer_context(self, include_nested=False):
        context = super().get_serializer_context()
        context.update(
            {
                "include_nested": include_nested,
            }
        )
        return context

    def create_objects_helper(self, request):
        serializer = self.get_serializer_class()(
            data=request.data, context=self.get_serializer_context(include_nested=False)
        )
        if not serializer.is_valid():
            logger.error(f"Validation error: {serializer.errors}")
            raise ValidationError(serializer.errors)
        try:
            self.perform_create(serializer)
        except Exception as e:
            logger.error(
                f"Error creating {self.get_serializer_class().Meta.model.__name__}: {str(e)}"
            )
            raise
        return self._create_rendered_response(serializer.data, status.HTTP_201_CREATED)

    def update_object_helper(self, request, obj):
        partial = request.method == "PATCH"
        serializer = self.get_serializer_class()(
            obj,
            data=request.data,
            partial=partial,
            context=self.get_serializer_context(include_nested=False),
        )
        if not serializer.is_valid():
            logger.error(f"Validation error: {serializer.errors}")
            raise ValidationError(serializer.errors)

        self.perform_update(serializer)
        return self._create_rendered_response(serializer.data, status.HTTP_200_OK)

    def delete_object_helper(self, obj):
        if hasattr(obj, "is_active"):
            obj.is_active = False
            if hasattr(obj, "created_by") and self.request.user.is_authenticated:
                obj.created_by = self.request.user
            obj.save(request=self.request)
            logger.info(f"Soft deleted {obj.__class__.__name__} with id {obj.pk}")
        else:
            obj.delete()
            logger.info(f"Hard deleted {obj.__class__.__name__} with id {obj.pk}")

        return self._create_rendered_response(
            {"message": "Deleted successfully."}, status.HTTP_204_NO_CONTENT
        )

    @CacheService.cached(
        tag_prefix="locations:countries", timeout=CacheService.LONG_CACHE_TIMEOUT
    )
    def countries(self, request, pk=None):
        if pk is not None:
            return self.country_detail(request, pk)

        queryset = Country.objects.filter(is_active=True)
        serializer = self.get_serializer(
            queryset,
            many=True,
            context=self.get_serializer_context(include_nested=False),
        )
        return self._create_rendered_response(serializer.data)

    def country_detail(self, request, pk=None):
        country = get_object_or_404(Country, pk=pk)

        if request.method == "GET":
            serializer = self.get_serializer(
                country, context=self.get_serializer_context(include_nested=True)
            )
            return self._create_rendered_response(serializer.data)
        elif request.method in ["PUT", "PATCH"]:
            return self.update_object_helper(request, country)
        elif request.method == "DELETE":
            return self.delete_object_helper(country)

    @CacheService.cached(tag_prefix="locations:provinces")
    def provinces(self, request):
        queryset = Province.objects.select_related("country").filter(is_active=True)
        if country_id := request.query_params.get("country_id"):
            queryset = queryset.filter(country_id=country_id)

        serializer = self.get_serializer(
            queryset,
            many=True,
            context=self.get_serializer_context(include_nested=False),
        )
        return self._create_rendered_response(serializer.data)

    def create_province(self, request):
        return self.create_objects_helper(request)

    def province_detail(self, request, pk=None):
        # province = get_object_or_404(Province, pk=pk)
        try:
            province = Province.objects.get(id=pk)
            if request.method == "GET":
                serializer = self.get_serializer(
                    province, context=self.get_serializer_context(include_nested=True)
                )
                return self._create_rendered_response(serializer.data)
            elif request.method in ["PUT", "PATCH"]:
                return self.update_object_helper(request, province)
            elif request.method == "DELETE":
                return self.delete_object_helper(province)
        except Exception as e:
            logger.error(f"error: {str(e)}")

    @CacheService.cached(
        tag_prefix="locations:cities", timeout=CacheService.LONG_CACHE_TIMEOUT
    )
    def cities(self, request):
        queryset = City.objects.select_related("province").filter(is_active=True)
        province_id = request.query_params.get("province_id")
        country_id = request.query_params.get("country_id")

        if province_id:
            queryset = queryset.filter(province_id=province_id)
        elif country_id:
            queryset = queryset.filter(province__country_id=country_id)

        serializer = self.get_serializer(
            queryset,
            many=True,
            context=self.get_serializer_context(include_nested=False),
        )
        return self._create_rendered_response(serializer.data)

    def create_city(self, request):
        return self.create_objects_helper(request)

    def city_detail(self, request, pk=None):
        city = get_object_or_404(City, pk=pk)

        if request.method == "GET":
            serializer = self.get_serializer(
                city, context=self.get_serializer_context(include_nested=True)
            )
            return self._create_rendered_response(serializer.data)
        elif request.method in ["PUT", "PATCH"]:
            return self.update_object_helper(request, city)
        elif request.method == "DELETE":
            return self.delete_object_helper(city)

    @CacheService.cached(
        tag_prefix="locations:suburbs", timeout=CacheService.LONG_CACHE_TIMEOUT
    )
    def suburbs(self, request):
        queryset = Suburb.objects.select_related("city").filter(is_active=True)
        city_id = request.query_params.get("city_id")
        province_id = request.query_params.get("province_id")
        country_id = request.query_params.get("country_id")

        if city_id:
            queryset = queryset.filter(city_id=city_id)
        elif province_id:
            queryset = queryset.filter(city__province_id=province_id)
        elif country_id:
            queryset = queryset.filter(city__province__country_id=country_id)

        serializer = self.get_serializer(
            queryset,
            many=True,
            context=self.get_serializer_context(include_nested=False),
        )
        return self._create_rendered_response(serializer.data)

    def create_suburb(self, request):
        return self.create_objects_helper(request)

    def suburb_detail(self, request, pk=None):
        suburb = get_object_or_404(Suburb, pk=pk)

        if request.method == "GET":
            serializer = self.get_serializer(
                suburb, context=self.get_serializer_context(include_nested=True)
            )
            return self._create_rendered_response(serializer.data)
        elif request.method in ["PUT", "PATCH"]:
            return self.update_object_helper(request, suburb)
        elif request.method == "DELETE":
            return self.delete_object_helper(suburb)

    @CacheService.cached(tag_prefix="locations:hierarchy")
    def location_hierarchy(self, request):
        countries = Country.objects.filter(is_active=True)
        country_serializer = self.get_serializer(
            countries,
            many=True,
            context=self.get_serializer_context(include_nested=True),
        )

        data = {
            "countries": country_serializer.data,
        }
        return self._create_rendered_response(data)


class SuburbViewSet(viewsets.ReadOnlyModelViewSet):
    # city -> province -> country for every row, so all three must be joined.
    queryset = Suburb.objects.select_related("city__province__country").filter(
        is_active=True
    )
    serializer_class = SuburbViewSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        if search := self.request.query_params.get("search"):
            return self.queryset.filter(name__icontains=search)
        return self.queryset


class CurrencyViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Currency.objects.all()
    serializer_class = CurrencySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None


class LookupOptionViewSet(viewsets.ModelViewSet):
    """
    Manage PartyType / BaseAssetType / AssetCondition options.

    - List/retrieve: any authenticated user
    - Create/delete: staff only
    - System-seeded rows cannot be deleted
    - In-use values cannot be deleted
    """

    serializer_class = LookupOptionSerializer
    pagination_class = None
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_permissions(self):
        if self.action in ("create", "destroy"):
            return [IsAuthenticated(), IsAdminUser()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = LookupOption.objects.all().order_by("category", "sort_order", "label")
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        active_only = self.request.query_params.get("active_only", "true").lower()
        if active_only in ("1", "true", "yes"):
            qs = qs.filter(is_active=True)
        return qs

    def perform_destroy(self, instance: LookupOption) -> None:
        if instance.is_system:
            raise ValidationError(
                {"detail": "System lookup options cannot be deleted."}
            )
        if self._option_in_use(instance):
            raise ValidationError(
                {
                    "detail": (
                        f"Cannot delete '{instance.value}' because it is still "
                        "referenced by one or more records."
                    )
                }
            )
        instance.delete()

    @staticmethod
    def _option_in_use(option: LookupOption) -> bool:
        from apps.asset_management.models import AssetRegistration
        from apps.collateral.models.models import CollateralRegistration
        from apps.hire_purchase.models.models import HirePurchaseRegistration

        value = option.value
        if option.category == LookupOption.CATEGORY_PARTY_TYPE:
            return (
                AssetRegistration.objects.filter(
                    Q(owner_type=value) | Q(custodian_type=value)
                ).exists()
                or CollateralRegistration.objects.filter(debtor_type=value).exists()
                or HirePurchaseRegistration.objects.filter(
                    purchaser_type=value
                ).exists()
            )
        if option.category == LookupOption.CATEGORY_BASE_ASSET_TYPE:
            return (
                AssetRegistration.objects.filter(asset_category=value).exists()
                or HirePurchaseRegistration.objects.filter(
                    asset_category=value
                ).exists()
            )
        if option.category == LookupOption.CATEGORY_COLLATERAL_ASSET_CATEGORY:
            return CollateralRegistration.objects.filter(
                asset_category=value
            ).exists()
        if option.category == LookupOption.CATEGORY_ASSET_CONDITION:
            return (
                AssetRegistration.objects.filter(condition=value).exists()
                or HirePurchaseRegistration.objects.filter(condition=value).exists()
                or CollateralRegistration.objects.filter(condition=value).exists()
            )
        if option.category == LookupOption.CATEGORY_INDUSTRY:
            from apps.companies.models.models import Company

            return Company.objects.filter(industry=value, is_deleted=False).exists()
        return False


class CommonChoicesView(APIView):
    """
    Returns available lookup choices for enumeration fields like
    PartyType, BaseAssetType, CollateralAssetType, AssetCondition.

    PartyType, BaseAssetType, and AssetCondition are served from
    ``LookupOption`` (manageable via /api/common/managed-choices/).

    Query parameters:
    ?types=PartyType (comma separated list to only return requested types)
    """

    permission_classes = [IsAuthenticated]

    @CacheService.cached(
        tag_prefix=CacheService.CHOICES_COMMON_TAG,
        timeout=CacheService.HEAVY_CACHE_TIMEOUT,
    )
    def get(self, request, *args, **kwargs):
        all_choices = {
            "PartyType": list_lookup_choices(LookupOption.CATEGORY_PARTY_TYPE),
            "BaseAssetType": list_lookup_choices(
                LookupOption.CATEGORY_BASE_ASSET_TYPE
            ),
            "CollateralAssetCategory": list_lookup_choices(
                LookupOption.CATEGORY_COLLATERAL_ASSET_CATEGORY
            ),
            # Alias for older clients still requesting CollateralAssetType.
            "CollateralAssetType": list_lookup_choices(
                LookupOption.CATEGORY_COLLATERAL_ASSET_CATEGORY
            ),
            "AssetCondition": list_lookup_choices(
                LookupOption.CATEGORY_ASSET_CONDITION
            ),
            "Industry": list_lookup_choices(LookupOption.CATEGORY_INDUSTRY),
            "CustodyType": [
                {"value": choice.value, "label": choice.label}
                for choice in CustodyType
            ],
            "IdentificationType": [
                {"value": value, "label": label}
                for value, label in Individual.IDENTIFICATION_TYPES
            ],
            "LegalStatus": [
                {"value": value, "label": label}
                for value, label in Company.LEGAL_STATUS_CHOICES
            ],
        }

        # Fallback to TextChoices if lookup table has not been seeded yet.
        if not all_choices["PartyType"]:
            from apps.common.models import PartyType

            all_choices["PartyType"] = [
                {"value": c.value, "label": c.label} for c in PartyType
            ]
        if not all_choices["BaseAssetType"]:
            from apps.common.models import BaseAssetType

            all_choices["BaseAssetType"] = [
                {"value": c.value, "label": c.label} for c in BaseAssetType
            ]
        if not all_choices["CollateralAssetCategory"]:
            all_choices["CollateralAssetCategory"] = [
                {"value": c.value, "label": c.label} for c in CollateralAssetType
            ]
            all_choices["CollateralAssetType"] = all_choices[
                "CollateralAssetCategory"
            ]
        if not all_choices["AssetCondition"]:
            from apps.common.models import AssetCondition

            all_choices["AssetCondition"] = [
                {"value": c.value, "label": c.label} for c in AssetCondition
            ]
        if not all_choices["Industry"]:
            from apps.companies.models.models import Industry

            all_choices["Industry"] = [
                {"value": c.value, "label": c.label} for c in Industry
            ]

        requested_types = request.query_params.get("types")
        if requested_types:
            type_keys = [t.strip() for t in requested_types.split(",")]
            filtered_choices = {k: v for k, v in all_choices.items() if k in type_keys}
            return Response(filtered_choices)

        return Response(all_choices)
