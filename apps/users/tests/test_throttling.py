"""Tests for rate limiting on login and authenticated API endpoints."""

from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from apps.users.api.throttles import LoginRateThrottle
from apps.users.api.views import LoginView


class LoginRateThrottleTests(TestCase):
    """Verify the LoginRateThrottle is wired to LoginView correctly."""

    def test_login_view_has_login_rate_throttle(self):
        """LoginView must include LoginRateThrottle in its throttle_classes."""
        self.assertIn(LoginRateThrottle, LoginView.throttle_classes)

    def test_login_rate_throttle_scope(self):
        """LoginRateThrottle must use scope 'login'."""
        self.assertEqual(LoginRateThrottle.scope, "login")

    def test_login_rate_throttle_is_anon_subclass(self):
        """LoginRateThrottle must extend AnonRateThrottle (per-IP)."""
        self.assertTrue(issubclass(LoginRateThrottle, AnonRateThrottle))


class ThrottledLoginResponseTests(TestCase):
    """Verify a throttled login returns 429 with Retry-After header."""

    def setUp(self):
        self.client = APIClient()
        self.login_url = reverse("login")

    def test_throttled_login_returns_429_with_retry_after(self):
        """When the login throttle is exceeded, the response is 429 with Retry-After."""
        # Force the throttle to always reject (wait=30 seconds)
        with patch.object(LoginRateThrottle, "allow_request", return_value=False), \
             patch.object(LoginRateThrottle, "wait", return_value=30.0):
            response = self.client.post(
                self.login_url,
                {"username": "any", "password": "any"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("Retry-After", response)
        self.assertEqual(int(response["Retry-After"]), 30)

    def test_throttled_response_error_envelope(self):
        """429 response body must follow the project error envelope."""
        with patch.object(LoginRateThrottle, "allow_request", return_value=False), \
             patch.object(LoginRateThrottle, "wait", return_value=10.0):
            response = self.client.post(
                self.login_url,
                {"username": "any", "password": "any"},
                format="json",
            )

        data = response.json()
        self.assertEqual(data["status"], "error")
        self.assertIn("message", data)
        self.assertIn("errors", data)


class RestFrameworkThrottleSettingsTests(TestCase):
    """Ensure the REST_FRAMEWORK settings include required throttle configuration."""

    def test_default_throttle_classes_configured(self):
        from django.conf import settings

        classes = settings.REST_FRAMEWORK.get("DEFAULT_THROTTLE_CLASSES", [])
        self.assertIn("rest_framework.throttling.AnonRateThrottle", classes)
        self.assertIn("rest_framework.throttling.UserRateThrottle", classes)

    def test_throttle_rates_configured(self):
        from django.conf import settings

        rates = settings.REST_FRAMEWORK.get("DEFAULT_THROTTLE_RATES", {})
        self.assertIn("login", rates)
        self.assertIn("anon", rates)
        self.assertIn("user", rates)
        # Login must be 10 requests per minute
        self.assertEqual(rates["login"], "10/minute")
