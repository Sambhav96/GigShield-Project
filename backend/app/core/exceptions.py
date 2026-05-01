"""core/exceptions.py — All custom exceptions and FastAPI exception handlers."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import structlog

log = structlog.get_logger()


class GigShieldError(Exception):
    """Base exception."""
    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, detail: dict | None = None):
        self.message = message
        self.detail = detail or {}
        super().__init__(message)


class NotFoundError(GigShieldError):
    status_code = 404
    error_code = "NOT_FOUND"


class ValidationError(GigShieldError):
    status_code = 400
    error_code = "VALIDATION_ERROR"


class FraudBlockError(GigShieldError):
    """Hard-flag: fraud detected, payout blocked."""
    status_code = 403
    error_code = "FRAUD_BLOCK"


class CapExhaustedError(GigShieldError):
    status_code = 422
    error_code = "CAP_EXHAUSTED"


class PolicyPausedError(GigShieldError):
    status_code = 422
    error_code = "POLICY_PAUSED"


class ActiveTriggerError(GigShieldError):
    """Cannot pause policy during active trigger."""
    status_code = 400
    error_code = "ACTIVE_TRIGGER_IN_ZONE"


class IdempotencyConflict(GigShieldError):
    status_code = 409
    error_code = "IDEMPOTENCY_CONFLICT"


class CircuitOpenError(GigShieldError):
    status_code = 503
    error_code = "CIRCUIT_BREAKER_OPEN"


class KillSwitchError(GigShieldError):
    status_code = 503
    error_code = "KILL_SWITCH_ACTIVE"


def register_exception_handlers(app: FastAPI) -> None:
    CORS_HEADERS = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
    }

    @app.exception_handler(GigShieldError)
    async def gigshield_error_handler(request: Request, exc: GigShieldError):
        origin = request.headers.get("origin", "")
        log.error(
            "api_error",
            error_code=exc.error_code,
            message=exc.message,
            path=request.url.path,
        )
        headers = {**CORS_HEADERS}
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.error_code,
                "message": exc.message,
                "detail": exc.detail,
            },
            headers=headers,
        )

    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception):
        origin = request.headers.get("origin", "")
        log.exception("unhandled_error", path=request.url.path, error=str(exc))
        headers = {**CORS_HEADERS}
        if origin:
            headers["Access-Control-Allow-Origin"] = origin
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL_ERROR", "message": str(exc)},
            headers=headers,
        )
