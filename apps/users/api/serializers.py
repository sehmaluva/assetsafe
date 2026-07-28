import contextlib
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import authenticate
from django.utils.translation import gettext_lazy as _
from django.contrib.auth import get_user_model
from apps.clients.models.models import Client
from apps.clients.api.serializers import MinimalClientSerializer
from apps.users.models.models import Role

User = get_user_model()


class RoleMinimalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "name", "description"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.StringRelatedField(many=True)

    class Meta:
        model = Role
        fields = ["id", "name", "description", "permissions"]


class UserCreateSerializer(serializers.ModelSerializer):
    client_id = serializers.PrimaryKeyRelatedField(
        queryset=Client.objects.all(), required=False, allow_null=True, write_only=True
    )
    role_id = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), required=False, allow_null=True, write_only=True
    )
    password = serializers.CharField(write_only=True, required=True)

    class Meta:
        model = User
        fields = [
            "email",
            "username",
            "password",
            "first_name",
            "last_name",
            "position",
            "client_id",
            "role_id",
            "is_staff",
            "is_superuser",
        ]
        extra_kwargs = {"email": {"required": True}, "username": {"required": False}}

    def validate(self, data):
        client = data.get("client_id")

        if client and not getattr(client, "can_have_users", False):
            raise serializers.ValidationError(
                "This client type cannot have users associated with it"
            )

        if client and client.is_individual_client:
            individual = client.linked_individual
            if (
                individual.email
                and data.get("email", "").lower() != individual.email.lower()
            ):
                raise serializers.ValidationError(
                    "Email must match the individual's registered email"
                )

        return data


class ClientUserSerializer(serializers.ModelSerializer):
    client = MinimalClientSerializer(read_only=True)
    is_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "client",
            "is_verified",
            "is_admin",
            "date_joined",
        ]
        read_only_fields = fields

    def get_is_admin(self, obj):
        return obj.is_staff or obj.roles.filter(name="Admin").exists()


class UserMiniSerializer(serializers.ModelSerializer):
    is_company_client = serializers.SerializerMethodField()
    client_id = serializers.IntegerField(
        source="client.id", read_only=True, allow_null=True
    )
    client_name = serializers.CharField(
        source="client.name", read_only=True, allow_null=True
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "position",
            "user_type",
            "is_verified",
            "is_staff",
            "is_superuser",
            "is_company_client",
            "client_id",
            "client_name",
        ]

    def get_is_company_client(self, obj):
        return bool(obj.client and obj.client.is_company_client)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        authenticate_kwargs = {
            self.username_field: attrs[self.username_field],
            "password": attrs["password"],
        }

        with contextlib.suppress(KeyError):
            authenticate_kwargs["request"] = self.context["request"]

        self.user = authenticate(**authenticate_kwargs)

        if self.user is None or not self.user.is_active:
            raise serializers.ValidationError(
                _("Invalid username or password."),
                code="authorization",
            )

        if not self.user.is_verified:
            raise serializers.ValidationError(
                _("Account not verified. Please verify your account."),
                code="unverified",
            )

        refresh = self.get_token(self.user)

        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": UserMiniSerializer(self.user).data,
        }

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["user_type"] = user.user_type
        token["client_id"] = (
            user.client.id if hasattr(user, "client") and user.client else None
        )
        token["is_verified"] = user.is_verified
        return token


class UserSerializer(serializers.ModelSerializer):
    client = MinimalClientSerializer(read_only=True)
    profile_object = serializers.SerializerMethodField()
    roles = RoleSerializer(many=True, read_only=True)
    is_company_client = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "user_type",
            "first_name",
            "last_name",
            "position",
            "client",
            "profile_object",
            "roles",
            "is_verified",
            "is_staff",
            "is_superuser",
            "is_company_client",
            "last_login",
            "date_joined",
        ]
        read_only_fields = [
            "last_login",
            "date_joined",
            "is_staff",
            "is_superuser",
            "user_type",
            "roles",
            "client",
            "profile_object",
            "is_company_client",
        ]

    def get_is_company_client(self, obj):
        return bool(obj.client and obj.client.is_company_client)

    def get_profile_object(self, obj):
        if not obj.profile_object:
            return None

        from apps.individuals.api.serializers import IndividualSerializer

        return IndividualSerializer(obj.profile_object).data


class MinimalUserSerializer(serializers.ModelSerializer):
    client = MinimalClientSerializer(read_only=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "user_type", "is_verified", "client"]
        read_only_fields = fields


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Fields a user may update on their own account."""

    class Meta:
        model = User
        fields = ["first_name", "last_name", "position"]
        read_only_fields = ["email"]

    def validate_position(self, value):
        return (value or "").strip()

    def validate_position(self, value):
        current = (getattr(self.instance, "position", None) or "").strip()
        incoming = (value or "").strip()
        if current and incoming != current:
            raise serializers.ValidationError(
                "Position can only be set when it is currently blank."
            )
        return incoming


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True)
    confirm_password = serializers.CharField(required=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is not correct")
        return value

    def validate(self, data):
        if data["new_password"] != data["confirm_password"]:
            raise serializers.ValidationError("New passwords must match")
        user = self.context["request"].user
        validate_password(data["new_password"], user=user)
        if user.check_password(data["new_password"]):
            raise serializers.ValidationError(
                "New password cannot be the same as the old password."
            )
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)


class PasswordResetConfirmSerializer(serializers.Serializer):
    new_password = serializers.CharField(required=True)
    confirm_password = serializers.CharField(required=True)

    def validate(self, data):
        if data["new_password"] != data["confirm_password"]:
            raise serializers.ValidationError("New passwords must match")
        return data

    def validate_new_password(self, value):
        validate_password(value, user=self.context.get("user"))
        return value


class PasswordResetValidateSerializer(serializers.Serializer):
    uid = serializers.CharField(required=True)
    token = serializers.CharField(required=True)
