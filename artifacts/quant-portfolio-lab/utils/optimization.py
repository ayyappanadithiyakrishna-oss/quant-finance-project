"""Vectorized random-portfolio efficient frontier."""
from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252
MAX_PORTFOLIOS = 5000


def random_portfolios(returns: pd.DataFrame, risk_free: float, n: int = MAX_PORTFOLIOS, seed: int = 42) -> dict:
    """Generate n random portfolios with vectorized NumPy. Returns dict of arrays."""
    rng = np.random.default_rng(seed)
    n_assets = returns.shape[1]
    weights = rng.random((n, n_assets))
    weights /= weights.sum(axis=1, keepdims=True)

    mean_daily = returns.mean().values  # shape (n_assets,)
    cov_daily = returns.cov().values  # shape (n_assets, n_assets)

    ann_returns = (weights @ mean_daily) * TRADING_DAYS  # shape (n,)
    # vectorized vol: w^T C w for each row
    port_var = np.einsum("ij,jk,ik->i", weights, cov_daily, weights) * TRADING_DAYS
    ann_vol = np.sqrt(np.clip(port_var, 0, None))
    sharpe = np.where(ann_vol > 0, (ann_returns - risk_free) / ann_vol, 0.0)

    max_sharpe_idx = int(np.argmax(sharpe))
    min_vol_idx = int(np.argmin(ann_vol))
    return {
        "weights": weights,
        "returns": ann_returns,
        "vols": ann_vol,
        "sharpe": sharpe,
        "max_sharpe_idx": max_sharpe_idx,
        "min_vol_idx": min_vol_idx,
        "tickers": list(returns.columns),
    }
