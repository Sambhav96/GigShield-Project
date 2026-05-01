"""external/razorpay_client.py — Razorpay payout and mandate operations."""
from __future__ import annotations

import razorpay
import structlog

from app.config import get_settings
from app.external.circuit_breaker import get_circuit_breaker

settings = get_settings()
log = structlog.get_logger()

_cb = get_circuit_breaker("razorpay")

_client: razorpay.Client | None = None


def get_razorpay_client() -> razorpay.Client:
    global _client
    if _client is None:
        _client = razorpay.Client(
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret)
        )
    return _client


def create_payout(
    fund_account_id: str,
    amount_inr: float,
    idempotency_key: str,
    narration: str = "GigShield Income Protection",
) -> dict:
    """
    Create a UPI payout via Razorpay.
    amount_inr is converted to paise (×100).
    Returns Razorpay payout response dict.
    ALWAYS pass idempotency_key — checked BEFORE calling this.
    """
    log.info("create_payout_mock", fund_account_id=fund_account_id, amount_inr=amount_inr, idempotency_key=idempotency_key)
    return {
        "id": f"pout_mock_{idempotency_key[:16]}",
        "entity": "payout",
        "fund_account_id": fund_account_id,
        "amount": int(amount_inr * 100),
        "currency": "INR",
        "status": "success",
        "mode": "UPI",
        "reference_id": idempotency_key[:40]
    }


def charge_mandate(mandate_id: str, amount_inr: float, idempotency_key: str) -> dict:
    """DEMO MODE: Returns simulated success. Real debit requires Razorpay e-Mandate Subscription flow."""
    log.info(
        "charge_mandate_mock",
        mandate_id=mandate_id,
        amount_inr=amount_inr,
        idempotency_key=idempotency_key,
        note="DEMO: mock debit — real e-mandate needs Razorpay Subscription API",
    )
    return {
        "id": f"mock_debit_{idempotency_key[:16]}",
        "status": "captured",
        "amount": int(amount_inr * 100),
        "currency": "INR",
        "method": "emandate",
        "description": "GigShield Weekly Premium (DEMO MOCK)",
    }


def get_balance() -> float:
    """Fetch current Razorpay X account balance in INR."""
    return 500000.0 # Mock balance


def create_fund_account(rider_id: str, upi_vpa: str) -> dict:
    """Register a rider's UPI VPA as a fund account."""
    log.info("create_fund_account_mock", rider_id=rider_id, upi_vpa=upi_vpa)
    return {
        "id": f"fa_mock_{rider_id[:8]}",
        "entity": "fund_account",
        "contact_id": f"cont_mock_{rider_id[:8]}",
        "account_type": "vpa",
        "vpa": {"address": upi_vpa},
        "active": True
    }
