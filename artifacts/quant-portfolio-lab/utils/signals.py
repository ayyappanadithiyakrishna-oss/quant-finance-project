"""Forward-looking trade signals: technical indicators, regime detection, forecasts.

Produces actionable BUY / HOLD / SELL verdicts per ticker with quant-derived
entry, stop-loss, and target price levels — the kind of analysis a quant
trader uses to decide whether to put on a trade.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ----- Technical indicators -----

def rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder's smoothing)."""
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50)


def zscore(prices: pd.Series, lookback: int = 20) -> pd.Series:
    """Z-score of price vs rolling mean — mean-reversion signal."""
    m = prices.rolling(lookback).mean()
    s = prices.rolling(lookback).std()
    return (prices - m) / s.replace(0, np.nan)


def bollinger_position(prices: pd.Series, lookback: int = 20, k: float = 2.0) -> pd.Series:
    """Where is price within the Bollinger band? -1 = lower, 0 = mid, +1 = upper."""
    m = prices.rolling(lookback).mean()
    s = prices.rolling(lookback).std()
    upper = m + k * s
    lower = m - k * s
    return ((prices - m) / (k * s.replace(0, np.nan))).clip(-1.5, 1.5)


def atr(prices: pd.Series, period: int = 14) -> pd.Series:
    """Approximate ATR using close-only data (no high/low available)."""
    tr = prices.diff().abs()
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def ma_cross_signal(prices: pd.Series, fast: int = 50, slow: int = 200) -> dict:
    """Detect golden cross (fast > slow) or death cross with current state."""
    if len(prices) < slow + 5:
        return {"state": "n/a", "fast": None, "slow": None, "spread_pct": None, "days_since_cross": None}
    ma_f = prices.rolling(fast).mean()
    ma_s = prices.rolling(slow).mean()
    last_f = float(ma_f.iloc[-1])
    last_s = float(ma_s.iloc[-1])
    spread = (last_f - last_s) / last_s * 100
    state = "golden" if last_f > last_s else "death"
    # find most recent cross
    diff = (ma_f - ma_s).dropna()
    sign = np.sign(diff)
    flips = (sign != sign.shift(1)).cumsum()
    last_flip_idx = sign.groupby(flips).cumcount().iloc[-1]
    return {
        "state": state,
        "fast": last_f,
        "slow": last_s,
        "spread_pct": float(spread),
        "days_since_cross": int(last_flip_idx),
    }


def momentum(prices: pd.Series, lookback: int) -> float:
    """Total % return over lookback days."""
    if len(prices) <= lookback:
        return 0.0
    return float(prices.iloc[-1] / prices.iloc[-lookback - 1] - 1) * 100


def vol_regime(returns: pd.Series, short: int = 20, long: int = 252) -> dict:
    """Current short-term vol vs longer-term vol — risk regime."""
    if len(returns) < long:
        long = max(60, len(returns) - 1)
    short_v = float(returns.tail(short).std() * np.sqrt(252) * 100)
    long_v = float(returns.tail(long).std() * np.sqrt(252) * 100)
    ratio = short_v / long_v if long_v > 0 else 1.0
    if ratio > 1.4:
        regime = "elevated"
    elif ratio < 0.7:
        regime = "compressed"
    else:
        regime = "normal"
    return {"short_vol": short_v, "long_vol": long_v, "ratio": float(ratio), "regime": regime}


# ----- Composite verdict -----

def _score_signal(rsi_v: float, z_v: float, mom_20: float, mom_60: float,
                  ma_state: str, ma_spread: float, boll_pos: float) -> tuple[float, str, list[str]]:
    """Combine signals into a -100..+100 score and a BUY/HOLD/SELL verdict."""
    score = 0.0
    rationale: list[str] = []

    # Mean reversion (oversold = bullish, overbought = bearish)
    if rsi_v < 30:
        score += 25
        rationale.append(f"RSI {rsi_v:.0f} → oversold (mean-reversion long)")
    elif rsi_v > 70:
        score -= 25
        rationale.append(f"RSI {rsi_v:.0f} → overbought (mean-reversion short)")
    elif rsi_v < 40:
        score += 8
    elif rsi_v > 60:
        score -= 8

    # Z-score (price vs 20d mean)
    if z_v < -1.5:
        score += 15
        rationale.append(f"Z-score {z_v:+.2f}σ below 20d mean → stretched downside")
    elif z_v > 1.5:
        score -= 15
        rationale.append(f"Z-score {z_v:+.2f}σ above 20d mean → stretched upside")

    # Momentum (positive momentum is bullish trend-following)
    if mom_20 > 5 and mom_60 > 10:
        score += 20
        rationale.append(f"Strong momentum: +{mom_20:.1f}% (1M), +{mom_60:.1f}% (3M)")
    elif mom_20 < -5 and mom_60 < -10:
        score -= 20
        rationale.append(f"Negative momentum: {mom_20:.1f}% (1M), {mom_60:.1f}% (3M)")
    elif mom_20 > 3:
        score += 8
    elif mom_20 < -3:
        score -= 8

    # MA crossover trend filter
    if ma_state == "golden" and ma_spread > 2:
        score += 15
        rationale.append(f"Golden cross active (50d {ma_spread:+.1f}% above 200d) — bullish trend")
    elif ma_state == "death" and ma_spread < -2:
        score -= 15
        rationale.append(f"Death cross active (50d {ma_spread:+.1f}% vs 200d) — bearish trend")

    # Bollinger position
    if boll_pos < -0.9:
        score += 10
    elif boll_pos > 0.9:
        score -= 10

    score = max(-100, min(100, score))
    if score >= 35:
        verdict = "BUY"
    elif score <= -35:
        verdict = "SELL"
    else:
        verdict = "HOLD"
    return score, verdict, rationale


def forecast_distribution(returns: pd.Series, horizon_days: int = 21, current_price: float = 1.0) -> dict:
    """Project a price distribution over the horizon using historical drift+vol.

    Uses the lognormal / GBM approximation:
      log(P_T / P_0) ~ N((mu - 0.5*sigma^2) * T, sigma^2 * T)
    """
    daily_mu = float(returns.mean())
    daily_sigma = float(returns.std())
    T = horizon_days
    drift = (daily_mu - 0.5 * daily_sigma ** 2) * T
    diffusion = daily_sigma * np.sqrt(T)

    def p(z):
        return float(current_price * np.exp(drift + diffusion * z))

    median = p(0)
    p5 = p(-1.645)
    p95 = p(1.645)
    p25 = p(-0.674)
    p75 = p(0.674)
    expected_return = (median / current_price - 1) * 100
    return {
        "horizon_days": horizon_days,
        "median": median,
        "p5": p5, "p25": p25, "p75": p75, "p95": p95,
        "expected_return_pct": expected_return,
        "annualized_vol_pct": daily_sigma * np.sqrt(252) * 100,
    }


def trade_levels(price: float, atr_v: float, verdict: str) -> dict:
    """Suggest entry, stop-loss, and target based on ATR — standard quant risk sizing."""
    if verdict == "BUY":
        entry_lo = price - 0.5 * atr_v
        entry_hi = price + 0.25 * atr_v
        stop = price - 2.0 * atr_v
        target = price + 3.0 * atr_v
    elif verdict == "SELL":
        entry_lo = price - 0.25 * atr_v
        entry_hi = price + 0.5 * atr_v
        stop = price + 2.0 * atr_v
        target = price - 3.0 * atr_v
    else:
        entry_lo = price - 0.5 * atr_v
        entry_hi = price + 0.5 * atr_v
        stop = price - 1.5 * atr_v
        target = price + 1.5 * atr_v

    risk = abs(price - stop)
    reward = abs(target - price)
    rr = reward / risk if risk > 0 else 0
    return {
        "entry_lo": float(entry_lo),
        "entry_hi": float(entry_hi),
        "stop_loss": float(stop),
        "target": float(target),
        "risk_reward": float(rr),
    }


# ----- Per-ticker analysis -----

def analyze_ticker(prices: pd.Series, returns: pd.Series) -> dict:
    """Run the full signal stack for one ticker."""
    last_price = float(prices.iloc[-1])
    rsi_v = float(rsi(prices).iloc[-1])
    z_v = float(zscore(prices).iloc[-1]) if len(prices) >= 20 else 0.0
    boll = float(bollinger_position(prices).iloc[-1]) if len(prices) >= 20 else 0.0
    mom_20 = momentum(prices, 20)
    mom_60 = momentum(prices, 60)
    mom_120 = momentum(prices, 120)
    ma = ma_cross_signal(prices)
    vol = vol_regime(returns)
    atr_v = float(atr(prices).iloc[-1])

    score, verdict, rationale = _score_signal(
        rsi_v, z_v, mom_20, mom_60, ma["state"], ma["spread_pct"] or 0, boll
    )
    forecast = forecast_distribution(returns, horizon_days=21, current_price=last_price)
    levels = trade_levels(last_price, atr_v, verdict)

    return {
        "price": last_price,
        "rsi": rsi_v,
        "zscore": z_v,
        "bollinger_pos": boll,
        "momentum_1m": mom_20,
        "momentum_3m": mom_60,
        "momentum_6m": mom_120,
        "ma_cross": ma,
        "vol_regime": vol,
        "atr": atr_v,
        "atr_pct": atr_v / last_price * 100,
        "score": score,
        "verdict": verdict,
        "rationale": rationale,
        "forecast": forecast,
        "levels": levels,
    }


# ----- Pairs trading -----

def find_best_pair(returns: pd.DataFrame, prices: pd.DataFrame) -> dict | None:
    """Find the most correlated pair and compute spread z-score signal."""
    if returns.shape[1] < 2:
        return None
    corr = returns.corr()
    np.fill_diagonal(corr.values, np.nan)
    flat = corr.unstack().dropna()
    if flat.empty:
        return None
    a, b = flat.idxmax()
    rho = float(flat.max())
    if rho < 0.5:
        return None  # not worth pairing

    # Build a normalized log-price spread
    pa = np.log(prices[a])
    pb = np.log(prices[b])
    # Hedge ratio via simple OLS slope
    cov = np.cov(pa, pb)[0, 1]
    var_b = np.var(pb)
    beta = cov / var_b if var_b > 0 else 1.0
    spread = pa - beta * pb
    s_mean = float(spread.tail(60).mean())
    s_std = float(spread.tail(60).std())
    z = float((spread.iloc[-1] - s_mean) / s_std) if s_std > 0 else 0.0

    if z > 1.5:
        signal = f"SHORT {a} / LONG {b}"
        action = "short_long"
    elif z < -1.5:
        signal = f"LONG {a} / SHORT {b}"
        action = "long_short"
    else:
        signal = f"WAIT — spread within ±1.5σ"
        action = "wait"

    return {
        "ticker_a": a,
        "ticker_b": b,
        "correlation": rho,
        "hedge_ratio": float(beta),
        "spread_z": z,
        "signal": signal,
        "action": action,
        "spread_series": spread.tail(180).tolist(),
        "spread_dates": [d.strftime("%Y-%m-%d") for d in spread.tail(180).index],
        "z_upper": s_mean + 1.5 * s_std,
        "z_lower": s_mean - 1.5 * s_std,
        "spread_mean": s_mean,
    }


# ----- Top-level orchestrator -----

def trade_signals(state: dict) -> dict:
    """Run signal analysis on every ticker in the portfolio + a pairs scan."""
    prices: pd.DataFrame = state["prices"]
    returns: pd.DataFrame = state["returns"]
    tickers = list(prices.columns)

    per_ticker: dict[str, dict] = {}
    for t in tickers:
        per_ticker[t] = analyze_ticker(prices[t], returns[t])

    # Rank by absolute score → top opportunities
    ranked = sorted(
        per_ticker.items(),
        key=lambda kv: abs(kv[1]["score"]),
        reverse=True,
    )
    top = [{"ticker": t, **v} for t, v in ranked]

    pair = find_best_pair(returns, prices)

    # Counts for summary
    buys = sum(1 for v in per_ticker.values() if v["verdict"] == "BUY")
    sells = sum(1 for v in per_ticker.values() if v["verdict"] == "SELL")
    holds = sum(1 for v in per_ticker.values() if v["verdict"] == "HOLD")

    return {
        "tickers": tickers,
        "as_of": prices.index[-1].strftime("%Y-%m-%d"),
        "signals": per_ticker,
        "ranked": top,
        "summary": {"buy": buys, "sell": sells, "hold": holds},
        "pair": pair,
    }
