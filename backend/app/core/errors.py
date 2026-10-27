"""RFC 9457 problem+json responses and exception handlers.

Every error response has the same shape: ``type``, ``title``, ``status``, ``code``,
``detail``, ``request_id`` and, for validation failures, ``errors``. Inaccessible and
missing resources produce an identical 404 body. Submitted input values are never
echoed back.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Final

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

PROBLEM_CONTENT_TYPE: Final = "application/problem+json"

_STATUS_INFO: Final[dict[int, tuple[str, str]]] = {
    400: ("bad_request", "Bad request"),
    401: ("unauthenticated", "Authentication required"),
    403: ("forbidden", "Forbidden"),
    404: ("not_found", "Not found"),
    405: ("method_not_allowed", "Method not allowed"),
    406: ("not_acceptable", "Not acceptable"),
    409: ("conflict", "Conflict"),
    412: ("precondition_failed", "Precondition failed"),
    413: ("payload_too_large", "Payload too large"),
    415: ("unsupported_media_type", "Unsupported media type"),
    422: ("validation_error", "Validation failed"),
    428: ("precondition_required", "Precondition required"),
    429: ("rate_limited", "Too many requests"),
    500: ("internal_error", "Internal server error"),
    503: ("service_unavailable", "Service unavailable"),
}

NOT_FOUND_DETAIL: Final = "The requested resource was not found."


def status_info(status: int) -> tuple[str, str]:
    if status in _STATUS_INFO:
        return _STATUS_INFO[status]
    return ("server_error", "Server error") if status >= 500 else ("client_error", "Client error")


class AppError(Exception):
    """Domain/application error mapped to a problem response."""

    def __init__(
        self,
        status: int,
        code: str,
        detail: str | None = None,
        *,
        title: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.title = title or status_info(status)[1]
        self.detail = detail
        self.headers = dict(headers or {})


def problem_body(
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    errors: Sequence[Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": f"urn:problem:{code}",
        "title": title,
        "status": status,
        "code": code,
        "detail": detail,
        "request_id": request_id_var.get(),
    }
    if errors is not None:
        body["errors"] = list(errors)
    return body


def problem_response(
    status: int,
    code: str | None = None,
    detail: str | None = None,
    *,
    title: str | None = None,
    errors: Sequence[Mapping[str, str]] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    default_code, default_title = status_info(status)
    return JSONResponse(
        problem_body(status, code or default_code, title or default_title, detail, errors),
        status_code=status,
        headers=dict(headers or {}),
        media_type=PROBLEM_CONTENT_TYPE,
    )


async def _http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover - registration guarantees
        raise TypeError(type(exc).__name__)
    status = exc.status_code
    if status == 404:
        detail: str | None = NOT_FOUND_DETAIL
    elif status < 500 and isinstance(exc.detail, str):
        detail = exc.detail
    else:
        detail = None
    return problem_response(status, detail=detail, headers=exc.headers)


def _field_path(location: Sequence[int | str]) -> str:
    return ".".join(str(part) for part in location)


async def _validation_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):  # pragma: no cover
        raise TypeError(type(exc).__name__)
    # Only location and message: pydantic's "input"/"ctx" may contain submitted secrets.
    errors = [
        {"field": _field_path(error.get("loc", ())), "message": str(error.get("msg", "invalid"))}
        for error in exc.errors()
    ]
    return problem_response(422, detail="The request is invalid.", errors=errors)


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AppError):  # pragma: no cover
        raise TypeError(type(exc).__name__)
    return problem_response(exc.status, exc.code, exc.detail, title=exc.title, headers=exc.headers)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(AppError, _app_error_handler)
