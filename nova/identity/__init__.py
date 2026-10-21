"""Consent-scoped encrypted memory; no personal data enters shared model weights."""

from .store import IdentityStore, ConsentError, ConsentRegistry

__all__ = ["IdentityStore", "ConsentError", "ConsentRegistry"]
