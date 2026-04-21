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


def trade_levels(
    prices: pd.Series,
    atr_v: float,
    verdict: str,
    score: float,
    vol_regime_state: str,
    account_size: float = 100_000.0,
    risk_per_trade_pct: float = 1.0,
) -> dict:
    """
    Realistic swing-trade levels grounded in price structure, not just ATR multiples.

    Methodology (matches how systematic and discretionary equity desks size trades):
    - Stop loss is anchored to the recent 20-day swing high/low with an ATR buffer to
      avoid noise stops, capped so the per-share risk does not exceed 2.5 ATR.
    - Target 1 (T1) is the nearest meaningful structural level — the prior 20-day
      extreme in the trade direction — or a 2.5x ATR projection, whichever offers
      better risk/reward.
    - Target 2 (T2) is the 60-day extreme, providing a runner extension for trend trades.
    - Position size is calculated from a fixed-risk model: shares = (account * risk_pct)
      / per-share dollar risk. This is the standard Van Tharp / CMT approach.
    - Time horizon scales with signal conviction and volatility regime.
    """
    price = float(prices.iloc[-1])
    swing_high_20 = float(prices.tail(20).max())
    swing_low_20 = float(prices.tail(20).min())
    swing_high_60 = float(prices.tail(60).max()) if len(prices) >= 60 else swing_high_20
    swing_low_60 = float(prices.tail(60).min()) if len(prices) >= 60 else swing_low_20

    if verdict == "BUY":
        # Entry: between the 20-day SMA pullback and current price (buy on dips into the band)
        sma20 = float(prices.tail(20).mean())
        entry_lo = max(sma20, price - 0.75 * atr_v)
        entry_hi = price + 0.10 * atr_v
        # Stop: below 20-day swing low minus 0.5 ATR buffer, but no wider than 2.5 ATR
        structural_stop = swing_low_20 - 0.5 * atr_v
        max_risk = price - 2.5 * atr_v
        stop = max(structural_stop, max_risk)
        # Target 1: nearest resistance (20d high), pushed out to at least 2x risk
        risk_per_share = price - stop
        min_t1 = price + 2.0 * risk_per_share
        t1 = max(swing_high_20, min_t1)
        # Target 2: 60d high or +1 ATR extension above T1
        t2 = max(swing_high_60, t1 + atr_v)
        direction = "long"
    elif verdict == "SELL":
        sma20 = float(prices.tail(20).mean())
        entry_lo = price - 0.10 * atr_v
        entry_hi = min(sma20, price + 0.75 * atr_v)
        structural_stop = swing_high_20 + 0.5 * atr_v
        max_risk = price + 2.5 * atr_v
        stop = min(structural_stop, max_risk)
        risk_per_share = stop - price
        min_t1 = price - 2.0 * risk_per_share
        t1 = min(swing_low_20, min_t1)
        t2 = min(swing_low_60, t1 - atr_v)
        direction = "short"
    else:  # HOLD — tight bracket around price; no actionable trade
        entry_lo = price - 0.25 * atr_v
        entry_hi = price + 0.25 * atr_v
        stop = price - 1.5 * atr_v
        t1 = price + 1.5 * atr_v
        t2 = price + 2.5 * atr_v
        risk_per_share = price - stop
        direction = "neutral"

    risk = abs(risk_per_share)
    reward_t1 = abs(t1 - price)
    reward_t2 = abs(t2 - price)
    rr_t1 = reward_t1 / risk if risk > 1e-9 else 0.0
    rr_t2 = reward_t2 / risk if risk > 1e-9 else 0.0

    # Fixed-fractional position sizing (standard 1% account risk model)
    risk_dollars = account_size * (risk_per_trade_pct / 100.0)
    shares = int(risk_dollars / risk) if risk > 1e-9 else 0
    notional = shares * price
    notional_pct = (notional / account_size) * 100 if account_size > 0 else 0

    # Time horizon: stronger signals justify longer holds; high-vol shrinks horizon
    base_days = 10 if abs(score) < 30 else (20 if abs(score) < 60 else 35)
    if vol_regime_state == "elevated":
        base_days = max(5, int(base_days * 0.6))
    elif vol_regime_state == "subdued":
        base_days = int(base_days * 1.3)

    # Conviction tier from composite score
    abs_s = abs(score)
    if abs_s >= 60:
        conviction = "high"
    elif abs_s >= 30:
        conviction = "medium"
    else:
        conviction = "low"

    return {
        "direction": direction,
        "entry_lo": float(entry_lo),
        "entry_hi": float(entry_hi),
        "stop_loss": float(stop),
        "target": float(t1),  # back-compat alias
        "target_1": float(t1),
        "target_2": float(t2),
        "risk_per_share": float(risk),
        "risk_reward": float(rr_t1),
        "risk_reward_t2": float(rr_t2),
        "shares_1pct_risk": int(shares),
        "risk_dollars": float(risk_dollars),
        "account_size": float(account_size),
        "notional": float(notional),
        "notional_pct": float(notional_pct),
        "horizon_days": int(base_days),
        "conviction": conviction,
        "swing_high_20": swing_high_20,
        "swing_low_20": swing_low_20,
        "swing_high_60": swing_high_60,
        "swing_low_60": swing_low_60,
    }


# ----- Per-ticker analysis -----

def analyze_ticker(prices: pd.Series, returns: pd.Series, account_size: float = 100_000.0) -> dict:
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
    levels = trade_levels(prices, atr_v, verdict, score, vol["regime"], account_size=account_size)

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
    account_size = float(state.get("portfolio_size", 100_000.0) or 100_000.0)

    per_ticker: dict[str, dict] = {}
    for t in tickers:
        per_ticker[t] = analyze_ticker(prices[t], returns[t], account_size=account_size)

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

    # Conviction-weighted suggested allocation across actionable trades (BUY/SELL only)
    conv_weight = {"high": 3.0, "medium": 2.0, "low": 1.0}
    actionable = [(t, v) for t, v in per_ticker.items() if v["verdict"] in ("BUY", "SELL")]
    alloc_total_notional = 0.0
    alloc_total_risk = 0.0
    for t, v in actionable:
        w = conv_weight.get(v.get("levels", {}).get("conviction", "low"), 1.0)
        notional = v.get("levels", {}).get("notional", 0.0) * w
        risk = v.get("levels", {}).get("risk_dollars", 0.0) * w
        alloc_total_notional += notional
        alloc_total_risk += risk
    allocation = {
        "account_size": account_size,
        "n_actionable": len(actionable),
        "deployed_notional": min(alloc_total_notional, account_size),
        "deployed_pct": min(alloc_total_notional / account_size, 1.0) * 100 if account_size > 0 else 0,
        "total_risk_dollars": alloc_total_risk,
        "total_risk_pct": (alloc_total_risk / account_size) * 100 if account_size > 0 else 0,
        "cash_reserve_pct": max(0.0, (1.0 - alloc_total_notional / account_size) * 100) if account_size > 0 else 100,
    }

    return {
        "tickers": tickers,
        "as_of": prices.index[-1].strftime("%Y-%m-%d"),
        "signals": per_ticker,
        "ranked": top,
        "summary": {"buy": buys, "sell": sells, "hold": holds},
        "pair": pair,
        "allocation": allocation,
        "account_size": account_size,
    }
