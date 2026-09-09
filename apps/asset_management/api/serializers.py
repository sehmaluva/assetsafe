"""
serializers.py — Asset Management API
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.asset_management.models import (
    AssetRegistration,
    LandDetails,
    MobileDetails,
    StandSaleTransition,
    VehicleDetails,
)
from apps.asset_management.services.stand_workflows import (
    record_ownership_change,
    record_sale_transition,
)
from apps.common.models import BaseAssetType, Currency, LookupOption
from apps.common.models.models import City
from apps.common.utils.lookups import ensure_valid_lookup_value
from apps.companies.models.models import CompanyBranch
from apps.individuals.models.models import Individual
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.core.exceptions import ValidationError as DjangoValidationError

_OWNER_TYPE_INDIVIDUAL = "individual"
_OWNER_TYPE_COMPANY = "company"
_CUSTODIAN_TYPE_INDIVIDUAL = "individual"
_CUSTODIAN_TYPE_COMPANY = "company"


def _individual_display_name(individual: Individual | None) -> str | None:
    if not individual:
        return None
    name = individual.full_name.strip()
    return name or None


def _company_branch_display_name(branch: CompanyBranch | None) -> str | None:
    if not branch:
        return None
    company = branch.company
    company_name = (
        (company.trading_name or company.registration_name or "").strip()
        if company
        else ""
    )
    branch_name = (branch.branch_name or "").strip()
    if (
        branch_name
        and company_name
        and branch_name.lower()
        not in {
            company_name.lower(),
            (company.registration_name or "").strip().lower(),
            (company.trading_name or "").strip().lower(),
        }
        and not branch.is_headquarters
    ):
        return f"{company_name} — {branch_name}"
    return company_name or branch_name or None

_IDENTIFIER_TEXT_FIELDS: tuple[str, ...] = (
    "serial_number",
    "owner_asset_number",
)


class VehicleDetailsSerializer(serializers.ModelSerializer):
    class Meta:
        model = VehicleDetails
        fields = [
            "mv_registration_number",
            "chassis_number",
            "engine_number",
        ]

    def validate(self, attrs: dict) -> dict:
        for field in ("mv_registration_number", "chassis_number", "engine_number"):
            value = attrs.get(field)
            if isinstance(value, str):
                attrs[field] = value.strip()
        return attrs


class MobileDetailsSerializer(serializers.ModelSerializer):
    class Meta:
        model = MobileDetails
        fields = ["imei"]

    def validate_imei(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("IMEI is required for mobile assets.")
        return value


class LandDetailsSerializer(serializers.ModelSerializer):
    city_name = serializers.CharField(source="city.name", read_only=True)
    suburb_name = serializers.CharField(source="suburb.name", read_only=True)
    stand_size_display = serializers.CharField(read_only=True)
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = LandDetails
        fields = [
            "city",
            "suburb",
            "city_name",
            "suburb_name",
            "stand_address",
            "stand_number",
            "stand_size",
            "stand_size_unit",
            "stand_size_display",
            "valuation_type",
            "title_status",
        ]

    def validate(self, attrs: dict) -> dict:
        suburb = attrs.get("suburb") or (
            getattr(self.instance, "suburb", None) if self.instance else None
        )
        city = attrs.get("city")
        if suburb and not city:
            attrs["city"] = suburb.city
        elif not suburb and not city:
            raise serializers.ValidationError(
                {"suburb": "Suburb/Area/Development is required."}
            )

        for field_name in ("valuation_type", "title_status"):
            value = attrs.get(field_name)
            if value is None and self.instance:
                continue
            if value:
                category = (
                    LookupOption.CATEGORY_VALUATION_TYPE
                    if field_name == "valuation_type"
                    else LookupOption.CATEGORY_TITLE_STATUS
                )
                try:
                    attrs[field_name] = ensure_valid_lookup_value(
                        category, value, field=field_name
                    )
                except DjangoValidationError as exc:
                    raise DRFValidationError(exc.message_dict) from exc

        stand_number = attrs.get(
            "stand_number",
            getattr(self.instance, "stand_number", "") if self.instance else "",
        )
        if isinstance(stand_number, str):
            attrs["stand_number"] = stand_number.strip()

        if "stand_address" in attrs or not self.instance:
            stand_address = attrs.get("stand_address", "")
            if isinstance(stand_address, str):
                stand_address = stand_address.strip()
                attrs["stand_address"] = stand_address
            if not stand_address:
                raise serializers.ValidationError(
                    {"stand_address": "Stand Address is required."}
                )

        return attrs


class StandSaleTransitionWriteSerializer(serializers.Serializer):
    purchaser_type = serializers.ChoiceField(choices=["individual", "company"])
    individual_purchaser = serializers.PrimaryKeyRelatedField(
        queryset=Individual.objects.all(),
        required=False,
        allow_null=True,
    )
    company_purchaser = serializers.PrimaryKeyRelatedField(
        queryset=CompanyBranch.objects.all(),
        required=False,
        allow_null=True,
    )
    sale_date = serializers.DateField()
    terms = serializers.CharField()
    valuation_type = serializers.CharField()
    title_status = serializers.CharField()
    currency = serializers.SlugRelatedField(
        slug_field="code",
        queryset=Currency.objects.all(),
        required=False,
        allow_null=True,
    )
    value_amount = serializers.DecimalField(max_digits=18, decimal_places=2)

    def validate(self, attrs: dict) -> dict:
        purchaser_type = attrs["purchaser_type"]
        individual = attrs.get("individual_purchaser")
        company = attrs.get("company_purchaser")
        errors: dict[str, str] = {}
        if purchaser_type == _OWNER_TYPE_INDIVIDUAL:
            if not individual:
                errors["individual_purchaser"] = "Individual purchaser is required."
            if company:
                errors["company_purchaser"] = "Must be empty for individual purchaser."
        elif purchaser_type == _OWNER_TYPE_COMPANY:
            if not company:
                errors["company_purchaser"] = "Company purchaser is required."
            if individual:
                errors["individual_purchaser"] = "Must be empty for company purchaser."
        if errors:
            raise serializers.ValidationError(errors)

        for field_name, category in (
            ("valuation_type", LookupOption.CATEGORY_VALUATION_TYPE),
            ("title_status", LookupOption.CATEGORY_TITLE_STATUS),
            ("terms", LookupOption.CATEGORY_SALE_TERMS),
        ):
            try:
                attrs[field_name] = ensure_valid_lookup_value(
                    category, attrs[field_name], field=field_name
                )
            except DjangoValidationError as exc:
                raise DRFValidationError(exc.message_dict) from exc
        return attrs


class OwnershipChangeWriteSerializer(serializers.Serializer):
    owner_type = serializers.ChoiceField(choices=["individual", "company"])
    individual_owner = serializers.PrimaryKeyRelatedField(
        queryset=Individual.objects.all(),
        required=False,
        allow_null=True,
    )
    company_owner = serializers.PrimaryKeyRelatedField(
        queryset=CompanyBranch.objects.all(),
        required=False,
        allow_null=True,
    )
    valuation_type = serializers.CharField(required=False, allow_blank=True)
    title_status = serializers.CharField(required=False, allow_blank=True)
    terms = serializers.CharField(required=False, allow_blank=True)
    currency = serializers.SlugRelatedField(
        slug_field="code",
        queryset=Currency.objects.all(),
        required=False,
        allow_null=True,
    )
    value_amount = serializers.DecimalField(
        max_digits=18, decimal_places=2, required=False, allow_null=True
    )

    def validate(self, attrs: dict) -> dict:
        owner_type = attrs["owner_type"]
        individual = attrs.get("individual_owner")
        company = attrs.get("company_owner")
        errors: dict[str, str] = {}
        if owner_type == _OWNER_TYPE_INDIVIDUAL:
            if not individual:
                errors["individual_owner"] = "Individual owner is required."
            if company:
                errors["company_owner"] = "Must be empty for individual owner."
        elif owner_type == _OWNER_TYPE_COMPANY:
            if not company:
                errors["company_owner"] = "Company owner is required."
            if individual:
                errors["individual_owner"] = "Must be empty for company owner."
        if errors:
            raise serializers.ValidationError(errors)

        for field_name, category in (
            ("valuation_type", LookupOption.CATEGORY_VALUATION_TYPE),
            ("title_status", LookupOption.CATEGORY_TITLE_STATUS),
            ("terms", LookupOption.CATEGORY_SALE_TERMS),
        ):
            value = attrs.get(field_name)
            if value:
                try:
                    attrs[field_name] = ensure_valid_lookup_value(
                        category, value, field=field_name
                    )
                except DjangoValidationError as exc:
                    raise DRFValidationError(exc.message_dict) from exc
        return attrs


class StandSaleTransitionReadSerializer(serializers.ModelSerializer):
    purchaser_display = serializers.SerializerMethodField()
    purchaser_id_reg = serializers.SerializerMethodField()
    currency_code = serializers.CharField(source="currency.code", read_only=True)

    class Meta:
        model = StandSaleTransition
        fields = [
            "id",
            "purchaser_type",
            "individual_purchaser",
            "company_purchaser",
            "purchaser_display",
            "purchaser_id_reg",
            "sale_date",
            "terms",
            "valuation_type",
            "title_status",
            "currency_code",
            "value_amount",
            "is_completed",
        ]

    def get_purchaser_display(self, obj: StandSaleTransition) -> str | None:
        if obj.purchaser_type == _OWNER_TYPE_INDIVIDUAL and obj.individual_purchaser:
            return _individual_display_name(obj.individual_purchaser)
        if obj.company_purchaser:
            return _company_branch_display_name(obj.company_purchaser)
        return None

    def get_purchaser_id_reg(self, obj: StandSaleTransition) -> str | None:
        if obj.purchaser_type == _OWNER_TYPE_INDIVIDUAL and obj.individual_purchaser:
            return obj.individual_purchaser.identification_number
        if obj.company_purchaser and obj.company_purchaser.company:
            return obj.company_purchaser.company.registration_number
        return None


class AssetRegistrationSerializer(serializers.ModelSerializer):
    is_active = serializers.SerializerMethodField(read_only=True)
    owner_display = serializers.SerializerMethodField(read_only=True)
    owner_id_reg = serializers.SerializerMethodField(read_only=True)
    stand_status = serializers.SerializerMethodField(read_only=True)
    open_sale = serializers.SerializerMethodField(read_only=True)
    vehicle = VehicleDetailsSerializer(required=False, allow_null=True)
    mobile = MobileDetailsSerializer(required=False, allow_null=True)
    land = LandDetailsSerializer(required=False, allow_null=True)
    currency = serializers.SlugRelatedField(
        slug_field="code",
        queryset=Currency.objects.all(),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = AssetRegistration
        fields = "__all__"
        read_only_fields = [
            "id",
            "registration_number",
            "lodge_date",
            "date_created",
            "date_updated",
        ]

    def get_is_active(self, obj: AssetRegistration) -> bool:
        return obj.is_active()

    def get_owner_display(self, obj: AssetRegistration) -> str | None:
        if obj.owner_type == _OWNER_TYPE_INDIVIDUAL and obj.individual_owner:
            return _individual_display_name(obj.individual_owner)
        if obj.owner_type == _OWNER_TYPE_COMPANY and obj.company_owner:
            return _company_branch_display_name(obj.company_owner)
        if obj.individual_owner:
            return _individual_display_name(obj.individual_owner)
        if obj.company_owner:
            return _company_branch_display_name(obj.company_owner)
        return None

    def get_owner_id_reg(self, obj: AssetRegistration) -> str | None:
        if obj.owner_type == _OWNER_TYPE_INDIVIDUAL and obj.individual_owner:
            return obj.individual_owner.identification_number
        if obj.company_owner and obj.company_owner.company:
            return obj.company_owner.company.registration_number
        return None

    def get_stand_status(self, obj: AssetRegistration) -> str | None:
        if obj.asset_category != BaseAssetType.LAND:
            return None
        if obj.get_open_sale_transition():
            return "sold"
        return "clear"

    def get_open_sale(self, obj: AssetRegistration):
        sale = obj.get_open_sale_transition()
        if not sale:
            return None
        return StandSaleTransitionReadSerializer(sale).data

    def validate_asset_category(self, value: str) -> str:
        try:
            return ensure_valid_lookup_value(
                LookupOption.CATEGORY_BASE_ASSET_TYPE,
                value,
                field="asset_category",
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(exc.message_dict) from exc

    def validate_year_of_make(self, value: int | None) -> int | None:
        if value is None:
            return value
        current_year = timezone.now().year
        if not (1900 <= value <= current_year + 1):
            raise serializers.ValidationError(
                f"Year of make must be between 1900 and {current_year + 1}."
            )
        return value

    def validate_estimated_value(self, value) -> object:
        if value < 0:
            raise serializers.ValidationError("Estimated value must be 0 or greater.")
        return value

    def _validate_owner(self, attrs: dict) -> dict:
        owner_type: str | None = attrs.get(
            "owner_type",
            getattr(self.instance, "owner_type", None),
        )
        individual_owner = attrs.get(
            "individual_owner",
            getattr(self.instance, "individual_owner", None),
        )
        company_owner = attrs.get(
            "company_owner",
            getattr(self.instance, "company_owner", None),
        )
        if (
            "owner_type" in attrs
            and owner_type == _OWNER_TYPE_INDIVIDUAL
            and "company_owner" not in attrs
        ):
            company_owner = None
        if (
            "owner_type" in attrs
            and owner_type == _OWNER_TYPE_COMPANY
            and "individual_owner" not in attrs
        ):
            individual_owner = None

        owner_errors: dict[str, str] = {}
        if owner_type == _OWNER_TYPE_INDIVIDUAL:
            if not individual_owner:
                owner_errors["individual_owner"] = (
                    "Individual owner is required when owner_type is 'individual'."
                )
            if company_owner:
                owner_errors["company_owner"] = (
                    "Company owner must be empty when owner_type is 'individual'."
                )
        elif owner_type == _OWNER_TYPE_COMPANY:
            if not company_owner:
                owner_errors["company_owner"] = (
                    "Company owner is required when owner_type is 'company'."
                )
            if individual_owner:
                owner_errors["individual_owner"] = (
                    "Individual owner must be empty when owner_type is 'company'."
                )
        if owner_errors:
            raise serializers.ValidationError(owner_errors)
        return attrs

    def _validate_custody(self, attrs: dict) -> dict:
        custody_type = attrs.get(
            "custody_type",
            getattr(self.instance, "custody_type", "") or "",
        )
        if "custody_type" in attrs and attrs["custody_type"] is None:
            custody_type = ""

        if custody_type:
            custodian_type: str | None = attrs.get(
                "custodian_type",
                getattr(self.instance, "custodian_type", None),
            )
            individual_custodian = attrs.get(
                "individual_custodian",
                getattr(self.instance, "individual_custodian", None),
            )
            company_custodian = attrs.get(
                "company_custodian",
                getattr(self.instance, "company_custodian", None),
            )
            if (
                "custodian_type" in attrs
                and custodian_type == _CUSTODIAN_TYPE_INDIVIDUAL
                and "company_custodian" not in attrs
            ):
                company_custodian = None
            if (
                "custodian_type" in attrs
                and custodian_type == _CUSTODIAN_TYPE_COMPANY
                and "individual_custodian" not in attrs
            ):
                individual_custodian = None

            custody_errors: dict[str, str] = {}
            if not custodian_type:
                custody_errors["custodian_type"] = (
                    "Custodian type is required when custody type is set."
                )
            elif custodian_type == _CUSTODIAN_TYPE_INDIVIDUAL:
                if not individual_custodian:
                    custody_errors["individual_custodian"] = (
                        "Individual custodian is required when custodian_type is 'individual'."
                    )
                if company_custodian:
                    custody_errors["company_custodian"] = (
                        "Company custodian must be empty when custodian_type is 'individual'."
                    )
            elif custodian_type == _CUSTODIAN_TYPE_COMPANY:
                if not company_custodian:
                    custody_errors["company_custodian"] = (
                        "Company custodian is required when custodian_type is 'company'."
                    )
                if individual_custodian:
                    custody_errors["individual_custodian"] = (
                        "Individual custodian must be empty when custodian_type is 'company'."
                    )
            custodian_address = attrs.get(
                "custodian_address",
                getattr(self.instance, "custodian_address", "") or "",
            )
            if not str(custodian_address).strip():
                custody_errors["custodian_address"] = (
                    "Custodian address is required when custody type is set."
                )
            if custody_errors:
                raise serializers.ValidationError(custody_errors)
        else:
            attrs["custodian_type"] = ""
            attrs["individual_custodian"] = None
            attrs["company_custodian"] = None
            attrs.setdefault("custodian_address", "")
            attrs.setdefault("custodian_email", "")
            attrs.setdefault("custodian_mobile", "")
            attrs.setdefault("custodian_telephone", "")
            attrs.setdefault("guarantor_name", "")
            attrs.setdefault("guarantor_identification", "")
        return attrs

    def _validate_type_details(self, attrs: dict) -> dict:
        asset_category: str = attrs.get(
            "asset_category",
            getattr(self.instance, "asset_category", None),
        )
        vehicle_data = attrs.pop("vehicle", serializers.empty)
        mobile_data = attrs.pop("mobile", serializers.empty)
        land_data = attrs.pop("land", serializers.empty)

        if vehicle_data is not serializers.empty:
            self._vehicle_payload = vehicle_data
        elif self.instance and hasattr(self.instance, "vehicle"):
            self._vehicle_payload = None
        else:
            self._vehicle_payload = None

        if mobile_data is not serializers.empty:
            self._mobile_payload = mobile_data
        else:
            self._mobile_payload = None

        if land_data is not serializers.empty:
            self._land_payload = land_data
        else:
            self._land_payload = None

        is_create = self.instance is None
        if is_create:
            if asset_category == BaseAssetType.VEHICLES and not self._vehicle_payload:
                raise serializers.ValidationError(
                    {"vehicle": "Vehicle details are required for vehicle assets."}
                )
            if asset_category == BaseAssetType.MOBILES and not self._mobile_payload:
                raise serializers.ValidationError(
                    {"mobile": "Mobile details are required for mobile assets."}
                )
            if asset_category == BaseAssetType.LAND and not self._land_payload:
                raise serializers.ValidationError(
                    {"land": "Land details are required for land assets."}
                )

        errors: dict[str, str] = {}
        if asset_category != BaseAssetType.VEHICLES and self._vehicle_payload:
            errors["vehicle"] = "Vehicle details are only valid for vehicle assets."
        if asset_category != BaseAssetType.MOBILES and self._mobile_payload:
            errors["mobile"] = "Mobile details are only valid for mobile assets."
        if asset_category != BaseAssetType.LAND and self._land_payload:
            errors["land"] = "Land details are only valid for land assets."
        if errors:
            raise serializers.ValidationError(errors)

        if asset_category == BaseAssetType.LAND:
            attrs.setdefault("make", "")
            attrs.setdefault("model", "")
            attrs.setdefault("condition", "")
            attrs.setdefault("location_address", "")

        return attrs

    def _check_vehicle_uniqueness(self, vehicle_data: dict | None, instance_pk=None):
        if not vehicle_data:
            return
        for field_name, label in (
            ("mv_registration_number", "MV registration number"),
            ("chassis_number", "chassis number"),
            ("engine_number", "engine number"),
        ):
            value = vehicle_data.get(field_name, "")
            if not value:
                continue
            qs = VehicleDetails.objects.filter(**{f"{field_name}__iexact": value})
            if instance_pk:
                qs = qs.exclude(asset_id=instance_pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {f"vehicle.{field_name}": f"An asset with this {label} already exists."}
                )

    def _check_mobile_uniqueness(self, imei: str | None, instance_pk=None):
        if not imei:
            return
        qs = MobileDetails.objects.filter(imei__iexact=imei.strip())
        if instance_pk:
            qs = qs.exclude(asset_id=instance_pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"mobile.imei": "An asset with this IMEI already exists."}
            )

    def _check_land_uniqueness(self, land_data: dict | None, instance_pk=None):
        if not land_data:
            return
        city = land_data.get("city")
        suburb = land_data.get("suburb")
        stand_number = (land_data.get("stand_number") or "").strip()
        stand_address = (land_data.get("stand_address") or "").strip()
        if not (city and suburb and stand_number):
            return
        qs = LandDetails.objects.filter(
            city=city,
            suburb=suburb,
            stand_number__iexact=stand_number,
        )
        if instance_pk:
            qs = qs.exclude(asset_id=instance_pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"land.stand_number": "This stand is already registered for this area."}
            )
        if stand_address:
            addr_qs = LandDetails.objects.filter(
                suburb=suburb,
                stand_address__iexact=stand_address,
            )
            if instance_pk:
                addr_qs = addr_qs.exclude(asset_id=instance_pk)
            if addr_qs.exists():
                raise serializers.ValidationError(
                    {
                        "land.stand_address": (
                            "This address is already registered for this suburb."
                        )
                    }
                )

    def validate(self, attrs: dict) -> dict:
        attrs = self._validate_owner(attrs)
        attrs = self._validate_custody(attrs)
        attrs = self._validate_type_details(attrs)

        for field_name in _IDENTIFIER_TEXT_FIELDS:
            value = attrs.get(field_name)
            if isinstance(value, str):
                attrs[field_name] = value.strip()

        duplicate_errors: dict[str, str] = {}
        if "serial_number" in attrs or not self.instance:
            serial = attrs.get(
                "serial_number",
                getattr(self.instance, "serial_number", "") if self.instance else "",
            )
            if serial:
                duplicates = AssetRegistration.objects.filter(
                    serial_number__iexact=serial
                )
                if self.instance:
                    duplicates = duplicates.exclude(pk=self.instance.pk)
                if duplicates.exists():
                    duplicate_errors["serial_number"] = (
                        "An asset with this serial number already exists."
                    )

        owner_type = attrs.get("owner_type", getattr(self.instance, "owner_type", None))
        individual_owner = attrs.get(
            "individual_owner",
            getattr(self.instance, "individual_owner", None),
        )
        company_owner = attrs.get(
            "company_owner",
            getattr(self.instance, "company_owner", None),
        )
        owner_scope_changed = (
            not self.instance
            or "owner_asset_number" in attrs
            or "owner_type" in attrs
            or "individual_owner" in attrs
            or "company_owner" in attrs
        )
        if owner_scope_changed:
            owner_asset_number = attrs.get(
                "owner_asset_number",
                getattr(self.instance, "owner_asset_number", ""),
            )
            if owner_asset_number:
                owner_duplicates = AssetRegistration.objects.filter(
                    owner_asset_number__iexact=owner_asset_number,
                    owner_type=owner_type,
                )
                if owner_type == _OWNER_TYPE_INDIVIDUAL and individual_owner:
                    owner_duplicates = owner_duplicates.filter(
                        individual_owner=individual_owner
                    )
                elif owner_type == _OWNER_TYPE_COMPANY and company_owner:
                    owner_duplicates = owner_duplicates.filter(
                        company_owner=company_owner
                    )
                else:
                    owner_duplicates = AssetRegistration.objects.none()
                if self.instance:
                    owner_duplicates = owner_duplicates.exclude(pk=self.instance.pk)
                if owner_duplicates.exists():
                    duplicate_errors["owner_asset_number"] = (
                        "This owner asset number already exists for the selected owner."
                    )

        if duplicate_errors:
            raise serializers.ValidationError(duplicate_errors)

        # Nested vehicle/mobile/land serializers already ran to_internal_value.
        # Do not re-validate that payload: FK fields now hold model instances
        # (e.g. City), and PrimaryKeyRelatedField would reject them.

        instance_pk = self.instance.pk if self.instance else None
        self._check_vehicle_uniqueness(self._vehicle_payload, instance_pk)
        self._check_mobile_uniqueness(
            (self._mobile_payload or {}).get("imei") if self._mobile_payload else None,
            instance_pk,
        )
        self._check_land_uniqueness(self._land_payload, instance_pk)

        start = attrs.get(
            "subscription_start_date",
            getattr(self.instance, "subscription_start_date", None),
        )
        end = attrs.get(
            "subscription_end_date",
            getattr(self.instance, "subscription_end_date", None),
        )
        if start and end and end <= start:
            raise serializers.ValidationError(
                {
                    "subscription_end_date": (
                        "Subscription end date must be strictly after subscription start date."
                    )
                }
            )
        return attrs

    def _upsert_vehicle(self, asset: AssetRegistration, data: dict | None, user):
        if data is None:
            return
        obj, created = VehicleDetails.objects.update_or_create(
            asset=asset,
            defaults={**data, "updated_by": user},
        )
        if created:
            obj.created_by = user
            obj.save(update_fields=["created_by"])

    def _upsert_mobile(self, asset: AssetRegistration, data: dict | None, user):
        if data is None:
            return
        obj, created = MobileDetails.objects.update_or_create(
            asset=asset,
            defaults={**data, "updated_by": user},
        )
        if created:
            obj.created_by = user
            obj.save(update_fields=["created_by"])

    def _upsert_land(self, asset: AssetRegistration, data: dict | None, user):
        if data is None:
            return
        obj, created = LandDetails.objects.update_or_create(
            asset=asset,
            defaults={**data, "updated_by": user},
        )
        if created:
            obj.created_by = user
            obj.save(update_fields=["created_by"])

    @transaction.atomic
    def create(self, validated_data: dict) -> AssetRegistration:
        vehicle_data = getattr(self, "_vehicle_payload", None)
        mobile_data = getattr(self, "_mobile_payload", None)
        land_data = getattr(self, "_land_payload", None)
        user = self.context["request"].user
        validated_data["created_by"] = user
        instance = super().create(validated_data)
        self._upsert_vehicle(instance, vehicle_data, user)
        self._upsert_mobile(instance, mobile_data, user)
        self._upsert_land(instance, land_data, user)
        return instance

    @transaction.atomic
    def update(self, instance: AssetRegistration, validated_data: dict) -> AssetRegistration:
        vehicle_data = getattr(self, "_vehicle_payload", None)
        mobile_data = getattr(self, "_mobile_payload", None)
        land_data = getattr(self, "_land_payload", None)
        user = self.context["request"].user
        validated_data["updated_by"] = user
        instance = super().update(instance, validated_data)
        if vehicle_data is not None:
            self._upsert_vehicle(instance, vehicle_data, user)
        if mobile_data is not None:
            self._upsert_mobile(instance, mobile_data, user)
        if land_data is not None:
            self._upsert_land(instance, land_data, user)
        return instance


class AssetRegistrationListSerializer(AssetRegistrationSerializer):
    primary_identifier = serializers.SerializerMethodField(read_only=True)
    description = serializers.SerializerMethodField(read_only=True)
    lodge_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    currency_code = serializers.CharField(source="currency.code", read_only=True)
    subscription_start_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    subscription_end_date = serializers.DateField(read_only=True, format="%d-%b-%y")

    class Meta(AssetRegistrationSerializer.Meta):
        fields = [
            "id",
            "lodge_date",
            "registration_number",
            "owner_display",
            "description",
            "primary_identifier",
            "asset_category",
            "asset_type",
            "currency_code",
            "estimated_value",
            "subscription_start_date",
            "subscription_end_date",
            "is_active",
            "stand_status",
        ]

    def get_primary_identifier(self, obj: AssetRegistration) -> str:
        if obj.asset_category == BaseAssetType.VEHICLES:
            vehicle = getattr(obj, "vehicle", None)
            return vehicle.mv_registration_number if vehicle else ""
        if obj.asset_category == BaseAssetType.MOBILES:
            mobile = getattr(obj, "mobile", None)
            if mobile:
                return mobile.imei
        if obj.asset_category == BaseAssetType.LAND:
            land = getattr(obj, "land", None)
            if land:
                return land.stand_number
        return obj.serial_number or ""

    def get_description(self, obj: AssetRegistration) -> str:
        if obj.asset_category == BaseAssetType.LAND:
            return obj.asset_type or "Stand"
        if obj.make and obj.model:
            return f"{obj.make} {obj.model}"
        if obj.make:
            return obj.make
        if obj.model:
            return obj.model
        return obj.asset_type or ""


class AssetRegistryDashboardSerializer(serializers.Serializer):
    total_assets = serializers.IntegerField(min_value=0)
    total_estimate_value = serializers.DecimalField(max_digits=24, decimal_places=2)


__all__ = [
    "AssetRegistrationSerializer",
    "AssetRegistrationListSerializer",
    "AssetRegistryDashboardSerializer",
    "StandSaleTransitionWriteSerializer",
    "OwnershipChangeWriteSerializer",
    "StandSaleTransitionReadSerializer",
    "record_sale_transition",
    "record_ownership_change",
]
