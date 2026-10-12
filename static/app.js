"use strict";

/* GitHub Insights Dashboard -- front-end logic.
 * Vanilla JS + anime.js for motion. Two views share one create/edit modal.
 * Repositories are paginated (PAGE_SIZE per page) with a numbered pager. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const PAGE_SIZE = 8;

const state = {
  account: "vercel", data: null, editingId: null, modalItem: null,
  charts: {}, priority: "Medium",
  page: 1, filtered: [],
};

/* ---------------- tab switching + sliding indicator ---------------- */
function moveIndicator() {
  const active = $(".tab.active");
  const ind = $("#tabIndicator");
  if (!active || !ind) return;
  ind.style.width = active.offsetWidth + "px";
  ind.style.transform = `translateX(${active.offsetLeft - 5}px)`;
}
$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.remove("active"));
    $$(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");
    moveIndicator();
    runReveals();
    if (btn.dataset.tab === "saved") loadSaved();
  });
});
window.addEventListener("resize", moveIndicator);

/* ---------------- reveal-on-render ---------------- */
function runReveals() {
  const items = $$(".view.active .reveal:not(.in)");
  items.forEach((el, i) => setTimeout(() => el.classList.add("in"), 60 * i));
}

/* ---------------- dashboard: fetch + render ---------------- */
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.account = $("#account").value.trim() || "vercel";
  loadDashboard();
});
$("#refreshBtn").addEventListener("click", () => {
  $("#refreshBtn").classList.add("spin");
  loadDashboard().finally(() => setTimeout(() => $("#refreshBtn").classList.remove("spin"), 600));
});
$("#retryBtn").addEventListener("click", loadDashboard);

function showState(which) {
  $("#loading").classList.toggle("hidden", which !== "loading");
  $("#error").classList.toggle("hidden", which !== "error");
  $("#content").classList.toggle("hidden", which !== "content");
}

async function loadDashboard() {
  showState("loading");
  $("#dataMeta").textContent = "";
  try {
    const res = await fetch(`/api/github/${encodeURIComponent(state.account)}`);
    const body = await res.json();
    if (!res.ok) { $("#errorMsg").textContent = body.error || "Something went wrong."; showState("error"); return; }
    state.data = body; state.page = 1;
    renderDashboard(body);
    showState("content");
    $("#dataMeta").textContent =
      `Showing @${body.account} · ${body.metrics.repos} repositories · refreshed ${new Date().toLocaleTimeString()}`;
  } catch {
    $("#errorMsg").textContent = "Could not load data. Is the server running?";
    showState("error");
  }
}

function renderDashboard(d) {
  renderKpis(d.metrics);
  renderInsightBanner(d.insights);
  renderStarsChart(d.top_repos);
  renderLangChart(d.languages);
  state.filtered = d.repos;
  $("#repoTotal").textContent = d.repos.length;
  renderRepoPage(1);
  // re-arm reveals for freshly injected cards
  $$("#content .reveal").forEach((el) => el.classList.remove("in"));
  requestAnimationFrame(runReveals);
}

/* ---- KPI tiles with count-up ---- */
function renderKpis(m) {
  const tiles = [
    ["Repositories", m.repos, "📦", 0],
    ["Total stars", m.stars, "★", 0],
    ["Total forks", m.forks, "⑂", 0],
    ["Open issues", m.open_issues, "◎", 0],
    ["Avg stars / repo", m.avg_stars, "μ", 1],
  ];
  $("#kpis").innerHTML = tiles.map(([label, val, icon], i) => `
    <div class="kpi" data-i="${i}">
      <div class="k-label"><span class="k-icon">${icon}</span>${label}</div>
      <div class="k-value" data-target="${val}" data-dec="${tiles[i][3]}">0</div>
    </div>`).join("");
  // pointer-tracking glow
  $$(".kpi").forEach((k) => k.addEventListener("pointermove", (e) => {
    const r = k.getBoundingClientRect();
    k.style.setProperty("--mx", `${e.clientX - r.left}px`);
  }));
  countUp();
  if (window.anime) anime({ targets: ".kpi", translateY: [18, 0], opacity: [0, 1], delay: anime.stagger(70), duration: 600, easing: "easeOutCubic" });
}

function countUp() {
  $$(".k-value").forEach((el) => {
    const target = parseFloat(el.dataset.target), dec = +el.dataset.dec;
    const obj = { v: 0 };
    if (window.anime) {
      anime({ targets: obj, v: target, duration: 1100, easing: "easeOutExpo",
        update: () => { el.textContent = dec ? obj.v.toFixed(1) : Math.round(obj.v).toLocaleString(); } });
    } else {
      el.textContent = dec ? target.toFixed(1) : target.toLocaleString();
    }
  });
}

function renderInsightBanner(ins) {
  const items = [
    ["Most starred", ins.top_repo ? `${ins.top_repo.split("/").pop()} · ${ins.top_repo_stars.toLocaleString()}★` : "—"],
    ["Primary language", ins.top_language || "—"],
    ["Languages used", ins.language_count],
    ["Most recently pushed", ins.most_recent ? `${ins.most_recent} · ${fmtDate(ins.most_recent_at)}` : "—"],
  ];
  $("#insightBanner").innerHTML = items.map(([l, v]) =>
    `<div class="ib"><div class="ib-label">${l}</div><div class="ib-value">${v}</div></div>`).join("");
  if (window.anime) anime({ targets: ".ib", scale: [.95, 1], opacity: [0, 1], delay: anime.stagger(70, { start: 150 }), duration: 550, easing: "easeOutCubic" });
}

const CHART_COLORS = ["#e85a4f","#d8c3a5","#8e8d8a","#e98074","#c08a52","#b5533f","#a9a7a0","#efb28a","#6f6e6b","#cf9f6a"];
const AXIS_COLOR = "#8e8d8a";
const GRID_COLOR = "rgba(42,40,36,.10)";

function renderStarsChart(top) {
  state.charts.stars?.destroy();
  state.charts.stars = new Chart($("#starsChart"), {
    type: "bar",
    data: { labels: top.map((r) => r.name),
      datasets: [{ label: "Stars", data: top.map((r) => r.stars),
        backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0,0,0,220); g.addColorStop(0,"#e85a4f"); g.addColorStop(1,"#e98074"); return g; },
        borderRadius: 3, borderSkipped: false }] },
    options: { animation: { duration: 900, easing: "easeOutQuart" },
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: AXIS_COLOR, maxRotation: 40, minRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } } } },
  });
}

function renderLangChart(langs) {
  state.charts.lang?.destroy();
  const labels = Object.keys(langs), values = Object.values(langs);
  state.charts.lang = new Chart($("#langChart"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, cutout: "62%",
      backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      borderColor: "#f3f0e7", borderWidth: 3, hoverOffset: 8 }] },
    options: { animation: { animateRotate: true, duration: 1000, easing: "easeOutCubic" },
      plugins: { legend: { position: "right", labels: { color: "#55524c", boxWidth: 11, padding: 8, font: { size: 11 } } } } },
  });
}

/* ---- paginated repository table ---- */
$("#repoFilter").addEventListener("input", () => {
  const f = $("#repoFilter").value.toLowerCase();
  state.filtered = state.data.repos.filter((r) =>
    !f || r.name.toLowerCase().includes(f) || (r.language || "").toLowerCase().includes(f));
  $("#repoTotal").textContent = state.filtered.length;
  renderRepoPage(1);
});

function renderRepoPage(page) {
  const rows = state.filtered;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);
  const body = $("#repoTable tbody");

  body.innerHTML = slice.map((r, i) => `
    <tr class="row-anim" style="animation-delay:${i * 45}ms">
      <td class="rank"><span class="rnum ${start + i < 3 ? "top3" : ""}">${start + i + 1}</span></td>
      <td class="repo-name">
        <a href="${r.url}" target="_blank" rel="noopener">${r.name}</a>
        ${r.description ? `<div class="repo-desc">${escapeHtml(r.description)}</div>` : ""}
      </td>
      <td class="num">${r.stars.toLocaleString()}</td>
      <td class="num">${r.forks.toLocaleString()}</td>
      <td class="num">${r.issues.toLocaleString()}</td>
      <td><span class="lang-dot" style="background:${langColor(r.language)}"></span>${r.language}</td>
      <td>${fmtDate(r.updated_at)}</td>
      <td><button class="btn tiny primary" data-note='${enc({ name: r.full_name, url: r.url })}'>+ Note</button></td>
    </tr>`).join("") || `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:30px">No repositories match that filter.</td></tr>`;

  body.querySelectorAll("[data-note]").forEach((b) =>
    b.addEventListener("click", () => openModal(JSON.parse(decodeURIComponent(b.dataset.note)))));
  renderPager(pages);
}

function renderPager(pages) {
  if (pages <= 1) { $("#pager").innerHTML = ""; return; }
  const cur = state.page;
  const nums = pageNumbers(cur, pages);
  let html = `<button ${cur === 1 ? "disabled" : ""} data-go="${cur - 1}">‹</button>`;
  nums.forEach((n) => {
    html += n === "…" ? `<span class="ellip">…</span>`
      : `<button class="${n === cur ? "active" : ""}" data-go="${n}">${n}</button>`;
  });
  html += `<button ${cur === pages ? "disabled" : ""} data-go="${cur + 1}">›</button>`;
  $("#pager").innerHTML = html;
  $$("#pager [data-go]").forEach((b) => b.addEventListener("click", () => {
    renderRepoPage(+b.dataset.go);
    document.querySelector("#repoTable").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
}

function pageNumbers(cur, total) {
  const out = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= cur - 1 && i <= cur + 1)) out.push(i);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

/* ---------------- modal: create / edit ---------------- */
$$("#priPick button").forEach((b) => b.addEventListener("click", () => {
  $$("#priPick button").forEach((x) => x.classList.remove("on"));
  b.classList.add("on"); state.priority = b.dataset.v;
}));

function openModal(item, existing = null) {
  state.modalItem = item; state.editingId = existing ? existing.id : null;
  state.priority = existing ? existing.priority : "Medium";
  $("#modalTitle").textContent = existing ? "Edit insight" : "Add insight";
  $("#modalItem").textContent = item.name;
  $("#noteInput").value = existing ? existing.note : "";
  $$("#priPick button").forEach((x) => x.classList.toggle("on", x.dataset.v === state.priority));
  $("#modalError").classList.add("hidden");
  $("#modal").classList.remove("hidden");
  setTimeout(() => $("#noteInput").focus(), 50);
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#cancelModal").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

$("#saveModal").addEventListener("click", async () => {
  const note = $("#noteInput").value.trim();
  if (!note) { showModalError("Please write a note."); return; }
  try {
    let res;
    if (state.editingId) {
      res = await fetch(`/api/insights/${state.editingId}`, { method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, priority: state.priority }) });
    } else {
      res = await fetch("/api/insights", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_name: state.modalItem.name, item_url: state.modalItem.url, note, priority: state.priority }) });
    }
    const body = await res.json();
    if (!res.ok) { showModalError(body.error || "Could not save."); return; }
    closeModal();
    toast(state.editingId ? "Insight updated" : "Insight saved");
    refreshSavedCount();
    if ($("#saved").classList.contains("active")) loadSaved();
  } catch { showModalError("Network error while saving."); }
});
function showModalError(m) { const el = $("#modalError"); el.textContent = m; el.classList.remove("hidden"); }

/* ---------------- saved insights ---------------- */
["filterPriority", "sortOrder", "insightSearch"].forEach((id) => $("#" + id).addEventListener("input", loadSaved));

async function loadSaved() {
  const p = new URLSearchParams();
  const pri = $("#filterPriority").value; if (pri) p.set("priority", pri);
  const q = $("#insightSearch").value.trim(); if (q) p.set("q", q);
  p.set("order", $("#sortOrder").value);
  const res = await fetch("/api/insights?" + p.toString());
  const body = await res.json();
  const list = body.insights || [];
  $("#savedCount").textContent = body.stats.total;
  const s = body.stats.by_priority;
  $("#savedStats").textContent = `${body.stats.total} saved · ${s.High} high · ${s.Medium} medium · ${s.Low} low`;
  $("#savedEmpty").classList.toggle("hidden", list.length > 0);
  $("#savedList").innerHTML = list.map(renderInsightCard).join("");
  $$("#savedList [data-edit]").forEach((b) => b.addEventListener("click", () => {
    const i = JSON.parse(decodeURIComponent(b.dataset.edit));
    openModal({ name: i.item_name, url: i.item_url }, i);
  }));
  $$("#savedList [data-del]").forEach((b) => b.addEventListener("click", () => deleteInsight(+b.dataset.del)));
  if (window.anime && list.length) anime({ targets: "#savedList .insight-card", translateY: [16, 0], opacity: [0, 1], delay: anime.stagger(55), duration: 500, easing: "easeOutCubic" });
}

function renderInsightCard(i) {
  const edited = i.updated_at ? ` · edited ${fmtDateTime(i.updated_at)}` : "";
  return `<article class="insight-card">
    <div class="stripe ${i.priority}"></div>
    <div>
      <div class="i-item">${i.item_url ? `<a href="${i.item_url}" target="_blank" rel="noopener">${escapeHtml(i.item_name)}</a>` : escapeHtml(i.item_name)}</div>
      <p class="i-note">${escapeHtml(i.note)}</p>
      <div class="i-meta"><span class="badge ${i.priority}">${i.priority}</span><span>saved ${fmtDateTime(i.created_at)}${edited}</span></div>
    </div>
    <div class="i-actions">
      <button class="btn tiny" data-edit='${enc(i)}'>Edit</button>
      <button class="btn tiny danger" data-del="${i.id}">Delete</button>
    </div></article>`;
}

async function deleteInsight(id) {
  if (!confirm("Delete this insight?")) return;
  const res = await fetch(`/api/insights/${id}`, { method: "DELETE" });
  if (res.ok) { toast("Insight deleted"); loadSaved(); refreshSavedCount(); } else toast("Could not delete");
}

async function refreshSavedCount() {
  try { const r = await fetch("/api/insights"); const b = await r.json(); $("#savedCount").textContent = b.stats.total; } catch {}
}

/* ---------------- helpers ---------------- */
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function enc(o) { return encodeURIComponent(JSON.stringify(o)); }
function langColor(lang) {
  let h = 0; for (const c of String(lang)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}
let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.classList.add("hidden"), 300); }, 2400);
}

/* ---------------- boot ---------------- */
window.addEventListener("load", () => { moveIndicator(); runReveals(); });
loadDashboard();
refreshSavedCount();
