"""
serializers.py — Asset Management API

Serializers for AssetRegistration model.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.common.models import BaseAssetType, Currency
from apps.common.models.models import LookupOption
from apps.common.utils.lookups import ensure_valid_lookup_value
from apps.asset_management.models import AssetRegistration
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.core.exceptions import ValidationError as DjangoValidationError

_VEHICLE_ONLY_FIELDS: tuple[str, ...] = (
    "mv_registration_number",
    "chassis_number",
    "engine_number",
)
_OWNER_TYPE_INDIVIDUAL = "individual"
_OWNER_TYPE_COMPANY = "company"
_CUSTODIAN_TYPE_INDIVIDUAL = "individual"
_CUSTODIAN_TYPE_COMPANY = "company"
_UNIQUE_ASSET_IDENTIFIER_FIELDS: tuple[tuple[str, str], ...] = (
    ("mv_registration_number", "MV registration number"),
    ("chassis_number", "chassis number"),
    ("engine_number", "engine number"),
    ("serial_number", "serial number"),
)
_IDENTIFIER_TEXT_FIELDS: tuple[str, ...] = (
    "mv_registration_number",
    "chassis_number",
    "engine_number",
    "serial_number",
    "owner_asset_number",
)


# ---------------------------------------------------------------------------
# Asset Registry serializers
# ---------------------------------------------------------------------------


class AssetRegistrationSerializer(serializers.ModelSerializer):
    """
    Full read-write serializer for :class:`~asset_management.models.AssetRegistration`.

    Read-only computed properties
    ------------------------------
    ``is_active``        — whether today is within the subscription window.
    ``owner_display``    — human-readable owner/branch display label.
    ``registration_number`` — server-generated; clients must never supply it.
    """

    is_active = serializers.SerializerMethodField(
        read_only=True,
        help_text="True when today is within the subscription window.",
    )
    owner_display = serializers.SerializerMethodField(
        read_only=True,
        help_text="Human-readable owner name; for display purposes only.",
    )
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

    # ------------------------------------------------------------------
    # Computed field implementations
    # ------------------------------------------------------------------

    def get_is_active(self, obj: AssetRegistration) -> bool:
        """Delegates to the model's own ``is_active()`` helper."""
        return obj.is_active()

    def get_owner_display(self, obj: AssetRegistration) -> str | None:
        """Returns a human-readable label for whichever owner relation is populated."""
        if obj.owner_type == _OWNER_TYPE_INDIVIDUAL and obj.individual_owner:
            return str(obj.individual_owner)
        if obj.owner_type == _OWNER_TYPE_COMPANY and obj.company_owner:
            return str(obj.company_owner)
        if obj.individual_owner:
            return str(obj.individual_owner)
        if obj.company_owner:
            return str(obj.company_owner)
        return None

    def validate_asset_category(self, value: str) -> str:
        try:
            return ensure_valid_lookup_value(
                LookupOption.CATEGORY_BASE_ASSET_TYPE,
                value,
                field="asset_category",
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(exc.message_dict) from exc

    # ------------------------------------------------------------------
    # Field-level validation
    # ------------------------------------------------------------------

    def validate_year_of_make(self, value: int | None) -> int | None:
        """Rejects years that are clearly impossible (pre-cars or future)."""
        if value is None:
            return value
        current_year = timezone.now().year
        if not (1900 <= value <= current_year + 1):
            raise serializers.ValidationError(
                f"Year of make must be between 1900 and {current_year + 1}."
            )
        return value

    def validate_estimated_value(self, value) -> object:
        """Ensures the estimated value is a non-negative number."""
        if value < 0:
            raise serializers.ValidationError("Estimated value must be 0 or greater.")
        return value

    # ------------------------------------------------------------------
    # Cross-field validation
    # ------------------------------------------------------------------

    def validate(self, attrs: dict) -> dict:
        """
        Cross-field validation covering:
        1. Owner fields must be consistent with ``owner_type``.
        2. Duplicate identifiers are rejected before save.
        3. Vehicle-specific fields must be empty when the asset type is not 'vehicles'.
        4. Subscription end date must be strictly after start date.
        """
        # --- 1. Owner consistency ---
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

        # If owner_type is being switched, treat the opposite owner relation as cleared
        # unless the client explicitly provides it.
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

        # --- 1b. Custody consistency (optional) ---
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
            # Clear custody relations when no custody type is recorded.
            attrs["custodian_type"] = ""
            attrs["individual_custodian"] = None
            attrs["company_custodian"] = None
            attrs.setdefault("custodian_address", "")
            attrs.setdefault("custodian_email", "")
            attrs.setdefault("custodian_mobile", "")
            attrs.setdefault("custodian_telephone", "")
            attrs.setdefault("guarantor_name", "")
            attrs.setdefault("guarantor_identification", "")

        # --- 2. Normalize and validate uniqueness of asset identifiers ---
        for field_name in _IDENTIFIER_TEXT_FIELDS:
            value = attrs.get(field_name)
            if isinstance(value, str):
                attrs[field_name] = value.strip()

        duplicate_errors: dict[str, str] = {}

        for field_name, label in _UNIQUE_ASSET_IDENTIFIER_FIELDS:
            # On update, only re-check identifiers that are being changed.
            if self.instance and field_name not in attrs:
                continue

            value = attrs.get(field_name, getattr(self.instance, field_name, ""))
            if not value:
                continue

            duplicates = AssetRegistration.objects.filter(
                **{f"{field_name}__iexact": value}
            )
            if self.instance:
                duplicates = duplicates.exclude(pk=self.instance.pk)

            if duplicates.exists():
                duplicate_errors[field_name] = (
                    f"An asset with this {label} already exists."
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

        # --- 3. Vehicle-only field guard ---
        asset_category: str = attrs.get(
            "asset_category",
            getattr(self.instance, "asset_category", None),
        )
        if asset_category and asset_category != BaseAssetType.VEHICLES:
            for field_name in _VEHICLE_ONLY_FIELDS:
                if attrs.get(field_name):
                    raise serializers.ValidationError(
                        {
                            field_name: (
                                f"'{field_name}' is only valid when asset_category "
                                "is 'vehicles'. This field should be left blank "
                                "for other asset categories."
                            )
                        }
                    )

        # --- 4. Subscription date ordering ---
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

    # ------------------------------------------------------------------
    # Create — wrapped in a transaction for safe sequential numbering
    # ------------------------------------------------------------------

    @transaction.atomic
    def create(self, validated_data: dict) -> AssetRegistration:
        """
        Wraps the default create in a DB transaction so that the
        ``select_for_update`` inside ``AssetRegistration.save()`` can
        safely serialise the registration-number generation step.
        """
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)

    @transaction.atomic
    def update(
        self, instance: AssetRegistration, validated_data: dict
    ) -> AssetRegistration:
        """
        Wraps the default update in a DB transaction to ensure that any updates to unique identifiers are safely checked against concurrent modifications.
        """
        validated_data["updated_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class AssetRegistrationListSerializer(AssetRegistrationSerializer):
    """
    Lightweight read-only serializer optimized for list endpoints and dashboards.
    """

    primary_identifier = serializers.SerializerMethodField(
        read_only=True,
        help_text="Returns the MV registration number for vehicles, or the serial number otherwise.",
    )
    description = serializers.SerializerMethodField(
        read_only=True,
        help_text="Concatenated make and model for display purposes.",
    )
    lodge_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    currency_code = serializers.CharField(
        source="currency.code",
        read_only=True,
    )
    subscription_start_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    subscription_end_date = serializers.DateField(read_only=True, format="%d-%b-%y")

    class Meta(AssetRegistrationSerializer.Meta):
        """Class Meta inherits from AssetRegistrationSerializer.Meta, but overrides fields to a smaller subset for list performance."""

        fields = [
            "id",
            "lodge_date",
            "registration_number",
            "owner_display",
            "description",
            "primary_identifier",
            "currency_code",
            "estimated_value",
            "subscription_start_date",
            "subscription_end_date",
            "is_active",
        ]
        # read_only_fields are implicit since all output fields in Meta.fields are either standard model fields or explicitly defined read-only method fields.

    def get_primary_identifier(self, obj: AssetRegistration) -> str:
        """Gets the primary identifier for the asset, which is the MV registration number for vehicles or the serial number for other asset types."""
        if obj.asset_category == "vehicles":
            return obj.mv_registration_number
        return obj.serial_number

    def get_description(self, obj: AssetRegistration) -> str:
        """Gets the description for the asset, which is a concatenation of the make and model."""
        if obj.make and obj.model:
            return f"{obj.make} {obj.model}"
        if obj.make:
            return obj.make
        if obj.model:
            return obj.model
        return ""


class AssetRegistryDashboardSerializer(serializers.Serializer):
    """
    Read-only summary statistics for the Asset Registry dashboard panel.
    """

    total_assets = serializers.IntegerField(min_value=0)
    total_estimate_value = serializers.DecimalField(max_digits=24, decimal_places=2)
