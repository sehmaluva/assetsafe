from django.db import models
from django.utils.translation import gettext_lazy as _
from django.contrib.contenttypes.fields import GenericRelation
from django.contrib.contenttypes.models import ContentType
from apps.common.models.models import Address, Document, Note
from apps.common.models.base_models import BaseModel, BaseModelWithUser
from apps.common.models.models import PartyDataSource
from apps.individuals.models.models import Individual
from django.db.models import UniqueConstraint, Q, Max
from django.db.models.functions import Lower
from django.utils.functional import cached_property
from django.db import transaction


class Industry(models.TextChoices):
    """
    Default industry sectors for companies.

    Live dropdown values are served from ``LookupOption`` rows with
    category ``Industry`` (seeded from this enum via ``seed_lookups``).
    Staff may add additional industries in Django admin / managed-choices.
    """

    AGRICULTURE = "agriculture", _("Agriculture")
    BANKING = "banking", _("Banking")
    CONSTRUCTION = "construction", _("Construction")
    EDUCATION = "education", _("Education")
    ENERGY = "energy", _("Energy")
    ENTERTAINMENT = "entertainment", _("Entertainment")
    FINANCE = "finance", _("Finance")
    FOOD = "food", _("Food")
    HEALTH = "health", _("Health")
    HOSPITALITY = "hospitality", _("Hospitality")
    INSURANCE = "insurance", _("Insurance")
    MANUFACTURING = "manufacturing", _("Manufacturing")
    MEDIA = "media", _("Media")
    RETAIL = "retail", _("Retail")
    TECHNOLOGY = "technology", _("Technology")
    TELECOMMUNICATIONS = "telecommunications", _("Telecommunications")
    TRANSPORTATION = "transportation", _("Transportation")
    AVIATION = "aviation", _("Aviation")
    REAL_ESTATE = "real_estate", _("Real Estate")
    OTHER = "other", _("Other")


class Company(BaseModelWithUser):
    LEGAL_STATUS_CHOICES = (
        ("private", "Private Limited"),
        ("public", "Public Limited"),
        ("government", "Government"),
        ("ngo", "NGO"),
        ("other", "Other"),
    )

    registration_number = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text=_("Unique registration number of the company."),
    )
    registration_name = models.CharField(
        max_length=255, help_text=_("The official registered name of the company.")
    )
    trading_name = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text=_(
            "The name the company trades under, if different from registration name."
        ),
    )
    legal_status = models.CharField(
        max_length=20,
        choices=LEGAL_STATUS_CHOICES,
        help_text=_("The legal status or type of the company."),
        default="private",
        blank=True,
        null=True,
    )
    date_of_incorporation = models.DateField(
        blank=True,
        null=True,
        help_text=_("The date the company was officially incorporated."),
    )
    industry = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text=_("The industry sector the company operates in."),
    )
    is_verified = models.BooleanField(
        default=False,
        help_text=_("Indicates if the company's details have been verified."),
    )
    is_active = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)
    source = models.CharField(
        max_length=20,
        choices=PartyDataSource.choices,
        default=PartyDataSource.INTERNAL,
        db_default=PartyDataSource.INTERNAL,
        help_text=_(
            "Whether this record was created locally or imported from an external registry."
        ),
    )
    external_reference = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
        db_index=True,
        help_text=_(
            "Identifier of this record in the external registry, when source is external."
        ),
    )
    # Relationships
    addresses = GenericRelation(Address, related_query_name="company_address")
    documents = GenericRelation(
        Document,
        related_query_name="company_document",
        null=True,
        blank=True,
        help_text=_("Documents associated with the company."),
    )
    notes = GenericRelation(
        Note,
        related_query_name="company_note",
        null=True,
        blank=True,
        help_text=_("Notes associated with the company."),
    )

    class Meta:
        app_label = "companies"
        db_table = "company"
        verbose_name = _("company")
        verbose_name_plural = _("companies")
        ordering = ["registration_name"]
        constraints = [
            UniqueConstraint(
                fields=["registration_name"],
                name="unique_registration_name_company",
                condition=~models.Q(registration_name__isnull=True),
            ),
        ]

    def __str__(self):
        return self.trading_name or self.registration_name

    @property
    def full_name(self):
        return self.trading_name or self.registration_name

    def auto_create_hq_branch(self):
        """
        Automatically create a headquarters branch if it doesn't exist.
        This method can be called after saving the company instance.
        """
        if not self.branches.filter(is_headquarters=True).exists():
            company_address = Address.objects.filter(
                content_type=ContentType.objects.get_for_model(Company),
                object_id=self.id,
                address_type="physical",
                is_primary=True,
            ).first()
            branch = CompanyBranch.objects.create(
                company=self,
                branch_name=self.registration_name,
                is_headquarters=True,
                email=self.profile.email if hasattr(self, "profile") else None,
                phone=self.profile.mobile_phone if hasattr(self, "profile") else None,
                # addresses=company_address if company_address else None
            )

            if company_address:
                Address.objects.create(
                    content_type=ContentType.objects.get_for_model(CompanyBranch),
                    object_id=branch.id,
                    address_type=company_address.address_type,
                    is_primary=True,
                    street_address=company_address.street_address,
                    line_2=company_address.line_2,
                    postal_code=company_address.postal_code,
                    city=company_address.city,
                    suburb=company_address.suburb,
                    province=company_address.province,
                    country=company_address.country,
                    latitude=company_address.latitude,
                    longitude=company_address.longitude,
                )

            return branch
        return None


class CompanyBranch(BaseModelWithUser):
    company = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name="branches",
        help_text=_("The company this branch belongs to."),
    )
    branch_name = models.CharField(
        max_length=255, help_text=_("The name of the branch.")
    )
    email = models.EmailField(
        max_length=255,
        blank=True,
        null=True,
        help_text=_("General email address for the branch."),
    )
    phone = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text=_("General phone number for the branch."),
    )
    addresses = GenericRelation(Address, related_query_name="branch_address")
    is_deleted = models.BooleanField(
        default=False, help_text=_("Indicates if the branch is deleted.")
    )
    is_headquarters = models.BooleanField(
        default=False, help_text=_("Indicates if this branch is the headquarters.")
    )

    class Meta:
        app_label = "companies"
        db_table = "company_branch"
        verbose_name = _("company branch")
        verbose_name_plural = _("company branches")
        constraints = [
            UniqueConstraint(
                fields=["company", "branch_name"], name="unique_branch_name_per_company"
            ),
        ]
        ordering = ["company__registration_name", "branch_name"]

    def __str__(self):
        return self.party_display

    @property
    def party_display(self) -> str:
        """
        Registry-friendly label: company name (registration number).

        Avoids duplicating the HQ branch name when it mirrors the company
        registration/trading name (e.g. ``Acme - Acme``).
        """
        company = self.company
        company_name = (
            (company.trading_name or company.registration_name or "").strip()
            if company
            else ""
        )
        branch_name = (self.branch_name or "").strip()
        reg_no = (company.registration_number or "").strip() if company else ""

        if (
            branch_name
            and company_name
            and branch_name.lower()
            not in {
                company_name.lower(),
                (company.registration_name or "").strip().lower(),
                (company.trading_name or "").strip().lower(),
            }
            and not self.is_headquarters
        ):
            label = f"{company_name} — {branch_name}"
        else:
            label = company_name or branch_name or f"Branch #{self.pk}"

        if reg_no:
            return f"{label} ({reg_no})"
        return label

    @property
    def full_name(self):
        return (
            f"{self.branch_name}"
            if self.branch_name
            else self.company.registration_name
        )

    @cached_property
    def primary_address(self):
        if not self.addresses.exists():
            return None
        return self.addresses.filter(is_primary=True).first()


class ContactPerson(BaseModel):
    CONTACT_TYPES = (
        ("primary", "Primary Contact"),
        ("finance", "Finance Contact"),
        ("technical", "Technical Contact"),
        ("other", "Other"),
    )
    branch = models.ForeignKey(
        CompanyBranch,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="contacts",
        help_text=_("The company branch this contact person is associated with."),
    )
    individual = models.ForeignKey(
        Individual,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contact_as_person",
        help_text=_(
            "The individual record if this contact person is also an Individual."
        ),
    )

    contact_type = models.CharField(
        max_length=20,
        choices=CONTACT_TYPES,
        blank=True,
        null=True,
        help_text=_(
            "The type of contact this person represents (e.g., primary, finance)."
        ),
    )
    is_primary = models.BooleanField(
        default=False,
        help_text=_("Indicates if this is the primary contact for its context."),
    )

    position = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text=_("The position or role of the contact person."),
    )

    class Meta:
        app_label = "companies"
        db_table = "contact_person"
        verbose_name = _("Contact Person")
        verbose_name_plural = _("Contact Persons")
        ordering = ["-date_created"]
        constraints = [
            UniqueConstraint(
                fields=["branch", "contact_type"],
                condition=Q(contact_type="primary"),
                name="unique_primary_branch_contact",
            )
        ]

    def __str__(self):
        name = (
            f"{self.individual.first_name} {self.individual.last_name}"
            if self.individual
            else _("Unnamed Contact")
        )
        context = f" ( {self.branch.branch_name})" if self.branch else ""
        contact_type_display = (
            self.get_contact_type_display() if self.contact_type else "General"
        )

        return f"{name}{context} [{contact_type_display}]"

    def get_contact_type_display(self):
        return dict(self.CONTACT_TYPES).get(self.contact_type, "Unknown")

    @property
    def full_name(self):
        return (
            f"{self.individual.first_name} {self.individual.last_name}"
            if self.individual
            else _("Unnamed Contact")
        )

    @property
    def full_contact_info(self):
        """
        Returns a formatted string with the contact person's full name and position.
        """
        name = self.full_name
        position = self.position or ""
        mobile = (
            self.individual.contact_details.first().first_mobile_phone
            if self.individual
            else ""
        )
        return f"{name} - {position} - {mobile}".strip()

    @property
    def phone(self):
        return (
            self.individual.contact_details.first().first_mobile_phone
            if self.individual
            else None
        )

    def clean(self):
        super().clean()
        if self.branch.company:
            raise models.ValidationError(
                _(
                    "Contact person cannot be associated with a branch that is not linked to a company."
                )
            )


class CompanyProfile(BaseModel):
    company = models.OneToOneField(
        Company,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="profile",
        help_text=_("The company this profile belongs to."),
    )

    TRADING_STATUS_CHOICES = (
        ("ACTIVE", _("Active")),
        ("INACTIVE", _("Inactive")),
        ("LIQUIDATION", _("In Liquidation")),
        ("BUSINESS_RESCUE", _("Business Rescue")),
        ("DEREGISTERED", _("Deregistered")),
        ("PENDING_REGISTRATION", _("Pending Registration")),
    )
    trading_status = models.CharField(
        _("Trading Status"),
        max_length=50,
        choices=TRADING_STATUS_CHOICES,
        blank=True,
        null=True,
        help_text=_("Current trading status of the company."),
    )

    former_address = GenericRelation(
        Address, related_query_name="profile_former_address"
    )
    postal_address = GenericRelation(
        Address, related_query_name="profile_postal_address"
    )

    mobile_phone = models.CharField(
        _("Mobile Phone"),
        max_length=20,
        blank=True,
        null=True,
        help_text=_("General mobile phone number for the company."),
    )
    landline_phone = models.CharField(
        _("Landline Phone"),
        max_length=20,
        blank=True,
        null=True,
        help_text=_("General landline phone number for the company."),
    )
    email = models.EmailField(
        _("Email Address"),
        max_length=255,
        blank=True,
        null=True,
        help_text=_("General email address for the company."),
    )

    logo = models.ImageField(
        _("Company Logo"),
        upload_to="company_logos/",
        blank=True,
        null=True,
        help_text=_("Company logo image file."),
    )
    registration_date = models.DateField(
        _("Registration Date"),
        blank=True,
        null=True,
        help_text=_("The official registration date of the company profile."),
    )
    tin_number = models.CharField(
        _("Tin Number"),
        max_length=255,
        blank=True,
        null=True,
        help_text=_("Tax Identification Number."),
    )

    vat_number = models.CharField(
        _("VAT Number"),
        max_length=255,
        blank=True,
        null=True,
        help_text=_("Value Added Tax (VAT) registration number."),
    )
    number_of_employees = models.IntegerField(
        _("Number of Employees"),
        blank=True,
        null=True,
        help_text=_("Approximate number of employees."),
    )
    website = models.URLField(
        _("Website"),
        max_length=255,
        blank=True,
        null=True,
        help_text=_("Official website URL of the company."),
    )
    TREND_CHOICES = (
        ("GROWING", _("Growing")),
        ("STABLE", _("Stable")),
        ("DECLINING", _("Declining")),
        ("NEW", _("New")),
    )
    trend = models.CharField(
        _("Company Trend"),
        max_length=50,
        choices=TREND_CHOICES,
        blank=True,
        null=True,
        help_text=_("Current growth trend of the company."),
    )

    twitter = models.URLField(_("Twitter URL"), max_length=255, blank=True, null=True)
    facebook = models.URLField(_("Facebook URL"), max_length=255, blank=True, null=True)
    instagram = models.URLField(
        _("Instagram URL"), max_length=255, blank=True, null=True
    )
    linkedin = models.URLField(_("LinkedIn URL"), max_length=255, blank=True, null=True)

    operations = models.TextField(
        _("Operations Details"),
        blank=True,
        null=True,
        help_text=_("Detailed description of company operations."),
    )

    contact_person = models.ForeignKey(
        ContactPerson,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="companies_as_primary_contact",
        help_text=_("The primary contact person for this company profile."),
    )

    RISK_CLASS_CHOICES = (
        ("LOW", _("Low Risk")),
        ("MEDIUM", _("Medium Risk")),
        ("HIGH", _("High Risk")),
        ("VERY_HIGH", _("Very High Risk")),
    )
    risk_class = models.CharField(
        _("Risk Class"),
        max_length=20,
        choices=RISK_CLASS_CHOICES,
        default="LOW",
        blank=True,
        null=True,
        help_text=_("Assessed risk classification of the company."),
    )

    account_number = models.CharField(
        _("Account Number"),
        max_length=255,
        blank=True,
        null=True,
        help_text=_("Unique customer account number for the company."),
        unique=True,
    )

    IS_JUDICIAL_CHOICES = (
        ("NO_INFO", _("No Information")),
        ("YES", _("Yes")),
        ("NO", _("No")),
        ("PENDING", _("Pending Assessment")),
    )
    is_under_judicial = models.CharField(
        _("Is Under Judicial Process"),
        max_length=20,
        choices=IS_JUDICIAL_CHOICES,
        blank=True,
        null=True,
        default="NO_INFO",
        help_text=_(
            "Indicates if the company is currently under judicial management or liquidation."
        ),
    )

    is_suspended = models.BooleanField(
        _("Is Suspended"),
        default=False,
        help_text=_("Indicates if the company's services are currently suspended."),
    )

    class Meta:
        app_label = "companies"
        db_table = "company_profile"
        verbose_name = _("Company Profile")
        verbose_name_plural = _("Company Profiles")

    def __str__(self):
        return f"Profile for {self.company.registration_name}"

    def save(self, *args, **kwargs):
        if not self.account_number:
            name_for_prefix = self.company.registration_name
            prefix = name_for_prefix[:3].upper()
            base_prefix = f"C{prefix}"

            with transaction.atomic():
                latest_account = (
                    CompanyProfile.objects.select_for_update()
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
