"""
serializers.py — Collateral API

Serializers for CollateralRegistration model.
"""

from __future__ import annotations

from django.utils import timezone
from django.db import transaction
from rest_framework import serializers

from apps.collateral.constants import ASSET_IDENTIFIER_FIELDS, ASSET_IDENTIFIER_LABELS
from apps.collateral.models.models import (
    CollateralRegistration,
    DEBTOR_TYPE_COMPANY,
    DEBTOR_TYPE_INDIVIDUAL,
)
from apps.common.models import Currency
from apps.common.models.models import LookupOption
from apps.common.utils.lookups import ensure_valid_lookup_value
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.core.exceptions import ValidationError as DjangoValidationError

# ---------------------------------------------------------------------------
# Collateral Registry serializers
# ---------------------------------------------------------------------------


class CollateralRegistrationSerializer(serializers.ModelSerializer):
    """
    Full read-write serializer for :class:`~collateral.models.CollateralRegistration`.
    """

    is_active = serializers.SerializerMethodField(read_only=True)
    is_pending_discharge = serializers.SerializerMethodField(read_only=True)
    financier_display = serializers.SerializerMethodField(read_only=True)
    debtor_display = serializers.SerializerMethodField(read_only=True)
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
        model = CollateralRegistration
        fields = [
            "id",
            "financier",
            "data_date",
            "debtor_type",
            "individual_debtor",
            "company_debtor",
            "agreement_number",
            "asset_category",
            "asset_type",
            "make",
            "model",
            "year_of_make",
            "condition",
            "asset_registration_number",
            "chassis_number",
            "engine_number",
            "serial_number",
            "currency",
            "total_debt",
            "instalment_amount",
            "instalment_day",
            "total_paid_to_date",
            "balance",
            "agreement_start_date",
            "agreement_end_date",
            "lodge_date",
            "is_discharged",
            "discharge_confirmed_at",
            "date_created",
            "date_updated",
            "created_by",
            "updated_by",
            "is_active",
            "is_pending_discharge",
            "financier_display",
            "debtor_display",
            "data_source_display",
            "data_source_position",
            "data_source_user_id",
        ]
        read_only_fields = [
            "id",
            "lodge_date",
            "discharge_confirmed_at",
            "date_created",
            "date_updated",
            "is_active",
        ]
        extra_kwargs = {
            "balance": {"required": False},
        }

    # ------------------------------------------------------------------
    # Computed field implementations
    # ------------------------------------------------------------------

    def get_is_active(self, obj: CollateralRegistration) -> bool:
        return obj.is_active()

    def get_is_pending_discharge(self, obj: CollateralRegistration) -> bool:
        return obj.is_pending_discharge()

    def get_financier_display(self, obj: CollateralRegistration) -> str:
        return obj.financier_display

    def get_debtor_display(self, obj: CollateralRegistration) -> str:
        return obj.debtor_display

    def validate_asset_category(self, value: str) -> str:
        try:
            return ensure_valid_lookup_value(
                LookupOption.CATEGORY_COLLATERAL_ASSET_CATEGORY,
                value,
                field="asset_category",
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(exc.message_dict) from exc

    def get_data_source_display(self, obj: CollateralRegistration) -> str:
        if obj.created_by is None:
            return ""
        return obj.created_by.get_full_name() or obj.created_by.username or ""

    def get_data_source_position(self, obj: CollateralRegistration) -> str:
        if obj.created_by is None:
            return ""
        return obj.created_by.position or ""

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

    def validate_total_paid_to_date(self, value) -> object:
        """Cannot have paid more than the total debt that was owed."""
        if value < 0:
            raise serializers.ValidationError("Total paid to date cannot be negative.")
        return value

    def _resolve_party_for_validation(
        self,
        attrs: dict,
        role: str,
    ) -> tuple[str | None, object | None, object | None]:
        party_type = attrs.get(
            f"{role}_type",
            getattr(self.instance, f"{role}_type", None),
        )
        individual = attrs.get(
            f"individual_{role}",
            getattr(self.instance, f"individual_{role}", None),
        )
        company = attrs.get(
            f"company_{role}",
            getattr(self.instance, f"company_{role}", None),
        )

        if (
            f"{role}_type" in attrs
            and party_type == DEBTOR_TYPE_INDIVIDUAL
            and f"company_{role}" not in attrs
        ):
            attrs[f"company_{role}"] = None
            company = None
        if (
            f"{role}_type" in attrs
            and party_type == DEBTOR_TYPE_COMPANY
            and f"individual_{role}" not in attrs
        ):
            attrs[f"individual_{role}"] = None
            individual = None

        return party_type, individual, company

    def _validate_party_shape(
        self,
        role: str,
        party_type: str | None,
        individual: object | None,
        company: object | None,
    ) -> dict[str, str]:
        errors: dict[str, str] = {}
        if party_type == DEBTOR_TYPE_INDIVIDUAL:
            if not individual:
                errors[f"individual_{role}"] = (
                    f"Individual {role} is required when {role}_type is 'individual'."
                )
            if company:
                errors[f"company_{role}"] = (
                    f"Company {role} must be empty when {role}_type is 'individual'."
                )
        elif party_type == DEBTOR_TYPE_COMPANY:
            if not company:
                errors[f"company_{role}"] = (
                    f"Company {role} is required when {role}_type is 'company'."
                )
            if individual:
                errors[f"individual_{role}"] = (
                    f"Individual {role} must be empty when {role}_type is 'company'."
                )
        return errors

    def _validate_unique_asset_identifiers(self, attrs: dict) -> dict[str, str]:
        """
        Blocks duplicate non-discharged registrations for the same asset
        identifiers. Mirrors model-level validation for API writes.
        """
        target_is_discharged = attrs.get(
            "is_discharged",
            getattr(self.instance, "is_discharged", False),
        )
        if target_is_discharged:
            return {}

        identifiers: dict[str, str] = {}
        for field_name in ASSET_IDENTIFIER_FIELDS:
            raw_value = attrs.get(
                field_name,
                getattr(self.instance, field_name, ""),
            )
            value = raw_value.strip() if isinstance(raw_value, str) else raw_value
            if field_name in attrs and isinstance(raw_value, str):
                attrs[field_name] = value
            if value:
                identifiers[field_name] = value

        if not identifiers:
            return {}

        existing_qs = CollateralRegistration.objects.filter(  # type: ignore[attr-defined]
            is_discharged=False
        )
        if self.instance:
            existing_qs = existing_qs.exclude(pk=self.instance.pk)

        errors: dict[str, str] = {}
        for field_name, value in identifiers.items():
            if existing_qs.filter(**{f"{field_name}__iexact": value}).exists():
                label = ASSET_IDENTIFIER_LABELS.get(
                    field_name,
                    field_name.replace("_", " "),
                )
                errors[field_name] = (
                    f"An active collateral registration already exists with this {label}."
                )

        return errors

    # ------------------------------------------------------------------
    # Cross-field validation
    # ------------------------------------------------------------------

    def validate(self, attrs: dict) -> dict:
        """
        Cross-field validation covering:
        1. Agreement date ordering.
        2. Instalment cannot exceed total debt.
        3. Total paid cannot exceed total debt.
        4. Balance must match (total_debt - total_paid_to_date).
        5. Debtor relation fields must match debtor_type.
        6. Financier and debtor cannot be the same party.
        7. Active asset/device identifiers must be unique.
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
                {"agreement_end_date": "Agreement end date must be after start date."}
            )

        # --- 2. Instalment cap ---
        total_debt = attrs.get(
            "total_debt",
            getattr(self.instance, "total_debt", None),
        )
        instalment = attrs.get(
            "instalment_amount",
            getattr(self.instance, "instalment_amount", None),
        )
        if (
            total_debt is not None
            and instalment is not None
            and instalment > total_debt
        ):
            raise serializers.ValidationError(
                {"instalment_amount": "Instalment amount cannot exceed total debt."}
            )

        # --- 3/4. Paid + balance consistency ---
        total_paid = attrs.get(
            "total_paid_to_date",
            getattr(self.instance, "total_paid_to_date", 0),
        )
        if (
            total_debt is not None
            and total_paid is not None
            and total_paid > total_debt
        ):
            raise serializers.ValidationError(
                {"total_paid_to_date": "Total paid to date cannot exceed total debt."}
            )

        if total_debt is not None and total_paid is not None:
            expected_balance = total_debt - total_paid
            if "balance" in attrs:
                if attrs["balance"] != expected_balance:
                    raise serializers.ValidationError(
                        {
                            "balance": "Balance must equal total debt minus total paid to date."
                        }
                    )
            else:
                attrs["balance"] = expected_balance

        # --- 5. Debtor party shape ---
        financier = attrs.get("financier", getattr(self.instance, "financier", None))
        if financier is None:
            raise serializers.ValidationError({"financier": "Financier is required."})

        debtor_type, individual_debtor, company_debtor = (
            self._resolve_party_for_validation(
                attrs,
                "debtor",
            )
        )

        party_errors: dict[str, str] = {}
        party_errors.update(
            self._validate_party_shape(
                "debtor",
                debtor_type,
                individual_debtor,
                company_debtor,
            )
        )
        if party_errors:
            raise serializers.ValidationError(party_errors)

        # --- 6. Financier ≠ debtor ---
        if (
            debtor_type == DEBTOR_TYPE_INDIVIDUAL
            and individual_debtor is not None
            and financier.is_individual_client
            and financier.linked_individual == individual_debtor
        ):
            raise serializers.ValidationError(
                {
                    "individual_debtor": (
                        "Debtor cannot be the same individual as the financier."
                    )
                }
            )

        if (
            debtor_type == DEBTOR_TYPE_COMPANY
            and company_debtor is not None
            and financier.is_company_client
            and financier.linked_company_branch == company_debtor
        ):
            raise serializers.ValidationError(
                {
                    "company_debtor": "Debtor cannot be the same company as the financier."
                }
            )

        duplicate_identifier_errors = self._validate_unique_asset_identifiers(attrs)
        if duplicate_identifier_errors:
            raise serializers.ValidationError(duplicate_identifier_errors)

        return attrs

    @transaction.atomic
    def create(self, validated_data):
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
    def update(self, instance, validated_data):
        validated_data["updated_by"] = self.context["request"].user
        return super().update(instance, validated_data)


class CollateralDischargeSerializer(serializers.ModelSerializer):
    """
    Narrow serializer for the ``/discharge/`` action endpoint.

    Only the ``is_discharged`` flag is writable.  ``discharge_confirmed_at``
    is stamped automatically inside ``update()`` to prevent a client from
    supplying a fabricated timestamp.
    """

    class Meta:
        model = CollateralRegistration
        fields = ["is_discharged", "discharge_confirmed_at"]
        read_only_fields = ["discharge_confirmed_at"]

    def validate_is_discharged(self, value: bool) -> bool:
        """Prevents un-discharging a record once it has been marked discharged."""
        if self.instance and self.instance.is_discharged and not value:
            raise serializers.ValidationError(
                "A discharged record cannot be re-activated via this endpoint. "
                "Please contact an administrator."
            )
        return value

    @transaction.atomic
    def update(
        self, instance: CollateralRegistration, validated_data: dict
    ) -> CollateralRegistration:
        """
        Stamps ``discharge_confirmed_at`` with the current UTC datetime when
        ``is_discharged`` transitions from ``False`` to ``True``.
        Uses ``update_fields`` to issue a narrow UPDATE statement rather than
        a full-row write, reducing lock contention on busy tables.
        """
        newly_discharged = (
            validated_data.get("is_discharged", False) and not instance.is_discharged
        )
        if newly_discharged:
            instance.discharge_confirmed_at = timezone.now()
        instance.is_discharged = validated_data.get(
            "is_discharged", instance.is_discharged
        )
        instance.date_updated = timezone.now()
        instance.save(
            update_fields=["is_discharged", "discharge_confirmed_at", "date_updated"]
        )
        return instance


class CollateralDashboardSerializer(serializers.Serializer):
    """
    Read-only dashboard statistics for the Collateral Registry .
    """

    number_of_financiers = serializers.IntegerField(min_value=0)
    active_agreements = serializers.IntegerField(min_value=0)
    pending_discharge_confirmation = serializers.IntegerField(min_value=0)
    total_active_loan_value = serializers.DecimalField(
        max_digits=18,
        decimal_places=2,
        min_value=0,
    )


class CollateralRegistrationListSerializer(CollateralRegistrationSerializer):
    """
    Subclass of the full serializer, optimized for list views by including
    related fields needed for display and skipping expensive computed fields.
    """

    lodge_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    agreement_start_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    agreement_end_date = serializers.DateField(read_only=True, format="%d-%b-%y")
    currency_code = serializers.CharField(
        source="currency.code",
        read_only=True,
    )
    description = serializers.SerializerMethodField(
        read_only=True,
        help_text="Concatenated make and model for display purposes.",
    )
    primary_identifier = serializers.SerializerMethodField(
        read_only=True,
        help_text="Returns the MV registration number for vehicles, or the serial number otherwise.",
    )

    class Meta(CollateralRegistrationSerializer.Meta):
        """class Meta for CollateralRegistrationListSerializer"""

        fields = [
            "id",
            "lodge_date",
            "agreement_number",
            "financier_display",
            "debtor_display",
            "description",
            "primary_identifier",
            "currency_code",
            "total_debt",
            "agreement_start_date",
            "agreement_end_date",
            "is_discharged",
        ]
        read_only_fields = fields

    def get_financier_display(self, obj: CollateralRegistration) -> str:
        return obj.financier_display

    def get_debtor_display(self, obj: CollateralRegistration) -> str:
        return obj.debtor_display

    def get_description(self, obj: CollateralRegistration) -> str:
        """Gets the description for the asset, which is a concatenation of the make and model."""
        if obj.make and obj.model:
            return f"{obj.make} {obj.model}"
        if obj.make:
            return obj.make
        if obj.model:
            return obj.model
        return ""

    def get_primary_identifier(self, obj: CollateralRegistration) -> str:
        """Gets the primary identifier for the asset, which is the MV registration number for vehicles or the serial number for other asset types."""
        if obj.asset_category == "vehicles":
            return obj.asset_registration_number
        return obj.serial_number
