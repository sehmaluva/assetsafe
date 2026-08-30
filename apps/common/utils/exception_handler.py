"""Custom DRF exception handler with consistent error envelope."""

import logging

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """
    Custom DRF exception handler that wraps all error responses in a
    consistent envelope::

        {
            "status": "error",
            "message": "<human-readable summary>",
            "errors": { ... }   # field-level detail, may be empty
        }

    For ``Throttled`` (429) responses, a ``Retry-After`` header is added
    with the number of seconds until the client may retry.
    """
    # Let Django's Http404 / PermissionDenied be handled by DRF
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()

    response = drf_exception_handler(exc, context)

    if response is None:
        # Unhandled exception – do not interfere; Django / middleware will deal with it.
        return None

    # Build the error envelope
    detail = response.data
    if isinstance(detail, dict):
        message = detail.get("detail", str(detail))
        errors = {k: v for k, v in detail.items() if k != "detail"}
    elif isinstance(detail, list):
        message = " ".join(str(item) for item in detail)
        errors = {}
    else:
        message = str(detail)
        errors = {}

    response.data = {
        "status": "error",
        "message": message,
        "errors": errors,
    }

    # Ensure Retry-After header is present for throttled responses
    if isinstance(exc, exceptions.Throttled) and exc.wait is not None:
        response["Retry-After"] = int(exc.wait)

    return response
