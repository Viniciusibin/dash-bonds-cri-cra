/* ═══════════════════════════════════════════════
   BTG Pactual — Monitor de Renda Fixa
   Frontend application
   ═══════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  deb: {
    rows: [], filtered: [], dates: [], currentDate: null,
    sortCol: null, sortDir: 1, search: "", indexFilter: "",
  },
  cri: {
    rows: [], filtered: [], dates: [], currentDate: null,
    sortCol: null, sortDir: 1, search: "", indexFilter: "",
  },
};

let charts = { taxa: null, pupar: null };

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setHeaderDate();
  setupTabs();
  setupUploads();
  setupModal();
  loadAll();
});

function setHeaderDate() {
  const el = document.getElementById("headerDate");
  if (el) {
    el.textContent = new Date().toLocaleDateString("pt-BR", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".tab-content").forEach(s =>
    s.classList.toggle("active", s.id === `tab-${tab}`)
  );
}

// ── File uploads ──────────────────────────────────────────────────────────────
function setupUploads() {
  document.getElementById("deb-file-input").addEventListener("change", e => {
    uploadFiles("/api/debentures/upload", e.target.files, "deb");
    e.target.value = "";
  });
  document.getElementById("cri-file-input").addEventListener("change", e => {
    uploadFiles("/api/cricra/upload", e.target.files, "cri");
    e.target.value = "";
  });
}

async function uploadFiles(url, files, type) {
  if (!files || !files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("file", f);

  showToast("Processando arquivo…", "info");
  try {
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Erro ao processar arquivo", "error");
      return;
    }
    const loaded = data.loaded || [];
    const total = loaded.reduce((s, x) => s + x.count, 0);
    showToast(`✓ ${total} títulos carregados`, "success");
    if (type === "deb") loadDeb();
    else loadCri();
  } catch (err) {
    showToast("Erro de conexão", "error");
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────
function loadAll() {
  loadDeb();
  loadCri();
}

async function loadDeb(date) {
  const url = date ? `/api/debentures?date=${date}` : "/api/debentures";
  try {
    const res = await fetch(url);
    const data = await res.json();
    state.deb.rows = data.rows || [];
    state.deb.dates = data.dates || [];
    state.deb.currentDate = data.date;
    renderDebStats();
    renderDateSelect("deb-date-select", state.deb.dates, state.deb.currentDate, d => loadDeb(d));
    applyFilters("deb");
  } catch (err) {
    setSubtitle("deb-ref-date", "Erro ao carregar dados");
  }
}

async function loadCri(date) {
  const url = date ? `/api/cricra?date=${date}` : "/api/cricra";
  try {
    const res = await fetch(url);
    const data = await res.json();
    state.cri.rows = data.rows || [];
    state.cri.dates = data.dates || [];
    state.cri.currentDate = data.date;
    renderCriStats();
    renderDateSelect("cri-date-select", state.cri.dates, state.cri.currentDate, d => loadCri(d));
    applyFilters("cri");
  } catch (err) {
    setSubtitle("cri-ref-date", "Erro ao carregar dados");
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderDebStats() {
  const rows = state.deb.rows;
  const d = state.deb.currentDate;
  setSubtitle("deb-ref-date", d ? `Data de referência: ${fmtDateDisplay(d)}` : "Nenhum arquivo carregado");
  if (!rows.length) return;

  setText("deb-count", rows.length);
  setText("deb-hist-count", state.deb.dates.length);

  const rates = rows.map(r => r.taxaIndicativa).filter(v => v !== null);
  setText("deb-min-rate", rates.length ? fmtPct4(Math.min(...rates)) : "—");
  setText("deb-max-rate", rates.length ? fmtPct4(Math.max(...rates)) : "—");

  const durs = rows.map(r => r.duration).filter(v => v !== null);
  setText("deb-avg-dur", durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : "—");

  populateIndexFilter("deb-index-filter", rows, state.deb.indexFilter);
}

function renderCriStats() {
  const rows = state.cri.rows;
  const d = state.cri.currentDate;
  setSubtitle("cri-ref-date", d ? `Data de referência: ${fmtDateDisplay(d)}` : "Nenhum arquivo carregado");
  if (!rows.length) return;

  setText("cri-count", rows.length);
  setText("cri-hist-count", state.cri.dates.length);

  const rates = rows.map(r => r.taxaIndicativa).filter(v => v !== null);
  setText("cri-min-rate", rates.length ? fmtPct4(Math.min(...rates)) : "—");
  setText("cri-max-rate", rates.length ? fmtPct4(Math.max(...rates)) : "—");

  const durs = rows.map(r => r.duration).filter(v => v !== null);
  setText("cri-avg-dur", durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : "—");

  populateIndexFilter("cri-index-filter", rows, state.cri.indexFilter);
}

function populateIndexFilter(selectId, rows, current) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const opts = [...new Set(rows.map(r => r.indice).filter(Boolean))].sort();
  el.innerHTML =
    '<option value="">Todos os índices</option>' +
    opts.map(o => `<option value="${esc(o)}" ${current === o ? "selected" : ""}>${esc(o)}</option>`).join("");
}

// ── Date selector ─────────────────────────────────────────────────────────────
function renderDateSelect(selectId, dates, current, onChange) {
  const el = document.getElementById(selectId);
  if (!el) return;
  if (!dates.length) { el.innerHTML = ""; return; }
  el.innerHTML = dates.slice().reverse().map(d =>
    `<option value="${d}" ${d === current ? "selected" : ""}>${fmtDateDisplay(d)}</option>`
  ).join("");
  el.onchange = () => onChange(el.value);
}

// ── Filtering & sorting ───────────────────────────────────────────────────────
function setupTableEvents() {
  // Search
  const debSearch = document.getElementById("deb-search");
  const criSearch = document.getElementById("cri-search");
  if (debSearch) debSearch.addEventListener("input", e => { state.deb.search = e.target.value; applyFilters("deb"); });
  if (criSearch) criSearch.addEventListener("input", e => { state.cri.search = e.target.value; applyFilters("cri"); });

  // Index filter
  const debIdx = document.getElementById("deb-index-filter");
  const criIdx = document.getElementById("cri-index-filter");
  if (debIdx) debIdx.addEventListener("change", e => { state.deb.indexFilter = e.target.value; applyFilters("deb"); });
  if (criIdx) criIdx.addEventListener("change", e => { state.cri.indexFilter = e.target.value; applyFilters("cri"); });

  // Sort (header clicks)
  document.querySelectorAll("#deb-table thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => sortBy("deb", th.dataset.col));
  });
  document.querySelectorAll("#cri-table thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => sortBy("cri", th.dataset.col));
  });
}

function applyFilters(type) {
  const s = state[type];
  let rows = [...s.rows];

  if (s.search) {
    const q = s.search.toLowerCase();
    rows = rows.filter(r =>
      (r.codigo || "").toLowerCase().includes(q) ||
      (r.nome || r.riscoCredito || "").toLowerCase().includes(q) ||
      (r.emissor || "").toLowerCase().includes(q)
    );
  }

  if (s.indexFilter) {
    rows = rows.filter(r => r.indice === s.indexFilter);
  }

  if (s.sortCol) {
    rows.sort((a, b) => {
      let va = a[s.sortCol], vb = b[s.sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * s.sortDir;
      return (va - vb) * s.sortDir;
    });
  }

  s.filtered = rows;
  renderTable(type);
}

function sortBy(type, col) {
  const s = state[type];
  if (s.sortCol === col) s.sortDir *= -1;
  else { s.sortCol = col; s.sortDir = 1; }

  const tableId = type === "deb" ? "deb-table" : "cri-table";
  document.querySelectorAll(`#${tableId} thead th`).forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.col === col) {
      th.classList.add(s.sortDir === 1 ? "sort-asc" : "sort-desc");
    }
  });

  applyFilters(type);
}

// ── Table rendering ───────────────────────────────────────────────────────────
function renderTable(type) {
  const s = state[type];
  const tbodyId = type === "deb" ? "deb-tbody" : "cri-tbody";
  const countId = type === "deb" ? "deb-count-label" : "cri-count-label";
  const cols    = type === "deb" ? 10 : 12;
  const tbody   = document.getElementById(tbodyId);
  const countEl = document.getElementById(countId);

  if (countEl) {
    countEl.textContent = s.filtered.length
      ? `${s.filtered.length} título${s.filtered.length !== 1 ? "s" : ""}`
      : "";
  }

  if (!tbody) return;

  if (!s.filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}">${emptyState(type)}</td></tr>`;
    return;
  }

  tbody.innerHTML = s.filtered.map(row =>
    type === "deb" ? renderDebRow(row) : renderCriRow(row)
  ).join("");

  // Row click → modal
  tbody.querySelectorAll("tr").forEach((tr, i) => {
    tr.addEventListener("click", () => openModal(type, s.filtered[i]));
  });
}

function emptyState(type) {
  const isLoaded = state[type].rows.length > 0;
  const fileLabel = type === "deb" ? "XLS" : "CSV";
  const inputId   = type === "deb" ? "deb-file-input" : "cri-file-input";

  if (isLoaded) {
    return `<div class="empty-state"><p>Nenhum resultado encontrado para os filtros aplicados.</p></div>`;
  }
  return `<div class="empty-state">
    <span class="empty-icon">📊</span>
    <h3>Nenhum dado carregado</h3>
    <p>Carregue um arquivo ${fileLabel} para começar</p>
    <label class="btn btn-primary" for="${inputId}" style="cursor:pointer;display:inline-flex;align-items:center;gap:7px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Carregar ${fileLabel}
    </label>
  </div>`;
}

function renderDebRow(row) {
  return `<tr>
    <td><span class="code-tag">${esc(row.codigo)}</span></td>
    <td class="name-cell" title="${esc(row.nome)}">${esc(row.nome) || nullCell()}</td>
    <td>${esc(row.vencimento) || nullCell()}</td>
    <td>${indexBadge(row.indice)}</td>
    <td class="num">${fmtRate(row.taxaCompra)}</td>
    <td class="num">${fmtRate(row.taxaVenda)}</td>
    <td class="num rate-val">${fmtRate(row.taxaIndicativa)}</td>
    <td class="num">${fmtPU(row.pu)}</td>
    <td class="num">${fmtPct2(row.puPar)}</td>
    <td class="num">${fmtDur(row.duration)}</td>
  </tr>`;
}

function renderCriRow(row) {
  return `<tr>
    <td><span class="code-tag">${esc(row.codigo)}</span></td>
    <td class="name-cell" title="${esc(row.riscoCredito)}">${esc(row.riscoCredito) || nullCell()}</td>
    <td class="emissor-cell" title="${esc(row.emissor)}">${esc(row.emissor) || nullCell()}</td>
    <td>${esc(row.vencimento) || nullCell()}</td>
    <td>${indexBadge(row.indice)}</td>
    <td class="num">${fmtRate(row.taxaCompra)}</td>
    <td class="num">${fmtRate(row.taxaVenda)}</td>
    <td class="num rate-val">${fmtRate(row.taxaIndicativa)}</td>
    <td class="num">${fmtRate(row.desvioPadrao)}</td>
    <td class="num">${fmtPU(row.pu)}</td>
    <td class="num">${fmtPct2(row.puPar)}</td>
    <td class="num">${fmtDur(row.duration)}</td>
  </tr>`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function setupModal() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

async function openModal(type, row) {
  const overlay = document.getElementById("modal-overlay");
  const isCri = type === "cri";

  // Header
  document.getElementById("modal-code").textContent = row.codigo;
  document.getElementById("modal-name").textContent = isCri
    ? (row.riscoCredito || row.codigo)
    : (row.nome || row.codigo);
  document.getElementById("modal-meta").textContent = isCri
    ? (row.emissor ? `Emissor: ${row.emissor}` : "")
    : (row.sheet ? `Categoria: ${row.sheet.replace(/_/g, " ")}` : "");

  // Stats grid
  const stats = isCri ? [
    { label: "Código",             value: row.codigo },
    { label: "Vencimento",         value: row.vencimento || "—" },
    { label: "Índice / Correção",  value: row.indice || "—" },
    { label: "Taxa Compra",        value: fmtRate(row.taxaCompra, true) },
    { label: "Taxa Venda",         value: fmtRate(row.taxaVenda, true) },
    { label: "Taxa Indicativa",    value: fmtRate(row.taxaIndicativa, true), highlight: true },
    { label: "Desvio Padrão",      value: fmtRate(row.desvioPadrao, true) },
    { label: "PU",                 value: fmtPU(row.pu, true) },
    { label: "% PU Par / % VNE",   value: fmtPct2(row.puPar, true), highlight: true },
    { label: "Duration",           value: fmtDur(row.duration, true) },
  ] : [
    { label: "Código",             value: row.codigo },
    { label: "Repac. / Venc.",     value: row.vencimento || "—" },
    { label: "Índice / Correção",  value: row.indice || "—" },
    { label: "Taxa Compra",        value: fmtRate(row.taxaCompra, true) },
    { label: "Taxa Venda",         value: fmtRate(row.taxaVenda, true) },
    { label: "Taxa Indicativa",    value: fmtRate(row.taxaIndicativa, true), highlight: true },
    { label: "PU",                 value: fmtPU(row.pu, true) },
    { label: "% PU Par",           value: fmtPct2(row.puPar, true), highlight: true },
    { label: "Duration",           value: fmtDur(row.duration, true) },
  ];

  document.getElementById("modal-grid").innerHTML = stats.map(s =>
    `<div class="modal-stat">
      <div class="modal-stat-label">${esc(s.label)}</div>
      <div class="modal-stat-value${s.highlight ? " highlight" : ""}">${s.value}</div>
    </div>`
  ).join("");

  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Fetch history
  const histUrl = isCri
    ? `/api/cricra/history/${encodeURIComponent(row.codigo)}`
    : `/api/debentures/history/${encodeURIComponent(row.codigo)}`;

  try {
    const res = await fetch(histUrl);
    const hist = await res.json();
    renderCharts(hist);
  } catch {
    renderCharts([]);
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
  destroyCharts();
}

function destroyCharts() {
  if (charts.taxa)  { charts.taxa.destroy();  charts.taxa  = null; }
  if (charts.pupar) { charts.pupar.destroy(); charts.pupar = null; }
}

function renderCharts(hist) {
  destroyCharts();

  const labels  = hist.map(p => fmtDateDisplay(p.date));
  const taxaData  = hist.map(p => p.taxaIndicativa);
  const puParData = hist.map(p => p.puPar);

  const hasValidTaxa  = taxaData.some(v => v !== null);
  const hasValidPuPar = puParData.some(v => v !== null);

  // Taxa chart
  const taxaNoData = document.getElementById("chart-taxa-nodata");
  const taxaCanvas = document.getElementById("chart-taxa");
  if (hasValidTaxa && hist.length > 1) {
    taxaNoData.style.display = "none";
    taxaCanvas.style.display = "block";
    charts.taxa = buildLineChart("chart-taxa", labels, taxaData, "Taxa Indicativa", "#003087");
  } else {
    taxaNoData.style.display = "flex";
    taxaCanvas.style.display = "none";
  }

  // PU Par chart
  const puParNoData = document.getElementById("chart-pupar-nodata");
  const puParCanvas = document.getElementById("chart-pupar");
  if (hasValidPuPar && hist.length > 1) {
    puParNoData.style.display = "none";
    puParCanvas.style.display = "block";
    charts.pupar = buildLineChart("chart-pupar", labels, puParData, "% PU Par", "#C9A227");
  } else {
    puParNoData.style.display = "flex";
    puParCanvas.style.display = "none";
  }
}

function buildLineChart(canvasId, labels, data, label, color) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: color,
        backgroundColor: color + "18",
        borderWidth: 2,
        pointRadius: data.length > 12 ? 2 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        fill: true,
        tension: 0.3,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw;
              return v !== null ? `${label}: ${v.toFixed(4)}%` : "—";
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxTicksLimit: 6, color: "#9CA3AF" },
        },
        y: {
          grid: { color: "#F3F4F6" },
          ticks: {
            font: { size: 10 },
            color: "#9CA3AF",
            callback: v => v.toFixed(2) + "%",
          },
        },
      },
    },
  });
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function nullCell() { return '<span class="null-val">—</span>'; }

function fmtRate(val, plain = false) {
  if (val === null || val === undefined) return plain ? "—" : nullCell();
  return val.toFixed(4) + "%";
}

function fmtPct4(val) {
  return val !== null ? val.toFixed(4) + "%" : "—";
}

function fmtPct2(val, plain = false) {
  if (val === null || val === undefined) return plain ? "—" : nullCell();
  return val.toFixed(2) + "%";
}

function fmtPU(val, plain = false) {
  if (val === null || val === undefined) return plain ? "—" : nullCell();
  return "R$ " + val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function fmtDur(val, plain = false) {
  if (val === null || val === undefined) return plain ? "—" : nullCell();
  return val.toFixed(2);
}

function fmtDateDisplay(key) {
  if (!key) return "—";
  const parts = key.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return key;
}

function indexBadge(indice) {
  if (!indice) return nullCell();
  const low = indice.toLowerCase();
  let cls = "badge-default";
  if (low.includes("ipca"))  cls = "badge-ipca";
  else if (low.includes("igp")) cls = "badge-igpm";
  else if (low.includes("prefixado") || /^\d/.test(low)) cls = "badge-prefix";
  else if (low.includes("di") || low.includes("% do di") || low.includes("di +")) cls = "badge-di";
  return `<span class="index-badge ${cls}">${esc(indice)}</span>`;
}

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 3200);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? "—";
}

function setSubtitle(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || "";
}

// ── Wire up after DOM is ready (table events need IDs to exist) ───────────────
document.addEventListener("DOMContentLoaded", setupTableEvents);
