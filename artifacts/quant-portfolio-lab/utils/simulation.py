"""Monte Carlo simulation of portfolio paths."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .analytics import portfolio_daily_returns

TRADING_DAYS = 252
MAX_PATHS = 1000


def monte_carlo(state: dict, horizon_years: float = 1.0, n_paths: int = MAX_PATHS, seed: int = 42) -> dict:
    horizon_years = float(np.clip(horizon_years, 0.1, 10.0))
    n_paths = int(min(n_paths, MAX_PATHS))
    n_days = int(round(TRADING_DAYS * horizon_years))

    returns = state["returns"]
    weights = state["weights"]
    mean_daily = float(np.mean(portfolio_daily_returns(returns, weights)))
    cov = returns.cov().values

    # Simulate underlying asset returns then aggregate to portfolio - vectorized
    rng = np.random.default_rng(seed)
    L = np.linalg.cholesky(cov + 1e-12 * np.eye(cov.shape[0]))
    asset_means = returns.mean().values
    # shocks: (n_days, n_paths, n_assets)
    eps = rng.standard_normal((n_days, n_paths, cov.shape[0]))
    correlated = eps @ L.T + asset_means
    port_daily = correlated @ weights  # (n_days, n_paths)
    paths = np.cumprod(1.0 + port_daily, axis=0)
    initial = 10000.0
    paths = paths * initial

    p5 = np.percentile(paths, 5, axis=1)
    p50 = np.percentile(paths, 50, axis=1)
    p95 = np.percentile(paths, 95, axis=1)
    final = paths[-1, :]

    return {
        "horizon_years": horizon_years,
        "n_paths": n_paths,
        "n_days": n_days,
        "initial_value": initial,
        "p5": p5.tolist(),
        "p50": p50.tolist(),
        "p95": p95.tolist(),
        "sample_paths": paths[:, : min(100, n_paths)].T.tolist(),
        "final_distribution": final.tolist(),
        "mean_final": float(np.mean(final)),
        "median_final": float(np.median(final)),
        "prob_loss": float(np.mean(final < initial)),
        "prob_double": float(np.mean(final >= 2 * initial)),
        "expected_daily_return": mean_daily,
    }
