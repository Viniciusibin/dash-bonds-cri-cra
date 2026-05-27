const DETAIL = window.__DEBENTURE_DETAIL__ || {};
const DETAIL_ROW = DETAIL.row || null;
const DETAIL_COLORS = {
  darkNavy: "#04122A",
  primaryBlue: "#0B2859",
  mediumBlue: "#103F8C",
  standardBlue: "#1959B4",
  brightBlue: "#3079E0",
  lightBlue: "#539CFF",
  lighterBlue: "#6BA9FE",
  paleBlue: "#D1E5FF",
  skyBlue: "#B1D2FE",
  white: "#FFFFFF",
};

const detailCharts = {};
const detailTooltipEl = document.createElement("div");
detailTooltipEl.className = "chart-html-tooltip";
document.body.appendChild(detailTooltipEl);

document.addEventListener("DOMContentLoaded", () => {
  setHeaderDate();
  if (!DETAIL_ROW) {
    showToast("Debênture não encontrada", "error");
    return;
  }
  renderHeader();
  renderMarketGrid();
  setupSectionTabs();
  loadAllDetailData();
});

function setHeaderDate() {
  const el = document.getElementById("headerDate");
  if (el) {
    el.textContent = new Date().toLocaleDateString("pt-BR", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }
}

function renderHeader() {
  document.getElementById("detail-code").textContent = DETAIL_ROW.codigo || "—";
  document.getElementById("detail-category").textContent = (DETAIL_ROW.sheet || "Debênture").replace(/_/g, " ").toUpperCase();
  document.getElementById("detail-name").textContent = DETAIL_ROW.nome || DETAIL_ROW.codigo || "Debênture";
  document.getElementById("detail-meta").textContent = "Debênture listada no mercado secundário";
}

function renderMarketGrid() {
  const stats = [
    { label: "Código", value: DETAIL_ROW.codigo, copyable: true, mono: true },
    { label: "Repac. / Venc.", value: DETAIL_ROW.vencimento || "—" },
    { label: "Índice / Correção", value: DETAIL_ROW.indice || "—", badge: "index" },
    { label: "Taxa Compra", value: fmtRate(DETAIL_ROW.taxaCompra), mono: true },
    { label: "Taxa Venda", value: fmtRate(DETAIL_ROW.taxaVenda), mono: true },
    { label: "Taxa Indicativa", value: fmtRate(DETAIL_ROW.taxaIndicativa), mono: true, emphasis: true },
    { label: "PU", value: fmtMoneyPrecise(DETAIL_ROW.pu), mono: true },
    { label: "% PU Par", value: fmtPercent(DETAIL_ROW.puPar), mono: true, emphasis: true, arcValue: DETAIL_ROW.puPar },
    { label: "Duration", value: fmtNumber(DETAIL_ROW.duration), mono: true },
  ];
  document.getElementById("detail-market-grid").innerHTML = renderStatsGrid(stats);
  bindCopyActions(document.getElementById("detail-market-grid"));
}

function setupSectionTabs() {
  const tabs = [...document.querySelectorAll(".detail-page-tab")];
  const sections = tabs.map(tab => document.getElementById(tab.dataset.scrollTarget)).filter(Boolean);
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const section = document.getElementById(tab.dataset.scrollTarget);
      if (!section) return;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.scrollTarget === visible.target.id));
  }, { rootMargin: "-120px 0px -60% 0px", threshold: [0.15, 0.35, 0.6] });

  sections.forEach(section => observer.observe(section));
}

async function loadAllDetailData() {
  await Promise.all([loadHistory(), loadCvmDetails()]);
}

async function loadHistory() {
  try {
    const res = await fetch(`/api/debentures/history/${encodeURIComponent(DETAIL.codigo)}`);
    const history = await res.json();
    renderMarketHistory(history || []);
  } catch {
    renderMarketHistory([]);
  }
}

async function loadCvmDetails() {
  const statusEl = document.getElementById("detail-cvm-status");
  statusEl.textContent = `Consultando CVM para: ${DETAIL_ROW.nome || DETAIL_ROW.codigo}`;
  document.getElementById("detail-cvm-company-grid").innerHTML = buildPlaceholderStats(6);
  document.getElementById("detail-cvm-financial-grid").innerHTML = buildPlaceholderStats(10);
  try {
    const res = await fetch(`/api/cvm/resolve?name=${encodeURIComponent(DETAIL_ROW.nome || "")}&year=2025`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao consultar CVM");
    renderCvmSnapshot(data);
    await loadCvmHistory(data.company?.cd_cvm);
  } catch (err) {
    statusEl.textContent = err.message || "Erro ao consultar CVM.";
    document.getElementById("detail-cvm-company-grid").innerHTML = "";
    document.getElementById("detail-cvm-financial-grid").innerHTML = "";
    renderFinancialHistory([]);
  }
}

function renderCvmSnapshot(data) {
  const company = data.company || {};
  const fin = data.financials || {};
  document.getElementById("detail-cvm-status").textContent = company.denom_social
    ? `Companhia encontrada na CVM: ${company.denom_social}`
    : "Companhia localizada sem detalhes adicionais.";

  const companyStats = [
    { label: "Razão Social", value: company.denom_social || "—" },
    { label: "Nome Comercial", value: company.denom_comercial || "—" },
    { label: "CNPJ", value: company.cnpj || "—", mono: true, copyable: !!company.cnpj },
    { label: "Código CVM", value: company.cd_cvm || "—", mono: true, copyable: !!company.cd_cvm },
    { label: "Setor", value: company.setor_atividade || "—" },
    { label: "Situação", value: company.situacao || "—" },
  ];

  const financialStats = [
    { label: "Ano DFP", value: fin.year || "—", mono: true },
    { label: "Data Referência", value: fmtDateDisplay(fin.dt_refer) },
    { label: "Data Entrega CVM", value: fmtDateDisplay(fin.dt_receb) },
    { label: "Versão DFP", value: fin.versao || "—", mono: true },
    { label: "Caixa", value: fmtMoney(fin.cash), mono: true, signValue: fin.cash },
    { label: "Dívida Curto Prazo", value: fmtMoney(fin.current_debt), mono: true, signValue: fin.current_debt },
    { label: "Dívida Longo Prazo", value: fmtMoney(fin.non_current_debt), mono: true, signValue: fin.non_current_debt },
    { label: "Dívida Bruta", value: fmtMoney(fin.gross_debt), mono: true, emphasis: true, signValue: fin.gross_debt },
    { label: "Dívida Líquida", value: fmtMoney(fin.net_debt), mono: true, emphasis: true, signValue: fin.net_debt },
    { label: "EBITDA Proxy", value: fmtMoney(fin.ebitda_proxy), mono: true, emphasis: true, signValue: fin.ebitda_proxy },
  ];

  document.getElementById("detail-cvm-company-grid").innerHTML = renderStatsGrid(companyStats);
  document.getElementById("detail-cvm-financial-grid").innerHTML = renderStatsGrid(financialStats);
  bindCopyActions(document.getElementById("detail-cvm-company-grid"));
}

async function loadCvmHistory(identifier) {
  if (!identifier) {
    renderFinancialHistory([]);
    return;
  }
  try {
    const res = await fetch(`/api/cvm/history/${encodeURIComponent(identifier)}?year_end=2025&years=5`);
    const data = await res.json();
    if (!res.ok) throw new Error("Histórico CVM indisponível");
    renderFinancialHistory(data.history || []);
  } catch {
    renderFinancialHistory([]);
  }
}

function renderMarketHistory(history) {
  const labels = history.map(item => fmtDateDisplay(item.date));
  updateSubtitle("detail-chart-taxa-subtitle", buildHistorySubtitle(history, "pregões"));
  updateSubtitle("detail-chart-pupar-subtitle", buildHistorySubtitle(history, "pregões"));
  buildSingleSeriesChart({
    canvasId: "detail-chart-taxa",
    emptyId: "detail-chart-taxa-empty",
    legendId: "detail-chart-taxa-legend",
    labels,
    data: history.map(item => item.taxaIndicativa),
    datasetLabel: "Taxa Indicativa",
    color: DETAIL_COLORS.brightBlue,
    format: "percent",
  });
  buildSingleSeriesChart({
    canvasId: "detail-chart-pupar",
    emptyId: "detail-chart-pupar-empty",
    legendId: "detail-chart-pupar-legend",
    labels,
    data: history.map(item => item.puPar),
    datasetLabel: "% PU Par",
    color: DETAIL_COLORS.lightBlue,
    format: "percent",
  });
}

function renderFinancialHistory(history) {
  const yearLabel = buildYearSubtitle(history);
  updateSubtitle("detail-chart-debt-subtitle", yearLabel);
  updateSubtitle("detail-chart-leverage-subtitle", yearLabel);
  updateSubtitle("detail-chart-coverage-subtitle", yearLabel);
  updateSubtitle("detail-chart-earnings-subtitle", yearLabel);
  const labels = history.map(item => String(item.year || ""));

  buildMultiSeriesChart({
    canvasId: "detail-chart-debt",
    emptyId: "detail-chart-debt-empty",
    legendId: "detail-chart-debt-legend",
    labels,
    format: "moneyCompact",
    datasets: [
      { label: "Dívida Bruta", color: DETAIL_COLORS.brightBlue, data: history.map(item => item.gross_debt), borderWidth: 2.5, borderDash: [], pointStyle: "circle" },
      { label: "Dívida Líquida", color: DETAIL_COLORS.skyBlue, data: history.map(item => item.net_debt), borderWidth: 2, borderDash: [6, 4], pointStyle: "triangle" },
      { label: "Caixa", color: DETAIL_COLORS.lightBlue, data: history.map(item => item.cash), borderWidth: 2, borderDash: [2, 4], pointStyle: "rect" },
    ],
  });

  buildMultiSeriesChart({
    canvasId: "detail-chart-leverage",
    emptyId: "detail-chart-leverage-empty",
    legendId: "detail-chart-leverage-legend",
    labels,
    format: "multiple",
    datasets: [
      { label: "ND / EBITDA", color: DETAIL_COLORS.brightBlue, data: history.map(item => item.nd_ebitda), borderWidth: 2.5, borderDash: [], pointStyle: "circle" },
      { label: "Caixa / Dívida CP", color: DETAIL_COLORS.skyBlue, data: history.map(item => item.cash_short_term_debt_coverage), borderWidth: 2, borderDash: [6, 4], pointStyle: "triangle" },
      { label: "Dívida Bruta / PL", color: DETAIL_COLORS.lighterBlue, data: history.map(item => item.debt_to_equity), borderWidth: 2, borderDash: [2, 4], pointStyle: "rect" },
    ],
  });

  buildMultiSeriesChart({
    canvasId: "detail-chart-coverage",
    emptyId: "detail-chart-coverage-empty",
    legendId: "detail-chart-coverage-legend",
    labels,
    format: "multiple",
    datasets: [
      { label: "EBIT / Desp. Fin.", color: DETAIL_COLORS.brightBlue, data: history.map(item => item.ebit_interest_coverage), borderWidth: 2.5, borderDash: [], pointStyle: "circle" },
      { label: "EBITDA / Desp. Fin.", color: DETAIL_COLORS.skyBlue, data: history.map(item => item.ebitda_interest_coverage), borderWidth: 2, borderDash: [6, 4], pointStyle: "triangle" },
    ],
  });

  buildMultiSeriesChart({
    canvasId: "detail-chart-earnings",
    emptyId: "detail-chart-earnings-empty",
    legendId: "detail-chart-earnings-legend",
    labels,
    format: "moneyCompact",
    datasets: [
      { label: "Receita Líquida", color: DETAIL_COLORS.brightBlue, data: history.map(item => item.revenue), borderWidth: 2.5, borderDash: [], pointStyle: "circle" },
      { label: "EBITDA Proxy", color: DETAIL_COLORS.skyBlue, data: history.map(item => item.ebitda_proxy), borderWidth: 2, borderDash: [6, 4], pointStyle: "triangle" },
      { label: "Lucro Líquido", color: DETAIL_COLORS.lighterBlue, data: history.map(item => item.net_income), borderWidth: 2, borderDash: [2, 4], pointStyle: "rect" },
    ],
  });
}

function buildSingleSeriesChart(config) {
  destroyChart(config.canvasId);
  const hasData = config.data.some(value => value !== null && value !== undefined) && config.data.length > 1;
  setChartVisibility(config.canvasId, config.emptyId, config.legendId, hasData);
  if (!hasData) return;

  const ctx = document.getElementById(config.canvasId).getContext("2d");
  const gradient = buildGradient(ctx, config.color);
  const dataset = {
    label: config.datasetLabel,
    data: config.data,
    borderColor: config.color,
    backgroundColor: gradient,
    fill: true,
    borderWidth: 2.5,
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 6,
    pointHitRadius: 16,
    pointBorderWidth: 2,
    pointBackgroundColor: config.color,
    pointBorderColor: DETAIL_COLORS.darkNavy,
  };
  detailCharts[config.canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels: config.labels, datasets: [dataset] },
    options: buildChartOptions(config.format),
    plugins: [createHoverPlugin()],
  });
  renderLegend(config.legendId, config.canvasId, [dataset]);
}

function buildMultiSeriesChart(config) {
  destroyChart(config.canvasId);
  const hasData = config.datasets.some(dataset => dataset.data.some(value => value !== null && value !== undefined)) && config.labels.length > 1;
  setChartVisibility(config.canvasId, config.emptyId, config.legendId, hasData);
  if (!hasData) return;

  const ctx = document.getElementById(config.canvasId).getContext("2d");
  const datasets = config.datasets.map(series => ({
    label: series.label,
    data: series.data,
    borderColor: series.color,
    btgBaseColor: series.color,
    backgroundColor: series.color,
    fill: false,
    borderWidth: series.borderWidth ?? 2.5,
    btgBaseBorderWidth: series.borderWidth ?? 2.5,
    borderDash: series.borderDash ?? [],
    btgBaseBorderDash: series.borderDash ?? [],
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 6,
    pointHitRadius: 16,
    pointBorderWidth: 2,
    pointBackgroundColor: series.color,
    pointBorderColor: DETAIL_COLORS.darkNavy,
    pointStyle: series.pointStyle ?? "circle",
  }));

  detailCharts[config.canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels: config.labels, datasets },
    options: buildChartOptions(config.format),
    plugins: [createHoverPlugin()],
  });
  renderLegend(config.legendId, config.canvasId, datasets);
}

function buildChartOptions(format) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation: { duration: 220 },
    layout: { padding: { top: 16, bottom: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: false,
        external: context => externalTooltipHandler(context, format),
      },
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false },
        border: { display: false },
        ticks: {
          color: DETAIL_COLORS.skyBlue,
          font: { family: "Calibri, Inter, sans-serif", size: 12 },
          maxTicksLimit: 6,
          autoSkip: true,
        },
      },
      y: {
        grid: { color: "rgba(16,63,140,0.6)", drawBorder: false },
        border: { display: false },
        ticks: {
          color: DETAIL_COLORS.skyBlue,
          font: { family: "Calibri, Inter, sans-serif", size: 12 },
          padding: 12,
          callback: value => formatAxisValue(value, format),
        },
      },
    },
  };
}

function createHoverPlugin() {
  return {
    id: "btgHover",
    afterEvent(chart, args) {
      const active = chart.getActiveElements();
      const activeDataset = active.length ? active[0].datasetIndex : null;
      chart.data.datasets.forEach((dataset, index) => {
        const baseColor = dataset.btgBaseColor || normalizeColor(dataset.borderColor, dataset.borderColor);
        const baseWidth = dataset.btgBaseBorderWidth ?? 2.5;
        dataset.borderWidth = activeDataset === index ? Math.max(3.5, baseWidth) : baseWidth;
        dataset.pointRadius = 0;
        dataset.pointHoverRadius = 6;
        dataset.borderColor = withOpacity(baseColor, activeDataset === null || activeDataset === index ? 1 : 0.15);
        dataset.pointBackgroundColor = withOpacity(baseColor, activeDataset === null || activeDataset === index ? 1 : 0.15);
        dataset.backgroundColor = dataset.fill ? buildGradient(chart.ctx, baseColor) : baseColor;
      });
      chart.draw();
    },
  };
}

function externalTooltipHandler(context, format) {
  const { chart, tooltip } = context;
  if (tooltip.opacity === 0) {
    detailTooltipEl.classList.remove("visible");
    return;
  }

  const title = tooltip.title?.[0] || "";
  const body = tooltip.dataPoints.map(point => {
    const color = point.dataset.borderColor;
    const label = point.dataset.label;
    const value = formatTooltipValue(point.raw, format);
    return `<div class="chart-html-tooltip-row"><span class="chart-html-tooltip-key"><span class="chart-html-tooltip-swatch" style="background:${normalizeColor(color, color)}"></span>${label}</span><strong>${value}</strong></div>`;
  }).join("");

  detailTooltipEl.innerHTML = `<div class="chart-html-tooltip-date">${title}</div>${body}`;
  detailTooltipEl.classList.add("visible");

  const rect = chart.canvas.getBoundingClientRect();
  detailTooltipEl.style.left = `${window.scrollX + rect.left + tooltip.caretX + 16}px`;
  detailTooltipEl.style.top = `${window.scrollY + rect.top + tooltip.caretY - detailTooltipEl.offsetHeight - 18}px`;
}

function renderLegend(legendId, canvasId, datasets) {
  const legend = document.getElementById(legendId);
  if (!legend) return;
  legend.innerHTML = datasets.map((dataset, index) => `
    <button class="chart-legend-item" type="button" data-canvas="${canvasId}" data-index="${index}">
      <span class="chart-legend-line">${renderLegendLineSvg(dataset)}</span>
      <span class="chart-legend-name">${dataset.label}</span>
    </button>
  `).join("");

  legend.querySelectorAll(".chart-legend-item").forEach(button => {
    button.addEventListener("mouseenter", () => setLegendHover(canvasId, Number(button.dataset.index)));
    button.addEventListener("mouseleave", () => setLegendHover(canvasId, null));
    button.addEventListener("click", () => toggleDataset(canvasId, Number(button.dataset.index), button));
  });
}

function setLegendHover(canvasId, activeIndex) {
  const chart = detailCharts[canvasId];
  if (!chart) return;
  chart.data.datasets.forEach((dataset, index) => {
    const baseColor = dataset.btgBaseColor || normalizeColor(dataset.borderColor, dataset.borderColor);
    dataset.borderColor = withOpacity(baseColor, activeIndex === null || activeIndex === index ? 1 : 0.15);
    dataset.pointBackgroundColor = withOpacity(baseColor, activeIndex === null || activeIndex === index ? 1 : 0.15);
  });
  chart.update("none");
}

function toggleDataset(canvasId, datasetIndex, button) {
  const chart = detailCharts[canvasId];
  if (!chart) return;
  const meta = chart.getDatasetMeta(datasetIndex);
  meta.hidden = meta.hidden === null ? !chart.data.datasets[datasetIndex].hidden : null;
  button.classList.toggle("is-muted", !!meta.hidden);
  chart.update();
}

function setChartVisibility(canvasId, emptyId, legendId, visible) {
  const canvas = document.getElementById(canvasId);
  const empty = document.getElementById(emptyId);
  const legend = document.getElementById(legendId);
  canvas.style.display = visible ? "block" : "none";
  empty.style.display = visible ? "none" : "flex";
  legend.style.display = visible ? "flex" : "none";
}

function destroyChart(canvasId) {
  if (detailCharts[canvasId]) {
    detailCharts[canvasId].destroy();
    delete detailCharts[canvasId];
  }
}

function buildGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  const rgb = hexToRgb(normalizeColor(color, color));
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
  gradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10)`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  return gradient;
}

function renderLegendLineSvg(dataset) {
  const color = dataset.btgBaseColor || normalizeColor(dataset.borderColor, dataset.borderColor);
  const width = dataset.btgBaseBorderWidth ?? dataset.borderWidth ?? 2.5;
  const dash = (dataset.btgBaseBorderDash || dataset.borderDash || []).join(",");
  return `<svg width="28" height="3" viewBox="0 0 28 3" aria-hidden="true"><line x1="0" y1="1.5" x2="28" y2="1.5" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round"></line></svg>`;
}

function renderStatsGrid(stats) {
  return stats.map(stat => {
    const classes = ["modal-stat-value", stat.mono ? "mono" : "", stat.emphasis ? "highlight" : "", stat.signValue < 0 ? "is-negative" : "", stat.signValue > 0 ? "is-positive" : "", isMissing(stat.value) ? "is-missing" : ""].filter(Boolean).join(" ");
    const valueHtml = stat.badge === "index"
      ? `<span class="index-badge-btg">${esc(stat.value || "—")}</span>`
      : `<span class="${classes}">${esc(stat.value || "—")}</span>${typeof stat.arcValue === "number" ? renderMiniArc(stat.arcValue) : ""}`;
    return `<div class="modal-stat${stat.copyable ? " is-copyable" : ""}"><div class="modal-stat-label">${esc(stat.label)}</div><div class="modal-stat-row"><div class="modal-stat-content">${valueHtml}</div>${stat.copyable ? `<button class="copy-chip" type="button" data-copy="${escAttr(stat.value)}" aria-label="Copiar ${escAttr(stat.label)}">${copyIcon()}</button>` : ""}</div></div>`;
  }).join("");
}

function buildPlaceholderStats(count) {
  return Array.from({ length: count }, () => `<div class="modal-stat is-loading"><div class="modal-stat-label skeleton-line"></div><div class="modal-stat-row"><div class="modal-stat-content skeleton-line skeleton-value"></div></div></div>`).join("");
}

function bindCopyActions(container) {
  if (!container) return;
  container.querySelectorAll("[data-copy]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        showToast("Valor copiado", "success");
      } catch {
        showToast("Não foi possível copiar", "error");
      }
    });
  });
}

function fmtRate(value) { return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`; }
function fmtPercent(value) { return value === null || value === undefined ? "—" : `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; }
function fmtNumber(value) { return value === null || value === undefined ? "—" : Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtMoney(value) { return value === null || value === undefined ? "—" : `R$ ${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`; }
function fmtMoneyPrecise(value) { return value === null || value === undefined ? "—" : `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`; }
function fmtDateDisplay(value) { if (!value) return "—"; const parts = String(value).split("-"); return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value; }
function formatAxisValue(value, format) { if (format === "percent") return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`; if (format === "multiple") return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}x`; return compactMoney(value); }
function formatTooltipValue(value, format) { if (value === null || value === undefined) return "—"; if (format === "percent") return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; if (format === "multiple") return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`; return compactMoneyLong(value); }
function compactMoney(value) { const abs = Math.abs(Number(value) || 0); if (abs >= 1_000_000_000) return `R$ ${(value / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`; if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mi`; return `R$ ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`; }
function compactMoneyLong(value) { const abs = Math.abs(Number(value) || 0); if (abs >= 1_000_000_000) return `R$ ${(value / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`; if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mi`; return `R$ ${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`; }
function buildHistorySubtitle(history, label) { return history.length ? `Últimos ${history.length} ${label}` : "Sem histórico disponível"; }
function buildYearSubtitle(history) { if (!history.length) return "Sem histórico disponível"; return `Dados anuais ${history[0].year}–${history[history.length - 1].year}`; }
function updateSubtitle(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function renderMiniArc(value) { const clamped = Math.max(0, Math.min(100, Number(value) || 0)); const circumference = 43.98; const offset = circumference - (clamped / 100) * circumference; return `<span class="mini-arc" aria-hidden="true"><svg viewBox="0 0 20 20"><circle class="mini-arc-track" cx="10" cy="10" r="7"></circle><circle class="mini-arc-fill" cx="10" cy="10" r="7" style="stroke-dasharray:${circumference};stroke-dashoffset:${offset};"></circle></svg></span>`; }
function copyIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path></svg>`; }
function showToast(msg, type = "success") { const el = document.getElementById("toast"); if (!el) return; el.textContent = msg; el.className = `toast ${type} show`; clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 2600); }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escAttr(value) { return esc(value).replace(/'/g, "&#39;"); }
function isMissing(value) { return value === null || value === undefined || value === "" || value === "—"; }
function normalizeColor(value, fallback) { return typeof value === "string" && value.startsWith("rgba") ? rgbaToHex(value) : (value || fallback); }
function withOpacity(color, opacity) { const rgb = hexToRgb(normalizeColor(color, color)); return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`; }
function hexToRgb(hex) { const clean = hex.replace("#", ""); const bigint = parseInt(clean, 16); return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }; }
function rgbaToHex(rgba) { const parts = rgba.replace(/[^\d,]/g, "").split(",").map(Number); return `#${parts.slice(0, 3).map(part => part.toString(16).padStart(2, "0")).join("")}`; }
