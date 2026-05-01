"""
external/earth_engine_client.py — Google Earth Engine NDWI for flood detection.
Primary signal for flood trigger (spec §3.2).
Requires GEE service account JSON configured in settings.
"""
from __future__ import annotations
import structlog
from app.config import get_settings
from app.external.circuit_breaker import get_circuit_breaker

settings = get_settings()
_cb      = get_circuit_breaker("earth_engine")
log      = structlog.get_logger()


def _score_flood_ndwi(satellite_ndwi: float, ndma_active: int) -> float:
    """
    Spec §3.2 flood score:
    score = (0.60 × CLAMP((ndwi − 0.3) / 0.5, 0, 1)) + (0.40 × ndma_active)
    """
    sat_component  = 0.60 * max(0.0, min(1.0, (satellite_ndwi - 0.3) / 0.5))
    ndma_component = 0.40 * ndma_active
    return round(sat_component + ndma_component, 4)


def fetch_ndwi_signal(lat: float, lng: float, ndma_active: int = 0) -> dict:
    """
    Mock fetch NDWI from Google Earth Engine for flood detection demo.
    """
    return {
        "satellite_score": 0.0,
        "ndwi_value":      0.0,
        "flood_score":     _score_flood_ndwi(0.0, ndma_active),
        "source":          "mock_demo",
        "raw_data":        {},
    }
