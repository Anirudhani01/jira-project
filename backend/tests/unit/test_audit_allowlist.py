from app.modules.audit.service import ACTION_METADATA_ALLOWLIST


def test_org_settings_updated_metadata_allowlist() -> None:
    assert ACTION_METADATA_ALLOWLIST["org.settings.updated"] == frozenset({"fields"})


def test_project_settings_updated_metadata_allowlist() -> None:
    assert ACTION_METADATA_ALLOWLIST["project.settings.updated"] == frozenset(
        {"project", "fields"}
    )
