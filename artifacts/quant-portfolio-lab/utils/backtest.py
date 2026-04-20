"""Backtest portfolio vs S&P 500 benchmark."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .analytics import compute_metrics, cumulative_returns, portfolio_daily_returns
from .data import fetch_benchmark


def backtest(state: dict) -> dict:
    returns = state["returns"]
    weights = state["weights"]
    rf = state["risk_free_rate"]
    port_daily = portfolio_daily_returns(returns, weights)
    port_cum = cumulative_returns(port_daily)
    port_metrics = compute_metrics(port_daily, rf)

    out = {
        "dates": [d.strftime("%Y-%m-%d") for d in returns.index],
        "portfolio_cumulative": port_cum.tolist(),
        "portfolio_metrics": port_metrics,
        "benchmark_available": False,
    }

    bench = fetch_benchmark(state["start_date"], state["end_date"])
    if bench is not None and len(bench) > 1:
        bench_aligned = bench.reindex(returns.index).ffill().bfill()
        bench_returns = bench_aligned.pct_change().fillna(0).values
        bench_cum = cumulative_returns(bench_returns)
        out["benchmark_available"] = True
        out["benchmark_cumulative"] = bench_cum.tolist()
        out["benchmark_metrics"] = compute_metrics(bench_returns, rf)
    return out
