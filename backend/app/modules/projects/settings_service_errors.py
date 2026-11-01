"""Project settings API errors (B2)."""

from app.core.errors import AppError


def project_archived() -> AppError:
    return AppError(409, "project_archived", "Archived projects are read-only.")


def project_settings_conflict(fields: list[str]) -> AppError:
    return AppError(
        409,
        "project_settings_conflict",
        "Project overrides no longer match organization settings. "
        "Update or reset the conflicting override fields.",
        errors=[
            {"field": field, "message": "conflicts with organization settings"} for field in fields
        ],
    )


def validation_error(field: str, message: str) -> AppError:
    return AppError(
        422,
        "validation_error",
        "Validation failed.",
        errors=[{"field": f"body.{field}", "message": message}],
    )
