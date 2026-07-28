from django.db import models

# Create your models here.
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.utils.text import slugify
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from apps.common.models.base_models import BaseModel


# ---------------------------------------------------------------------------
# Shared Enums for Asset Registries (used across all registry apps)
# ---------------------------------------------------------------------------


class PartyType(models.TextChoices):
    """Whether a party (owner / financier / debtor / purchaser) is an individual or company."""

    INDIVIDUAL = "individual", _("Individual")
    COMPANY = "company", _("Company")


class PartyDataSource(models.TextChoices):
    """Where party master data originated."""

    INTERNAL = "internal", _("Internal")
    EXTERNAL = "external", _("External")


class BaseAssetType(models.TextChoices):
    """Asset categories shared across asset management and hire purchase registries"""

    COMPUTERS = "computers", _("Computers")
    MACHINERY = "machinery", _("Machinery")
    EQUIPMENT = "equipment", _("Equipment")
    VEHICLES = "vehicles", _("Vehicles")
    LAND = "land", _("Land")
    BUILDING = "building", _("Building")
    FURNITURE = "furniture", _("Furniture")
    SHARES = "shares", _("Shares")
    MOBILES = "mobiles", _("Mobiles")
    CONSOLES = "consoles", _("Consoles")


class CollateralAssetType(models.TextChoices):
    """
    Historic enum for collateral asset categories.

    Live dropdowns are served from ``LookupOption`` rows with
    category ``CollateralAssetCategory`` (seeded from this enum).
    """

    COMPUTERS = "computers", _("Computers")
    MACHINERY = "machinery", _("Machinery")
    EQUIPMENT = "equipment", _("Equipment")
    VEHICLES = "vehicles", _("Vehicles")
    LAND = "land", _("Land")
    BUILDING = "building", _("Building")
    FURNITURE = "furniture", _("Furniture")
    SHARES = "shares", _("Shares")
    INVENTORY = "inventory", _("Inventory")
    ACCOUNTS_RECEIVABLE = "accounts_receivable", _("Accounts Receivable")
    MOBILES = "mobiles", _("Mobiles")
    CONSOLES = "consoles", _("Consoles")


class AssetCondition(models.TextChoices):
    """Physical condition of an asset at the time of registration."""

    NEW = "new", _("New")
    SECOND_HAND = "second_hand", _("Second Hand")
    RECONDITIONED = "reconditioned", _("Reconditioned")
    NON_FUNCTIONING = "non_functioning", _("Non Functioning")


class CustodyType(models.TextChoices):
    """How an asset is held by a non-owner custodian (Asset Registry)."""

    RENTAL = "rental", _("Rental")
    ESCROW = "escrow", _("Escrow")
    CONSIGNMENT = "consignment", _("Consignment")
    TRUST = "trust", _("Trust")
    ARRANGEMENT = "arrangement", _("Arrangement")
    EMPLOYEE = "employee", _("Employee")


class LookupOption(models.Model):
    """
    DB-backed choice lists for PartyType, BaseAssetType, AssetCondition,
    and CollateralAssetCategory.

    System rows (``is_system=True``) mirror TextChoices enums and are kept in
    sync by ``apps.common.utils.seed_lookups.seed_system_lookup_options``
    (``post_migrate`` + ``manage.py seed_lookups``). Staff may create and
    delete custom non-system rows.
    """

    CATEGORY_PARTY_TYPE = "PartyType"
    CATEGORY_BASE_ASSET_TYPE = "BaseAssetType"
    CATEGORY_ASSET_CONDITION = "AssetCondition"
    CATEGORY_COLLATERAL_ASSET_CATEGORY = "CollateralAssetCategory"
    CATEGORY_CHOICES = (
        (CATEGORY_PARTY_TYPE, _("Party Type")),
        (CATEGORY_BASE_ASSET_TYPE, _("Base Asset Type")),
        (CATEGORY_ASSET_CONDITION, _("Asset Condition")),
        (CATEGORY_COLLATERAL_ASSET_CATEGORY, _("Collateral Asset Category")),
    )

    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        db_index=True,
    )
    value = models.CharField(max_length=50)
    label = models.CharField(max_length=100)
    is_system = models.BooleanField(
        default=False,
        help_text=_("System rows are seeded from built-in enums and cannot be deleted."),
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        app_label = "common"
        ordering = ["category", "sort_order", "label"]
        constraints = [
            models.UniqueConstraint(
                fields=["category", "value"],
                name="uniq_lookup_option_category_value",
            )
        ]
        verbose_name = _("Lookup Option")
        verbose_name_plural = _("Lookup Options")

    def __str__(self) -> str:
        return f"{self.category}:{self.value}"

    def clean(self):
        self.value = (self.value or "").strip().lower().replace(" ", "_")
        self.label = (self.label or "").strip()
        if not self.value:
            raise ValidationError({"value": _("Value is required.")})
        if not self.label:
            raise ValidationError({"label": _("Label is required.")})


class Currency(models.Model):
    """Supported currencies. Extend as the product expands to new markets."""

    code = models.CharField(max_length=3, unique=True)
    name = models.CharField(max_length=100)
    symbol = models.CharField(max_length=10)

    def __str__(self):
        return self.name

    class Meta:
        app_label = "common"
        verbose_name = "Currency"
        verbose_name_plural = "Currencies"


# ---------------------------------------------------------------------------
# Abstract base model for audit timestamps
# ---------------------------------------------------------------------------


class TimeStampedModel(models.Model):
    """
    Abstract base class that injects ``created_at`` and ``updated_at`` audit
    timestamps into every concrete subclass automatically.
    """

    created_at = models.DateTimeField(auto_now_add=True, editable=False)
    updated_at = models.DateTimeField(auto_now=True, editable=False)

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Common App Models (Document, Note, Location Data, Addresses, etc.)
# ---------------------------------------------------------------------------


class Document(BaseModel):
    DOCUMENT_TYPES = (
        ("id", "Identification"),
        ("proof_of_address", "Proof of Address"),
        ("contract", "Contract"),
        ("other", "Other"),
    )

    content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, null=True, blank=True
    )
    object_id = models.PositiveIntegerField(null=True, blank=True)
    content_object = GenericForeignKey("content_type", "object_id")

    document_type = models.CharField(max_length=50, choices=DOCUMENT_TYPES)
    file = models.FileField(upload_to="documents/")
    description = models.TextField(blank=True, null=True)
    is_verified = models.BooleanField(default=False)

    class Meta:
        app_label = "common"
        verbose_name = "Document"
        verbose_name_plural = "Documents"

    def __str__(self):
        if self.content_type and self.object_id:
            return f"{self.get_document_type_display()} for object ID {self.object_id}"
        return f"{self.get_document_type_display()} (Unlinked)"

    def get_document_type_display(self):
        return dict(self.DOCUMENT_TYPES).get(
            self.document_type, "Unknown Document Type"
        )


class Note(BaseModel):
    content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, null=True, blank=True
    )
    object_id = models.PositiveIntegerField(null=True, blank=True)
    content_object = GenericForeignKey("content_type", "object_id")

    author = models.ForeignKey(
        "users.CustomUser",
        on_delete=models.CASCADE,
        related_name="notes",
        null=True,
        blank=True,
    )
    content = models.TextField()
    is_private = models.BooleanField(default=False)

    class Meta:
        app_label = "common"
        verbose_name = "Note"
        verbose_name_plural = "Notes"

    def __str__(self):
        if self.content_type and self.object_id:
            return (
                f"Note by {self.author.get_full_name() if self.author else 'Unknown'}"
            )
        return f"Note by {self.author.get_full_name() if self.author else 'Unknown'} (Unlinked)"


class Country(BaseModel):
    """Country level location data"""

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=3)  # ISO 3166-3 alpha-3
    slug = models.SlugField(unique=True, null=True)
    dial_code = models.CharField(max_length=5)
    currency_code = models.CharField(max_length=3)
    currency_name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "common"
        verbose_name_plural = "countries"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        if not self.id:
            count = 1
            while Country.objects.filter(slug=self.slug).exists():
                self.slug = f"{self.slug}-{count}"
                count += 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.code})"


class Province(BaseModel):
    """Provinces/States level location data"""

    country = models.ForeignKey(
        Country, on_delete=models.PROTECT, related_name="provinces"
    )
    slug = models.SlugField(unique=True, null=True)
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=10)
    is_active = models.BooleanField(default=True)
    approved = models.BooleanField(default=False)

    class Meta:
        app_label = "common"
        verbose_name_plural = "provinces"
        unique_together = ["country", "code"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)

        if not self.id:
            count = 1
            while Province.objects.filter(slug=self.slug).exists():
                self.slug = f"{self.slug}-{count}"
                count += 1

        super().save(*args, **kwargs)

    def __str__(self):
        try:
            return f"{self.name} ({self.code}) - {self.country.name}"
        except Exception:
            return f"{self.name} ({self.code}) - [Country not loaded]"


class City(BaseModel):
    """City/Town level location data"""

    province = models.ForeignKey(
        Province, on_delete=models.PROTECT, related_name="cities"
    )
    slug = models.SlugField(unique=True, null=True)
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "common"
        verbose_name_plural = "cities"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)

        if not self.id:
            count = 1
            while City.objects.filter(slug=self.slug).exists():
                self.slug = f"{self.slug}-{count}"
                count += 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} - {self.province.name}"


class Suburb(BaseModel):
    """Suburb level location data"""

    city = models.ForeignKey(City, on_delete=models.PROTECT, related_name="suburbs")
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "common"
        verbose_name_plural = "suburbs"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)

        if not self.id:
            count = 1
            while Suburb.objects.filter(slug=self.slug).exists():
                self.slug = f"{self.slug}-{count}"
                count += 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} - {self.city.name}"


class Address(BaseModel):
    ADDRESS_TYPES = (
        ("physical", "Physical Address"),
        ("postal", "Postal Address"),
        ("billing", "Billing Address"),
        ("work", "Work Address"),
        ("other", "Other"),
    )

    # Generic Foreign Key to link Address to our other models (eg Individual, Company, Property, etc.)
    content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, null=True, blank=True
    )
    object_id = models.PositiveIntegerField(null=True, blank=True)
    content_object = GenericForeignKey("content_type", "object_id")

    # Type of address for the linked object
    address_type = models.CharField(
        max_length=20, choices=ADDRESS_TYPES, default="physical"
    )
    is_primary = models.BooleanField(
        default=False,
        help_text="Is this the primary address of its type for the linked object?",
    )

    country = models.ForeignKey(
        Country,
        on_delete=models.PROTECT,
        related_name="addresses",
        null=True,
        blank=True,
    )
    province = models.ForeignKey(
        Province,
        on_delete=models.PROTECT,
        related_name="addresses",
        null=True,
        blank=True,
    )
    city = models.ForeignKey(
        City, on_delete=models.PROTECT, related_name="addresses", blank=True, null=True
    )
    suburb = models.ForeignKey(
        Suburb,
        on_delete=models.PROTECT,
        related_name="addresses",
        null=True,
        blank=True,
    )

    # Address Components
    street_address = models.CharField(
        max_length=255,
        help_text="Street name, house/building number",
        null=True,
        blank=True,
    )
    line_2 = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Apartment, suite, or unit number",
    )
    postal_code = models.CharField(max_length=20, null=True, blank=True)

    # Geographic coordinates
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )

    class Meta:
        verbose_name_plural = "Addresses"
        app_label = "common"
        # Ensure only one primary address of a given type per object
        unique_together = ("content_type", "object_id", "address_type", "is_primary")

    def __str__(self):
        parts = []
        if self.street_address:
            parts.append(self.street_address)
        if self.line_2:
            parts.append(self.line_2)
        if self.suburb:
            parts.append(self.suburb.name)
        if self.city:
            parts.append(self.city.name)
        if self.province and self.province.name != self.city.name:
            parts.append(self.province.name)
        if self.country:
            parts.append(self.country.name)
        if self.postal_code:
            parts.append(self.postal_code)

        if not parts:
            return f"Address (ID: {self.pk})"

        return f"{', '.join(parts)} ({self.get_address_type_display()})"

    def clean(self):
        """Validate address hierarchy"""
        super().clean()

        if self.suburb and self.city and self.suburb.city != self.city:
            raise ValidationError(
                {
                    "suburb": f'Suburb "{self.suburb.name}" does not belong to city "{self.city.name}"'
                }
            )

        if self.city and self.province and self.city.province != self.province:
            raise ValidationError(
                {
                    "city": f'City "{self.city.name}" does not belong to province "{self.province.name}"'
                }
            )

        if self.province and self.country and self.province.country != self.country:
            raise ValidationError(
                {
                    "province": f'Province "{self.province.name}" does not belong to country "{self.country.name}"'
                }
            )

    def save(self, *args, **kwargs):
        if self.suburb and not self.city:
            self.city = self.suburb.city
        if self.city and not self.province:
            self.province = self.city.province
        if self.province and not self.country:
            self.country = self.province.country

        self.full_clean()

        if self.is_primary and self.content_object:
            qs = Address.objects.filter(
                content_type=self.content_type,
                object_id=self.object_id,
                address_type=self.address_type,
                is_primary=True,
            )
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            qs.update(is_primary=False)

        super().save(*args, **kwargs)
