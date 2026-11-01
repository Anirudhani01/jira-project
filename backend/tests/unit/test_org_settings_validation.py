import pytest

from app.modules.orgs.settings_validation import (
    LocaleValidationError,
    TimezoneValidationError,
    normalize_bcp47_locale,
    validate_iana_timezone,
)


def test_normalize_common_locales() -> None:
    assert normalize_bcp47_locale("en-US") == "en-US"
    assert normalize_bcp47_locale("en-us") == "en-US"
    assert normalize_bcp47_locale("fr-FR") == "fr-FR"
    assert normalize_bcp47_locale("zh-Hans-CN") == "zh-Hans-CN"
    assert normalize_bcp47_locale("sr-Latn") == "sr-Latn"


def test_rejects_empty_and_invalid() -> None:
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("")
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("   ")
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("not_a_locale!")
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("e")


def test_rejects_overlong_tag() -> None:
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("en-" + "x" * 260)


def test_rejects_underscore_locale() -> None:
    with pytest.raises(LocaleValidationError):
        normalize_bcp47_locale("en_US")


def test_extension_and_private_use_locales() -> None:
    assert normalize_bcp47_locale("en-u-ca-gregory") == "en-u-ca-gregory"
    assert normalize_bcp47_locale("en-x-private") == "en-x-private"


def test_timezone_validation() -> None:
    assert validate_iana_timezone("UTC") == "UTC"
    assert validate_iana_timezone(" America/New_York ") == "America/New_York"
    with pytest.raises(TimezoneValidationError):
        validate_iana_timezone("Not/Real")
