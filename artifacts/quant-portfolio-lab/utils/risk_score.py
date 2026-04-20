"""QPL composite risk index."""
from __future__ import annotations

import numpy as np


VOL_ANCHOR = 0.20  # 20% annualized vol = 100 points
DD_ANCHOR = 0.40   # 40% drawdown = 100 points
DSD_ANCHOR = 0.20  # 20% downside dev = 100 points


def normalize(value: float, anchor: float) -> float:
    """Map [0, anchor] -> [0, 100], cap at 100."""
    return float(np.interp(value, [0.0, anchor], [0.0, 100.0]))


def qpl_risk_index(annual_vol: float, max_dd: float, downside_dev: float) -> dict:
    n_vol = normalize(annual_vol, VOL_ANCHOR)
    n_dd = normalize(max_dd, DD_ANCHOR)
    n_dsd = normalize(downside_dev, DSD_ANCHOR)
    # Square the dd component (already on 0-100 -> divide to keep scale stable)
    dd_squared = (n_dd ** 2) / 100.0
    score = 0.40 * n_vol + 0.35 * dd_squared + 0.25 * n_dsd
    score = float(np.clip(score, 0.0, 100.0))
    return {
        "score": score,
        "components": {
            "normalized_volatility": n_vol,
            "normalized_max_drawdown": n_dd,
            "normalized_downside_deviation": n_dsd,
            "drawdown_squared_term": dd_squared,
        },
        "label": interpret(score),
    }


def interpret(score: float) -> str:
    if score < 20:
        return "Very Conservative"
    if score < 40:
        return "Conservative"
    if score < 60:
        return "Moderate"
    if score < 80:
        return "Aggressive"
    return "High Risk"
