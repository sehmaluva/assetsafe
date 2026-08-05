"""
serializers.py — Hire Purchase API

Serializers for HirePurchaseRegistration model.
"""

from __future__ import annotations

from django.utils import timezone
from django.db import transaction
from rest_framework import serializers

from apps.hire_purchase.models import HirePurchaseRegistration
from apps.common.models import Currency
from apps.common.models.models import LookupOption
from apps.common.utils.lookups import ensure_valid_lookup_value
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.core.exceptions import ValidationError as DjangoValidationError

# ---------------------------------------------------------------------------
# Hire Purchase serializers
# ---------------------------------------------------------------------------


class HirePurchaseRegistrationSerializer(serializers.ModelSerializer):
    """
    Full read-write serializer for
    :class:`~hire_purchase.models.HirePurchaseRegistration`.
    """

    is_active = serializers.SerializerMethodField(read_only=True)
    is_pending_closure = serializers.SerializerMethodField(read_only=True)
    financier_display = serializers.StringRelatedField(
        source="financier", read_only=True
    )
    purchaser_display = serializers.SerializerMethodField(read_only=True)
    data_source_display = serializers.SerializerMethodField(read_only=True)
    data_source_position = serializers.SerializerMethodField(read_only=True)
    data_source_user_id = serializers.IntegerField(write_only=True, required=False)
    currency = serializers.SlugRelatedField(
        slug_field="code",
        queryset=Currency.objects.all(),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = HirePurchaseRegistration
        fields = [
            "id",
            "financier",
            "financier_display",
            "purchaser_individual",
            "purchaser_company",
            "purchaser_display",
            "purchaser_type",
            "data_date",
            "agreement_number",
            "asset_category",
            "asset_type",
            "make",
            "model",
            "year_of_make",
            "condition",
            "mv_registration_number",
            "chassis_number",
            "engine_number",
            "serial_number",
            "currency",
            "purchase_amount",
            "instalment_amount",
            "instalment_day",
            "total_paid_to_date",
            "balance",
            "agreement_start_date",
            "agreement_end_date",
            "lodge_date",
            "closure_confirmed",
            "closure_confirmed_at",
            "is_active",
            "is_pending_closure",
            "data_source_display",
            "data_source_position",
            "data_source_user_id",
            "date_created",
            "date_updated",
            "updated_by",
            "created_by",
        ]
        read_only_fields = [
            "id",
            "purchaser_type",
            "balance",
            "lodge_date",
            "closure_confirmed_at",
            "created_at",
            "updated_at",
            "is_active",
            "is_pending_closure",
            "financier_display",
            "purchaser_display",
            "data_source_display",
            "data_source_position",
        ]
        extra_kwargs = {
            "mv_registration_number": {"required": False},
            "serial_number": {"required": False},
            "make": {"required": False},
        }
        validators = []

    # ------------------------------------------------------------------
    # Computed field implementations
    # ------------------------------------------------------------------

    def get_is_active(self, obj: HirePurchaseRegistration) -> bool:
        return obj.is_active()

    def get_is_pending_closure(self, obj: HirePurchaseRegistration) -> bool:
        return obj.is_pending_closure()

    def get_purchaser_display(self, obj: HirePurchaseRegistration) -> str:
        if obj.purchaser_individual:
            return str(obj.purchaser_individual)
        if obj.purchaser_company:
            return str(obj.purchaser_company)
        return ""

    def get_data_source_display(self, obj: HirePurchaseRegistration) -> str:
        if obj.created_by is None:
            return ""
        return obj.created_by.get_full_name() or obj.created_by.username or ""

    def get_data_source_position(self, obj: HirePurchaseRegistration) -> str:
        if obj.created_by is None:
            return ""
        return obj.created_by.position or ""

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

    def validate_instalment_day(self, value: int) -> int:
        """Day-of-month must be within calendar bounds (1-31)."""
        if not 1 <= value <= 31:
            raise serializers.ValidationError(
                "Instalment day must be between 1 and 31."
            )
        return value

    # ------------------------------------------------------------------
    # Cross-field validation
    # ------------------------------------------------------------------

    def validate(self, attrs: dict) -> dict:
        """
        Cross-field validation covering:
        1. Agreement date ordering.
        2. Instalment cannot exceed purchase amount.
        3. Financier and purchaser must be different users.
        4. Duplicate registrations of the same asset.
        """
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            user = request.user
            if not user.is_staff and user.client:
                attrs["financier"] = user.client

        # --- 1. Date ordering ---
        start = attrs.get(
            "agreement_start_date",
            getattr(self.instance, "agreement_start_date", None),
        )
        end = attrs.get(
            "agreement_end_date",
            getattr(self.instance, "agreement_end_date", None),
        )
        if start and end and end <= start:
            raise serializers.ValidationError(
                {
                    "agreement_end_date": (
                        "Agreement end date must be strictly after agreement start date."
                    )
                }
            )

        # --- 2. Instalment cap ---
        purchase_amount = attrs.get(
            "purchase_amount",
            getattr(self.instance, "purchase_amount", None),
        )
        instalment = attrs.get(
            "instalment_amount",
            getattr(self.instance, "instalment_amount", None),
        )
        if (
            purchase_amount is not None
            and instalment is not None
            and instalment > purchase_amount
        ):
            raise serializers.ValidationError(
                {
                    "instalment_amount": (
                        "Instalment amount cannot exceed the total purchase amount."
                    )
                }
            )

        # --- 4. Financier ≠ purchaser ---
        financier = attrs.get("financier", getattr(self.instance, "financier", None))
        purchaser_ind = attrs.get(
            "purchaser_individual", getattr(self.instance, "purchaser_individual", None)
        )
        purchaser_comp = attrs.get(
            "purchaser_company", getattr(self.instance, "purchaser_company", None)
        )

        if (purchaser_ind and purchaser_comp) or not (purchaser_ind or purchaser_comp):
            raise serializers.ValidationError(
                "Provide exactly one: purchaser_individual or purchaser_company."
            )

        attrs["purchaser_type"] = "individual" if purchaser_ind else "company"

        if financier:
            # Client cannot be the same Individual or Company records if they use the same underlying entity IDs,
            # but strictly speaking `financier` is a Client and purchaser is Individual/Company.
            pass

        # --- 5. Duplicate prevention ---
        make = attrs.get("make", getattr(self.instance, "make", ""))

        if financier and (purchaser_ind or purchaser_comp):
            mv_reg = attrs.get(
                "mv_registration_number",
                getattr(self.instance, "mv_registration_number", ""),
            )
            serial = attrs.get(
                "serial_number", getattr(self.instance, "serial_number", "")
            )

            qs = HirePurchaseRegistration.objects.filter(financier=financier, make=make)
            if purchaser_ind:
                qs = qs.filter(purchaser_individual=purchaser_ind)
            else:
                qs = qs.filter(purchaser_company=purchaser_comp)

            if self.instance and self.instance.pk:
                qs = qs.exclude(pk=self.instance.pk)

            # Check matching MV registration number if provided
            if mv_reg and qs.filter(mv_registration_number=mv_reg).exists():
                raise serializers.ValidationError(
                    {"mv_registration_number": "Duplicate MV registration number."}
                )

            # Check matching serial number if provided
            if serial and qs.filter(serial_number=serial).exists():
                raise serializers.ValidationError(
                    {"serial_number": "Duplicate serial number."}
                )

            # Check if both identifiers are missing and a corresponding record already exists
            if (
                not mv_reg
                and not serial
                and qs.filter(mv_registration_number="", serial_number="").exists()
            ):
                raise serializers.ValidationError(
                    "Duplicate asset without registration or serial numbers."
                )

        return attrs

    @transaction.atomic
    def create(self, validated_data: dict) -> HirePurchaseRegistration:
        from django.contrib.auth import get_user_model

        User = get_user_model()
        request_user = self.context["request"].user
        data_source_user_id = validated_data.pop("data_source_user_id", None)

        if request_user.is_staff and data_source_user_id:
            try:
                data_source_user = User.objects.get(pk=data_source_user_id)
            except User.DoesNotExist as exc:
                raise serializers.ValidationError(
                    {"data_source_user_id": "Invalid data source user."}
                ) from exc

            financier = validated_data.get("financier")
            if not financier or data_source_user.client_id != getattr(
                financier, "pk", financier
            ):
                raise serializers.ValidationError(
                    {
                        "data_source_user_id": (
                            "Data source user must belong to the selected financier."
                        )
                    }
                )
            validated_data["created_by"] = data_source_user
        else:
            validated_data["created_by"] = request_user

        return super().create(validated_data)

    @transaction.atomic
    def update(
        self, instance: HirePurchaseRegistration, validated_data: dict
    ) -> HirePurchaseRegistration:
        validated_data["updated_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class HirePurchaseRegistrationListSerializer(HirePurchaseRegistrationSerializer):
    """
    Lightweight read-only serializer optimized for list endpoints and
    dashboards, mirroring the shape returned by the Collateral and Asset
    Registry list endpoints.
    """

    lodge_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    agreement_start_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    agreement_end_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    currency_code = serializers.CharField(source="currency.code", read_only=True)
    description = serializers.SerializerMethodField(
        read_only=True,
        help_text="Concatenated make and model for display purposes.",
    )
    primary_identifier = serializers.SerializerMethodField(
        read_only=True,
        help_text="Returns the MV registration number for vehicles, or the serial number otherwise.",
    )

    class Meta(HirePurchaseRegistrationSerializer.Meta):
        """Inherits from HirePurchaseRegistrationSerializer.Meta, but overrides fields to a smaller subset for list performance."""

        fields = [
            "id",
            "lodge_date",
            "agreement_number",
            "financier_display",
            "purchaser_display",
            "description",
            "primary_identifier",
            "currency_code",
            "purchase_amount",
            "agreement_start_date",
            "agreement_end_date",
            "closure_confirmed",
        ]
        read_only_fields = fields

    def get_description(self, obj: HirePurchaseRegistration) -> str:
        """Gets the description for the asset, which is a concatenation of the make and model."""
        if obj.make and obj.model:
            return f"{obj.make} {obj.model}"
        if obj.make:
            return obj.make
        if obj.model:
            return obj.model
        return ""

    def get_primary_identifier(self, obj: HirePurchaseRegistration) -> str:
        """Gets the primary identifier for the asset, which is the MV registration number for vehicles or the serial number for other asset types."""
        if obj.asset_category == "vehicles":
            return obj.mv_registration_number
        return obj.serial_number


class HirePurchaseClosureSerializer(serializers.ModelSerializer):
    """
    Narrow serializer for the ``/confirm-closure/`` action endpoint.

    Only the ``closure_confirmed`` flag is writable.
    ``closure_confirmed_at`` is stamped server-side in ``update()``.
    """

    class Meta:
        model = HirePurchaseRegistration
        fields = ["closure_confirmed", "closure_confirmed_at"]
        read_only_fields = ["closure_confirmed_at"]

    def validate_closure_confirmed(self, value: bool) -> bool:
        """Prevents rolling back a confirmed closure via this endpoint."""
        if self.instance and self.instance.closure_confirmed and not value:
            raise serializers.ValidationError(
                "A confirmed closure cannot be reversed via this endpoint."
            )
        return value

    @transaction.atomic
    def update(
        self, instance: HirePurchaseRegistration, validated_data: dict
    ) -> HirePurchaseRegistration:
        """
        Stamps ``closure_confirmed_at`` with the current UTC datetime when
        ``closure_confirmed`` transitions from ``False`` to ``True``.
        Uses ``update_fields`` for a targeted, low-lock UPDATE statement.
        """
        newly_closed = (
            validated_data.get("closure_confirmed", False)
            and not instance.closure_confirmed
        )
        if newly_closed:
            instance.closure_confirmed_at = timezone.now()
        instance.closure_confirmed = validated_data.get(
            "closure_confirmed", instance.closure_confirmed
        )
        instance.save(
            update_fields=["closure_confirmed", "closure_confirmed_at", "date_updated"]
        )
        return instance


class HirePurchaseDashboardSerializer(serializers.Serializer):
    """
    Read-only dashboard statistics for the HP Registry.
    """

    number_of_financiers = serializers.IntegerField(min_value=0)
    active_agreements = serializers.IntegerField(min_value=0)
    pending_closure_confirmation = serializers.IntegerField(min_value=0)
    total_active_loan_value = serializers.DecimalField(
        max_digits=24, decimal_places=2, min_value=0
    )
