// Quant Portfolio Lab - frontend
const FONT_FAMILY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO_FAMILY = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
const AXIS_DEFAULTS = {
  gridcolor: "rgba(255,255,255,0.04)",
  zerolinecolor: "rgba(255,255,255,0.08)",
  linecolor: "rgba(255,255,255,0.08)",
  tickcolor: "rgba(255,255,255,0.15)",
  tickfont: { family: FONT_FAMILY, size: 11, color: "#7b859d" },
  titlefont: { family: FONT_FAMILY, size: 12, color: "#a5aec3" },
  automargin: true,
};
const PLOTLY_LAYOUT_DEFAULTS = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#c1c8d8", family: FONT_FAMILY, size: 12 },
  margin: { t: 36, r: 20, b: 44, l: 56 },
  xaxis: { ...AXIS_DEFAULTS },
  yaxis: { ...AXIS_DEFAULTS },
  hoverlabel: {
    bgcolor: "#161c2c",
    bordercolor: "rgba(76,194,255,0.4)",
    font: { family: FONT_FAMILY, size: 12, color: "#e3e8f3" },
  },
  legend: {
    font: { family: FONT_FAMILY, size: 11.5, color: "#c1c8d8" },
    bgcolor: "rgba(0,0,0,0)",
  },
  colorway: ["#4cc2ff", "#7c5cff", "#3ddc97", "#ffb547", "#ff5c8a", "#76ddff", "#a87aff", "#5fe6b0"],
};
const PLOTLY_CONFIG = { displaylogo: false, responsive: true, displayModeBar: false };
function titleCfg(text) {
  return { text, font: { family: FONT_FAMILY, size: 13, color: "#e3e8f3" }, x: 0.02, xanchor: "left" };
}

// Default dates: ~3 years
(function initDates() {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const past = new Date(today);
  past.setFullYear(past.getFullYear() - 3);
  document.getElementById("end").value = end;
  document.getElementById("start").value = past.toISOString().slice(0, 10);
})();

// Cache last results for CSV exports
const cache = { analytics: null, backtest: null, signals: null, universe: null, meta: {} };

// ============ Ticker Picker ============
const MAX_TICKERS = 10;
const selectedTickers = (document.getElementById("tickers").value || "")
  .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

// Special-case overrides: tickers whose logo is served from our own /static directory
const LOCAL_LOGOS = {
  SPY: "/static/images/spy.png",
  QQQ: "/static/images/qqq.png",
};
function logoUrl(domain, symbol) {
  if (symbol && LOCAL_LOGOS[symbol]) return LOCAL_LOGOS[symbol];
  if (!domain) return "";
  // Google's faviconV2 endpoint at 256px — highest quality cached icon Google has
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=256`;
}
function hasLogo(meta) {
  return !!(meta && (LOCAL_LOGOS[meta.symbol] || meta.domain));
}
function tickerInitial(sym) { return (sym || "?").slice(0, 1); }
// Deterministic pleasant color per ticker for letter-tile fallbacks
const TILE_PALETTE = [
  ["#5b8def","#1e3a8a"], ["#10b981","#064e3b"], ["#f59e0b","#78350f"],
  ["#ef4444","#7f1d1d"], ["#8b5cf6","#4c1d95"], ["#ec4899","#831843"],
  ["#06b6d4","#164e63"], ["#84cc16","#365314"], ["#f97316","#7c2d12"],
  ["#14b8a6","#134e4a"], ["#6366f1","#312e81"], ["#d946ef","#701a75"],
];
function tileColor(sym) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) | 0;
  return TILE_PALETTE[Math.abs(h) % TILE_PALETTE.length];
}
function tileStyle(sym) {
  const [c1, c2] = tileColor(sym);
  return `background:linear-gradient(135deg, ${c1} 0%, ${c2} 100%);color:#fff;`;
}

function chipHtml(meta) {
  const sym = meta.symbol;
  const initial = tickerInitial(sym);
  const url = logoUrl(meta.domain || "", sym);
  return `
    <span class="t-chip" data-sym="${sym}" title="${meta.name || sym} · ${meta.exchange || ""}">
      <span class="t-chip-logo" style="${tileStyle(sym)}">
        <span class="t-chip-fallback">${initial}</span>
        ${url ? `<img src="${url}" alt="" onload="this.previousElementSibling.style.display='none';this.parentElement.classList.add('has-logo');" onerror="this.style.display='none'">` : ""}
      </span>
      <span class="t-chip-sym">${sym}</span>
      <button class="t-chip-x" data-sym="${sym}" aria-label="Remove ${sym}">×</button>
    </span>
  `;
}

function syncHiddenTickers() {
  document.getElementById("tickers").value = selectedTickers.join(",");
}

function renderChips() {
  const universe = cache.universe || [];
  const bySym = Object.fromEntries(universe.map(u => [u.symbol, u]));
  const wrap = document.getElementById("ticker-chips");
  wrap.innerHTML = selectedTickers.map(s => chipHtml(bySym[s] || { symbol: s, name: s, exchange: "", domain: "" })).join("");
  wrap.querySelectorAll(".t-chip-x").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = btn.dataset.sym;
      const i = selectedTickers.indexOf(sym);
      if (i >= 0) selectedTickers.splice(i, 1);
      syncHiddenTickers();
      renderChips();
    });
  });
  syncHiddenTickers();
}

function renderDropdown(query) {
  const dd = document.getElementById("ticker-dropdown");
  if (!cache.universe) {
    dd.innerHTML = `<div class="dd-empty">Loading 10,734-ticker universe…</div>`;
    dd.classList.remove("hidden");
    return;
  }
  const q = (query || "").trim().toUpperCase();
  let results = cache.universe;
  if (q) {
    results = results.filter(u =>
      u.symbol.startsWith(q) || u.name.toUpperCase().includes(q)
    );
    // Symbol exact-match first
    results.sort((a, b) => {
      const aExact = a.symbol === q ? -2 : a.symbol.startsWith(q) ? -1 : 0;
      const bExact = b.symbol === q ? -2 : b.symbol.startsWith(q) ? -1 : 0;
      return aExact - bExact;
    });
  }
  results = results.slice(0, 30);
  if (!results.length) {
    dd.innerHTML = `<div class="dd-empty">No matches in NYSE / NASDAQ universe</div>`;
    dd.classList.remove("hidden");
    return;
  }
  dd.innerHTML = results.map(u => {
    const picked = selectedTickers.includes(u.symbol);
    const initial = tickerInitial(u.symbol);
    return `
      <div class="dd-row ${picked ? "dd-picked" : ""}" data-sym="${u.symbol}">
        <span class="dd-logo" style="${tileStyle(u.symbol)}">
          <span class="dd-fallback">${initial}</span>
          ${hasLogo(u) ? `<img src="${logoUrl(u.domain, u.symbol)}" alt="" onload="this.previousElementSibling.style.display='none';this.parentElement.classList.add('has-logo');" onerror="this.style.display='none'">` : ""}
        </span>
        <div class="dd-info">
          <div class="dd-row-top">
            <span class="dd-sym">${u.symbol}</span>
            <span class="dd-exchange ex-${u.exchange.toLowerCase()}">${u.exchange}</span>
          </div>
          <div class="dd-name">${u.name}</div>
        </div>
        <div class="dd-sector">${u.sector}</div>
        <div class="dd-add">${picked ? "✓" : "+"}</div>
      </div>
    `;
  }).join("");
  dd.classList.remove("hidden");
  dd.querySelectorAll(".dd-row").forEach(row => {
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const sym = row.dataset.sym;
      const i = selectedTickers.indexOf(sym);
      if (i >= 0) {
        selectedTickers.splice(i, 1);
      } else {
        if (selectedTickers.length >= MAX_TICKERS) {
          showError(`Maximum ${MAX_TICKERS} tickers. Remove one first.`);
          return;
        }
        selectedTickers.push(sym);
      }
      renderChips();
      renderDropdown(document.getElementById("ticker-search").value);
    });
  });
}

async function loadUniverse() {
  try {
    const r = await fetch("/universe");
    const j = await r.json();
    cache.universe = j.data || [];
    renderChips();
  } catch (e) {
    console.error("universe load failed", e);
    cache.universe = [];
    renderChips();
  }
}

(function initTickerPicker() {
  const input = document.getElementById("ticker-search");
  const dd = document.getElementById("ticker-dropdown");
  const wrap = document.getElementById("ticker-picker");
  input.addEventListener("focus", () => renderDropdown(input.value));
  input.addEventListener("input", () => renderDropdown(input.value));
  input.addEventListener("blur", () => setTimeout(() => dd.classList.add("hidden"), 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && selectedTickers.length) {
      selectedTickers.pop();
      renderChips();
    } else if (e.key === "Enter") {
      const q = input.value.trim().toUpperCase();
      if (q) {
        let symToAdd = null;
        if (cache.universe) {
          const found = cache.universe.find(u => u.symbol === q) || cache.universe.find(u => u.symbol.startsWith(q));
          if (found) symToAdd = found.symbol;
        }
        // Graceful fallback: even if universe hasn't loaded, accept the typed symbol
        if (!symToAdd && /^[A-Z][A-Z0-9.\-]{0,5}$/.test(q)) symToAdd = q;
        if (symToAdd && !selectedTickers.includes(symToAdd) && selectedTickers.length < MAX_TICKERS) {
          selectedTickers.push(symToAdd);
          renderChips();
          input.value = "";
          renderDropdown("");
        }
      }
      e.preventDefault();
    } else if (e.key === "Escape") {
      dd.classList.add("hidden");
    }
  });
  wrap.addEventListener("click", () => input.focus());
  loadUniverse();
})();

// State helpers
function getState() {
  const tickers = document.getElementById("tickers").value
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const wsRaw = document.getElementById("weights").value
    .split(",").map(s => s.trim()).filter(Boolean);
  const weights = wsRaw.length === tickers.length ? wsRaw.map(Number) : null;
  return {
    tickers,
    weights,
    start_date: document.getElementById("start").value,
    end_date: document.getElementById("end").value,
    risk_free_rate: (Number(document.getElementById("rf").value) || 0) / 100,
  };
}

function showError(msg) {
  const el = document.getElementById("error-toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

function showSkipped(skipped) {
  const el = document.getElementById("skipped-warning");
  if (skipped && skipped.length) {
    el.textContent = `Skipped tickers (no data / low coverage): ${skipped.join(", ")}. Weights re-normalized.`;
  } else {
    el.textContent = "";
  }
}

function setLoading(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !on);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.status !== "success") {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

// Sidebar nav scroll
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", e => {
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");
  });
});

// ============ Renderers ============
function renderMetrics(metrics) {
  const grid = document.getElementById("metrics-grid");
  const items = [
    ["Annual Return", (metrics.annual_return * 100).toFixed(2) + "%", metrics.annual_return >= 0 ? "pos" : "neg"],
    ["Annual Volatility", (metrics.annual_volatility * 100).toFixed(2) + "%", ""],
    ["Sharpe Ratio", metrics.sharpe_ratio.toFixed(2), metrics.sharpe_ratio >= 1 ? "pos" : ""],
    ["Sortino Ratio", metrics.sortino_ratio.toFixed(2), metrics.sortino_ratio >= 1 ? "pos" : ""],
    ["Max Drawdown", "-" + (metrics.max_drawdown * 100).toFixed(2) + "%", "neg"],
    ["Downside Dev", (metrics.downside_deviation * 100).toFixed(2) + "%", ""],
  ];
  grid.innerHTML = items.map(([l, v, c]) =>
    `<div class="metric-card"><div class="metric-label">${l}</div><div class="metric-value ${c}">${v}</div></div>`
  ).join("");
}

function renderCumChart(dates, cum) {
  Plotly.newPlot("cumchart", [{
    x: dates,
    y: cum.map(v => v * 100),
    type: "scatter",
    mode: "lines",
    line: { color: "#4cc2ff", width: 2.2, shape: "spline", smoothing: 0.4 },
    fill: "tozeroy",
    fillcolor: "rgba(76,194,255,0.08)",
    name: "Cumulative %",
    hovertemplate: "<b>%{x|%b %d, %Y}</b><br>%{y:.2f}%<extra></extra>",
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: titleCfg("Cumulative Return"),
    xaxis: { ...AXIS_DEFAULTS, type: "date" },
    yaxis: { ...AXIS_DEFAULTS, ticksuffix: "%" },
  }, PLOTLY_CONFIG);
}

function renderCorrChart(corr) {
  Plotly.newPlot("corrchart", [{
    z: corr.matrix,
    x: corr.labels,
    y: corr.labels,
    type: "heatmap",
    colorscale: [[0, "#ff5c8a"], [0.5, "#161c2c"], [1, "#3ddc97"]],
    zmin: -1, zmax: 1,
    text: corr.matrix.map(r => r.map(v => v.toFixed(2))),
    texttemplate: "%{text}",
    textfont: { size: 11, family: FONT_FAMILY, color: "#e3e8f3" },
    hovertemplate: "<b>%{y} ↔ %{x}</b><br>ρ = %{z:.2f}<extra></extra>",
    colorbar: { tickfont: { family: FONT_FAMILY, size: 10, color: "#7b859d" }, outlinewidth: 0, thickness: 12 },
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: titleCfg("Correlation Matrix"),
    xaxis: { ...AXIS_DEFAULTS, type: "category", showgrid: false },
    yaxis: { ...AXIS_DEFAULTS, type: "category", showgrid: false },
  }, PLOTLY_CONFIG);
}

function renderFrontier(d) {
  const traces = [{
    x: d.vols.map(v => v * 100),
    y: d.returns.map(v => v * 100),
    mode: "markers",
    type: "scatter",
    marker: {
      size: 5,
      color: d.sharpe,
      colorscale: [[0, "#1a2540"], [0.5, "#7c5cff"], [1, "#4cc2ff"]],
      showscale: true,
      opacity: 0.75,
      colorbar: {
        title: { text: "Sharpe", font: { family: FONT_FAMILY, size: 11, color: "#a5aec3" }, side: "right" },
        tickfont: { family: FONT_FAMILY, size: 10, color: "#7b859d" },
        outlinewidth: 0,
        thickness: 12,
        len: 0.85,
      },
    },
    name: "Portfolios",
    hovertemplate: "<b>Random Portfolio</b><br>Vol: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
  }, {
    x: [d.max_sharpe.vol * 100],
    y: [d.max_sharpe.return * 100],
    mode: "markers",
    type: "scatter",
    marker: { size: 18, color: "#3ddc97", symbol: "star", line: { color: "#0a0d13", width: 2 } },
    name: "Max Sharpe",
    hovertemplate: "<b>Max Sharpe</b><br>Vol: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
  }, {
    x: [d.min_vol.vol * 100],
    y: [d.min_vol.return * 100],
    mode: "markers",
    type: "scatter",
    marker: { size: 16, color: "#ffb547", symbol: "diamond", line: { color: "#0a0d13", width: 2 } },
    name: "Min Vol",
    hovertemplate: "<b>Min Volatility</b><br>Vol: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
  }];
  Plotly.newPlot("frontier-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 480,
    title: titleCfg("Efficient Frontier — 5,000 Portfolios"),
    xaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Annualized Volatility (%)", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } }, ticksuffix: "%" },
    yaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Annualized Return (%)", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } }, ticksuffix: "%" },
    legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center", font: { family: FONT_FAMILY, size: 12, color: "#c1c8d8" } },
  }, PLOTLY_CONFIG);

  function detail(p) {
    const wRows = d.tickers.map((t, i) => `${t}: ${(p.weights[i] * 100).toFixed(1)}%`).join("<br/>");
    return `
      <div class="metric-value">${p.sharpe.toFixed(2)}</div>
      <div style="font-size: 11px; color: var(--muted); margin-top: 8px;">
        Return ${(p.return * 100).toFixed(2)}% &middot; Vol ${(p.vol * 100).toFixed(2)}%
      </div>
      <div style="font-size: 12px; margin-top: 10px; line-height: 1.6;">${wRows}</div>
    `;
  }
  document.getElementById("max-sharpe-detail").innerHTML = detail(d.max_sharpe);
  document.getElementById("min-vol-detail").innerHTML = detail(d.min_vol);
}

function renderBacktest(d) {
  const traces = [{
    x: d.dates,
    y: d.portfolio_cumulative.map(v => v * 100),
    mode: "lines",
    line: { color: "#4cc2ff", width: 2.2, shape: "spline", smoothing: 0.4 },
    name: "Portfolio",
    hovertemplate: "<b>%{x|%b %d, %Y}</b><br>Portfolio: %{y:.2f}%<extra></extra>",
  }];
  if (d.benchmark_available) {
    traces.push({
      x: d.dates,
      y: d.benchmark_cumulative.map(v => v * 100),
      mode: "lines",
      line: { color: "#ffb547", width: 2, dash: "dash", shape: "spline", smoothing: 0.4 },
      name: "S&P 500",
      hovertemplate: "<b>%{x|%b %d, %Y}</b><br>S&P 500: %{y:.2f}%<extra></extra>",
    });
  }
  Plotly.newPlot("backtest-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: titleCfg("Cumulative Returns"),
    xaxis: { ...AXIS_DEFAULTS, type: "date" },
    yaxis: { ...AXIS_DEFAULTS, ticksuffix: "%" },
    legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center", font: { family: FONT_FAMILY, size: 12, color: "#c1c8d8" } },
  }, PLOTLY_CONFIG);

  function row(label, m) {
    return `<tr>
      <td>${label}</td>
      <td>${(m.annual_return * 100).toFixed(2)}%</td>
      <td>${(m.annual_volatility * 100).toFixed(2)}%</td>
      <td>${m.sharpe_ratio.toFixed(2)}</td>
      <td>-${(m.max_drawdown * 100).toFixed(2)}%</td>
    </tr>`;
  }
  let html = `<table>
    <thead><tr><th></th><th>Annual Ret</th><th>Volatility</th><th>Sharpe</th><th>Max DD</th></tr></thead>
    <tbody>${row("Portfolio", d.portfolio_metrics)}`;
  if (d.benchmark_available) html += row("S&P 500", d.benchmark_metrics);
  html += "</tbody></table>";
  if (!d.benchmark_available) {
    html += `<div style="font-size:12px;color:var(--warn);margin-top:8px;">Benchmark data unavailable for this period.</div>`;
  }
  document.getElementById("backtest-metrics").innerHTML = html;
}

function renderMonteCarlo(d) {
  const days = Array.from({ length: d.n_days }, (_, i) => i);
  const traces = [];
  // Confidence band (5th to 95th percentile shaded)
  traces.push({
    x: days.concat(days.slice().reverse()),
    y: d.p95.concat(d.p5.slice().reverse()),
    fill: "toself",
    fillcolor: "rgba(76,194,255,0.08)",
    line: { color: "rgba(0,0,0,0)" },
    name: "5–95% range",
    hoverinfo: "skip",
    showlegend: true,
  });
  // Sample paths
  d.sample_paths.forEach(p => {
    traces.push({
      x: days, y: p, mode: "lines", line: { color: "rgba(124,92,255,0.10)", width: 1 },
      showlegend: false, hoverinfo: "skip",
    });
  });
  traces.push({ x: days, y: d.p95, mode: "lines", line: { color: "#3ddc97", width: 1.8, dash: "dash" }, name: "95th percentile",
    hovertemplate: "Day %{x}<br>P95: $%{y:,.0f}<extra></extra>" });
  traces.push({ x: days, y: d.p50, mode: "lines", line: { color: "#4cc2ff", width: 2.4 }, name: "Median",
    hovertemplate: "Day %{x}<br>Median: $%{y:,.0f}<extra></extra>" });
  traces.push({ x: days, y: d.p5, mode: "lines", line: { color: "#ff5c8a", width: 1.8, dash: "dash" }, name: "5th percentile",
    hovertemplate: "Day %{x}<br>P5: $%{y:,.0f}<extra></extra>" });

  Plotly.newPlot("mc-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 420,
    title: titleCfg(`Monte Carlo Projection — ${d.n_paths.toLocaleString()} paths · ${d.horizon_years.toFixed(1)}yr · $10k start`),
    xaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Trading Day", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } } },
    yaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Portfolio Value ($)", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } }, tickprefix: "$", tickformat: ",.0f" },
    legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center", font: { family: FONT_FAMILY, size: 12, color: "#c1c8d8" } },
  }, PLOTLY_CONFIG);

  Plotly.newPlot("mc-hist", [{
    x: d.final_distribution,
    type: "histogram",
    marker: {
      color: "rgba(124,92,255,0.55)",
      line: { color: "#7c5cff", width: 1 },
    },
    nbinsx: 50,
    hovertemplate: "Range: $%{x:,.0f}<br>Count: %{y}<extra></extra>",
    name: "Outcomes",
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 300,
    title: titleCfg(`Final Value Distribution — Median $${d.median_final.toLocaleString(undefined, {maximumFractionDigits: 0})}`),
    xaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Ending Value ($)", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } }, tickprefix: "$", tickformat: ",.0f" },
    yaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "Frequency", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } } },
    bargap: 0.05,
    showlegend: false,
  }, PLOTLY_CONFIG);
}

function renderRebal(d) {
  Plotly.newPlot("rebal-chart", [
    {
      x: d.dates, y: d.drift_cumulative.map(v => v * 100),
      mode: "lines", name: "Drift (no rebalance)",
      line: { color: "#ffb547", width: 2.2, shape: "spline", smoothing: 0.4 },
      hovertemplate: "<b>%{x|%b %d, %Y}</b><br>Drift: %{y:.2f}%<extra></extra>",
    },
    {
      x: d.dates, y: d.rebal_cumulative.map(v => v * 100),
      mode: "lines", name: `Rebalanced (${d.frequency})`,
      line: { color: "#4cc2ff", width: 2.2, shape: "spline", smoothing: 0.4 },
      hovertemplate: "<b>%{x|%b %d, %Y}</b><br>Rebalanced: %{y:.2f}%<extra></extra>",
    },
  ], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: titleCfg("Rebalanced vs Drift"),
    xaxis: { ...AXIS_DEFAULTS, type: "date" },
    yaxis: { ...AXIS_DEFAULTS, ticksuffix: "%" },
    legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center", font: { family: FONT_FAMILY, size: 12, color: "#c1c8d8" } },
  }, PLOTLY_CONFIG);

  function weightTraces(weights) {
    return d.tickers.map((t, i) => ({
      x: d.dates,
      y: weights.map(row => row[i] * 100),
      type: "scatter", mode: "lines", stackgroup: "one", name: t,
      hovertemplate: `<b>${t}</b><br>%{x|%b %d, %Y}<br>%{y:.1f}%<extra></extra>`,
      line: { width: 0.5 },
    }));
  }
  Plotly.newPlot("drift-weights-chart", weightTraces(d.drift_weights), {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: titleCfg("Weight Drift (no rebalance)"),
    xaxis: { ...AXIS_DEFAULTS, type: "date" },
    yaxis: { ...AXIS_DEFAULTS, ticksuffix: "%", range: [0, 100] },
  }, PLOTLY_CONFIG);
  Plotly.newPlot("rebal-weights-chart", weightTraces(d.rebal_weights), {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: titleCfg(`Weights with ${d.frequency} rebalance`),
    xaxis: { ...AXIS_DEFAULTS, type: "date" },
    yaxis: { ...AXIS_DEFAULTS, ticksuffix: "%", range: [0, 100] },
  }, PLOTLY_CONFIG);

  function row(label, m) {
    return `<tr>
      <td>${label}</td>
      <td>${(m.annual_return * 100).toFixed(2)}%</td>
      <td>${(m.annual_volatility * 100).toFixed(2)}%</td>
      <td>${m.sharpe_ratio.toFixed(2)}</td>
      <td>-${(m.max_drawdown * 100).toFixed(2)}%</td>
    </tr>`;
  }
  document.getElementById("rebal-metrics").innerHTML = `<table>
    <thead><tr><th></th><th>Ann Return</th><th>Volatility</th><th>Sharpe</th><th>Max DD</th></tr></thead>
    <tbody>${row("Drift", d.drift_metrics)}${row("Rebalanced", d.rebal_metrics)}</tbody></table>`;
}

function renderSector(d) {
  const labels = Object.keys(d.sectors);
  const values = labels.map(k => d.sectors[k] * 100);
  const palette = ["#4cc2ff", "#7c5cff", "#3ddc97", "#ffb547", "#ff5c8a", "#76ddff", "#a87aff", "#5fe6b0"];
  const totalPct = values.reduce((a, b) => a + b, 0).toFixed(0);
  Plotly.newPlot("sector-pie", [{
    labels, values, type: "pie",
    hole: 0.62,
    textinfo: "percent",
    textposition: "outside",
    textfont: { family: FONT_FAMILY, size: 12, color: "#e3e8f3" },
    insidetextorientation: "horizontal",
    marker: {
      colors: palette,
      line: { color: "#0a0d13", width: 2 },
    },
    sort: true,
    direction: "clockwise",
    rotation: -45,
    hovertemplate: "<b>%{label}</b><br>Allocation: %{value:.2f}%<extra></extra>",
    automargin: true,
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: titleCfg("Sector Allocation"),
    showlegend: true,
    legend: {
      orientation: "v",
      x: 1.02,
      y: 0.5,
      yanchor: "middle",
      font: { family: FONT_FAMILY, size: 11.5, color: "#c1c8d8" },
      bgcolor: "rgba(0,0,0,0)",
    },
    annotations: [{
      text: `<b style="font-size:18px;color:#e3e8f3">${labels.length}</b><br><span style="font-size:10px;color:#7b859d;letter-spacing:0.5px">SECTORS</span>`,
      showarrow: false,
      font: { family: FONT_FAMILY, size: 12, color: "#c1c8d8" },
      x: 0.5, y: 0.5, xref: "paper", yref: "paper",
    }],
    margin: { t: 36, r: 20, b: 30, l: 20 },
  }, PLOTLY_CONFIG);

  let html = `<table><thead><tr><th>Ticker</th><th>Weight</th><th>Sector</th></tr></thead><tbody>`;
  d.rows.forEach(r => {
    html += `<tr><td>${r.ticker}</td><td>${(r.weight * 100).toFixed(2)}%</td><td>${r.sector}</td></tr>`;
  });
  html += `</tbody></table>`;
  if (Object.keys(d.over_concentration).length) {
    html += `<div style="margin-top:10px;color:var(--warn);font-size:12px;">⚠ Concentration > 40%: ${Object.keys(d.over_concentration).join(", ")}</div>`;
  }
  document.getElementById("sector-table").innerHTML = html;
}

function renderRiskScore(d) {
  Plotly.newPlot("risk-gauge", [{
    type: "indicator",
    mode: "gauge+number",
    value: d.user.score,
    number: { font: { family: FONT_FAMILY, size: 44, color: "#e3e8f3" }, suffix: "" },
    title: { text: `<b>${d.user.label}</b>`, font: { family: FONT_FAMILY, size: 14, color: "#a5aec3" } },
    gauge: {
      axis: {
        range: [0, 100],
        tickcolor: "rgba(255,255,255,0.2)",
        tickfont: { family: FONT_FAMILY, size: 10, color: "#7b859d" },
        tickwidth: 1,
      },
      bar: { color: "#4cc2ff", thickness: 0.25 },
      bgcolor: "rgba(255,255,255,0.03)",
      borderwidth: 0,
      steps: [
        { range: [0, 25], color: "rgba(61,220,151,0.20)" },
        { range: [25, 50], color: "rgba(76,194,255,0.20)" },
        { range: [50, 75], color: "rgba(255,181,71,0.22)" },
        { range: [75, 100], color: "rgba(255,92,138,0.22)" },
      ],
      threshold: { line: { color: "#e3e8f3", width: 3 }, thickness: 0.75, value: d.user.score },
    },
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: titleCfg("QPL Risk Index"),
  }, PLOTLY_CONFIG);

  Plotly.newPlot("risk-compare", [{
    x: ["Your Portfolio", "Max Sharpe", "Min Vol"],
    y: [d.user.score, d.max_sharpe.score, d.min_vol.score],
    type: "bar",
    marker: {
      color: ["#4cc2ff", "#3ddc97", "#ffb547"],
      line: { color: "rgba(0,0,0,0)", width: 0 },
    },
    text: [d.user.label, d.max_sharpe.label, d.min_vol.label],
    textposition: "outside",
    textfont: { family: FONT_FAMILY, size: 11, color: "#c1c8d8" },
    hovertemplate: "<b>%{x}</b><br>Score: %{y:.0f}<extra></extra>",
    width: [0.55, 0.55, 0.55],
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: titleCfg("Risk Comparison"),
    xaxis: { ...AXIS_DEFAULTS, type: "category", showgrid: false },
    yaxis: { ...AXIS_DEFAULTS, type: "linear", range: [0, 115], title: { text: "Score (0–100)", font: { family: FONT_FAMILY, size: 12, color: "#a5aec3" } } },
    bargap: 0.4,
  }, PLOTLY_CONFIG);
}

// ============ Runners ============
async function runAll() {
  const state = getState();
  if (!state.tickers.length) return showError("Enter at least one ticker.");
  document.querySelectorAll(".loading").forEach(el => el.classList.remove("hidden"));
  showSkipped([]);

  const tasks = [
    runSignals(state),
    runOverview(state),
    runFrontier(state),
    runBacktest(state),
    runRebal(state),
    runSector(state),
    runRisk(state),
    runMonteCarlo(state),
  ];
  await Promise.allSettled(tasks);
}

async function runOverview(state) {
  setLoading("overview-loading", true);
  try {
    const r = await api("/analytics", state);
    cache.analytics = r.data;
    renderMetrics(r.data.metrics);
    renderCumChart(r.data.dates, r.data.cumulative_returns);
    renderCorrChart(r.data.correlation);
    document.getElementById("overview-insight").textContent = r.insight;
    showSkipped(r.data.skipped);
  } catch (e) { showError("Overview: " + e.message); }
  finally { setLoading("overview-loading", false); }
}

async function runFrontier(state) {
  setLoading("frontier-loading", true);
  try {
    const r = await api("/optimize", state);
    renderFrontier(r.data);
    document.getElementById("frontier-insight").textContent = r.insight;
  } catch (e) { showError("Frontier: " + e.message); }
  finally { setLoading("frontier-loading", false); }
}

async function runBacktest(state) {
  setLoading("backtest-loading", true);
  try {
    const r = await api("/backtest", state);
    cache.backtest = r.data;
    renderBacktest(r.data);
    document.getElementById("backtest-insight").textContent = r.insight;
  } catch (e) { showError("Backtest: " + e.message); }
  finally { setLoading("backtest-loading", false); }
}

async function runMonteCarlo(state) {
  setLoading("mc-loading", true);
  try {
    const horizon = Number(document.getElementById("horizon").value) || 1;
    const r = await api("/simulate", { ...state, horizon_years: horizon });
    renderMonteCarlo(r.data);
    document.getElementById("mc-insight").textContent = r.insight;
  } catch (e) { showError("Monte Carlo: " + e.message); }
  finally { setLoading("mc-loading", false); }
}

async function runRebal(state) {
  setLoading("rebal-loading", true);
  try {
    const freq = document.getElementById("rebal-freq").value;
    const r = await api("/rebalance", { ...state, frequency: freq });
    renderRebal(r.data);
    document.getElementById("rebal-insight").textContent = r.insight;
  } catch (e) { showError("Rebalance: " + e.message); }
  finally { setLoading("rebal-loading", false); }
}

async function runSector(state) {
  setLoading("sector-loading", true);
  try {
    const r = await api("/sector", state);
    renderSector(r.data);
    document.getElementById("sector-insight").textContent = r.insight;
  } catch (e) { showError("Sector: " + e.message); }
  finally { setLoading("sector-loading", false); }
}

async function runRisk(state) {
  setLoading("risk-loading", true);
  try {
    const r = await api("/riskscore", state);
    renderRiskScore(r.data);
    document.getElementById("risk-insight").textContent = r.insight;
  } catch (e) { showError("Risk: " + e.message); }
  finally { setLoading("risk-loading", false); }
}

// ============ Trade Signals ============
async function runSignals(state) {
  setLoading("signals-loading", true);
  try {
    const r = await api("/signals", state);
    cache.signals = r.data;
    renderSignals(r.data);
    document.getElementById("signals-insight").textContent = r.insight;
  } catch (e) { showError("Signals: " + e.message); }
  finally { setLoading("signals-loading", false); }
}

function verdictClass(v) {
  return v === "BUY" ? "v-buy" : v === "SELL" ? "v-sell" : "v-hold";
}
function fmtMoney(v) { return "$" + v.toFixed(2); }
function fmtPct(v, signed = true) {
  const s = (signed && v > 0 ? "+" : "") + v.toFixed(1) + "%";
  return s;
}
function pctClass(v) { return v > 0 ? "pos" : v < 0 ? "neg" : ""; }

function renderSignals(d) {
  cache.meta = d.meta || {};
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("signals-asof").innerHTML =
    `<span class="asof-pill">DATA ${d.as_of}</span> <span class="asof-pill asof-live">RECOMPUTED ${today}</span>`;

  // Summary chips
  const s = d.summary;
  const total = s.buy + s.hold + s.sell;
  document.getElementById("signals-summary").innerHTML = `
    <div class="sig-chip sig-buy"><div class="sig-chip-num">${s.buy}</div><div class="sig-chip-lbl">BUY signals</div></div>
    <div class="sig-chip sig-hold"><div class="sig-chip-num">${s.hold}</div><div class="sig-chip-lbl">HOLD</div></div>
    <div class="sig-chip sig-sell"><div class="sig-chip-num">${s.sell}</div><div class="sig-chip-lbl">SELL signals</div></div>
    <div class="sig-chip sig-total"><div class="sig-chip-num">${total}</div><div class="sig-chip-lbl">tickers analyzed</div></div>
  `;

  // Top trade idea cards (top 3 by abs score, but show all if <=4)
  const cards = d.ranked.slice(0, Math.min(4, d.ranked.length));
  document.getElementById("signals-cards").innerHTML = cards.map(t => {
    const lev = t.levels;
    const fc = t.forecast;
    const meter = Math.max(2, Math.abs(t.score));
    const m = (cache.meta && cache.meta[t.ticker]) || { name: t.ticker, exchange: "", domain: "" };
    const logo = hasLogo({ ...m, symbol: t.ticker }) ? `<img src="${logoUrl(m.domain, t.ticker)}" alt="" onload="this.previousElementSibling.style.display='none';this.parentElement.classList.add('has-logo');" onerror="this.style.display='none'">` : "";
    return `
      <div class="sig-card ${verdictClass(t.verdict)}">
        <div class="sig-card-head">
          <div class="sig-card-id">
            <span class="sig-card-logo" style="${tileStyle(t.ticker)}"><span class="sig-card-logo-fb">${tickerInitial(t.ticker)}</span>${logo}</span>
            <div>
              <div class="sig-card-ticker">${t.ticker} <span class="sig-card-ex ex-${(m.exchange||'').toLowerCase()}">${m.exchange || ""}</span></div>
              <div class="sig-card-name">${m.name || ""}</div>
              <div class="sig-card-price">${fmtMoney(t.price)}</div>
            </div>
          </div>
          <div class="sig-card-verdict ${verdictClass(t.verdict)}">
            ${t.verdict}
            <div class="sig-card-score">score ${t.score >= 0 ? "+" : ""}${t.score.toFixed(0)}</div>
          </div>
        </div>
        <div class="sig-meter"><div class="sig-meter-fill ${verdictClass(t.verdict)}" style="width:${meter}%"></div></div>
        <div class="sig-card-grid">
          <div><span>RSI</span><b>${t.rsi.toFixed(0)}</b></div>
          <div><span>Z-score</span><b>${t.zscore >= 0 ? "+" : ""}${t.zscore.toFixed(2)}σ</b></div>
          <div><span>1M momentum</span><b class="${pctClass(t.momentum_1m)}">${fmtPct(t.momentum_1m)}</b></div>
          <div><span>3M momentum</span><b class="${pctClass(t.momentum_3m)}">${fmtPct(t.momentum_3m)}</b></div>
          <div><span>50/200 MA</span><b>${t.ma_cross.state === "n/a" ? "—" : t.ma_cross.state.toUpperCase()}</b></div>
          <div><span>Vol regime</span><b>${t.vol_regime.regime}</b></div>
        </div>
        <div class="sig-rationale">
          ${t.rationale.length ? t.rationale.map(r => `<div>• ${r}</div>`).join("") : "<div class='muted'>• Mixed/neutral signals — no edge detected</div>"}
        </div>
        <div class="sig-trade-plan">
          <div class="sig-trade-head">
            <span class="sig-direction sig-dir-${lev.direction}">${(lev.direction || "").toUpperCase()}</span>
            <span class="sig-conviction sig-conv-${lev.conviction}">${(lev.conviction || "low")} conviction</span>
            <span class="sig-horizon">${lev.horizon_days}-day horizon</span>
          </div>
          <div class="sig-levels">
            <div class="lvl"><span>Entry zone</span><b>${fmtMoney(lev.entry_lo)} – ${fmtMoney(lev.entry_hi)}</b></div>
            <div class="lvl lvl-stop"><span>Stop loss</span><b>${fmtMoney(lev.stop_loss)}</b><i>−${fmtMoney(lev.risk_per_share)}/sh</i></div>
            <div class="lvl lvl-target"><span>Target 1</span><b>${fmtMoney(lev.target_1)}</b><i>${lev.risk_reward.toFixed(2)}× R</i></div>
            <div class="lvl lvl-target"><span>Target 2</span><b>${fmtMoney(lev.target_2)}</b><i>${lev.risk_reward_t2.toFixed(2)}× R</i></div>
          </div>
          <div class="sig-sizing">
            <span>Position sizing (1% of $100k account)</span>
            <b>${lev.shares_1pct_risk.toLocaleString()} shares</b>
            <span class="sig-sizing-sub">≈ ${fmtMoney(lev.notional)} notional · ${lev.notional_pct.toFixed(1)}% of capital</span>
          </div>
        </div>
        <div class="sig-forecast">
          21-day GBM forecast: <b class="${pctClass(fc.expected_return_pct)}">${fmtPct(fc.expected_return_pct)}</b>
          &nbsp;·&nbsp; 90% range <b>${fmtMoney(fc.p5)} → ${fmtMoney(fc.p95)}</b>
        </div>
      </div>
    `;
  }).join("");

  // Full matrix table
  const rows = d.ranked.map(t => {
    const m = (cache.meta && cache.meta[t.ticker]) || {};
    const logo = hasLogo({ ...m, symbol: t.ticker }) ? `<img src="${logoUrl(m.domain, t.ticker)}" class="t-row-logo" onload="this.previousElementSibling.style.display='none';this.parentElement.classList.add('has-logo');" onerror="this.style.display='none'">` : "";
    return `
    <tr class="${verdictClass(t.verdict)}-row">
      <td class="t-tk"><span class="t-row-logo-wrap" style="${tileStyle(t.ticker)}"><span class="t-row-logo-fb">${tickerInitial(t.ticker)}</span>${logo}</span>${t.ticker}</td>
      <td>${fmtMoney(t.price)}</td>
      <td><span class="t-verdict ${verdictClass(t.verdict)}">${t.verdict}</span></td>
      <td>${t.score >= 0 ? "+" : ""}${t.score.toFixed(0)}</td>
      <td>${t.rsi.toFixed(0)}</td>
      <td>${t.zscore >= 0 ? "+" : ""}${t.zscore.toFixed(2)}</td>
      <td class="${pctClass(t.momentum_1m)}">${fmtPct(t.momentum_1m)}</td>
      <td class="${pctClass(t.momentum_3m)}">${fmtPct(t.momentum_3m)}</td>
      <td>${t.ma_cross.state === "n/a" ? "—" : t.ma_cross.state}</td>
      <td>${t.vol_regime.short_vol.toFixed(0)}% (${t.vol_regime.regime})</td>
      <td class="${pctClass(t.forecast.expected_return_pct)}">${fmtPct(t.forecast.expected_return_pct)}</td>
    </tr>
  `;}).join("");
  document.getElementById("signals-table").innerHTML = `
    <table class="sig-table">
      <thead><tr>
        <th>Ticker</th><th>Price</th><th>Verdict</th><th>Score</th>
        <th>RSI</th><th>Z-score</th><th>1M</th><th>3M</th>
        <th>MA 50/200</th><th>20d Vol</th><th>21d Forecast</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Pairs
  const pairEl = document.getElementById("signals-pair");
  if (!d.pair) {
    pairEl.innerHTML = `<div class="pair-empty">No correlated pair (ρ ≥ 0.5) found among these tickers — pairs trading needs at least two highly co-moving stocks.</div>`;
  } else {
    const p = d.pair;
    const actionClass = p.action === "wait" ? "v-hold" : "v-buy";
    pairEl.innerHTML = `
      <div class="pair-head">
        <div>
          <div class="pair-name">${p.ticker_a} ↔ ${p.ticker_b}</div>
          <div class="pair-meta">ρ = ${p.correlation.toFixed(2)} &nbsp;·&nbsp; hedge ratio β = ${p.hedge_ratio.toFixed(2)} &nbsp;·&nbsp; spread z = ${p.spread_z >= 0 ? "+" : ""}${p.spread_z.toFixed(2)}σ</div>
        </div>
        <div class="pair-signal ${actionClass}">${p.signal}</div>
      </div>
      <div id="pair-chart" style="height:280px;margin-top:8px;"></div>
      <div class="pair-explain">
        Pairs trading bets that two co-moving stocks revert toward their long-run spread. When the spread is &gt; 1.5σ from its 60-day mean, the model flags a mean-reversion trade: short the over-performer, long the under-performer, and unwind when the spread returns to zero.
      </div>
    `;
    // Spread chart
    const spread = p.spread_series;
    const dates = p.spread_dates;
    Plotly.newPlot("pair-chart", [
      { x: dates, y: spread, type: "scatter", mode: "lines", name: "Spread", line: { color: "#4cc2ff", width: 2 } },
      { x: dates, y: dates.map(_ => p.spread_mean), type: "scatter", mode: "lines", name: "Mean", line: { color: "#a5aec3", dash: "dot" } },
      { x: dates, y: dates.map(_ => p.z_upper), type: "scatter", mode: "lines", name: "+1.5σ", line: { color: "#ef4444", dash: "dash" } },
      { x: dates, y: dates.map(_ => p.z_lower), type: "scatter", mode: "lines", name: "-1.5σ", line: { color: "#3ddc97", dash: "dash" } },
    ], {
      ...PLOTLY_LAYOUT_DEFAULTS,
      height: 280,
      margin: { l: 50, r: 16, t: 8, b: 60 },
      xaxis: { ...AXIS_DEFAULTS, type: "category", nticks: 6, tickangle: 0 },
      yaxis: { ...AXIS_DEFAULTS, type: "linear", title: { text: "log spread", font: { family: FONT_FAMILY, size: 11, color: "#a5aec3" } } },
      showlegend: true,
      legend: { ...PLOTLY_LAYOUT_DEFAULTS.legend, orientation: "h", y: -0.22 },
    }, PLOTLY_CONFIG);
  }
}

// CSV export
function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export-overview").addEventListener("click", () => {
  if (!cache.analytics) return showError("Run analytics first.");
  const d = cache.analytics;
  const rows = [["Metric", "Value"]];
  Object.entries(d.metrics).forEach(([k, v]) => rows.push([k, v]));
  rows.push([]);
  rows.push(["Date", "Cumulative Return", "Daily Return"]);
  d.dates.forEach((dt, i) => rows.push([dt, d.cumulative_returns[i], d.daily_returns[i]]));
  downloadCsv("analytics.csv", rows);
});

document.getElementById("export-backtest").addEventListener("click", () => {
  if (!cache.backtest) return showError("Run backtest first.");
  const d = cache.backtest;
  const rows = [["Metric", "Portfolio", "Benchmark"]];
  Object.entries(d.portfolio_metrics).forEach(([k, v]) =>
    rows.push([k, v, d.benchmark_metrics ? d.benchmark_metrics[k] : ""])
  );
  rows.push([]);
  rows.push(["Date", "Portfolio Cum", "Benchmark Cum"]);
  d.dates.forEach((dt, i) =>
    rows.push([dt, d.portfolio_cumulative[i], d.benchmark_available ? d.benchmark_cumulative[i] : ""])
  );
  downloadCsv("backtest.csv", rows);
});

// Wire buttons
document.getElementById("run-btn").addEventListener("click", runAll);
document.getElementById("run-mc").addEventListener("click", () => runMonteCarlo(getState()));
document.getElementById("run-rebal").addEventListener("click", () => runRebal(getState()));

// Auto-run on load
runAll();
