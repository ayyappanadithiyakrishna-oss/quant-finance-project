"""Sector exposure analyzer with cached yfinance lookups."""
from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np
import yfinance as yf

logger = logging.getLogger(__name__)


@lru_cache(maxsize=128)
def get_sector(ticker: str) -> str:
    try:
        info = yf.Ticker(ticker).info
        sector = info.get("sector") if info else None
        return sector or "Unknown"
    except Exception as exc:
        logger.warning("sector lookup failed for %s: %s", ticker, exc)
        return "Unknown"


def sector_breakdown(tickers: list[str], weights) -> dict:
    weights = np.array(weights, dtype=float)
    sectors = [get_sector(t) for t in tickers]
    sector_totals: dict[str, float] = {}
    rows = []
    for t, w, s in zip(tickers, weights, sectors):
        sector_totals[s] = sector_totals.get(s, 0.0) + float(w)
        rows.append({"ticker": t, "weight": float(w), "sector": s})
    over_concentration = {s: w for s, w in sector_totals.items() if w > 0.4}
    return {
        "sectors": sector_totals,
        "rows": rows,
        "over_concentration": over_concentration,
    }
