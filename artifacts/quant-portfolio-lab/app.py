"""Quant Portfolio Lab - Flask backend."""
from __future__ import annotations

import logging
import time
import traceback
from functools import wraps

import numpy as np
from flask import Flask, jsonify, render_template, request

from utils import analytics, backtest, optimization, rebalancing, risk_score, sector, signals, simulation
from utils.data import load_portfolio, validate_inputs
from utils.insight import (
    backtest_insight,
    monte_carlo_insight,
    overview_insight,
    rebalance_insight,
    risk_insight,
    sector_insight,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("qpl")

app = Flask(__name__, template_folder="templates", static_folder="static")


def api_route(fn):
    """Wrap a route handler with timing, validation, and error handling."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        t0 = time.time()
        endpoint = request.path
        logger.info("REQ %s", endpoint)
        try:
            payload = request.get_json(silent=True) or {}
            cleaned = validate_inputs(payload)
            data = fn(cleaned, payload)
            elapsed_ms = (time.time() - t0) * 1000
            logger.info("OK %s in %.0f ms", endpoint, elapsed_ms)
            return jsonify({"status": "success", "data": data.get("data"), "insight": data.get("insight", "")})
        except ValueError as exc:
            elapsed_ms = (time.time() - t0) * 1000
            logger.info("BAD_REQ %s in %.0f ms: %s", endpoint, elapsed_ms, exc)
            return jsonify({"status": "error", "message": str(exc)}), 400
        except Exception as exc:
            elapsed_ms = (time.time() - t0) * 1000
            logger.error("ERR %s in %.0f ms\n%s", endpoint, elapsed_ms, traceback.format_exc())
            return jsonify({"status": "error", "message": f"Server error: {exc}"}), 500

    return wrapper


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.route("/analytics", methods=["POST"])
@api_route
def route_analytics(cleaned, payload):
    state = load_portfolio(cleaned)
    daily = analytics.portfolio_daily_returns(state["returns"], state["weights"])
    metrics = analytics.compute_metrics(daily, state["risk_free_rate"])
    corr = analytics.correlation_matrix(state["returns"])
    sector_info = sector.sector_breakdown(state["tickers"], state["weights"])
    cum = analytics.cumulative_returns(daily)
    data = {
        "tickers": state["tickers"],
        "weights": state["weights"].tolist(),
        "skipped": state["skipped"],
        "metrics": metrics,
        "correlation": {
            "labels": list(corr.columns),
            "matrix": corr.values.tolist(),
        },
        "dates": [d.strftime("%Y-%m-%d") for d in state["returns"].index],
        "cumulative_returns": cum.tolist(),
        "daily_returns": daily.tolist(),
    }
    return {"data": data, "insight": overview_insight(metrics, sector_info)}


@app.route("/optimize", methods=["POST"])
@api_route
def route_optimize(cleaned, payload):
    state = load_portfolio(cleaned)
    res = optimization.random_portfolios(state["returns"], state["risk_free_rate"])
    max_i = res["max_sharpe_idx"]
    min_i = res["min_vol_idx"]
    data = {
        "tickers": state["tickers"],
        "skipped": state["skipped"],
        "vols": res["vols"].tolist(),
        "returns": res["returns"].tolist(),
        "sharpe": res["sharpe"].tolist(),
        "max_sharpe": {
            "weights": res["weights"][max_i].tolist(),
            "return": float(res["returns"][max_i]),
            "vol": float(res["vols"][max_i]),
            "sharpe": float(res["sharpe"][max_i]),
        },
        "min_vol": {
            "weights": res["weights"][min_i].tolist(),
            "return": float(res["returns"][min_i]),
            "vol": float(res["vols"][min_i]),
            "sharpe": float(res["sharpe"][min_i]),
        },
    }
    insight = (
        f"Generated {len(res['returns'])} random portfolios. "
        f"Max Sharpe: {data['max_sharpe']['sharpe']:.2f} at {data['max_sharpe']['vol']*100:.1f}% vol. "
        f"Min Vol: {data['min_vol']['vol']*100:.1f}% with Sharpe {data['min_vol']['sharpe']:.2f}."
    )
    return {"data": data, "insight": insight}


@app.route("/backtest", methods=["POST"])
@api_route
def route_backtest(cleaned, payload):
    state = load_portfolio(cleaned)
    res = backtest.backtest(state)
    res["tickers"] = state["tickers"]
    res["skipped"] = state["skipped"]
    return {"data": res, "insight": backtest_insight(res)}


@app.route("/simulate", methods=["POST"])
@api_route
def route_simulate(cleaned, payload):
    state = load_portfolio(cleaned)
    horizon = float(payload.get("horizon_years", 1.0))
    res = simulation.monte_carlo(state, horizon_years=horizon)
    return {"data": res, "insight": monte_carlo_insight(res)}


@app.route("/rebalance", methods=["POST"])
@api_route
def route_rebalance(cleaned, payload):
    state = load_portfolio(cleaned)
    freq = str(payload.get("frequency", "quarterly"))
    res = rebalancing.simulate(state, frequency=freq)
    return {"data": res, "insight": rebalance_insight(res)}


@app.route("/sector", methods=["POST"])
@api_route
def route_sector(cleaned, payload):
    state = load_portfolio(cleaned)
    info = sector.sector_breakdown(state["tickers"], state["weights"])
    return {"data": info, "insight": sector_insight(info)}


@app.route("/signals", methods=["POST"])
@api_route
def route_signals(cleaned, payload):
    state = load_portfolio(cleaned)
    res = signals.trade_signals(state)
    s = res["summary"]
    insight = (
        f"As of {res['as_of']}: {s['buy']} BUY · {s['hold']} HOLD · {s['sell']} SELL signals "
        f"across {len(res['tickers'])} tickers."
    )
    if res.get("pair") and res["pair"]["action"] != "wait":
        insight += f" Pairs trade flagged: {res['pair']['signal']} (z = {res['pair']['spread_z']:+.2f})."
    return {"data": res, "insight": insight}


@app.route("/riskscore", methods=["POST"])
@api_route
def route_riskscore(cleaned, payload):
    state = load_portfolio(cleaned)
    daily = analytics.portfolio_daily_returns(state["returns"], state["weights"])
    metrics = analytics.compute_metrics(daily, state["risk_free_rate"])
    user_score = risk_score.qpl_risk_index(
        metrics["annual_volatility"], metrics["max_drawdown"], metrics["downside_deviation"]
    )

    # Compare against optimization-derived portfolios
    opt = optimization.random_portfolios(state["returns"], state["risk_free_rate"])
    max_i = opt["max_sharpe_idx"]
    min_i = opt["min_vol_idx"]

    def compute_for(weights):
        d = analytics.portfolio_daily_returns(state["returns"], weights)
        m = analytics.compute_metrics(d, state["risk_free_rate"])
        return risk_score.qpl_risk_index(m["annual_volatility"], m["max_drawdown"], m["downside_deviation"])

    max_sharpe_score = compute_for(opt["weights"][max_i])
    min_vol_score = compute_for(opt["weights"][min_i])
    data = {
        "user": user_score,
        "max_sharpe": max_sharpe_score,
        "min_vol": min_vol_score,
        "metrics": metrics,
    }
    return {
        "data": data,
        "insight": risk_insight(user_score, max_sharpe_score["score"], min_vol_score["score"]),
    }


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
