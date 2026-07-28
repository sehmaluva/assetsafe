from django.db import models, transaction
from django.db.models import Max
from django.utils.translation import gettext_lazy as _
from apps.common.models.models import Address, Document, Note
from django.contrib.contenttypes.fields import GenericRelation
from apps.common.models.base_models import BaseModel, BaseModelWithUser
from apps.common.models.models import PartyDataSource
import re


class Individual(BaseModelWithUser):
    IDENTIFICATION_TYPES = (
        ("national_id", "National ID"),
        ("passport", "Passport"),
        ("alien_id", "Alien ID"),
        ("service_id", "Service ID"),
    )

    GENDER_CHOICES = (
        ("male", "Male"),
        ("female", "Female"),
        ("other", "Other"),
    )
    MARITAL_STATUS_CHOICES = (
        ("single", "Single"),
        ("married", "Married"),
        ("divorced", "Divorced"),
        ("widowed", "Widowed"),
    )
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    date_of_birth = models.DateField(blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    gender = models.CharField(
        max_length=10, choices=GENDER_CHOICES, blank=True, null=True
    )
    identification_type = models.CharField(max_length=20, choices=IDENTIFICATION_TYPES)
    identification_number = models.CharField(max_length=50, unique=True)
    marital_status = models.CharField(
        max_length=20, choices=MARITAL_STATUS_CHOICES, blank=True, null=True
    )
    account_number = models.CharField(
        max_length=100, unique=True, blank=True, null=True
    )
    is_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)
    source = models.CharField(
        max_length=20,
        choices=PartyDataSource.choices,
        default=PartyDataSource.INTERNAL,
        db_default=PartyDataSource.INTERNAL,
        help_text=_("Whether this record was created locally or imported from an external registry."),
    )
    external_reference = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
        db_index=True,
        help_text=_("Identifier of this record in the external registry, when source is external."),
    )
    # Relationships
    addresses = GenericRelation(Address)
    documents = GenericRelation(Document)
    notes = GenericRelation(Note)

    class Meta:
        app_label = "individuals"
        db_table = "individual"
        verbose_name = _("individual")
        verbose_name_plural = _("individuals")
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.identification_number})"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def primary_address(self):
        primary_address = (
            self.addresses.filter(is_primary=True).first()
            if self.addresses.exists()
            else "No Address"
        )
        return primary_address

    @property
    def phone(self):

        return (
            self.contact_details.last().mobile_number
            or self.contact_details.last().whatsapp_number
        )

    def clean(self):
        if self.first_name:
            self.first_name = self.first_name.strip().capitalize()

        if self.last_name:
            self.last_name = self.last_name.strip().capitalize()

        if self.identification_number:
            cleaned_id = re.sub(r"[-\s]", "", self.identification_number.strip())
            self.identification_number = cleaned_id.upper()

    def save(self, *args, **kwargs):
        if not self.account_number:
            name_for_prefix = self.first_name or self.full_name
            prefix = name_for_prefix[:3].upper()
            base_prefix = f"C{prefix}"

            with transaction.atomic():
                latest_account = (
                    Individual.objects.select_for_update()
                    .filter(account_number__startswith=base_prefix)
                    .aggregate(Max("account_number"))["account_number__max"]
                )

                if latest_account:
                    latest_number = int(latest_account[-4:])
                    new_number = latest_number + 1
                else:
                    new_number = 1

                self.account_number = f"{base_prefix}{new_number:04d}"

        self.full_clean()
        return super().save(*args, **kwargs)


class IndividualContactDetail(BaseModel):
    PHONE_TYPES = (
        ("mobile", "Mobile"),
        ("whatsapp", "WhatsApp"),
        ("combined", "Combined"),
        ("home", "Home"),
        ("work", "Work"),
        ("other", "Other"),
    )

    individual = models.ForeignKey(
        Individual, on_delete=models.CASCADE, related_name="contact_details"
    )
    type = models.CharField(
        max_length=50, blank=True, choices=PHONE_TYPES, default="mobile"
    )
    phone_number = models.CharField(max_length=20, blank=True, null=True)

    @property
    def mobile_number(self):
        if self.type in ["mobile", "combined"]:
            return self.phone_number

    @property
    def whatsapp_number(self):
        if self.type in ["whatsapp", "combined"]:
            return self.phone_number

    class Meta:
        app_label = "individuals"
        db_table = "contact_detail"
        verbose_name = "contact detail"
        verbose_name_plural = "contact details"
        ordering = ("id",)

    def __str__(self):
        return f"Phone Number: {self.phone_number} for {self.individual}"


class EmploymentDetail(BaseModel):
    individual = models.ForeignKey(
        Individual, on_delete=models.CASCADE, related_name="employment_details"
    )
    employer_name = models.CharField(max_length=255)
    job_title = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField(blank=True, null=True)
    is_current = models.BooleanField(default=True)
    monthly_income = models.DecimalField(
        max_digits=12, decimal_places=2, blank=True, null=True
    )
    industry = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        app_label = "individuals"
        db_table = "employment_detail"
        verbose_name = _("employment detail")
        verbose_name_plural = _("employment details")
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.job_title} at {self.employer_name}"


class NextOfKin(BaseModel):
    RELATIONSHIP_CHOICES = (
        ("spouse", "Spouse"),
        ("parent", "Parent"),
        ("child", "Child"),
        ("sibling", "Sibling"),
        ("other", "Other"),
    )

    individual = models.ForeignKey(
        Individual, on_delete=models.CASCADE, related_name="next_of_kin"
    )
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    relationship = models.CharField(max_length=20, choices=RELATIONSHIP_CHOICES)
    mobile_phone = models.CharField(max_length=20)
    email = models.EmailField(blank=True, null=True)
    physical_address = models.TextField(blank=True, null=True)

    class Meta:
        app_label = "individuals"
        db_table = "next_of_kin"
        verbose_name = _("next of kin")
        verbose_name_plural = _("next of kin")
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.get_relationship_display()})"

    def get_relationship_display(self):
        return dict(self.RELATIONSHIP_CHOICES).get(self.relationship, "Unknown")


class IndividualAccounts(BaseModel):
    """Model representing an individual's account details.

    Args:
        BaseModel (_type_): _description_

    Returns:
        _string_: _description_
    """

    individual = models.ForeignKey(
        Individual, on_delete=models.CASCADE, related_name="account_details"
    )
    tin_number = models.CharField(max_length=100, unique=True)
    vat_number = models.CharField(max_length=100, unique=True)

    class Meta(BaseModel.Meta):
        app_label = "individuals"
        db_table = "individual_account_detail"
        verbose_name = _("individual account detail")
        verbose_name_plural = _("individual account details")
        ordering = ["-id"]

    def __str__(self):
        return f"account details for {self.individual.full_name}"
