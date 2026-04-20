"""Portfolio analytics: returns, vol, Sharpe, Sortino, drawdown, correlation."""
from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def portfolio_daily_returns(returns: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    """Daily portfolio returns from asset returns and weights."""
    return returns.values @ weights


def annualized_return(daily_returns: np.ndarray) -> float:
    return float(np.mean(daily_returns) * TRADING_DAYS)


def annualized_volatility(daily_returns: np.ndarray) -> float:
    return float(np.std(daily_returns, ddof=1) * np.sqrt(TRADING_DAYS))


def sharpe_ratio(daily_returns: np.ndarray, risk_free: float) -> float:
    ann_ret = annualized_return(daily_returns)
    ann_vol = annualized_volatility(daily_returns)
    if ann_vol == 0:
        return 0.0
    return float((ann_ret - risk_free) / ann_vol)


def sortino_ratio(daily_returns: np.ndarray, risk_free: float) -> float:
    ann_ret = annualized_return(daily_returns)
    downside = daily_returns[daily_returns < 0]
    if len(downside) == 0:
        return 0.0
    downside_dev = float(np.std(downside, ddof=1) * np.sqrt(TRADING_DAYS))
    if downside_dev == 0:
        return 0.0
    return float((ann_ret - risk_free) / downside_dev)


def downside_deviation(daily_returns: np.ndarray) -> float:
    downside = daily_returns[daily_returns < 0]
    if len(downside) == 0:
        return 0.0
    return float(np.std(downside, ddof=1) * np.sqrt(TRADING_DAYS))


def max_drawdown(daily_returns: np.ndarray) -> float:
    """Returns max drawdown as a positive fraction (e.g. 0.25 = -25%)."""
    cum = np.cumprod(1.0 + daily_returns)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    return float(-dd.min()) if len(dd) else 0.0


def cumulative_returns(daily_returns: np.ndarray) -> np.ndarray:
    return np.cumprod(1.0 + daily_returns) - 1.0


def compute_metrics(daily_ret: np.ndarray, risk_free: float) -> dict:
    return {
        "annual_return": annualized_return(daily_ret),
        "annual_volatility": annualized_volatility(daily_ret),
        "sharpe_ratio": sharpe_ratio(daily_ret, risk_free),
        "sortino_ratio": sortino_ratio(daily_ret, risk_free),
        "max_drawdown": max_drawdown(daily_ret),
        "downside_deviation": downside_deviation(daily_ret),
    }


def correlation_matrix(returns: pd.DataFrame) -> pd.DataFrame:
    return returns.corr()
