"""Plain-English insight engine."""
from __future__ import annotations


def fmt_pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def overview_insight(metrics: dict, sector_info: dict | None = None) -> str:
    parts = []
    parts.append(
        f"Your portfolio shows an annualized return of {fmt_pct(metrics['annual_return'])} "
        f"against volatility of {fmt_pct(metrics['annual_volatility'])} "
        f"(Sharpe {metrics['sharpe_ratio']:.2f})."
    )
    ratio = metrics["annual_return"] / metrics["annual_volatility"] if metrics["annual_volatility"] else 0
    if ratio > 1.0:
        parts.append("Returns comfortably exceed the risk you are taking.")
    elif ratio > 0.5:
        parts.append("Returns are reasonable for the volatility absorbed.")
    else:
        parts.append("The volatility is high relative to the realized return.")
    if sector_info and sector_info.get("over_concentration"):
        worst = max(sector_info["over_concentration"].items(), key=lambda kv: kv[1])
        parts.append(
            f"Concentration warning: {worst[0]} represents {fmt_pct(worst[1])} of holdings, "
            "creating significant single-sector risk."
        )
    return " ".join(parts)


def backtest_insight(result: dict) -> str:
    pm = result["portfolio_metrics"]
    if not result.get("benchmark_available"):
        return (
            f"Portfolio returned {fmt_pct(pm['annual_return'])} annually with "
            f"Sharpe {pm['sharpe_ratio']:.2f}. S&P 500 benchmark data unavailable for this run."
        )
    bm = result["benchmark_metrics"]
    diff = pm["sharpe_ratio"] - bm["sharpe_ratio"]
    verdict = "outperforms" if diff > 0 else "underperforms"
    return (
        f"Portfolio: {fmt_pct(pm['annual_return'])} annually, Sharpe {pm['sharpe_ratio']:.2f}. "
        f"S&P 500: {fmt_pct(bm['annual_return'])} annually, Sharpe {bm['sharpe_ratio']:.2f}. "
        f"Risk-adjusted, the portfolio {verdict} the benchmark by {abs(diff):.2f} Sharpe."
    )


def rebalance_insight(result: dict) -> str:
    diff = result["sharpe_improvement"]
    direction = "improves" if diff > 0 else "reduces"
    return (
        f"{result['frequency'].title()} rebalancing {direction} risk-adjusted returns by "
        f"{abs(diff):.2f} Sharpe versus letting the portfolio drift."
    )


def risk_insight(score: dict, max_sharpe_score: float | None = None, min_vol_score: float | None = None) -> str:
    parts = [f"QPL Risk Index: {score['score']:.0f}/100 ({score['label']})."]
    if max_sharpe_score is not None and min_vol_score is not None:
        parts.append(
            f"For comparison, the Max-Sharpe portfolio scores {max_sharpe_score:.0f} "
            f"and the Min-Vol portfolio scores {min_vol_score:.0f}."
        )
    return " ".join(parts)


def monte_carlo_insight(result: dict) -> str:
    return (
        f"Over {result['horizon_years']:.1f} years, simulated median ending value is "
        f"${result['median_final']:,.0f} from a $10,000 start. "
        f"Probability of loss: {fmt_pct(result['prob_loss'])}; "
        f"probability of doubling: {fmt_pct(result['prob_double'])}."
    )


def sector_insight(sector_info: dict) -> str:
    sectors = sector_info["sectors"]
    if not sectors:
        return "No sector data available."
    top = max(sectors.items(), key=lambda kv: kv[1])
    msg = f"Largest exposure: {top[0]} at {fmt_pct(top[1])} of holdings."
    if sector_info["over_concentration"]:
        worst = max(sector_info["over_concentration"].items(), key=lambda kv: kv[1])
        msg += f" Warning: {worst[0]} exceeds the 40% concentration threshold."
    return msg
