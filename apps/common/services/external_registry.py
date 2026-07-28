"""Client for searching and fetching party records from an external AssetSafe-compatible API."""

from __future__ import annotations

import copy
import logging
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class ExternalRegistryClient:
    """HTTP client for another AssetSafe instance (same individuals/companies API shape)."""

    def __init__(self) -> None:
        self.base_url = (getattr(settings, "EXTERNAL_REGISTRY_BASE_URL", "") or "").rstrip(
            "/"
        )
        self.api_key = getattr(settings, "EXTERNAL_REGISTRY_API_KEY", "") or ""
        self.timeout = getattr(settings, "EXTERNAL_REGISTRY_TIMEOUT", 10)

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url)

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request(self, method: str, path: str, **kwargs) -> Any | None:
        if not self.is_configured:
            return None

        url = f"{self.base_url}{path}"
        try:
            response = requests.request(
                method,
                url,
                headers=self._headers(),
                timeout=self.timeout,
                **kwargs,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            logger.warning("External registry request failed (%s %s): %s", method, url, exc)
            return None

    @staticmethod
    def _unwrap_record(payload: Any) -> dict[str, Any] | None:
        if isinstance(payload, dict):
            if "id" in payload or "first_name" in payload or "branch_name" in payload:
                return payload
            nested = payload.get("data")
            if isinstance(nested, dict):
                return nested
        return None

    @staticmethod
    def _unwrap_results(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]

        if not isinstance(payload, dict):
            return []

        for key in ("results", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = value.get("results") or value.get("data")
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]

        return []

    @staticmethod
    def _mark_external_individual(item: dict[str, Any]) -> dict[str, Any]:
        external_reference = str(item.get("id") or item.get("external_reference") or "")
        marked = copy.deepcopy(item)
        marked.update(
            {
                "id": None,
                "source": "external",
                "external_reference": external_reference,
            }
        )
        return marked

    @staticmethod
    def _mark_external_branch(item: dict[str, Any]) -> dict[str, Any]:
        branch_ref = str(item.get("id") or item.get("external_reference") or "")
        marked = copy.deepcopy(item)
        company = marked.get("company")
        if isinstance(company, dict):
            company_ref = str(company.get("id") or company.get("external_reference") or "")
            marked["company"] = {
                **company,
                "id": None,
                "source": "external",
                "external_reference": company_ref,
            }
        marked.update(
            {
                "id": None,
                "source": "external",
                "external_reference": branch_ref,
            }
        )
        return marked

    def search_individuals(self, query: str) -> list[dict[str, Any]]:
        payload = self._request(
            "GET",
            "/individuals/search/",
            params={"q": query, "search": query},
        )
        return [
            self._mark_external_individual(item) for item in self._unwrap_results(payload)
        ]

    def search_companies(self, query: str) -> list[dict[str, Any]]:
        payload = self._request(
            "GET",
            "/companies/branches/search/",
            params={"q": query},
        )
        return [self._mark_external_branch(item) for item in self._unwrap_results(payload)]

    def get_individual(self, external_reference: str) -> dict[str, Any] | None:
        payload = self._request(
            "GET",
            f"/individuals/{external_reference}/full-details/",
        )
        record = self._unwrap_record(payload)
        if not record:
            payload = self._request("GET", f"/individuals/{external_reference}/")
            record = self._unwrap_record(payload)
        return record

    def get_company_branch(self, external_reference: str) -> dict[str, Any] | None:
        payload = self._request(
            "GET",
            f"/companies/branches/{external_reference}/",
        )
        return self._unwrap_record(payload)

    def get_company(self, external_reference: str) -> dict[str, Any] | None:
        """Alias kept for import services — external_reference is the remote branch id."""
        return self.get_company_branch(external_reference)
