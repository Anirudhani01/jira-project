"""Pure-ASGI middleware: request context, error boundary, body limit, security headers.

Order (outermost first), established in ``app.main.create_app``:
RequestContext -> SecurityHeaders -> BodySizeLimit -> ErrorBoundary -> FastAPI routing.
"""

import logging
import re
import time
import uuid
from typing import Final

from fastapi import HTTPException
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import problem_response
from app.core.logging import request_id_var

logger = logging.getLogger("app.http")

REQUEST_ID_HEADER: Final = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,128}$")


def _incoming_request_id(scope: Scope) -> str | None:
    value = Headers(scope=scope).get(REQUEST_ID_HEADER)
    if value is not None and _VALID_REQUEST_ID.fullmatch(value):
        return value
    return None


class RequestContextMiddleware:
    """Assigns a request ID, echoes it in the response, and writes one access record.

    The access record contains the route *template* (never the raw path or query
    string), method, status and duration.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope) or uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            route = scope.get("route")
            logger.info(
                "request completed",
                extra={
                    "event": "http.request",
                    "method": scope["method"],
                    "route": getattr(route, "path", None) or "<unmatched>",
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            request_id_var.reset(token)


class ErrorBoundaryMiddleware:
    """Converts unhandled exceptions into a generic 500 problem response.

    The client never sees exception messages or stack traces; the server log gets
    the (redacted) traceback correlated by request ID.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            logger.exception(
                "unhandled error",
                extra={"event": "http.unhandled_error", "error_type": type(exc).__name__},
            )
            if response_started:
                raise
            await problem_response(500)(scope, receive, send)


class BodySizeLimitMiddleware:
    """Rejects request bodies larger than ``max_bytes`` with 413.

    Checks ``Content-Length`` up front and also counts streamed (chunked) bytes.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            if not declared.isdigit():
                await problem_response(400, detail="Invalid Content-Length.")(scope, receive, send)
                return
            if int(declared) > self.max_bytes:
                await problem_response(413)(scope, receive, send)
                return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # HTTPException passes through FastAPI's body parsing untouched.
                    raise HTTPException(status_code=413)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except HTTPException as exc:
            if exc.status_code != 413 or response_started:
                raise
            await problem_response(413)(scope, receive, send)


_API_SECURITY_HEADERS: Final = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}
_API_CSP: Final = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
_HSTS: Final = "max-age=63072000; includeSubDomains"


class SecurityHeadersMiddleware:
    """Adds baseline security headers to every response.

    The interactive API docs (dev only) load assets from a CDN, so the strict API CSP
    is skipped for the docs page itself.
    """

    def __init__(self, app: ASGIApp, *, hsts: bool, docs_path: str | None) -> None:
        self.app = app
        self.hsts = hsts
        self.docs_path = docs_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_docs = self.docs_path is not None and scope["path"] == self.docs_path

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _API_SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                if not is_docs:
                    headers.setdefault("Content-Security-Policy", _API_CSP)
                headers.setdefault("Cache-Control", "no-store")
                if self.hsts:
                    headers.setdefault("Strict-Transport-Security", _HSTS)
            await send(message)

        await self.app(scope, receive, send_with_headers)
