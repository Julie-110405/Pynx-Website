/* ==========================================================================
   PYNX ERP — Admin: Project Designs received from Marketing (view-only)
   Reads marketing_designs (+ materials, files) and shows cover photos via
   signed links from the private "marketing-designs" bucket.
   Needs admin_designs.sql to be run once in Supabase.
   ========================================================================== */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const BUCKET = "marketing-designs";
  const URL_TTL = 21600;      // signed photo links last 6 hours
  const POLL_MS = 30000;      // backup check for new designs
  const LOGIN_URL = "../Log_in/login.html";

  let designs = [];
  let lastSig = "";
  let loadError = "";
  const urlCache = {};
  const filters = { q: "", status: "" };

  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtNum = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fmtDate = iso => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB";
  const ext = name => { const i = name.lastIndexOf("."); return i > -1 ? name.slice(i + 1, i + 5).toUpperCase() : "FILE"; };
  const initials = name => name.split(" ").slice(0, 2).map(w => w.charAt(0)).join("").toUpperCase();
  const pill = s => `<span class="pill ${s === "Completed" ? "pill--ok" : "pill--warn"}">${esc(s)}</span>`;
  const bar = pct => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  const mapDesign = d => ({
    id: d.id, name: d.name, category: d.category, status: d.status, progress: Number(d.progress || 0),
    description: d.description || "", requirements: d.requirements || "", coverPath: d.cover_path || "",
    createdAt: d.created_at, updatedAt: d.updated_at,
    materials: (d.materials || []).slice().sort((a, b) => a.id - b.id)
      .map(m => ({ name: m.material_name, unit: m.unit, qty: Number(m.qty) })),
    files: (d.files || []).slice().sort((a, b) => a.id - b.id)
      .map(f => ({ name: f.file_name, size: Number(f.file_size), type: f.file_type || "", path: f.storage_path }))
  });

  /* Private photo links (signed, cached) */
  async function ensureUrls(paths) {
    const now = Date.now();
    const need = [...new Set(paths.filter(Boolean))].filter(p => !urlCache[p] || urlCache[p].exp < now);
    if (!need.length) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, URL_TTL);
    if (error) { console.warn("[storage]", error.message); return; }
    (data || []).forEach(x => { if (x.signedUrl) urlCache[x.path] = { url: x.signedUrl, exp: now + (URL_TTL - 300) * 1000 }; });
  }
  const urlOf = p => (p && urlCache[p] && urlCache[p].url) || "";

  async function load() {
    const { data, error } = await sb.from("marketing_designs")
      .select("*, materials:marketing_design_materials(*), files:marketing_design_files(*)")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    designs = (data || []).map(mapDesign);
    const paths = [];
    designs.forEach(d => {
      paths.push(d.coverPath);
      d.files.forEach(f => { if (f.type.indexOf("image/") === 0) paths.push(f.path); });
    });
    await ensureUrls(paths);
  }

  /* ---------- Screen ---------- */
  function matches(d) {
    const q = filters.q.trim().toLowerCase();
    if (filters.status && d.status !== filters.status) return false;
    return !q || (d.name + " " + d.description + " " + d.category).toLowerCase().indexOf(q) !== -1;
  }

  function card(d) {
    const cover = urlOf(d.coverPath);
    const thumb = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="thumb-ph">${esc(initials(d.name))}</div>`;
    return `<article class="design-card" data-open="${esc(d.id)}">
      <div class="design-thumb">${thumb}</div>
      <div class="design-body">
        <div class="design-top"><span class="tag">${esc(d.category)}</span>${pill(d.status)}</div>
        <h3>${esc(d.name)}</h3>
        <p class="mut clamp">${esc(d.description || "No description yet.")}</p>
        <div class="row"><span class="mut">Progress</span><b>${d.progress}%</b></div>${bar(d.progress)}
        <p class="mut design-meta">${d.materials.length} material${d.materials.length === 1 ? "" : "s"} · ${d.files.length} file${d.files.length === 1 ? "" : "s"} · Updated ${fmtDate(d.updatedAt)}</p>
      </div></article>`;
  }

  function paint() {
    const grid = $("designGrid");
    if (!grid) return;
    $("dTotal").textContent = designs.length;
    $("dOngoing").textContent = designs.filter(d => d.status === "Ongoing").length;
    $("dCompleted").textContent = designs.filter(d => d.status === "Completed").length;
    $("dFiles").textContent = designs.reduce((a, d) => a + d.files.length, 0);

    $("designNotice").hidden = !loadError;
    $("designNotice").textContent = loadError;

    const list = designs.filter(matches);
    grid.innerHTML = list.length ? list.map(card).join("")
      : `<div class="card empty-card">${designs.length ? "No projects match your search."
        : "No project designs received yet. If Marketing has already created projects, run admin_designs.sql in Supabase so Admin is allowed to read them."}</div>`;
  }

  function openDesign(id) {
    const d = designs.find(x => String(x.id) === String(id));
    if (!d) return;
    const cover = urlOf(d.coverPath);
    const back = document.createElement("div");
    back.className = "modal";
    back.innerHTML = `<div class="card" role="dialog" aria-modal="true">
      ${cover ? `<div class="detail-cover"><img src="${esc(cover)}" alt="Cover photo"></div>` : ""}
      <div class="modal-head"><div><h2>${esc(d.name)}</h2><div class="mut">${esc(d.category)} · Updated ${fmtDate(d.updatedAt)}</div></div>${pill(d.status)}</div>
      <div class="row"><span class="mut">Progress</span><b>${d.progress}%</b></div>${bar(d.progress)}
      <div class="detail-block"><span>Description</span>${esc(d.description || "—")}</div>
      <div class="detail-block"><span>Design requirements</span>${esc(d.requirements || "—")}</div>
      <div class="sub-title">Materials needed</div>
      ${d.materials.length ? `<div class="tw"><table><thead><tr><th>Material</th><th class="r">Quantity</th></tr></thead><tbody>${
        d.materials.map(m => `<tr><td><b>${esc(m.name)}</b></td><td class="r">${fmtNum(m.qty)} ${esc(m.unit)}</td></tr>`).join("")}</tbody></table></div>`
        : '<div class="mut">No materials listed.</div>'}
      <div class="sub-title">Design files</div>
      ${d.files.length ? '<div class="file-list">' + d.files.map(f => {
        const u = urlOf(f.path);
        const isImg = f.type.indexOf("image/") === 0 && u;
        const inner = `<div class="file-ico">${isImg ? `<img src="${esc(u)}" alt="">` : esc(ext(f.name))}</div>
          <div class="file-info"><strong>${esc(f.name)}</strong><span>${fmtSize(f.size)}</span></div>`;
        return u ? `<a class="file-row" href="${esc(u)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="file-row">${inner}</div>`;
      }).join("") + "</div>" : '<div class="mut">No files attached.</div>'}
      <div class="actions"><button type="button" data-close>Close</button></div></div>`;
    document.body.appendChild(back);
    document.body.classList.add("modal-open");
    const close = () => { back.remove(); document.body.classList.remove("modal-open"); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", e => { if (e.target === back) close(); });
    back.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); });
  }

  /* ---------- Refresh (live + backup polling) ---------- */
  let timer = null;
  function refresh(announce) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const before = new Set(designs.map(d => d.id));
        await load();
        loadError = "";
        const sig = JSON.stringify(designs);
        if (sig !== lastSig) {
          if (announce && lastSig) {
            designs.filter(d => !before.has(d.id)).slice(0, 3).forEach(d => toast("New project design from Marketing: " + d.name));
          }
          lastSig = sig;
          paint();
        }
      } catch (err) {
        console.warn("[designs]", err);
        loadError = "Project designs could not be loaded: " + ((err && err.message) || "unknown error");
        paint();
      }
    }, 300);
  }

  async function init() {
    const grid = $("designGrid");
    if (!grid) return;
    if (!sb) { grid.innerHTML = '<div class="card empty-card">Supabase is not connected. Check that ../config/supabase.js loads before this page.</div>'; return; }

    const { data } = await sb.auth.getSession();
    if (!data || !data.session) {
      grid.innerHTML = `<div class="card empty-card">Sign in to see project designs. <a href="${LOGIN_URL}">Go to login</a></div>`;
      return;
    }

    $("dQ").addEventListener("input", e => { filters.q = e.target.value; paint(); });
    $("dStatus").addEventListener("change", e => { filters.status = e.target.value; paint(); });
    grid.addEventListener("click", e => { const c = e.target.closest("[data-open]"); if (c) openDesign(c.dataset.open); });

    try { await load(); lastSig = JSON.stringify(designs); } catch (err) {
      loadError = "Project designs could not be loaded: " + ((err && err.message) || "unknown error");
    }
    paint();

    const live = () => refresh(true);
    sb.channel("admin-designs")
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_designs" }, live)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_design_files" }, live)
      .subscribe();
    setInterval(() => { if (!document.hidden) live(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) live(); });
  }

  init();
})();