"""Data fetching, alignment, and validation helpers."""
from __future__ import annotations

import logging
from datetime import datetime
from functools import lru_cache
from typing import Iterable

import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

TRADING_DAYS = 252
MIN_COVERAGE = 0.80


@lru_cache(maxsize=32)
def _fetch_prices_cached(tickers: tuple[str, ...], start: str, end: str) -> pd.DataFrame:
    """Fetch adjusted close prices for tickers between start and end (cached)."""
    if not tickers:
        return pd.DataFrame()
    logger.info("yfinance download tickers=%s start=%s end=%s", tickers, start, end)
    data = yf.download(
        list(tickers),
        start=start,
        end=end,
        progress=False,
        auto_adjust=True,
        threads=True,
        group_by="column",
    )
    if data is None or data.empty:
        return pd.DataFrame()
    if isinstance(data.columns, pd.MultiIndex):
        if "Close" in data.columns.get_level_values(0):
            prices = data["Close"]
        elif "Adj Close" in data.columns.get_level_values(0):
            prices = data["Adj Close"]
        else:
            prices = data.iloc[:, : len(tickers)]
    else:
        prices = data[["Close"]] if "Close" in data.columns else data[["Adj Close"]]
        prices.columns = [tickers[0]]
    prices = prices.dropna(how="all")
    return prices


def fetch_prices(tickers: Iterable[str], start: str, end: str) -> pd.DataFrame:
    return _fetch_prices_cached(tuple(sorted(set(tickers))), start, end).copy()


def align_prices(prices: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Align prices via inner join, ffill 1-2 day gaps, drop low-coverage assets.

    Returns (clean_prices, dropped_tickers).
    """
    if prices.empty:
        return prices, []
    prices = prices.sort_index()
    prices = prices.ffill(limit=2)
    total_days = len(prices)
    if total_days == 0:
        return prices, []
    coverage = prices.notna().sum() / total_days
    keep = coverage[coverage >= MIN_COVERAGE].index.tolist()
    dropped = [c for c in prices.columns if c not in keep]
    if dropped:
        logger.info("dropping low-coverage tickers (<%d%%): %s", int(MIN_COVERAGE * 100), dropped)
    prices = prices[keep].dropna(how="any")
    return prices, dropped


def validate_inputs(payload: dict) -> dict:
    """Validate and normalize a request payload. Returns cleaned dict or raises ValueError."""
    tickers_raw = payload.get("tickers", [])
    if isinstance(tickers_raw, str):
        tickers_raw = [t.strip() for t in tickers_raw.split(",")]
    tickers = [t.strip().upper() for t in tickers_raw if t and t.strip()]
    if not tickers:
        raise ValueError("At least one ticker is required.")
    if len(tickers) > 10:
        raise ValueError("Maximum of 10 tickers allowed.")

    weights = payload.get("weights")
    if weights is None or len(weights) != len(tickers):
        weights = [1.0 / len(tickers)] * len(tickers)
    weights = np.array([float(w) for w in weights], dtype=float)
    if weights.sum() <= 0:
        raise ValueError("Weights must be positive and sum to a positive value.")
    weights = weights / weights.sum()

    start = payload.get("start_date") or payload.get("start")
    end = payload.get("end_date") or payload.get("end")
    if not start or not end:
        raise ValueError("start_date and end_date are required (YYYY-MM-DD).")
    try:
        s_dt = datetime.strptime(start, "%Y-%m-%d")
        e_dt = datetime.strptime(end, "%Y-%m-%d")
    except Exception as exc:
        raise ValueError(f"Invalid date format: {exc}") from exc
    if e_dt <= s_dt:
        raise ValueError("end_date must be after start_date.")
    span_days = (e_dt - s_dt).days
    if span_days < 365:
        raise ValueError("Date range must span at least 1 year.")
    if span_days > 365 * 10 + 5:
        raise ValueError("Date range cannot exceed 10 years.")

    risk_free = float(payload.get("risk_free_rate", 0.04))
    if not 0.0 <= risk_free <= 0.2:
        raise ValueError("risk_free_rate must be between 0.0 and 0.2.")

    return {
        "tickers": tickers,
        "weights": weights.tolist(),
        "start_date": start,
        "end_date": end,
        "risk_free_rate": risk_free,
    }


def load_portfolio(cleaned: dict) -> dict:
    """Fetch, align, and prepare price/return data. Returns dict with clean state."""
    tickers = cleaned["tickers"]
    weights = np.array(cleaned["weights"], dtype=float)
    prices = fetch_prices(tickers, cleaned["start_date"], cleaned["end_date"])
    if prices.empty:
        raise ValueError("No price data returned for the requested tickers and date range.")

    # Order columns to match input
    available = [t for t in tickers if t in prices.columns]
    missing = [t for t in tickers if t not in prices.columns]
    prices = prices[available]
    if missing:
        logger.info("skipped tickers (no data): %s", missing)
    prices, dropped = align_prices(prices)
    skipped = list(set(missing + dropped))

    # Re-normalize weights for kept tickers
    kept = list(prices.columns)
    if not kept:
        raise ValueError("All tickers were dropped after alignment. Try different tickers.")
    name_to_w = dict(zip(tickers, weights))
    new_weights = np.array([name_to_w.get(t, 0.0) for t in kept], dtype=float)
    if new_weights.sum() <= 0:
        new_weights = np.ones(len(kept))
    new_weights = new_weights / new_weights.sum()
    if skipped:
        logger.info("re-normalized weights after skipping %s -> %s", skipped, new_weights.tolist())

    returns = prices.pct_change().dropna()
    return {
        "tickers": kept,
        "weights": new_weights,
        "prices": prices,
        "returns": returns,
        "skipped": skipped,
        "risk_free_rate": cleaned["risk_free_rate"],
        "start_date": cleaned["start_date"],
        "end_date": cleaned["end_date"],
    }


def fetch_benchmark(start: str, end: str) -> pd.Series | None:
    """Fetch S&P 500 (^GSPC) benchmark series. Returns None if unavailable."""
    try:
        prices = _fetch_prices_cached(("^GSPC",), start, end)
        if prices.empty:
            return None
        s = prices.iloc[:, 0] if isinstance(prices, pd.DataFrame) else prices
        return s.dropna()
    except Exception as exc:
        logger.warning("benchmark unavailable: %s", exc)
        return None
