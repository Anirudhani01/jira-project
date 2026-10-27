"""Error format, middleware ordering, request IDs, security headers, body limits."""

import json
import logging
from collections.abc import AsyncIterator, Callable

import httpx
import pytest
from fastapi import FastAPI
from pydantic import BaseModel, Field, SecretStr

from app.core.errors import NOT_FOUND_DETAIL, PROBLEM_CONTENT_TYPE, AppError


class Payload(BaseModel):
    name: str = Field(min_length=1, max_length=5)
    password: str


@pytest.fixture
def app(app_factory: Callable[..., FastAPI]) -> FastAPI:
    application = app_factory(max_request_body_bytes=2048)

    @application.post("/_test/echo")
    async def echo(payload: Payload) -> dict[str, str]:
        return {"name": payload.name}

    @application.get("/_test/boom")
    async def boom() -> None:
        raise RuntimeError("secret internals: password=hunter2")

    @application.get("/_test/app-error")
    async def app_error() -> None:
        raise AppError(409, "sprint_already_active", "A sprint is already active.")

    @application.get("/_test/items/{item_id}")
    async def item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    return application


def assert_problem(response: httpx.Response, status: int, code: str) -> dict[str, object]:
    assert response.status_code == status
    assert response.headers["content-type"].startswith(PROBLEM_CONTENT_TYPE)
    body: dict[str, object] = response.json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["type"] == f"urn:problem:{code}"
    assert body["request_id"] == response.headers["x-request-id"]
    return body


async def test_unknown_route_returns_uniform_404(client: httpx.AsyncClient) -> None:
    first = assert_problem(await client.get("/nope"), 404, "not_found")
    second = assert_problem(await client.get("/also/nope?x=1"), 404, "not_found")
    assert first["detail"] == second["detail"] == NOT_FOUND_DETAIL
    assert {k: v for k, v in first.items() if k != "request_id"} == {
        k: v for k, v in second.items() if k != "request_id"
    }


async def test_method_not_allowed(client: httpx.AsyncClient) -> None:
    response = await client.delete("/healthz")
    assert_problem(response, 405, "method_not_allowed")
    assert "GET" in response.headers["allow"]


async def test_validation_error_lists_fields_without_echoing_input(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/_test/echo", json={"name": "far-too-long", "password": 12345678987654321}
    )
    body = assert_problem(response, 422, "validation_error")
    fields = {error["field"] for error in body["errors"]}  # type: ignore[attr-defined]
    assert fields == {"body.name", "body.password"}
    assert "far-too-long" not in response.text
    assert "12345678987654321" not in response.text


async def test_malformed_json_is_a_validation_problem(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/_test/echo", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert_problem(response, 422, "validation_error")


async def test_unhandled_exception_returns_generic_500(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="app.http"):
        response = await client.get("/_test/boom")
    body = assert_problem(response, 500, "internal_error")
    assert body["detail"] is None
    assert "hunter2" not in response.text
    assert "Traceback" not in response.text
    assert "RuntimeError" not in response.text
    errors = [r for r in caplog.records if getattr(r, "event", None) == "http.unhandled_error"]
    assert errors
    assert errors[0].error_type == "RuntimeError"  # type: ignore[attr-defined]


async def test_app_error_maps_to_problem(client: httpx.AsyncClient) -> None:
    body = assert_problem(await client.get("/_test/app-error"), 409, "sprint_already_active")
    assert body["detail"] == "A sprint is already active."


async def test_request_id_is_generated_and_returned(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz")
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 32


async def test_valid_inbound_request_id_is_propagated(client: httpx.AsyncClient) -> None:
    response = await client.get("/nope", headers={"X-Request-ID": "trace-abc-12345"})
    assert response.headers["x-request-id"] == "trace-abc-12345"
    assert response.json()["request_id"] == "trace-abc-12345"


@pytest.mark.parametrize("bad", ["short", "has spaces in it", "x" * 200, 'inject"quote'])
async def test_invalid_inbound_request_id_is_replaced(client: httpx.AsyncClient, bad: str) -> None:
    response = await client.get("/healthz", headers={"X-Request-ID": bad})
    assert response.headers["x-request-id"] != bad


async def test_security_headers_present(client: httpx.AsyncClient) -> None:
    for path in ("/healthz", "/nope"):
        headers = (await client.get(path)).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert "default-src 'none'" in headers["content-security-policy"]
        assert headers["cache-control"] == "no-store"
        assert "strict-transport-security" not in headers  # test env is not production-like


async def test_hsts_enabled_in_production_like_environments(
    app_factory: Callable[..., FastAPI],
) -> None:
    application = app_factory(
        environment="staging",
        app_base_url="https://staging.example.com",
        database_url=SecretStr("postgresql+asyncpg://app_rw:s3cret@db/jira"),
        redis_url=SecretStr("redis://cache:6379/0"),
    )
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
        response = await http.get("/healthz")
    assert response.headers["strict-transport-security"].startswith("max-age=")


async def test_docs_disabled_outside_dev(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/docs")).status_code == 404
    assert (await client.get("/api/openapi.json")).status_code == 404


async def test_oversized_body_rejected_by_content_length(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/_test/echo", content=b"x" * 4096, headers={"content-type": "application/json"}
    )
    assert_problem(response, 413, "payload_too_large")


async def test_oversized_streamed_body_rejected(client: httpx.AsyncClient) -> None:
    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(8):
            yield b"x" * 512

    response = await client.post(
        "/_test/echo", content=chunks(), headers={"content-type": "application/json"}
    )
    assert_problem(response, 413, "payload_too_large")


async def test_invalid_content_length_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post("/_test/echo", content=b"{}", headers={"content-length": "abc"})
    assert_problem(response, 400, "bad_request")


async def test_access_log_uses_route_template_without_query_string(
    client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.http"):
        await client.get("/_test/items/42?token=supersecret")
    records = [r for r in caplog.records if getattr(r, "event", None) == "http.request"]
    assert len(records) == 1
    record = records[0]
    assert record.route == "/_test/items/{item_id}"  # type: ignore[attr-defined]
    assert record.status == 200  # type: ignore[attr-defined]
    assert "supersecret" not in json.dumps(record.__dict__, default=str)
