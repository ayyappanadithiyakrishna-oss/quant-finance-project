# Quant Portfolio Lab

**Institutional-grade portfolio analytics for everyone without a Bloomberg terminal.**

A full-stack quantitative finance dashboard built with Python Flask, NumPy, Pandas, yfinance, SciPy, and Plotly.

## Features

1. **Data Fetching** — Adjusted-close prices via yfinance with caching, alignment, and validation.
2. **Portfolio Analytics** — Annualized return, volatility, Sharpe, Sortino, max drawdown, correlation heatmap.
3. **Efficient Frontier** — 5,000 random portfolios with Max Sharpe and Min Vol identified.
4. **Backtest** — Cumulative returns vs S&P 500 with full metrics table.
5. **Monte Carlo** — 1,000 simulated paths with 5/50/95 percentile bands.
6. **Dynamic Rebalancing** — Drift vs monthly/quarterly/yearly rebalance comparison.
7. **Sector Exposure** — Pie chart with 40%-concentration warnings.
8. **QPL Risk Index** — Composite 0–100 score (40% vol, 35% drawdown², 25% downside dev) with comparison.
9. **Insight Engine** — Auto-generated plain-English summary on every section.

## Quick Start

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`.

## API Routes

All routes accept `POST` JSON with `{tickers, weights, start_date, end_date, risk_free_rate}` and return:

```json
{ "status": "success", "data": {...}, "insight": "..." }
```

- `POST /analytics`
- `POST /optimize`
- `POST /backtest`
- `POST /simulate` (extra: `horizon_years`)
- `POST /rebalance` (extra: `frequency`: monthly|quarterly|yearly)
- `POST /sector`
- `POST /riskscore`

## Architecture

- **Stateless backend** — every request carries full state.
- **Vectorized NumPy/Pandas** for all heavy computation.
- **`functools.lru_cache`** for yfinance prices and sector lookups.
- **Logging** at INFO level for every request, skipped tickers, and timing.
