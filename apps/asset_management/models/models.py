"""
models.py — Asset Management
"""

from __future__ import annotations

from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from apps.common.models import (
    BaseAssetType,
    CustodyType,
    Currency,
    PartyType,
    SaleTerms,
    TitleStatus,
    ValuationType,
)
from apps.common.models.base_models import BaseModelWithUser
from apps.common.models.models import City, Suburb
from apps.companies.models.models import CompanyBranch
from apps.individuals.models.models import Individual


class AssetRegistration(BaseModelWithUser):
    """
    An asset lodged in the Asset Registry by an individual or company.

    Type-specific fields live on related detail models (``vehicle``, ``mobile``,
    ``land``) keyed by ``asset_category``.
    """

    registration_number = models.CharField(
        max_length=20,
        unique=True,
        editable=False,
        db_index=True,
        verbose_name=_("Registration Number"),
        help_text=_("Internally generated sequential identifier, e.g. AR000001."),
    )
    owner_type = models.CharField(
        max_length=20,
        db_index=True,
        verbose_name=_("Owner Type"),
    )
    individual_owner = models.ForeignKey(
        Individual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name=_("Individual Owner"),
    )
    company_owner = models.ForeignKey(
        CompanyBranch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name=_("Company Owner"),
    )
    owner_asset_number = models.CharField(
        max_length=100,
        blank=True,
        verbose_name=_("Owner Asset Number"),
        help_text=_("Company's own internal code for this asset, if applicable."),
    )
    asset_category = models.CharField(
        max_length=50,
        db_index=True,
        verbose_name=_("Asset Category"),
        help_text=_("High-level category from managed base asset types."),
    )
    asset_type = models.CharField(
        max_length=100,
        blank=True,
        default="",
        verbose_name=_("Asset Type"),
        help_text=_("Free-text subtype describing the asset within its category."),
    )
    make = models.CharField(max_length=100, blank=True, verbose_name=_("Make"))
    model = models.CharField(max_length=100, blank=True, verbose_name=_("Model"))
    year_of_make = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name=_("Year of Make"),
    )
    condition = models.CharField(
        max_length=20,
        blank=True,
        verbose_name=_("Condition"),
    )

    serial_number = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name=_("Serial Number"),
        help_text=_("For non-vehicle assets that carry a serial number."),
    )
    currency = models.ForeignKey(
        Currency,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        verbose_name=_("Currency"),
    )
    estimated_value = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        validators=[MinValueValidator(0)],
        verbose_name=_("Estimated Value"),
    )
    location_address = models.TextField(
        blank=True,
        default="",
        verbose_name=_("Location Address"),
        help_text=_(
            "Physical address where the asset is normally kept. "
            "For moveable assets, use the owner's address."
        ),
    )

    custodian_type = models.CharField(
        max_length=20,
        blank=True,
        verbose_name=_("Custodian Type"),
    )
    individual_custodian = models.ForeignKey(
        Individual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="custodied_assets",
        verbose_name=_("Individual Custodian"),
    )
    company_custodian = models.ForeignKey(
        CompanyBranch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="custodied_assets",
        verbose_name=_("Company Custodian"),
    )
    custody_type = models.CharField(
        max_length=20,
        choices=CustodyType.choices,
        blank=True,
        db_index=True,
        verbose_name=_("Custody Type"),
        help_text=_(
            "When set, the asset is encumbered under custody (rule 1404.1.2)."
        ),
    )
    custodian_address = models.TextField(blank=True, verbose_name=_("Custodian Address"))
    custodian_email = models.EmailField(blank=True, verbose_name=_("Custodian Email"))
    custodian_mobile = models.CharField(
        max_length=30, blank=True, verbose_name=_("Custodian Mobile")
    )
    custodian_telephone = models.CharField(
        max_length=30, blank=True, verbose_name=_("Custodian Telephone")
    )
    guarantor_name = models.CharField(
        max_length=255, blank=True, verbose_name=_("Guarantor")
    )
    guarantor_identification = models.CharField(
        max_length=100, blank=True, verbose_name=_("Guarantor ID")
    )

    lodge_date = models.DateField(
        auto_now_add=True,
        editable=False,
        verbose_name=_("Lodge Date"),
    )
    subscription_start_date = models.DateField(
        verbose_name=_("Subscription Start Date"),
    )
    subscription_end_date = models.DateField(
        verbose_name=_("Subscription End Date"),
    )

    class Meta:
        ordering = ["-lodge_date"]
        verbose_name = _("Asset Registration")
        verbose_name_plural = _("Asset Registrations")
        indexes = [
            models.Index(
                fields=["subscription_start_date", "subscription_end_date"],
                name="ar_sub_period_idx",
            ),
            models.Index(
                fields=["owner_type", "individual_owner"],
                name="ar_owner_ind_idx",
            ),
            models.Index(
                fields=["owner_type", "company_owner"],
                name="ar_owner_comp_idx",
            ),
        ]

    def __str__(self) -> str:
        owner = self.individual_owner or self.company_owner or _("Unassigned Owner")
        if self.asset_category == BaseAssetType.LAND:
            land = getattr(self, "land", None)
            stand = land.stand_number if land else ""
            return f"{self.registration_number} — Stand {stand} ({owner})"
        desc = f"{self.make} {self.model}".strip()
        return f"{self.registration_number} — {desc or self.asset_type} ({owner})"

    def is_active(self) -> bool:
        today = timezone.now().date()
        return self.subscription_start_date <= today <= self.subscription_end_date

    def is_under_custody(self) -> bool:
        return bool(self.custody_type)

    def get_open_sale_transition(self) -> StandSaleTransition | None:
        return (
            StandSaleTransition.objects.filter(
                asset=self,
                is_completed=False,
            )
            .select_related(
                "individual_purchaser",
                "company_purchaser",
                "company_purchaser__company",
            )
            .first()
        )

    def save(self, *args, **kwargs) -> None:
        if not self.registration_number:
            self.registration_number = self._generate_registration_number()
        super().save(*args, **kwargs)

    @classmethod
    def _generate_registration_number(cls) -> str:
        with transaction.atomic():
            last_record = (
                cls.objects.select_for_update()
                .only("registration_number")
                .order_by("-id")
                .first()
            )
            if last_record:
                next_seq = int(last_record.registration_number[2:]) + 1
            else:
                next_seq = 1
            return f"AR{next_seq:06d}"


class VehicleDetails(BaseModelWithUser):
    """Vehicle-specific identifiers (plates, chassis, engine)."""

    asset = models.OneToOneField(
        AssetRegistration,
        on_delete=models.CASCADE,
        related_name="vehicle",
        verbose_name=_("Asset"),
    )
    mv_registration_number = models.CharField(
        max_length=50,
        blank=True,
        db_index=True,
        verbose_name=_("MV Registration Number"),
    )
    chassis_number = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        verbose_name=_("Chassis Number"),
    )
    engine_number = models.CharField(
        max_length=100,
        blank=True,
        verbose_name=_("Engine Number"),
    )

    class Meta:
        verbose_name = _("Vehicle Details")
        verbose_name_plural = _("Vehicle Details")
        constraints = [
            models.UniqueConstraint(
                Lower("mv_registration_number"),
                condition=~models.Q(mv_registration_number=""),
                name="ar_uq_vehicle_mv_reg_ci",
            ),
            models.UniqueConstraint(
                Lower("chassis_number"),
                condition=~models.Q(chassis_number=""),
                name="ar_uq_vehicle_chassis_ci",
            ),
            models.UniqueConstraint(
                Lower("engine_number"),
                condition=~models.Q(engine_number=""),
                name="ar_uq_vehicle_engine_ci",
            ),
        ]

    def __str__(self) -> str:
        return self.mv_registration_number or str(self.asset_id)


class MobileDetails(BaseModelWithUser):
    """Mobile phone-specific identifiers."""

    asset = models.OneToOneField(
        AssetRegistration,
        on_delete=models.CASCADE,
        related_name="mobile",
        verbose_name=_("Asset"),
    )
    imei = models.CharField(
        max_length=20,
        db_index=True,
        verbose_name=_("IMEI"),
    )

    class Meta:
        verbose_name = _("Mobile Details")
        verbose_name_plural = _("Mobile Details")
        constraints = [
            models.UniqueConstraint(
                Lower("imei"),
                name="ar_uq_mobile_imei_ci",
            ),
        ]

    def __str__(self) -> str:
        return self.imei


class LandDetails(BaseModelWithUser):
    """Stand/plot/land registration details (1416)."""

    STAND_SIZE_UNIT_SQ_M = "sq_m"

    asset = models.OneToOneField(
        AssetRegistration,
        on_delete=models.CASCADE,
        related_name="land",
        verbose_name=_("Asset"),
    )
    city = models.ForeignKey(
        City,
        on_delete=models.PROTECT,
        related_name="land_assets",
        verbose_name=_("City/Town"),
    )
    suburb = models.ForeignKey(
        Suburb,
        on_delete=models.PROTECT,
        related_name="land_assets",
        verbose_name=_("Suburb/Area/Development"),
    )
    stand_address = models.CharField(
        max_length=255,
        blank=True,
        verbose_name=_("Stand Address"),
    )
    stand_number = models.CharField(
        max_length=50,
        db_index=True,
        verbose_name=_("Stand Number"),
    )
    stand_size = models.CharField(
        max_length=50,
        blank=True,
        verbose_name=_("Stand Size"),
        help_text=_("Numeric size, e.g. 1200"),
    )
    stand_size_unit = models.CharField(
        max_length=10,
        default=STAND_SIZE_UNIT_SQ_M,
        verbose_name=_("Stand Size Unit"),
    )
    valuation_type = models.CharField(
        max_length=30,
        choices=ValuationType.choices,
        verbose_name=_("Valuation Type"),
    )
    title_status = models.CharField(
        max_length=30,
        choices=TitleStatus.choices,
        verbose_name=_("Title Status"),
    )

    class Meta:
        verbose_name = _("Land Details")
        verbose_name_plural = _("Land Details")
        constraints = [
            models.UniqueConstraint(
                models.F("city"),
                models.F("suburb"),
                Lower("stand_number"),
                name="ar_uq_land_city_suburb_stand_ci",
            ),
        ]

    def __str__(self) -> str:
        return f"Stand {self.stand_number} — {self.suburb.name}"

    @property
    def stand_size_display(self) -> str:
        if not self.stand_size:
            return ""
        unit_label = "sq. m" if self.stand_size_unit == self.STAND_SIZE_UNIT_SQ_M else self.stand_size_unit
        return f"{self.stand_size} {unit_label}"


class StandSaleTransition(BaseModelWithUser):
    """
    Records a stand sale before deeds-office title transfer (1417).

    Owner on ``AssetRegistration`` stays the seller until ownership change.
    """

    asset = models.ForeignKey(
        AssetRegistration,
        on_delete=models.CASCADE,
        related_name="sale_transitions",
        verbose_name=_("Asset"),
    )
    purchaser_type = models.CharField(
        max_length=20,
        choices=PartyType.choices,
        verbose_name=_("Purchaser Type"),
    )
    individual_purchaser = models.ForeignKey(
        Individual,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="stand_purchases",
        verbose_name=_("Individual Purchaser"),
    )
    company_purchaser = models.ForeignKey(
        CompanyBranch,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="stand_purchases",
        verbose_name=_("Company Purchaser"),
    )
    sale_date = models.DateField(verbose_name=_("Date of Sale"))
    terms = models.CharField(
        max_length=20,
        choices=SaleTerms.choices,
        verbose_name=_("Terms"),
    )
    valuation_type = models.CharField(
        max_length=30,
        choices=ValuationType.choices,
        verbose_name=_("Valuation Type"),
    )
    title_status = models.CharField(
        max_length=30,
        choices=TitleStatus.choices,
        verbose_name=_("Title Status"),
    )
    currency = models.ForeignKey(
        Currency,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        verbose_name=_("Currency"),
    )
    value_amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        validators=[MinValueValidator(0)],
        verbose_name=_("Value Amount"),
    )
    is_completed = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name=_("Completed"),
        help_text=_("Set when ownership change finalises the sale."),
    )
    completed_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = _("Stand Sale Transition")
        verbose_name_plural = _("Stand Sale Transitions")
        ordering = ["-sale_date", "-date_created"]
        constraints = [
            models.UniqueConstraint(
                fields=["asset"],
                condition=models.Q(is_completed=False),
                name="ar_uq_open_sale_per_asset",
            ),
        ]

    def __str__(self) -> str:
        return f"Sale of {self.asset.registration_number} on {self.sale_date}"


class AssetOwnershipEventType(models.TextChoices):
    OWNERSHIP_CHANGE = "ownership_change", _("Ownership Change")
    SALE_TRANSITION = "sale_transition", _("Sale Transition")


class AssetOwnershipEvent(BaseModelWithUser):
    """Audit trail for stand ownership changes and sale transitions."""

    asset = models.ForeignKey(
        AssetRegistration,
        on_delete=models.CASCADE,
        related_name="ownership_events",
        verbose_name=_("Asset"),
    )
    event_type = models.CharField(
        max_length=30,
        choices=AssetOwnershipEventType.choices,
        db_index=True,
        verbose_name=_("Event Type"),
    )
    previous_owner_type = models.CharField(max_length=20, blank=True)
    previous_individual_owner = models.ForeignKey(
        Individual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    previous_company_owner = models.ForeignKey(
        CompanyBranch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    new_owner_type = models.CharField(max_length=20, blank=True)
    new_individual_owner = models.ForeignKey(
        Individual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    new_company_owner = models.ForeignKey(
        CompanyBranch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    sale_transition = models.ForeignKey(
        StandSaleTransition,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ownership_events",
    )
    valuation_type = models.CharField(
        max_length=30,
        choices=ValuationType.choices,
        blank=True,
    )
    title_status = models.CharField(
        max_length=30,
        choices=TitleStatus.choices,
        blank=True,
    )
    terms = models.CharField(
        max_length=20,
        choices=SaleTerms.choices,
        blank=True,
    )
    value_amount = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = _("Asset Ownership Event")
        verbose_name_plural = _("Asset Ownership Events")
        ordering = ["-date_created"]

    def __str__(self) -> str:
        return f"{self.event_type} — {self.asset.registration_number}"
