/* ==========================================================================
   PYNX ERP — Admin: Project Designs from Marketing
   Admin reviews each design project and APPROVES it or RETURNS it with remarks
   (database function marketing_design_admin_decide). After approval the project
   goes to Inventory (stock check), then to Purchasing/Finance if stock is short.
   ========================================================================== */
(function () {
  "use strict";

  const sb = window.supabaseClient;
  const BUCKET = "marketing-designs";
  const URL_TTL = 21600;
  const POLL_MS = 30000;
  const LOGIN_URL = "../Log_in/login.html";

  let designs = [];
  let lastSig = "";
  let loadError = "";
  let deciding = false;
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
  const bar = pct => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

  // Ongoing = waiting for Admin (or returned to Marketing), Approved = approved, Completed = finished
  function statePill(d) {
    if (d.status === "Completed") return '<span class="pill pill--ok">Completed</span>';
    if (d.status === "Approved") return '<span class="pill pill--ok">Approved</span>';
    if (d.returned) return '<span class="pill pill--bad">Returned</span>';
    return '<span class="pill pill--warn">Waiting for Admin</span>';
  }
  const waitingForAdmin = d => d.status === "Ongoing" && !d.returned;
  function inventoryText(d) {
    if (d.status === "Ongoing") return "Starts after Admin approves";
    if (d.inventoryCheck === "Available") return "Inventory confirmed: all products are in stock";
    if (d.inventoryCheck === "Unavailable") return d.sentToPurchasing ? "Not in stock: sent to Purchasing" : "Not in stock: Inventory has not yet sent it to Purchasing";
    return "Inventory is checking stock";
  }

  function toast(msg) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  const mapDesign = d => ({
    id: d.id, name: d.name, category: d.category, status: d.status, progress: Number(d.progress || 0),
    description: d.description || "", requirements: d.requirements || "", coverPath: d.cover_path || "",
    returned: !!d.returned, adminRemarks: d.admin_remarks || "",
    inventoryCheck: d.inventory_check || "Waiting", sentToPurchasing: !!d.sent_to_purchasing,
    submittedFrom: d.submitted_from || "Marketing Department",
    createdAt: d.created_at, updatedAt: d.updated_at,
    materials: (d.materials || []).slice().sort((a, b) => a.id - b.id)
      .map(m => ({ name: m.material_name, unit: m.unit, qty: Number(m.qty) })),
    files: (d.files || []).slice().sort((a, b) => a.id - b.id)
      .map(f => ({ name: f.file_name, size: Number(f.file_size), type: f.file_type || "", path: f.storage_path }))
  });

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
    if (filters.status === "Waiting" && !waitingForAdmin(d)) return false;
    if (filters.status && filters.status !== "Waiting" && d.status !== filters.status) return false;
    return !q || (d.name + " " + d.description + " " + d.category).toLowerCase().indexOf(q) !== -1;
  }

  function card(d) {
    const cover = urlOf(d.coverPath);
    const thumb = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="thumb-ph">${esc(initials(d.name))}</div>`;
    return `<article class="design-card" data-open="${esc(d.id)}">
      <div class="design-thumb">${thumb}</div>
      <div class="design-body">
        <div class="design-top"><span class="tag">${esc(d.category)}</span>${statePill(d)}</div>
        <h3>${esc(d.name)}</h3>
        <p class="mut clamp">${esc(d.description || "No description yet.")}</p>
        <div class="row"><span class="mut">Progress</span><b>${d.progress}%</b></div>${bar(d.progress)}
        <p class="mut design-meta">${d.materials.length} product${d.materials.length === 1 ? "" : "s"} · ${d.files.length} file${d.files.length === 1 ? "" : "s"} · Updated ${fmtDate(d.updatedAt)}</p>
      </div></article>`;
  }

  function paint() {
    const grid = $("designGrid");
    if (!grid) return;
    $("dTotal").textContent = designs.length;
    $("dOngoing").textContent = designs.filter(waitingForAdmin).length;
    $("dCompleted").textContent = designs.filter(d => d.status === "Completed").length;
    $("dFiles").textContent = designs.reduce((a, d) => a + d.files.length, 0);
    const label = document.querySelector("#dOngoing").closest(".metric");
    if (label) {
      label.querySelector(".metric-top span").textContent = "Waiting for Admin";
      label.querySelector(".metric-foot").textContent = "Needs your approval";
    }

    $("designNotice").hidden = !loadError;
    $("designNotice").textContent = loadError;

    const list = designs.filter(matches);
    grid.innerHTML = list.length ? list.map(card).join("")
      : `<div class="card empty-card">${designs.length ? "No projects match your search."
        : "No project designs received yet."}</div>`;
  }

  function openDesign(id) {
    const d = designs.find(x => String(x.id) === String(id));
    if (!d) return;
    const cover = urlOf(d.coverPath);
    const back = document.createElement("div");
    back.className = "modal";
    const decide = waitingForAdmin(d);
    back.innerHTML = `<div class="card" role="dialog" aria-modal="true">
      ${cover ? `<div class="detail-cover"><img src="${esc(cover)}" alt="Cover photo"></div>` : ""}
      <div class="modal-head"><div><h2>${esc(d.name)}</h2><div class="mut">${esc(d.id)} · ${esc(d.category)} · From ${esc(d.submittedFrom)} · Updated ${fmtDate(d.updatedAt)}</div></div>${statePill(d)}</div>
      <div class="row"><span class="mut">Progress</span><b>${d.progress}%</b></div>${bar(d.progress)}
      ${d.returned ? `<div class="notice"><b>Returned to Marketing:</b> ${esc(d.adminRemarks || "Please revise and resubmit.")}</div>` : ""}
      <div class="detail-block"><span>Description</span>${esc(d.description || "—")}</div>
      <div class="detail-block"><span>Design requirements</span>${esc(d.requirements || "—")}</div>
      <div class="detail-block"><span>Inventory / Purchasing</span>${esc(inventoryText(d))}</div>
      <div class="sub-title">Products needed</div>
      ${d.materials.length ? `<div class="tw"><table><thead><tr><th>Product</th><th class="r">Quantity</th></tr></thead><tbody>${
        d.materials.map(m => `<tr><td><b>${esc(m.name)}</b></td><td class="r">${fmtNum(m.qty)} ${esc(m.unit)}</td></tr>`).join("")}</tbody></table></div>`
        : '<div class="mut">No products listed.</div>'}
      <div class="sub-title">Design files</div>
      ${d.files.length ? '<div class="file-list">' + d.files.map(f => {
        const u = urlOf(f.path);
        const isImg = f.type.indexOf("image/") === 0 && u;
        const inner = `<div class="file-ico">${isImg ? `<img src="${esc(u)}" alt="">` : esc(ext(f.name))}</div>
          <div class="file-info"><strong>${esc(f.name)}</strong><span>${fmtSize(f.size)}</span></div>`;
        return u ? `<a class="file-row" href="${esc(u)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="file-row">${inner}</div>`;
      }).join("") + "</div>" : '<div class="mut">No files attached.</div>'}
      ${decide ? `<div class="sub-title">Admin decision</div>
        <label for="dRemarks">Remarks (required when returning, at least 5 characters)</label>
        <textarea id="dRemarks" rows="3" placeholder="Add remarks for Marketing"></textarea>
        <div class="error-msg" id="dMsg" role="alert" style="min-height:20px;margin-top:6px"></div>` : ""}
      <div class="actions">
        ${decide ? '<button type="button" class="dng" id="dReturn">Return to Marketing</button><button type="button" class="pri" id="dApprove">Approve project</button>' : ""}
        <button type="button" data-close>Close</button>
      </div></div>`;
    document.body.appendChild(back);
    document.body.classList.add("modal-open");
    const close = () => { back.remove(); document.body.classList.remove("modal-open"); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    back.addEventListener("mousedown", e => { if (e.target === back) close(); });
    back.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); });

    if (decide) {
      const run = async approve => {
        if (deciding) return;
        const remarks = ($("dRemarks").value || "").trim();
        if (!approve && remarks.length < 5) { $("dMsg").textContent = "Enter a reason for returning the project (at least 5 characters)."; return; }
        $("dMsg").textContent = "";
        deciding = true;
        back.querySelectorAll("button").forEach(b => { b.disabled = true; });
        const { error } = await sb.rpc("marketing_design_admin_decide", { p_design: String(d.id), p_approve: approve, p_remarks: remarks });
        deciding = false;
        if (error) { $("dMsg").textContent = error.message; back.querySelectorAll("button").forEach(b => { b.disabled = false; }); return; }
        close();
        toast(approve ? d.name + " approved. It now goes to Inventory." : d.name + " returned to Marketing.");
        try { await load(); lastSig = JSON.stringify(designs); } catch (err) { console.warn(err); }
        paint();
      };
      $("dApprove").addEventListener("click", () => run(true));
      $("dReturn").addEventListener("click", () => run(false));
    }
  }

  /* ---------- Refresh (live + backup polling) ---------- */
  let timer = null;
  function refresh(announce) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (deciding || document.querySelector(".modal")) return;
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

    // Filter list for the new status flow
    $("dStatus").innerHTML = '<option value="">All statuses</option><option value="Waiting">Waiting for Admin</option><option value="Approved">Approved</option><option value="Completed">Completed</option>';

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