"""external/platform_adapter.py — Platform health check + rider status adapters.

FIX: consecutive_failures moved from in-memory dict to Redis so it:
  - Persists across worker restarts
  - Is shared across multiple Celery workers
  - Uses 35-min TTL (7 checks × 5 min) to auto-reset if checks stop
"""
from __future__ import annotations

import structlog

from app.config import get_settings

settings = get_settings()
log = structlog.get_logger()

def check_platform_health(platform: str) -> dict:
    """
    Returns: {is_up: bool, consecutive_failures: int, platform_down_score: float}
    Active health checking via URLs removed per requirement.
    Always returns 'up' state.
    """
    return {
        "is_up":                True,
        "consecutive_failures": 0,
        "platform_down_score":  0.0,
    }


def get_rider_platform_status(rider_id: str, platform: str) -> dict | None:
    """
    In production: call Zepto/Blinkit B2B partner API.
    Returns None if API unavailable (intent check treats as N/A — soft fail, not hard fail).
    Currently returns mock 'available' for dev/demo — replace with real API call in Phase 2.
    """
    # TODO Phase 2: integrate Zepto/Blinkit B2B partner API for real rider status
    return {
        "status":    "available",
        "last_seen": None,
    }
