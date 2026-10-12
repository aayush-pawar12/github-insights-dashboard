"use strict";

/* ------------------------------------------------------------------ *
 * GitHub Insights Dashboard -- front-end logic.
 * Plain ES modules, no framework. Two views (Dashboard / Saved) plus a
 * shared modal for creating & editing insights.
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  account: "vercel",
  data: null,          // last successful dashboard payload
  editingId: null,     // non-null when the modal is editing an existing insight
  modalItem: null,     // {name, url} currently being noted
  charts: {},          // Chart.js instances, so we can destroy before redraw
};

/* ---------------- tab switching ---------------- */
$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.remove("active"));
    $$(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "saved") loadSaved();
  });
});

/* ---------------- dashboard: fetch + render ---------------- */
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.account = $("#account").value.trim() || "vercel";
  loadDashboard();
});
$("#refreshBtn").addEventListener("click", loadDashboard);
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
    if (!res.ok) {                          // graceful error state
      $("#errorMsg").textContent = body.error || "Something went wrong.";
      showState("error");
      return;
    }
    state.data = body;
    renderDashboard(body);
    showState("content");
    $("#dataMeta").textContent =
      `${body.account} · ${body.metrics.repos} repos · updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $("#errorMsg").textContent = "Could not load data. Is the server running?";
    showState("error");
  }
}

function renderDashboard(d) {
  renderKpis(d.metrics);
  renderInsightBanner(d.insights);
  renderStarsChart(d.top_repos);
  renderLangChart(d.languages);
  renderRepoTable(d.repos);
}

function renderKpis(m) {
  const tiles = [
    ["Repositories", m.repos, "📦"],
    ["Total stars", m.stars.toLocaleString(), "★"],
    ["Total forks", m.forks.toLocaleString(), "⑂"],
    ["Open issues", m.open_issues.toLocaleString(), "◎"],
    ["Avg stars / repo", m.avg_stars.toLocaleString(), "μ"],
  ];
  $("#kpis").innerHTML = tiles.map(([label, val, icon]) => `
    <div class="kpi">
      <div class="k-label"><span class="k-icon">${icon}</span>${label}</div>
      <div class="k-value">${val}</div>
    </div>`).join("");
}

function renderInsightBanner(ins) {
  const items = [
    ["Most starred repo", ins.top_repo ? `${ins.top_repo} · ${ins.top_repo_stars.toLocaleString()}★` : "—"],
    ["Primary language", ins.top_language || "—"],
    ["Languages used", ins.language_count],
    ["Most recently pushed", ins.most_recent ? `${ins.most_recent} · ${fmtDate(ins.most_recent_at)}` : "—"],
  ];
  $("#insightBanner").innerHTML = items.map(([label, val]) => `
    <div class="ib"><div class="ib-label">${label}</div><div class="ib-value">${val}</div></div>
  `).join("");
}

const CHART_COLORS = ["#4f8cff","#7c5cff","#35d07f","#f0b429","#ff5c6c","#2bc4c4","#e06cff","#8aa0b8"];

function renderStarsChart(top) {
  const ctx = $("#starsChart");
  state.charts.stars?.destroy();
  state.charts.stars = new Chart(ctx, {
    type: "bar",
    data: {
      labels: top.map((r) => r.name),
      datasets: [{ label: "Stars", data: top.map((r) => r.stars),
        backgroundColor: "#4f8cff", borderRadius: 6 }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#2a3850" } },
      },
    },
  });
}

function renderLangChart(langs) {
  const ctx = $("#langChart");
  state.charts.lang?.destroy();
  const labels = Object.keys(langs), values = Object.values(langs);
  state.charts.lang = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values,
      backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      borderColor: "#182134", borderWidth: 2 }] },
    options: { plugins: { legend: { position: "right", labels: { color: "#cdd7e6", boxWidth: 12 } } } },
  });
}

function renderRepoTable(repos) {
  const body = $("#repoTable tbody");
  const filter = $("#repoFilter").value.toLowerCase();
  const rows = repos.filter((r) =>
    !filter || r.name.toLowerCase().includes(filter) ||
    (r.language || "").toLowerCase().includes(filter));
  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="repo-name">
        <a href="${r.url}" target="_blank" rel="noopener">${r.name}</a>
        ${r.description ? `<div class="repo-desc">${escapeHtml(r.description)}</div>` : ""}
      </td>
      <td class="num">${r.stars.toLocaleString()}</td>
      <td class="num">${r.forks.toLocaleString()}</td>
      <td class="num">${r.issues.toLocaleString()}</td>
      <td><span class="lang-dot"></span>${r.language}</td>
      <td>${fmtDate(r.updated_at)}</td>
      <td><button class="btn tiny primary" data-note='${encodeURIComponent(JSON.stringify({name: r.full_name, url: r.url}))}'>+ Note</button></td>
    </tr>`).join("");
  body.querySelectorAll("[data-note]").forEach((b) =>
    b.addEventListener("click", () => openModal(JSON.parse(decodeURIComponent(b.dataset.note)))));
}
$("#repoFilter").addEventListener("input", () => { if (state.data) renderRepoTable(state.data.repos); });

/* ---------------- modal: create / edit ---------------- */
function openModal(item, existing = null) {
  state.modalItem = item;
  state.editingId = existing ? existing.id : null;
  $("#modalTitle").textContent = existing ? "Edit insight" : "Add insight";
  $("#modalItem").textContent = item.name;
  $("#noteInput").value = existing ? existing.note : "";
  $("#priorityInput").value = existing ? existing.priority : "Medium";
  $("#modalError").classList.add("hidden");
  $("#modal").classList.remove("hidden");
  $("#noteInput").focus();
}
function closeModal() { $("#modal").classList.add("hidden"); }
$("#cancelModal").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

$("#saveModal").addEventListener("click", async () => {
  const note = $("#noteInput").value.trim();
  const priority = $("#priorityInput").value;
  if (!note) { showModalError("Please write a note."); return; }

  try {
    let res;
    if (state.editingId) {
      res = await fetch(`/api/insights/${state.editingId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, priority }) });
    } else {
      res = await fetch("/api/insights", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_name: state.modalItem.name, item_url: state.modalItem.url, note, priority }) });
    }
    const body = await res.json();
    if (!res.ok) { showModalError(body.error || "Could not save."); return; }
    closeModal();
    toast(state.editingId ? "Insight updated" : "Insight saved");
    refreshSavedCount();
    if ($("#saved").classList.contains("active")) loadSaved();
  } catch { showModalError("Network error while saving."); }
});
function showModalError(msg) { const el = $("#modalError"); el.textContent = msg; el.classList.remove("hidden"); }

/* ---------------- saved insights view ---------------- */
["filterPriority", "sortOrder", "insightSearch"].forEach((id) =>
  $("#" + id).addEventListener("input", loadSaved));

async function loadSaved() {
  const params = new URLSearchParams();
  const pri = $("#filterPriority").value; if (pri) params.set("priority", pri);
  const q = $("#insightSearch").value.trim(); if (q) params.set("q", q);
  params.set("order", $("#sortOrder").value);

  const res = await fetch("/api/insights?" + params.toString());
  const body = await res.json();
  const list = body.insights || [];
  $("#savedCount").textContent = body.stats.total;

  const s = body.stats.by_priority;
  $("#savedStats").textContent =
    `${body.stats.total} saved · ${s.High} high · ${s.Medium} medium · ${s.Low} low`;

  $("#savedEmpty").classList.toggle("hidden", list.length > 0);
  $("#savedList").innerHTML = list.map(renderInsightCard).join("");
  $$("#savedList [data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = JSON.parse(decodeURIComponent(b.dataset.edit));
      openModal({ name: i.item_name, url: i.item_url }, i);
    }));
  $$("#savedList [data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteInsight(Number(b.dataset.del))));
}

function renderInsightCard(i) {
  const edited = i.updated_at ? ` · edited ${fmtDateTime(i.updated_at)}` : "";
  return `
    <article class="insight-card">
      <div class="stripe ${i.priority}"></div>
      <div>
        <div class="i-item">${i.item_url
          ? `<a href="${i.item_url}" target="_blank" rel="noopener">${escapeHtml(i.item_name)}</a>`
          : escapeHtml(i.item_name)}</div>
        <p class="i-note">${escapeHtml(i.note)}</p>
        <div class="i-meta">
          <span class="badge ${i.priority}">${i.priority}</span>
          <span>saved ${fmtDateTime(i.created_at)}${edited}</span>
        </div>
      </div>
      <div class="i-actions">
        <button class="btn tiny" data-edit='${encodeURIComponent(JSON.stringify(i))}'>Edit</button>
        <button class="btn tiny danger" data-del="${i.id}">Delete</button>
      </div>
    </article>`;
}

async function deleteInsight(id) {
  if (!confirm("Delete this insight?")) return;
  const res = await fetch(`/api/insights/${id}`, { method: "DELETE" });
  if (res.ok) { toast("Insight deleted"); loadSaved(); refreshSavedCount(); }
  else toast("Could not delete");
}

async function refreshSavedCount() {
  try {
    const res = await fetch("/api/insights");
    const body = await res.json();
    $("#savedCount").textContent = body.stats.total;
  } catch { /* ignore */ }
}

/* ---------------- helpers ---------------- */
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(msg) {
  const el = $("#toast"); el.textContent = msg; el.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

/* ---------------- boot ---------------- */
loadDashboard();
refreshSavedCount();
