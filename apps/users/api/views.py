"""User-related API views, including authentication, user management, and role management."""

import json
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions, viewsets
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.decorators import action
from django.conf import settings
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.db import transaction
from django.core.exceptions import ValidationError
from rest_framework.exceptions import ValidationError as DRFValidationError
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from apps.common.services.tasks import send_notification
from django.contrib.sites.shortcuts import get_current_site

from apps.users.api.authentication import CookieJWTAuthentication
from apps.users.api.throttles import LoginRateThrottle
from apps.users.api.serializers import (
    CustomTokenObtainPairSerializer,
    UserSerializer,
    UserCreateSerializer,
    RoleSerializer,
    RoleMinimalSerializer,
    PasswordChangeSerializer,
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetValidateSerializer,
    ProfileUpdateSerializer,
)
from apps.users.models import Role
from apps.users.utils.permissions import IsSuperuser
from apps.users.services.user_service import UserCreationService
from apps.users.services.audit_service import create_audit_log
from apps.users.utils.cookies import (
    delete_jwt_cookies,
    create_response_with_cookies,
)
from apps.users.utils.tokens import password_reset_token_generator

logger = logging.getLogger(__name__)
User = get_user_model()
from django.utils import timezone


def _friendly_login_message(raw: str) -> str:
    """Map technical auth failures to clear, user-facing copy."""
    text = (raw or "").strip()
    lower = text.lower()

    if "not verified" in lower:
        return "Account not verified. Please verify your account."
    if (
        "no active account" in lower
        or "given credentials" in lower
        or "invalid credentials" in lower
        or "authentication failed" in lower
        or "unable to log in" in lower
    ):
        return "Invalid username or password."
    if text:
        return text
    return "Invalid username or password."


class LoginView(APIView):
    """
    Custom login view that handles cookie setting properly.
    """

    permission_classes = []  # Allow anyone to access login
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        try:
            # Use the serializer to validate credentials
            serializer = CustomTokenObtainPairSerializer(
                data=request.data, context={"request": request}
            )
            serializer.is_valid(raise_exception=True)

            # Get the validated data
            data = serializer.validated_data

            # Create response with cookies
            response_data = {"user": data["user"], "message": "Login successful"}

            response = create_response_with_cookies(
                data=response_data,
                status_code=status.HTTP_200_OK,
                access_token=data["access"],
                refresh_token=data["refresh"],
            )

            return response

        except DRFValidationError as e:
            detail = e.detail
            # Prefer a plain error string for the frontend login banner.
            if isinstance(detail, dict):
                non_field = detail.get("non_field_errors")
                if isinstance(non_field, (list, tuple)) and non_field:
                    message = str(non_field[0])
                else:
                    first = next(iter(detail.values()), None)
                    message = (
                        str(first[0])
                        if isinstance(first, (list, tuple)) and first
                        else str(detail)
                    )
            elif isinstance(detail, (list, tuple)) and detail:
                message = str(detail[0])
            else:
                message = str(detail)

            message = _friendly_login_message(message)
            status_code = (
                status.HTTP_403_FORBIDDEN
                if "not verified" in message.lower()
                else status.HTTP_401_UNAUTHORIZED
            )
            logger.error("Login error: %s", detail)
            return Response(
                {
                    "error": message,
                    "detail": message,
                    "non_field_errors": [message],
                },
                status=status_code,
            )

        except Exception as e:
            logger.error(f"Login error: {str(e)}")
            message = _friendly_login_message(str(e))
            status_code = (
                status.HTTP_403_FORBIDDEN
                if "not verified" in message.lower()
                else status.HTTP_401_UNAUTHORIZED
            )
            return Response(
                {
                    "error": message,
                    "detail": message,
                    "non_field_errors": [message],
                },
                status=status_code,
            )


class LogoutView(APIView):
    permission_classes = []  # Allow logout without authentication

    def post(self, request):
        try:
            # Create simple response
            response_data = {"message": "Logout successful"}
            response = HttpResponse(
                json.dumps(response_data),
                status=status.HTTP_200_OK,
                content_type="application/json",
            )

            # Delete cookies
            response = delete_jwt_cookies(response)

            return response

        except Exception as e:
            logger.error(f"Logout error: {str(e)}")
            return Response(
                {"error": "Logout failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RefreshTokenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            from apps.users.utils.cookies import get_tokens_from_request

            tokens = get_tokens_from_request(request)
            refresh_token = tokens["refresh_token"]

            if not refresh_token:
                return Response(
                    {"error": "Refresh token not found"},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # Create new access token from refresh token
            token = RefreshToken(refresh_token)
            new_access_token = str(token.access_token)

            # Create response with new access token cookie
            response_data = {"message": "Token refreshed successfully"}
            response = create_response_with_cookies(
                data=response_data,
                status_code=status.HTTP_200_OK,
                access_token=new_access_token,
            )

            return response

        except Exception as e:
            logger.error(f"Token refresh error: {str(e)}")
            return Response(
                {"error": "Invalid refresh token"}, status=status.HTTP_401_UNAUTHORIZED
            )


def _user_from_uid_token(uidb64: str, token: str):
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None
    if user is None or not password_reset_token_generator.check_token(user, token):
        return None
    return user


class CurrentUserView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    def patch(self, request):
        serializer = ProfileUpdateSerializer(
            request.user, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        create_audit_log(
            request=request,
            action="user.profile_update",
            resource_type="CustomUser",
            resource_id=user.pk,
            details={"email": user.email},
            logger=logger,
        )
        return Response(UserSerializer(user).data)


class CheckCSRFView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"message": "CSRF token is valid"}, status=status.HTTP_200_OK)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("-date_joined")
    permission_classes = [IsAuthenticated, IsSuperuser]

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return UserCreateSerializer
        return UserSerializer

    def create(self, request):
        """
        Create either a system user or client user based on provided data
        """
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                user_data = serializer.validated_data
                client = user_data.get("client_id")
                role_id = user_data.get("role_id")

                if client:
                    # Create client user
                    user = UserCreationService.create_client_user(
                        creator=request.user, client=client, user_data=user_data
                    )
                else:
                    # Create system user
                    user = UserCreationService.create_system_user(
                        creator=request.user, user_data=user_data, role_id=role_id
                    )

                return Response(
                    UserSerializer(user).data, status=status.HTTP_201_CREATED
                )

        except ValidationError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response(
                {"detail": "An error occurred while creating user"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def perform_update(self, serializer):
        old_email = serializer.instance.email
        user = serializer.save()

        create_audit_log(
            request=self.request,
            action="user.update",
            resource_type="CustomUser",
            resource_id=user.pk,
            details={"username": user.username, "email": user.email},
            logger=logger,
        )

        # Check if email was changed
        if old_email and user.email and old_email.lower() != user.email.lower():
            # Send notification to the new email
            send_notification(
                recipient_type="user",
                recipient_id=user.id,
                notification_type="EMAIL_CHANGED",
                context={
                    "user": user,
                    "old_email": old_email,
                },
                template_name="email_changed",
                subject="Your Email Address Has Been Changed",
            )


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def minimal(self, request):
        """
        Get a minimal list of roles with only id, name, and description
        """
        roles = Role.objects.all()
        serializer = RoleMinimalSerializer(roles, many=True)
        return Response(serializer.data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(
            data=request.data, context={"request": request}
        )
        if serializer.is_valid():
            request.user.set_password(serializer.validated_data["new_password"])
            request.user.last_password_change = timezone.now()
            request.user.save()

            # Send notification using the template
            send_notification(
                recipient_type="user",
                recipient_id=request.user.id,
                notification_type="PASSWORD_CHANGED",
                context={
                    "user": request.user,
                },
                template_name="password_changed",
                subject="Your Password Has Been Changed",
            )

            return Response(
                {"message": "Password changed successfully"}, status=status.HTTP_200_OK
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


PASSWORD_RESET_GENERIC_MESSAGE = (
    "If an account with that email exists, we sent a password reset link. "
    "Check your inbox and spam folder."
)


class PasswordResetRequestView(APIView):
    permission_classes = []

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data["email"].strip().lower()
        try:
            user = User.objects.get(email__iexact=email)
            token = password_reset_token_generator.make_token(user)
            uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
            frontend_base = (
                getattr(settings, "FRONTEND_LOGIN_URL", None)
                or getattr(settings, "FRONTEND_URL", None)
                or ""
            ).rstrip("/")
            reset_path = f"/reset-password?uid={uidb64}&token={token}"
            reset_url = f"{frontend_base}{reset_path}" if frontend_base else reset_path

            send_notification(
                recipient_type="user",
                recipient_id=user.id,
                notification_type="PASSWORD_RESET",
                context={
                    "token": token,
                    "uidb64": uidb64,
                    "user": user,
                    "reset_url": reset_url,
                    "protocol": "https" if request.is_secure() else "http",
                    "domain": get_current_site(request).domain,
                },
                template_name="password_reset",
                subject="Password Reset Request",
            )
        except User.DoesNotExist:
            pass

        return Response(
            {"message": PASSWORD_RESET_GENERIC_MESSAGE},
            status=status.HTTP_200_OK,
        )


class PasswordResetValidateView(APIView):
    """Verify reset link before showing the new-password form."""

    permission_classes = []

    def post(self, request):
        serializer = PasswordResetValidateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        uid = serializer.validated_data["uid"]
        token = serializer.validated_data["token"]
        user = _user_from_uid_token(uid, token)
        if user is None:
            return Response(
                {"valid": False, "detail": "Invalid or expired reset link."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "valid": True,
                "message": "Reset link verified. You may set a new password.",
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = []

    def post(self, request, uidb64, token):
        serializer = PasswordResetConfirmSerializer(
            data=request.data,
            context={"user": _user_from_uid_token(uidb64, token)},
        )
        if serializer.is_valid():
            user = serializer.context.get("user")
            if user is not None:
                user.set_password(serializer.validated_data["new_password"])
                user.last_password_change = timezone.now()
                user.save()

                # Send notification using the template
                send_notification(
                    recipient_type="user",
                    recipient_id=user.id,
                    notification_type="PASSWORD_CHANGED",
                    context={
                        "user": user,
                    },
                    template_name="password_changed",
                    subject="Your Password Has Been Reset",
                )

                return Response(
                    {"message": "Password has been reset successfully"},
                    status=status.HTTP_200_OK,
                )
            else:
                return Response(
                    {"error": "Invalid or expired token"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
