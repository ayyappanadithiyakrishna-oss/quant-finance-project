"""Dynamic rebalancing simulator: drift vs periodic rebalancing."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .analytics import compute_metrics


FREQ_MAP = {"monthly": "M", "quarterly": "Q", "yearly": "A"}


def simulate(state: dict, frequency: str = "quarterly") -> dict:
    freq = FREQ_MAP.get(frequency.lower())
    if freq is None:
        raise ValueError("frequency must be one of monthly, quarterly, yearly")

    returns = state["returns"]
    weights = np.array(state["weights"], dtype=float)
    rf = state["risk_free_rate"]
    tickers = state["tickers"]

    # ---- Drift simulation ----
    n_days, n_assets = returns.shape
    asset_growth = (1.0 + returns.values).cumprod(axis=0)  # (n_days, n_assets)
    holdings_value = weights * asset_growth  # value of each asset relative to $1 starting
    drift_total = holdings_value.sum(axis=1)
    drift_returns = np.concatenate([[drift_total[0] - 1.0], drift_total[1:] / drift_total[:-1] - 1.0])
    drift_weights_over_time = holdings_value / drift_total[:, None]

    # ---- Rebalanced simulation ----
    rebal_dates = returns.index.to_series().resample(freq).last().dropna()
    rebal_set = set(rebal_dates.values)

    current_weights = weights.copy()
    portfolio_value = 1.0
    rebal_values = np.empty(n_days)
    rebal_weights_over_time = np.empty((n_days, n_assets))
    daily_rets = returns.values

    for i, date in enumerate(returns.index):
        # Apply today's returns to weights (multiplicative growth)
        growth_factors = 1.0 + daily_rets[i]
        port_growth = float(current_weights @ growth_factors)
        portfolio_value *= port_growth
        current_weights = (current_weights * growth_factors) / port_growth
        rebal_values[i] = portfolio_value
        rebal_weights_over_time[i] = current_weights
        # Rebalance at period-end dates
        if date.to_datetime64() in rebal_set:
            current_weights = weights.copy()

    rebal_returns = np.concatenate([[rebal_values[0] - 1.0], rebal_values[1:] / rebal_values[:-1] - 1.0])

    drift_metrics = compute_metrics(drift_returns, rf)
    rebal_metrics = compute_metrics(rebal_returns, rf)

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in returns.index],
        "tickers": tickers,
        "frequency": frequency,
        "drift_cumulative": (drift_total - 1.0).tolist(),
        "rebal_cumulative": (rebal_values - 1.0).tolist(),
        "drift_weights": drift_weights_over_time.tolist(),
        "rebal_weights": rebal_weights_over_time.tolist(),
        "drift_metrics": drift_metrics,
        "rebal_metrics": rebal_metrics,
        "sharpe_improvement": rebal_metrics["sharpe_ratio"] - drift_metrics["sharpe_ratio"],
    }
