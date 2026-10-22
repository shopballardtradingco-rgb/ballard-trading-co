"""Approval and diagnostic regressions; all credentials are synthetic."""
from cryptography.fernet import Fernet
import pytest

from btco_ebay.config import Settings
from btco_ebay.github_worker import require_fresh_owner_approval


def test_settings_diagnostics_omit_both_developer_and_store_secrets():
    key = Fernet.generate_key().decode()
    settings = Settings("https://connector.example.invalid", "synthetic-client-id",
                        "synthetic-developer-secret", "synthetic-runame", key,
                        openai_api_key="synthetic-ai-key")
    for value in (settings.client_secret, key, settings.openai_api_key):
        assert value not in repr(settings)
        assert value not in str(settings)
    assert settings.client_secret == "synthetic-developer-secret"
    assert settings.encryption_key == key


def owner_dispatch():
    return {"GITHUB_ACTOR": "shopballardtradingco-rgb",
            "GITHUB_TRIGGERING_ACTOR": "shopballardtradingco-rgb",
            "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "workflow_dispatch"}


def test_fresh_owner_dispatch_can_approve():
    require_fresh_owner_approval(owner_dispatch())


@pytest.mark.parametrize("field,value", [
    ("GITHUB_ACTOR", "collaborator"),
    ("GITHUB_TRIGGERING_ACTOR", "collaborator"),
    ("GITHUB_TRIGGERING_ACTOR", ""),
    ("GITHUB_RUN_ATTEMPT", "2"),
    ("GITHUB_RUN_ATTEMPT", ""),
    ("GITHUB_EVENT_NAME", "push"),
])
def test_rerun_or_different_operator_cannot_grant_new_listing_approval(field, value):
    env = owner_dispatch()
    env[field] = value
    with pytest.raises(ValueError, match="fresh owner"):
        require_fresh_owner_approval(env)
