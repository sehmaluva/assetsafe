from django.db import models

# Create your models here.
from django.utils.translation import gettext_lazy as _
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db.models import Q
from apps.common.models.base_models import BaseModel
from apps.individuals.models.models import Individual
from apps.companies.models.models import CompanyBranch
from uuid import uuid4
from django.contrib.auth import get_user_model
from django.conf import settings


class Client(models.Model):
    """
    Represents a client, which can be either an Individual or a Company.
    """

    USER_TYPE_CHOICES = (
        ("ADMIN", "Admin"),
        ("CLIENT", "Client"),
        ("INDIVIDUAL_USER", "Individual Profile User"),
        ("COMPANY_USER", "Company Profile User"),
    )
    client_content_type = models.ForeignKey(
        ContentType,
        on_delete=models.RESTRICT,
        limit_choices_to=Q(app_label="individuals", model="individual")
        | Q(app_label="companies", model="companybranch"),
        related_name="client_profiles",
        help_text=_(
            "The type of the associated client entity (Individual or Company)."
        ),
    )
    client_type = models.CharField(
        max_length=20,
        choices=USER_TYPE_CHOICES,
        default="CLIENT",
        help_text=_("The role or type of the user in the system."),
    )
    client_object_id = models.PositiveIntegerField(
        help_text=_("The ID of the associated client entity.")
    )
    client_object = GenericForeignKey("client_content_type", "client_object_id")
    name = models.CharField(
        max_length=255,
        unique=True,
        blank=True,
        null=True,
        help_text=_("A unique display name for this client. Auto-generated if empty."),
    )

    client_status_choices = (
        ("ACTIVE", _("Active")),
        ("INACTIVE", _("Inactive")),
        ("PENDING", _("Pending Approval")),
        ("SUSPENDED", _("Suspended")),
        ("CLOSED", _("Closed")),
    )
    status = models.CharField(
        max_length=20,
        choices=client_status_choices,
        default="ACTIVE",
        help_text=_("The current status of the client in the system."),
    )

    external_client_id = models.UUIDField(
        blank=True,
        null=True,
        unique=True,
        default=uuid4,
        help_text=_("An optional external ID for this client (e.g., from a CRM)."),
    )
    date_created = models.DateTimeField(
        auto_now_add=True, help_text=_("The date and time when the client was created.")
    )
    date_modified = models.DateTimeField(
        auto_now=True,
        help_text=_("The date and time when the client was last modified."),
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="client_created_by",
        help_text=_("The user who created this client profile."),
    )

    class Meta:
        app_label = "clients"
        db_table = "client"
        verbose_name = _("Client")
        verbose_name_plural = _("Clients")
        ordering = ["name"]
        unique_together = [["client_content_type", "client_object_id"]]

    def __str__(self):
        return f"{self.name or self.client_object} ({self.get_client_type_display()})"

    def save(self, *args, **kwargs):
        if not self.name and self.client_object:
            if isinstance(self.client_object, Individual):
                self.name = f"{self.client_object.full_name}"
            elif isinstance(self.client_object, CompanyBranch):
                self.name = f"{self.client_object.branch_name}"
            else:
                self.name = (
                    f"Client {self.client_content_type.model}-{self.client_object_id}"
                )

        original_name = self.name
        counter = 1
        while (
            self.name
            and Client.objects.filter(name=self.name).exclude(pk=self.pk).exists()
        ):
            self.name = f"{original_name} {counter}"
            counter += 1
        super().save(*args, **kwargs)

    @property
    def get_linked_entity(self):
        """Returns the linked Individual or Company object."""
        return self.client_object

    @property
    def is_individual_client(self):
        """Returns True if the client is an Individual."""
        return isinstance(self.client_object, Individual)

    @property
    def linked_individual(self):
        """Returns the linked Individual if this is an individual client, else None"""
        return self.client_object if self.is_individual_client else None

    @property
    def linked_company_branch(self):
        """Returns the linked CompanyBranch if this is a company client, else None"""
        return self.client_object if self.is_company_client else None

    @property
    def linked_company(self):
        """Returns the Company if this is a company client, else None"""
        return self.client_object.company if self.is_company_client else None

    def get_absolute_url(self):
        from django.urls import reverse

        return reverse("clients:client-detail", kwargs={"pk": self.pk})

    @property
    def is_company_client(self):
        """Returns True if the client is a Company."""
        return isinstance(self.client_object, CompanyBranch)

    @property
    def email(self):
        """Get email from linked entity"""
        if self.is_individual_client:
            return self.linked_individual.email or None
        elif self.is_company_client:
            return self.linked_company_branch.email
        return None

    @property
    def can_have_users(self):
        """Determine if this client type can have users"""
        return self.client_type in ["INDIVIDUAL_USER", "COMPANY_USER", "CLIENT"]

