// Quant Portfolio Lab - frontend
const PLOTLY_LAYOUT_DEFAULTS = {
  paper_bgcolor: "#131722",
  plot_bgcolor: "#131722",
  font: { color: "#d6dde9", family: "Inter, -apple-system, sans-serif", size: 12 },
  margin: { t: 30, r: 20, b: 40, l: 50 },
  xaxis: { gridcolor: "#232a3b", zerolinecolor: "#232a3b" },
  yaxis: { gridcolor: "#232a3b", zerolinecolor: "#232a3b" },
};
const PLOTLY_CONFIG = { displaylogo: false, responsive: true };

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
const cache = { analytics: null, backtest: null };

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
    risk_free_rate: Number(document.getElementById("rf").value),
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
    line: { color: "#4cc2ff", width: 2 },
    fill: "tozeroy",
    fillcolor: "rgba(76,194,255,0.1)",
    name: "Cumulative %",
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: { text: "Cumulative Return (%)", font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, ticksuffix: "%" },
  }, PLOTLY_CONFIG);
}

function renderCorrChart(corr) {
  Plotly.newPlot("corrchart", [{
    z: corr.matrix,
    x: corr.labels,
    y: corr.labels,
    type: "heatmap",
    colorscale: [[0, "#ff5c8a"], [0.5, "#1a2030"], [1, "#3ddc97"]],
    zmin: -1, zmax: 1,
    text: corr.matrix.map(r => r.map(v => v.toFixed(2))),
    texttemplate: "%{text}",
    textfont: { size: 11 },
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: { text: "Correlation Matrix", font: { size: 13 } },
    xaxis: { ...PLOTLY_LAYOUT_DEFAULTS.xaxis, type: "category" },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, type: "category" },
  }, PLOTLY_CONFIG);
}

function renderFrontier(d) {
  const traces = [{
    x: d.vols.map(v => v * 100),
    y: d.returns.map(v => v * 100),
    mode: "markers",
    type: "scattergl",
    marker: {
      size: 5,
      color: d.sharpe,
      colorscale: "Viridis",
      showscale: true,
      colorbar: { title: "Sharpe", titleside: "right" },
    },
    name: "Portfolios",
    hovertemplate: "Vol: %{x:.2f}%<br>Return: %{y:.2f}%<extra></extra>",
  }, {
    x: [d.max_sharpe.vol * 100],
    y: [d.max_sharpe.return * 100],
    mode: "markers",
    type: "scatter",
    marker: { size: 16, color: "#3ddc97", symbol: "star", line: { color: "#fff", width: 1 } },
    name: "Max Sharpe",
  }, {
    x: [d.min_vol.vol * 100],
    y: [d.min_vol.return * 100],
    mode: "markers",
    type: "scatter",
    marker: { size: 16, color: "#ffb547", symbol: "diamond", line: { color: "#fff", width: 1 } },
    name: "Min Vol",
  }];
  Plotly.newPlot("frontier-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 480,
    title: { text: "Efficient Frontier (5,000 portfolios)", font: { size: 13 } },
    xaxis: { ...PLOTLY_LAYOUT_DEFAULTS.xaxis, title: "Annualized Volatility (%)" },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, title: "Annualized Return (%)" },
    legend: { orientation: "h", y: -0.15 },
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
    line: { color: "#4cc2ff", width: 2 },
    name: "Portfolio",
  }];
  if (d.benchmark_available) {
    traces.push({
      x: d.dates,
      y: d.benchmark_cumulative.map(v => v * 100),
      mode: "lines",
      line: { color: "#ffb547", width: 2, dash: "dash" },
      name: "S&P 500",
    });
  }
  Plotly.newPlot("backtest-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: { text: "Cumulative Returns", font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, ticksuffix: "%" },
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
  d.sample_paths.forEach(p => {
    traces.push({
      x: days, y: p, mode: "lines", line: { color: "rgba(76,194,255,0.07)", width: 1 },
      showlegend: false, hoverinfo: "skip",
    });
  });
  traces.push({ x: days, y: d.p95, mode: "lines", line: { color: "#3ddc97", width: 2, dash: "dash" }, name: "95th %" });
  traces.push({ x: days, y: d.p50, mode: "lines", line: { color: "#4cc2ff", width: 2 }, name: "Median" });
  traces.push({ x: days, y: d.p5, mode: "lines", line: { color: "#ff5c8a", width: 2, dash: "dash" }, name: "5th %" });

  Plotly.newPlot("mc-chart", traces, {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 400,
    title: { text: `Monte Carlo: ${d.n_paths} paths, ${d.horizon_years.toFixed(1)}yr horizon ($10k start)`, font: { size: 13 } },
    xaxis: { ...PLOTLY_LAYOUT_DEFAULTS.xaxis, title: "Trading Day" },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, title: "Portfolio Value ($)" },
  }, PLOTLY_CONFIG);

  Plotly.newPlot("mc-hist", [{
    x: d.final_distribution,
    type: "histogram",
    marker: { color: "#7c5cff" },
    nbinsx: 50,
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 300,
    title: { text: `Final Value Distribution (median $${d.median_final.toLocaleString(undefined, {maximumFractionDigits: 0})})`, font: { size: 13 } },
    xaxis: { ...PLOTLY_LAYOUT_DEFAULTS.xaxis, title: "Ending Value ($)" },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, title: "Frequency" },
  }, PLOTLY_CONFIG);
}

function renderRebal(d) {
  Plotly.newPlot("rebal-chart", [
    {
      x: d.dates, y: d.drift_cumulative.map(v => v * 100),
      mode: "lines", name: "Drift", line: { color: "#ffb547", width: 2 },
    },
    {
      x: d.dates, y: d.rebal_cumulative.map(v => v * 100),
      mode: "lines", name: `Rebalanced (${d.frequency})`, line: { color: "#4cc2ff", width: 2 },
    },
  ], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: { text: "Rebalanced vs Drift", font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, ticksuffix: "%" },
  }, PLOTLY_CONFIG);

  function weightTraces(weights) {
    return d.tickers.map((t, i) => ({
      x: d.dates,
      y: weights.map(row => row[i] * 100),
      type: "scatter", mode: "lines", stackgroup: "one", name: t,
    }));
  }
  Plotly.newPlot("drift-weights-chart", weightTraces(d.drift_weights), {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: { text: "Weight Drift (no rebalance)", font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, ticksuffix: "%" },
  }, PLOTLY_CONFIG);
  Plotly.newPlot("rebal-weights-chart", weightTraces(d.rebal_weights), {
    ...PLOTLY_LAYOUT_DEFAULTS,
    title: { text: `Weights with ${d.frequency} rebalance`, font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, ticksuffix: "%" },
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
  const values = labels.map(k => d.sectors[k]);
  Plotly.newPlot("sector-pie", [{
    labels, values, type: "pie",
    textinfo: "label+percent",
    marker: { colors: ["#4cc2ff", "#7c5cff", "#3ddc97", "#ffb547", "#ff5c8a", "#76ddff", "#a87aff", "#5fe6b0"] },
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: { text: "Sector Allocation", font: { size: 13 } },
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
    title: { text: d.user.label, font: { size: 16 } },
    gauge: {
      axis: { range: [0, 100], tickcolor: "#8a93a6" },
      bar: { color: "#4cc2ff" },
      bgcolor: "#1a2030",
      steps: [
        { range: [0, 20], color: "#1f3a2e" },
        { range: [20, 40], color: "#1f4a3a" },
        { range: [40, 60], color: "#3a3a1f" },
        { range: [60, 80], color: "#4a2f1f" },
        { range: [80, 100], color: "#4a1f2a" },
      ],
    },
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
  }, PLOTLY_CONFIG);

  Plotly.newPlot("risk-compare", [{
    x: ["Your Portfolio", "Max Sharpe", "Min Vol"],
    y: [d.user.score, d.max_sharpe.score, d.min_vol.score],
    type: "bar",
    marker: { color: ["#4cc2ff", "#3ddc97", "#ffb547"] },
    text: [d.user.label, d.max_sharpe.label, d.min_vol.label],
    textposition: "outside",
  }], {
    ...PLOTLY_LAYOUT_DEFAULTS,
    height: 380,
    title: { text: "QPL Risk Comparison", font: { size: 13 } },
    yaxis: { ...PLOTLY_LAYOUT_DEFAULTS.yaxis, range: [0, 110], title: "Score" },
  }, PLOTLY_CONFIG);
}

// ============ Runners ============
async function runAll() {
  const state = getState();
  if (!state.tickers.length) return showError("Enter at least one ticker.");
  document.querySelectorAll(".loading").forEach(el => el.classList.remove("hidden"));
  showSkipped([]);

  const tasks = [
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
