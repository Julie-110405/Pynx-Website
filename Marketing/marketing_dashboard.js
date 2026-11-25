/* ==========================================================================
   PYNX ERP — Marketing (one script for all menus)
   Menus: Dashboard, Requisition, Project Designs, Products & Materials,
          Request History, Notifications, Log Out
   Data:  Supabase (marketing_* tables, purchasing_requests, inventory_products, storage bucket)
   Sections: 1 Settings · 2 Helpers · 3 Data · 4 Live updates · 5 Sidebar
             6 Dashboard · 7 Requisition · 8 Project Designs · 9 Products
             10 Request History · 11 Notifications · 12 Start-up
   ========================================================================== */
(function () {
  "use strict";

  /* ======================================================================
     1. SETTINGS
     ====================================================================== */
  const sb = window.supabaseClient;
  const LOGIN_URL = "../Log_in/login.html";
  const LOGO_URL = "../logo/pynx-logo.png";
  const ALLOWED_DEPARTMENTS = ["marketing", "admin"];
  const BUCKET = "marketing-designs";
  const DEMO_TOOLS = true;                 // set to false to hide the "pretend to be Admin / Inventory" buttons
  const POLL_MS = 30000;                   // backup check for new data
  const URL_TTL = 21600;                   // signed photo links last 6 hours
  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_COVER_BYTES = 5 * 1024 * 1024;
  const PROJECT_OTHER = "Departmental / Daily Use";
  const DEFAULT_CATEGORIES = ["Cups", "Bikini"];   // starting categories; staff can type new ones
  const DEPT_FROM = "Marketing Department";
  const LOW_STYLE = ' style="color:#b03030;font-weight:700"';

  const MENU = [
    { key: "dashboard",     label: "Dashboard" },
    { key: "requisition",   label: "Requisition" },
    { key: "designs",       label: "Project Designs" },
    { key: "products",      label: "Products & Materials" },
    { key: "history",       label: "Request History" },
    { key: "notifications", label: "Notifications" }
  ];

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    requisition: '<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    designs: '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    products: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="10" y1="10" x2="10" y2="20"/></svg>',
    history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    notifications: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
  };

  const state = {
    userId: null, profile: null,
    catalog: [], catalogError: "",
    requisitions: [], designs: [], notifications: [], purchasing: [],
    settings: { projectNotifications: true }
  };
  const urlCache = {};
  const seen = new Set();
  const pages = {};
  let currentKey = "dashboard";
  let draft = null;
  let lastSig = "";
  let pendingRender = false;
  let liveTimer = null;
  let onSynced = null;                     // lets an open project window refresh its stock numbers

  /* ======================================================================
     2. HELPERS
     ====================================================================== */
  const $id = id => document.getElementById(id);
  const norm = s => String(s == null ? "" : s).trim().toLowerCase();

  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  const fmtNum = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const fmtDate = iso => {
    if (!iso) return "—";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const fmtDateTime = iso => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  const timeAgo = iso => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "Just now";
    const m = Math.floor(s / 60); if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60); if (h < 24) return h + " hr ago";
    const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
    return fmtDate(iso);
  };
  const ago = iso => `<span class="ago" data-ts="${esc(iso)}" title="${esc(fmtDateTime(iso))}">${timeAgo(iso)}</span>`;

  const fmtSize = b => b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB";
  const dateKey = iso => {
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const today = () => dateKey(new Date().toISOString());
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ext = name => { const i = name.lastIndexOf("."); return i > -1 ? name.slice(i + 1, i + 5).toUpperCase() : "FILE"; };
  const initials = name => name.split(" ").slice(0, 2).map(w => w.charAt(0)).join("").toUpperCase();
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const deptLabel = d => norm(d) === "procurement" ? "Purchasing" : String(d || "Unknown");

  const REQ_BADGE = { Pending: "badge-yellow", Approved: "badge-green", Rejected: "badge-red", Completed: "badge-blue", Partial: "badge-yellow" };
  const statusBadge = s => `<span class="badge ${REQ_BADGE[s] || "badge-blue"}">${esc(s)}</span>`;
  const DESIGN_BADGE = { Ongoing: "badge-yellow", Approved: "badge-blue", Completed: "badge-green" };
  const designBadge = s => `<span class="badge ${DESIGN_BADGE[s] || "badge-yellow"}">${esc(s)}</span>`;
  const pill = t => `<span class="badge ${t.badge}">${esc(t.label)}</span>`;
  const stockBadge = s => s === "out" ? '<span class="badge badge-red">Out of Stock</span>'
    : s === "low" ? '<span class="badge badge-red">Low Stock</span>' : '<span class="badge badge-green">In Stock</span>';
  const stockStyle = s => s === "ok" ? "" : LOW_STYLE;
  const bar = pct => `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;

  function toast(msg, type) {
    let root = $id("toastRoot");
    if (!root) { root = document.createElement("div"); root.id = "toastRoot"; document.body.appendChild(root); }
    const t = document.createElement("div");
    t.className = "toast" + (type === "error" ? " toast-error" : "");
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function modal(html, opts) {
    opts = opts || {};
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal${opts.wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    backdrop.close = function () {
      if (!backdrop.parentNode) return;
      backdrop.parentNode.removeChild(backdrop);
      if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
      if (opts.onClose) opts.onClose();
    };
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) backdrop.close(); });
    backdrop.addEventListener("click", e => { if (e.target.closest("[data-close]")) backdrop.close(); });
    return backdrop;
  }
  const closeModals = () => document.querySelectorAll(".modal-backdrop").forEach(m => { if (m.close) m.close(); else m.remove(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const all = document.querySelectorAll(".modal-backdrop");
    if (all.length && all[all.length - 1].close) all[all.length - 1].close();
  });

  function confirmBox(o) {
    return new Promise(resolve => {
      let done = false;
      const m = modal(
        `<h2 class="modal-title">${esc(o.title)}</h2><p class="modal-text">${o.message}</p>
         <div class="modal-actions"><button type="button" class="btn btn-light" data-close>Cancel</button>
         <button type="button" class="btn ${o.danger ? "btn-danger" : "btn-dark"}" data-yes>${esc(o.confirmText || "Confirm")}</button></div>`,
        { onClose: () => { if (!done) { done = true; resolve(false); } } });
      m.querySelector("[data-yes]").addEventListener("click", () => { done = true; m.close(); resolve(true); });
    });
  }

  /* Permanent-delete warning: the red button stays off until the project name is typed */
  function confirmDeleteProject(p) {
    return new Promise(resolve => {
      let done = false;
      const m = modal(
        `<h2 class="modal-title">Delete this project permanently?</h2>
         <div class="remark remark-bad"><b>Warning:</b> This cannot be undone. Once deleted, the project can never be recovered.</div>
         <p class="modal-text">You are about to delete <b>${esc(p.name)}</b> (${esc(p.id)}). Its ${plural(p.materials.length, "product")}, ${plural(p.files.length, "file")} and cover photo will be removed for good. Past requisitions keep their records.</p>
         <div class="field" style="margin-top:14px"><label>Type <b>${esc(p.name)}</b> to confirm</label>
           <input type="text" id="delConfirm" autocomplete="off" placeholder="Project name"></div>
         <div class="modal-actions"><button type="button" class="btn btn-light" data-close>Cancel</button>
           <button type="button" class="btn btn-danger" id="delYes" disabled>Delete permanently</button></div>`,
        { onClose: () => { if (!done) { done = true; resolve(false); } } });
      const input = m.querySelector("#delConfirm");
      const yes = m.querySelector("#delYes");
      input.addEventListener("input", () => { yes.disabled = norm(input.value) !== norm(p.name); });
      yes.addEventListener("click", () => {
        if (norm(input.value) !== norm(p.name)) return;
        done = true; m.close(); resolve(true);
      });
      input.focus();
    });
  }

  function downloadCSV(filename, rows) {
    const csv = rows.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* Runs a save/delete action, shows a friendly error if it fails */
  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r === undefined ? true : r;
    } catch (err) {
      console.error(err);
      toast((err && err.message) || "Something went wrong. Please try again.", "error");
      return null;
    }
  }

  const isTyping = () => {
    const a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $id("view").contains(a);
  };

  /* ======================================================================
     3. DATA (Supabase)
     ====================================================================== */
  const product = name => state.catalog.find(p => norm(p.name) === norm(name)) || null;
  const productFor = x => state.catalog.find(p => x.sku && p.sku === x.sku) || product(x.name);
  const productStatus = p => p.stock <= 0 ? "out" : p.stock <= p.min ? "low" : "ok";
  const unitOf = name => (product(name) || {}).unit || "pcs";
  const unreadCount = () => state.notifications.filter(n => !n.read).length;
  const requisitions = () => state.requisitions;
  const getRequisition = id => state.requisitions.find(r => r.id === id) || null;
  const getDesign = id => state.designs.find(d => d.id === id) || null;

  const categoryList = () => {
    const out = DEFAULT_CATEGORIES.slice();
    state.designs.forEach(d => { if (d.category && !out.some(c => norm(c) === norm(d.category))) out.push(d.category); });
    return out;
  };

  const releasedSummary = r => r.items.filter(i => i.released > 0).map(i => fmtNum(i.released) + " of " + fmtNum(i.qty) + " " + i.unit).join("; ");
  const materialLabel = r => !r.items.length ? "—" : r.items[0].name + (r.items.length > 1 ? " +" + (r.items.length - 1) + " more" : "");
  const qtyLabel = r => !r.items.length ? "—" : r.items.length > 1 ? r.items.length + " items" : fmtNum(r.items[0].qty) + " " + r.items[0].unit;
  const fulfilment = r => !r.items.length ? 0 : Math.round(r.items.reduce((a, i) => a + Math.min(1, i.released / i.qty), 0) / r.items.length * 100);
  function statusText(r) {
    switch (r.status) {
      case "Pending":   return "Waiting for Admin approval";
      case "Approved":  return r.inventoryConfirmed ? "Inventory confirmed availability" : "Approved by Admin · waiting for Inventory to check stock";
      case "Rejected":  return "Returned by Admin" + (r.remarks ? " · " + r.remarks : "");
      case "Partial":   return "Partially fulfilled (" + releasedSummary(r) + ")";
      case "Completed": return "Fully released to Marketing";
      default:          return r.status;
    }
  }
  function summary() {
    const list = state.requisitions;
    const count = s => list.filter(r => r.status === s).length;
    return { total: list.length, pending: count("Pending"), approved: count("Approved") + count("Partial"),
      rejected: count("Rejected"), completed: count("Completed"), last: list[0] || null };
  }
  const designStats = () => ({
    total: state.designs.length,
    ongoing: state.designs.filter(p => p.status === "Ongoing").length,
    approved: state.designs.filter(p => p.status === "Approved").length,
    completed: state.designs.filter(p => p.status === "Completed").length
  });

  /* Purchasing progress of one design project */
  function designPurch(id) {
    const rows = state.purchasing.filter(r => r.designId === id);
    return {
      rows,
      requested: rows.filter(r => r.status === "Requested").length,
      purchased: rows.filter(r => r.status === "Purchased").length,
      inInv: rows.filter(r => r.status === "Purchased" && r.inInventory).length
    };
  }

  /* Where a design project is in the Admin -> Inventory -> Purchasing flow */
  function designTrack(d) {
    const approved = d.status !== "Ongoing";
    const admin = approved ? { badge: "badge-green", label: "Approved", note: d.adminRemarks || "Approved by Admin" }
      : d.returned ? { badge: "badge-red", label: "Returned", note: d.adminRemarks || "Revise the project and resubmit." }
      : { badge: "badge-yellow", label: "Pending", note: "Sent by the " + (d.submittedFrom || DEPT_FROM) + " · waiting for Admin approval" };
    let inv, pur;
    if (!approved) {
      inv = { badge: "badge-blue", label: "Not started", note: "Starts after Admin approves" };
      pur = { badge: "badge-blue", label: "—", note: "" };
    } else {
      if (d.inventoryCheck === "Available") {
        inv = { badge: "badge-green", label: "Available", note: "Inventory has all the products" };
        pur = { badge: "badge-blue", label: "Not needed", note: "Everything is in stock" };
      } else if (d.inventoryCheck === "Unavailable") {
        inv = { badge: "badge-red", label: "Not available", note: "Some products are not in stock" };
        if (!d.sentToPurchasing) {
          pur = { badge: "badge-red", label: "Not yet sent", note: "Not yet passed to Purchasing" };
        } else {
          const pp = designPurch(d.id);
          if (!pp.rows.length) pur = { badge: "badge-yellow", label: "Sent to Purchasing", note: "Inventory passed the request to Purchasing" };
          else if (!pp.purchased) pur = { badge: "badge-yellow", label: "Requested", note: "Waiting for Purchasing to buy the products" };
          else if (pp.purchased < pp.rows.length) pur = { badge: "badge-yellow", label: "Partly purchased", note: pp.purchased + " of " + pp.rows.length + " products purchased" };
          else if (pp.inInv === pp.rows.length) pur = { badge: "badge-green", label: "Purchased · In Inventory", note: "Everything was bought and is already in Inventory" };
          else pur = { badge: "badge-yellow", label: "Purchased · Not in Inventory", note: "Bought by Purchasing, waiting to arrive in Inventory" };
        }
      } else {
        inv = { badge: "badge-yellow", label: "Checking", note: "Inventory is checking stock" };
        pur = { badge: "badge-blue", label: "—", note: "" };
      }
    }
    return { admin, inv, pur };
  }

  const mapReq = r => ({
    id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, project: r.project, reason: r.reason,
    neededBy: r.needed_by, status: r.status, remarks: r.remarks || "", inventoryConfirmed: r.inventory_confirmed,
    items: (r.items || []).slice().sort((a, b) => a.id - b.id).map(i => ({
      name: i.material_name, sku: i.sku, unit: i.unit, qty: Number(i.qty), released: Number(i.released) })),
    timeline: (r.events || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
      .map(e => ({ at: e.created_at, by: e.by_dept, text: e.message }))
  });
  const mapDesign = d => ({
    id: d.id, name: d.name, category: d.category, status: d.status, progress: d.progress,
    description: d.description || "", requirements: d.requirements || "", coverPath: d.cover_path || "",
    returned: !!d.returned, adminRemarks: d.admin_remarks || "",
    inventoryCheck: d.inventory_check || "Waiting", sentToPurchasing: !!d.sent_to_purchasing,
    submittedFrom: d.submitted_from || DEPT_FROM,
    createdAt: d.created_at, updatedAt: d.updated_at,
    materials: (d.materials || []).slice().sort((a, b) => a.id - b.id).map(m => ({ name: m.material_name, sku: m.sku, unit: m.unit, qty: Number(m.qty) })),
    files: (d.files || []).slice().sort((a, b) => a.id - b.id).map(f => ({ name: f.file_name, size: Number(f.file_size), type: f.file_type, path: f.storage_path }))
  });
  const mapNotif = n => ({ id: n.id, text: n.message, source: n.source, tone: n.tone, kind: n.kind, reqId: n.req_id, designId: n.design_id, refSku: n.ref_sku, read: n.is_read, at: n.created_at });
  const mapPurch = r => ({
    id: r.id, designId: r.design_id, requestedBy: deptLabel(r.requested_by), product: r.product_name, sku: r.sku || "",
    unit: r.unit, qty: Number(r.qty), status: r.status, inInventory: !!r.in_inventory, createdAt: r.created_at, updatedAt: r.updated_at });

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

  async function loadData() {
    try { await sb.rpc("marketing_refresh_alerts"); } catch (err) { console.warn("[alerts]", err); }

    const [c, r, d, n, s, pr] = await Promise.all([
      sb.from("inventory_products").select("sku,name,category,unit,qty,min_level,supplier,location").eq("archived", false).order("name"),
      sb.from("marketing_requisitions").select("*, items:marketing_requisition_items(*), events:marketing_requisition_events(*)").order("created_at", { ascending: false }),
      sb.from("marketing_designs").select("*, materials:marketing_design_materials(*), files:marketing_design_files(*)").order("updated_at", { ascending: false }),
      sb.from("marketing_notifications").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("marketing_settings").select("project_notifications").eq("user_id", state.userId).maybeSingle(),
      sb.from("purchasing_requests").select("*").order("created_at", { ascending: false })
    ]);
    if (r.error) throw r.error;
    if (d.error) throw d.error;
    if (n.error) throw n.error;

    state.catalogError = c.error ? c.error.message : "";
    state.catalog = (c.data || []).map(p => ({
      sku: p.sku, name: p.name, category: p.category, unit: p.unit, stock: Number(p.qty), min: Number(p.min_level),
      supplier: p.supplier || "", location: p.location || "" }));
    state.requisitions = (r.data || []).map(mapReq);
    state.designs = (d.data || []).map(mapDesign);
    state.purchasing = pr.error ? [] : (pr.data || []).map(mapPurch);
    state.settings.projectNotifications = s.data ? s.data.project_notifications : true;
    state.notifications = (n.data || []).map(mapNotif).filter(x => state.settings.projectNotifications || !x.designId);
    await ensureUrls(state.designs.map(x => x.coverPath));
  }

  const sigOf = () => JSON.stringify([state.requisitions, state.designs, state.notifications, state.catalog, state.purchasing, state.settings]);

  /* Loads everything; announce = show a pop-up for brand-new notifications. Returns true if anything changed */
  async function syncData(announce) {
    await loadData();
    if (announce) {
      state.notifications.filter(n => !n.read && !seen.has(n.id)).slice(0, 3).reverse().forEach(n => toast(n.text));
    }
    state.notifications.forEach(n => seen.add(n.id));
    updateBadge();
    const sig = sigOf();
    const changed = sig !== lastSig;
    lastSig = sig;
    return changed;
  }
  async function reload() { await syncData(false); render(true); }

  /* Writes */
  async function addRequisition(data) {
    const items = data.items.map(i => { const p = product(i.name); return { sku: p ? p.sku : "", name: i.name, unit: p ? p.unit : unitOf(i.name), qty: Number(i.qty) }; });
    const { data: id, error } = await sb.rpc("marketing_submit_requisition", {
      p_project: data.project, p_reason: data.reason, p_needed_by: data.neededBy, p_items: items });
    if (error) throw error;
    return id;
  }
  async function demoStep(id, action) {
    const { error } = await sb.rpc("marketing_demo_step", { p_req: id, p_action: action });
    if (error) throw error;
  }
  async function demoDesignStep(id, action) {
    const { error } = await sb.rpc("marketing_demo_design_step", { p_design: id, p_action: action });
    if (error) throw error;
  }
  async function saveDesignRpc(payload) {
    const { data, error } = await sb.rpc("marketing_save_design", { p: payload });
    if (error) throw (error.code === "23505" ? new Error("Another project already uses this name.") : error);
    return data;
  }
  async function setRead(id, read) {
    const { error } = await sb.from("marketing_notifications").update({ is_read: read }).eq("id", id);
    if (error) throw error;
  }
  async function markAllRead() {
    const { error } = await sb.from("marketing_notifications").update({ is_read: true }).eq("is_read", false);
    if (error) throw error;
  }
  async function removeNotification(id) {
    const { error } = await sb.from("marketing_notifications").delete().eq("id", id);
    if (error) throw error;
  }
  async function setProjectNotifications(on) {
    const { error } = await sb.from("marketing_settings").upsert({ user_id: state.userId, project_notifications: on });
    if (error) throw error;
    state.settings.projectNotifications = on;
  }
  const removeFiles = paths => { if (paths.length) sb.storage.from(BUCKET).remove(paths).then(() => {}, () => {}); };

  function materialOptions(selected) {
    const groups = {};
    state.catalog.forEach(p => { (groups[p.category] = groups[p.category] || []).push(p); });
    let html = '<option value="">— Select material —</option>';
    Object.keys(groups).sort().forEach(cat => {
      html += `<optgroup label="${esc(cat)}">` + groups[cat].map(p =>
        `<option value="${esc(p.name)}"${p.name === selected ? " selected" : ""}>${esc(p.name)} — ${fmtNum(p.stock)} ${esc(p.unit)}</option>`).join("") + "</optgroup>";
    });
    if (selected && !product(selected)) html += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
    return html;
  }

  /* ======================================================================
     4. LIVE UPDATES (notifications and stock arrive without refreshing)
     ====================================================================== */
  function liveRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      try {
        const changed = await syncData(true);
        if (onSynced) onSynced();
        if (!changed) return;
        if (document.querySelector(".modal-backdrop") || isTyping()) pendingRender = true;
        else render(true);
      } catch (err) { console.warn("[live]", err); }
    }, 400);
  }

  function startLive() {
    sb.channel("marketing-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_notifications" }, liveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_requisitions" }, liveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "marketing_designs" }, liveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchasing_requests" }, liveRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_products" }, liveRefresh)
      .subscribe();
    setInterval(() => { if (!document.hidden) liveRefresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) liveRefresh(); });
    setInterval(() => {
      if (pendingRender && !document.querySelector(".modal-backdrop") && !isTyping()) { pendingRender = false; render(true); }
    }, 2000);
    setInterval(() => {
      document.querySelectorAll(".ago[data-ts]").forEach(el => { el.textContent = timeAgo(el.dataset.ts); });
    }, 30000);
  }

  /* ======================================================================
     5. SIDEBAR AND PAGE ROUTER
     ====================================================================== */
  function renderSidebar() {
    const links = MENU.map(i =>
      `<a href="#${i.key}" class="nav-item" data-key="${i.key}" title="${esc(i.label)}">
         <span class="nav-icon">${ICONS[i.key]}</span><span class="nav-label">${esc(i.label)}</span>
         ${i.key === "notifications" ? '<span class="nav-badge" id="navNotifBadge" hidden>0</span>' : ""}
       </a>`).join("");
    const dept = String(state.profile.department);
    const who = dept.toLowerCase() === "marketing" ? "Marketing Staff" : state.profile.username;

    $id("sidebar").innerHTML =
      `<div class="sidebar-logo"><img src="${LOGO_URL}" alt="Pynx - Beyond the Trend"></div>
       <nav class="sidebar-nav">${links}
         <button type="button" class="nav-item" id="logoutBtn" title="Log Out"><span class="nav-icon">${ICONS.logout}</span><span class="nav-label">Log Out</span></button>
       </nav>
       <div class="sidebar-spacer"></div>
       <div class="sidebar-user"><strong>${esc(who)}</strong><span>${esc(dept)}</span></div>`;

    const img = $id("sidebar").querySelector(".sidebar-logo img");
    img.addEventListener("error", () => { img.parentNode.innerHTML = '<span class="logo-fallback">pynx</span>'; });
    $id("logoutBtn").addEventListener("click", logout);
    updateBadge();
  }

  async function logout() {
    const ok = await confirmBox({ title: "Log out?", message: "You will be returned to the login page.", confirmText: "Log out" });
    if (!ok) return;
    try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
    window.location.href = LOGIN_URL;
  }

  function setActive(key) {
    document.querySelectorAll("#sidebar .nav-item[data-key]").forEach(a => a.classList.toggle("active", a.dataset.key === key));
  }
  function updateBadge() {
    const badge = $id("navNotifBadge");
    if (badge) { const n = unreadCount(); badge.textContent = n; badge.hidden = n === 0; }
    if (pages[currentKey]) document.title = (unreadCount() ? "(" + unreadCount() + ") " : "") + pages[currentKey].title + " | PYNX Marketing";
  }

  function parseHash() {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/");
    return { key: pages[parts[0]] ? parts[0] : "dashboard", arg: parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null };
  }

  function render(isRefresh) {
    const route = parseHash();
    const page = pages[route.key];
    const view = $id("view");
    const y = window.scrollY;
    currentKey = route.key;
    if (!isRefresh) closeModals();
    try {
      view.innerHTML = "";
      page.render(view, isRefresh ? null : route.arg);
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="card"><h2 class="card-title">Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`;
    }
    setActive(route.key);
    updateBadge();
    window.scrollTo(0, isRefresh ? y : 0);
  }

  function go(hash) {
    if (window.location.hash === "#" + hash) render(false);
    else window.location.hash = hash;
  }

  /* ======================================================================
     6. DASHBOARD
     ====================================================================== */
  function requisitionRows(term) {
    term = (term || "").trim().toLowerCase();
    return requisitions()
      .filter(r => !term || [r.id, materialLabel(r), r.project, r.status].some(v => v.toLowerCase().indexOf(term) !== -1))
      .slice(0, 6)
      .map(r => `<tr class="row-link" data-open="${r.id}">
        <td>${r.id}</td><td class="product">${esc(materialLabel(r))}</td><td>${esc(r.project)}</td>
        <td class="right">${esc(qtyLabel(r))}</td><td>${fmtDate(r.createdAt)}</td><td>${statusBadge(r.status)}</td></tr>`).join("");
  }

  function pageDashboard(view) {
    const s = summary(), ds = designStats();
    const maxD = Math.max(ds.ongoing, ds.approved, ds.completed, 1);
    const notifs = state.notifications.slice(0, 4);
    const updates = requisitions().slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 4);
    const dateText = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const cards = [
      { label: "Pending Requests",   value: s.pending,   note: "Awaiting Admin approval" },
      { label: "Approved Requests",  value: s.approved,  note: "Ready for Inventory checking" },
      { label: "Rejected Requests",  value: s.rejected,  note: "Needs attention" },
      { label: "Completed Requests", value: s.completed, note: "Materials fully released" }
    ];

    view.innerHTML = `
    <div class="page">
      <header class="page-header"><h1>Welcome to Marketing!</h1><p>${dateText}</p></header>

      <section class="grid grid-3">
        <article class="card card-lg">
          <h2 class="card-title">Requisition History</h2>
          <p class="big-number">${s.total}</p>
          <p class="muted">Total submitted requisitions</p>
          <p class="muted small">Last submitted: ${s.last ? fmtDate(s.last.createdAt) + " · " + esc(materialLabel(s.last)) : "—"}</p>
          <a href="#requisition" class="btn btn-dark">+ New Requisition</a>
        </article>

        <article class="card card-lg">
          <h2 class="card-title">Design Projects</h2>
          <div class="bar-item"><div class="bar-label"><span>Ongoing (waiting for Admin)</span><strong>${ds.ongoing}</strong></div>${bar(ds.ongoing / maxD * 100)}</div>
          <div class="bar-item"><div class="bar-label"><span>Approved</span><strong>${ds.approved}</strong></div>${bar(ds.approved / maxD * 100)}</div>
          <div class="bar-item"><div class="bar-label"><span>Completed</span><strong>${ds.completed}</strong></div>${bar(ds.completed / maxD * 100)}</div>
          <a class="link-more" href="#designs">View all projects &rarr;</a>
        </article>

        <article class="card card-lg">
          <h2 class="card-title">Notifications <span class="count-badge">${unreadCount()}</span></h2>
          <ul class="notif-list">${notifs.length ? notifs.map(n =>
            `<li><span class="notif-text${n.read ? "" : " unread"}">${esc(n.text)}</span><span class="badge badge-${n.tone}">${esc(n.source)}</span></li>`).join("")
            : '<li class="muted">No notifications yet.</li>'}</ul>
          <a class="link-more" href="#notifications">View all notifications &rarr;</a>
        </article>
      </section>

      <section class="grid grid-4">${cards.map(c =>
        `<article class="stat-card"><p class="stat-label">${c.label}</p><p class="stat-value">${c.value}</p><p class="stat-note">${c.note}</p></article>`).join("")}</section>

      <section class="section">
        <div class="section-head"><h2>Recent Requisitions</h2><div class="section-tools">
          <input type="text" id="requisitionSearch" class="search-input" placeholder="Search requisition">
          <a href="#history" class="btn btn-light">View all requests &rarr;</a></div></div>
        <div class="card table-card"><table class="table"><thead><tr>
          <th>Request ID</th><th>Material</th><th>Project</th><th class="right">Quantity</th><th>Date</th><th>Status</th>
          </tr></thead><tbody id="requisitionTableBody">${requisitionRows("")}</tbody></table>
          <p class="empty-state" id="requisitionEmpty" hidden>No requisitions found.</p></div>
      </section>

      <section class="section">
        <div class="section-head"><h2>Latest Updates on Requested Materials</h2></div>
        <div class="card update-card"><ul class="update-list">${updates.length ? updates.map(r => {
          const last = r.timeline[r.timeline.length - 1] || { text: "" };
          const line = r.status === "Partial" || r.status === "Pending" || r.status === "Approved" ? statusText(r) : last.text;
          return `<li class="row-link" data-open="${r.id}"><div class="update-main"><strong>${esc(materialLabel(r))} · ${esc(qtyLabel(r))}</strong>
            <span>${r.id} · ${esc(line)}</span></div>${statusBadge(r.status)}</li>`;
        }).join("") : '<li class="muted">No updates yet.</li>'}</ul></div>
      </section>
    </div>`;

    const root = view.querySelector(".page");
    const input = root.querySelector("#requisitionSearch");
    const body = root.querySelector("#requisitionTableBody");
    const empty = root.querySelector("#requisitionEmpty");
    empty.hidden = body.children.length !== 0;
    input.addEventListener("input", () => { body.innerHTML = requisitionRows(input.value); empty.hidden = body.children.length !== 0; });
    root.addEventListener("click", e => { const row = e.target.closest("[data-open]"); if (row) openRequest(row.dataset.open); });
  }

  /* ======================================================================
     7. REQUISITION
     ====================================================================== */
  const blankForm = () => ({ project: "", neededBy: "", reason: "", rows: [{ name: "", qty: "" }] });
  let form = blankForm();
  let submitting = false;

  function projectOptions(selected) {
    const list = state.designs.slice().sort((a, b) => (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0) || a.name.localeCompare(b.name));
    const names = list.map(p => p.name);
    const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(l)}</option>`;
    let html = '<option value="">— Select project / purpose —</option><optgroup label="Design projects">';
    html += list.map(p => opt(p.name, p.name + " (" + p.status + ")", p.name === selected)).join("");
    if (selected && selected !== PROJECT_OTHER && names.indexOf(selected) === -1) html += opt(selected, selected, true);
    return html + '</optgroup><optgroup label="Other">' + opt(PROJECT_OTHER, PROJECT_OTHER, selected === PROJECT_OTHER) + "</optgroup>";
  }

  function rowMeta(r) {
    const p = product(r.name);
    if (!p) return { unit: "", hint: "", warn: false };
    if (p.stock <= 0) return { unit: p.unit, hint: "Out of stock right now — Inventory will need to restock before this can be released.", warn: true };
    if (Number(r.qty) > p.stock) return { unit: p.unit, hint: "Only " + fmtNum(p.stock) + " " + p.unit + " in stock. You can still submit; Inventory will check what can be released.", warn: true };
    if (p.stock <= p.min) return { unit: p.unit, hint: "Low stock: " + fmtNum(p.stock) + " " + p.unit + " left.", warn: true };
    return { unit: p.unit, hint: fmtNum(p.stock) + " " + p.unit + " available", warn: false };
  }

  function openRequestsHtml() {
    const list = requisitions().filter(r => r.status !== "Completed");
    if (!list.length) return '<p class="muted">You have no open requests.</p>';
    return '<ul class="req-list">' + list.map(r =>
      `<li class="req-item" data-open="${r.id}">
        <div class="req-top"><strong>${r.id}</strong>${statusBadge(r.status)}</div>
        <div class="req-material">${esc(materialLabel(r))} · ${esc(qtyLabel(r))}</div>
        <div class="muted">${esc(r.project)} · ${fmtDate(r.createdAt)}</div>
        ${r.status === "Partial" ? `<div class="req-progress">${bar(fulfilment(r))}<span class="muted">${fulfilment(r)}% released</span></div>` : ""}
        ${r.status === "Rejected" ? `<div class="remark remark-bad"><b>Admin remarks:</b> ${esc(r.remarks || "No remarks provided.")}</div>
          <button type="button" class="btn btn-light btn-sm" data-resubmit="${r.id}">Revise &amp; resubmit</button>` : ""}
      </li>`).join("") + "</ul>";
  }

  /* Status of every design project: Admin approval -> Inventory -> Purchasing */
  function designRequestRows() {
    if (!state.designs.length) return '<tr><td colspan="5" class="empty-state">No design projects yet.</td></tr>';
    return state.designs.slice().sort((a, b) =>
      (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt))
      .map(d => {
        const t = designTrack(d);
        return `<tr class="row-link" data-design="${esc(d.id)}">
          <td><strong>${esc(d.name)}</strong><span class="cell-sub">${esc(d.id)} · ${esc(d.category)} · ${esc(d.submittedFrom)}</span></td>
          <td>${plural(d.materials.length, "product")}</td>
          <td>${pill(t.admin)}<span class="cell-sub">${esc(t.admin.note)}</span></td>
          <td>${pill(t.inv)}<span class="cell-sub">${esc(t.inv.note)}</span></td>
          <td>${pill(t.pur)}<span class="cell-sub">${esc(t.pur.note)}</span></td></tr>`;
      }).join("");
  }

  function pageRequisition(view) {
    if (draft) {
      form = { project: draft.project || "", neededBy: "", reason: draft.reason || "",
        rows: draft.items && draft.items.length ? draft.items.map(i => ({ name: i.name, qty: i.qty })) : [{ name: "", qty: "" }] };
      draft = null;
    }

    view.innerHTML = `
    <div class="page">
      <header class="page-header"><h1>Requisition</h1><p>Request the materials and supplies you need. Admin approves first, then Inventory checks stock.</p></header>
      <div class="two-col">
        <section class="card"><h2 class="card-title">New Requisition</h2>
          <form id="reqForm" novalidate>
            <div class="form-grid">
              <div class="field"><label>Project / Purpose *</label><select name="project">${projectOptions(form.project)}</select></div>
              <div class="field"><label>Needed by *</label><input type="date" name="neededBy" min="${today()}" value="${esc(form.neededBy)}"></div>
              <div class="field full"><label>Reason for request *</label><textarea name="reason" rows="3" placeholder="Why do you need these materials?">${esc(form.reason)}</textarea></div>
            </div>
            <h3 class="sub-title">Materials needed</h3>
            <div id="itemRows"></div>
            <button type="button" class="btn btn-light btn-sm" id="addRow">+ Add material</button>
            <div class="form-error" id="formError" hidden></div>
            <div class="form-actions"><button type="button" class="btn btn-light" id="clearForm">Clear</button>
              <button type="submit" class="btn btn-dark">Submit to Admin</button></div>
          </form></section>
        <section class="card"><h2 class="card-title">Open Requests</h2><div id="openRequests">${openRequestsHtml()}</div></section>
      </div>

      <section class="section">
        <div class="section-head"><h2>Project Design Requests</h2></div>
        <p class="muted" style="margin:-6px 0 12px">Each design project is sent to Admin by the Marketing Department with all its products. Once approved it goes to Inventory, and to Purchasing if the products are not in stock.</p>
        <div class="card table-card"><table class="table"><thead><tr>
          <th>Project</th><th>Products</th><th>Admin approval</th><th>Inventory</th><th>Purchasing</th>
          </tr></thead><tbody>${designRequestRows()}</tbody></table></div>
      </section>
    </div>`;

    const root = view.querySelector(".page");
    const f = root.querySelector("#reqForm");
    const rowsEl = root.querySelector("#itemRows");
    const errEl = root.querySelector("#formError");

    function paintRows() {
      rowsEl.innerHTML = form.rows.map((r, i) => {
        const m = rowMeta(r);
        return `<div class="item-row" data-i="${i}">
          <div class="field"><select class="row-material">${materialOptions(r.name)}</select></div>
          <div class="field qty"><input type="number" class="row-qty" min="0" step="any" placeholder="Qty" value="${esc(r.qty)}"><span class="unit">${esc(m.unit)}</span></div>
          <button type="button" class="icon-btn row-remove" title="Remove material"${form.rows.length === 1 ? " disabled" : ""}>&times;</button>
          <p class="row-hint${m.warn ? " warn" : ""}">${esc(m.hint)}</p></div>`;
      }).join("");
    }
    function updateRow(el, i) {
      const m = rowMeta(form.rows[i]);
      el.querySelector(".unit").textContent = m.unit;
      const hint = el.querySelector(".row-hint");
      hint.textContent = m.hint;
      hint.classList.toggle("warn", m.warn);
    }
    paintRows();

    rowsEl.addEventListener("change", e => {
      if (!e.target.classList.contains("row-material")) return;
      const el = e.target.closest(".item-row"), i = +el.dataset.i;
      form.rows[i].name = e.target.value; updateRow(el, i);
    });
    rowsEl.addEventListener("input", e => {
      if (!e.target.classList.contains("row-qty")) return;
      const el = e.target.closest(".item-row"), i = +el.dataset.i;
      form.rows[i].qty = e.target.value; updateRow(el, i);
    });
    rowsEl.addEventListener("click", e => {
      const btn = e.target.closest(".row-remove");
      if (!btn || form.rows.length === 1) return;
      form.rows.splice(+btn.closest(".item-row").dataset.i, 1); paintRows();
    });
    root.querySelector("#addRow").addEventListener("click", () => { form.rows.push({ name: "", qty: "" }); paintRows(); });

    const sync = () => { form.project = f.project.value; form.neededBy = f.neededBy.value; form.reason = f.reason.value; };
    f.addEventListener("input", sync);
    f.addEventListener("change", sync);
    root.querySelector("#clearForm").addEventListener("click", () => { form = blankForm(); render(true); });

    f.addEventListener("submit", e => {
      e.preventDefault();
      sync();
      const errors = [];
      const add = msg => { if (errors.indexOf(msg) === -1) errors.push(msg); };
      if (!form.project) add("Choose the project or purpose of this request.");
      if (!form.neededBy) add("Select the date you need the materials.");
      else if (form.neededBy < today()) add("The needed-by date cannot be in the past.");
      if (form.reason.trim().length < 10) add("Explain why you need these materials (at least 10 characters).");
      const filled = form.rows.filter(r => r.name || r.qty);
      if (!filled.length) add("Add at least one material.");
      const seenNames = {};
      filled.forEach(r => {
        if (!r.name) { add("Choose a material for every row."); return; }
        if (seenNames[r.name]) add(r.name + " is listed more than once. Combine the quantities into one row.");
        seenNames[r.name] = true;
        if (!(Number(r.qty) > 0)) add("Enter a quantity greater than zero for " + r.name + ".");
      });
      if (errors.length) { errEl.hidden = false; errEl.innerHTML = "<ul>" + errors.map(m => `<li>${esc(m)}</li>`).join("") + "</ul>"; return; }
      errEl.hidden = true;

      confirmBox({
        title: "Submit requisition?",
        message: `Send <b>${filled.length} material${filled.length > 1 ? "s" : ""}</b> for <b>${esc(form.project)}</b> from the Marketing Department to Admin for approval?`,
        confirmText: "Submit"
      }).then(async ok => {
        if (!ok || submitting) return;
        submitting = true;
        const id = await act(() => addRequisition({ project: form.project, reason: form.reason.trim(), neededBy: form.neededBy, items: filled }));
        submitting = false;
        if (!id) return;
        form = blankForm();
        await act(reload);
        toast(id + " submitted to Admin.");
      });
    });

    root.addEventListener("click", e => {
      const re = e.target.closest("[data-resubmit]");
      if (re) { resubmit(re.dataset.resubmit); return; }
      const dz = e.target.closest("[data-design]");
      if (dz) { openDesign(dz.dataset.design); return; }
      const row = e.target.closest("[data-open]");
      if (row) openRequest(row.dataset.open);
    });
  }

  function resubmit(id) {
    const r = getRequisition(id);
    if (!r) return;
    draft = { project: r.project, reason: r.reason, items: r.items.map(i => ({ name: i.name, qty: i.qty })) };
    go("requisition");
    toast("Details copied into a new form. Review and resubmit.");
  }

  /* ======================================================================
     8. PROJECT DESIGNS (with cover photo)
     ====================================================================== */
  const dFilters = { q: "", status: "", category: "" };

  function designMatches(p) {
    const q = dFilters.q.trim().toLowerCase();
    if (dFilters.status && p.status !== dFilters.status) return false;
    if (dFilters.category && norm(p.category) !== norm(dFilters.category)) return false;
    return !q || (p.name + " " + p.description + " " + p.category).toLowerCase().indexOf(q) !== -1;
  }

  const lowProductCount = p => p.status === "Completed" ? 0 : p.materials.filter(x => {
    const pr = productFor(x);
    return pr && productStatus(pr) !== "ok";
  }).length;

  function designCard(p) {
    const cover = urlOf(p.coverPath);
    const thumb = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="thumb-ph">${esc(initials(p.name))}</div>`;
    const hint = p.status === "Ongoing" ? (p.returned ? "Returned by Admin · revise and resubmit" : "Sent by the " + p.submittedFrom + " · waiting for Admin approval") : "";
    const low = lowProductCount(p);
    return `<article class="design-card" data-open="${p.id}">
      <div class="design-thumb">${thumb}</div>
      <div class="design-body">
        <div class="design-top"><span class="tag">${esc(p.category)}</span>${designBadge(p.status)}</div>
        <h3>${esc(p.name)}</h3>
        <p class="muted clamp">${esc(p.description || "No description yet.")}</p>
        ${hint ? `<p class="${p.returned ? "design-warn" : "muted"}" style="margin:-6px 0 10px;font-size:12px">${esc(hint)}</p>` : ""}
        ${low ? `<p class="design-warn" style="margin:-4px 0 10px;font-size:12px">&#9888; ${plural(low, "product")} low in stock</p>` : ""}
        <div class="bar-label"><span>Progress</span><strong>${p.progress}%</strong></div>${bar(p.progress)}
        <p class="muted design-meta">${plural(p.materials.length, "product")} · ${plural(p.files.length, "file")} · Updated ${fmtDate(p.updatedAt)}</p>
      </div></article>`;
  }

  function pageDesigns(view) {
    const st = designStats();
    view.innerHTML = `
    <div class="page">
      <header class="page-header page-header-row"><div><h1>Project Designs</h1><p>Plan and track your business' product designs here, then send the whole design, with its products, to Admin for approval.</p></div>
        <button type="button" class="btn btn-dark" id="newProject">+ New Project</button></header>
      <section class="grid grid-4">${[["Total Projects", st.total, "All design projects"], ["Ongoing", st.ongoing, "Waiting for Admin approval"],
        ["Approved", st.approved, "Approved, not yet made"], ["Completed", st.completed, "Product is made"]].map(c =>
        `<article class="stat-card"><p class="stat-label">${c[0]}</p><p class="stat-value">${c[1]}</p><p class="stat-note">${c[2]}</p></article>`).join("")}</section>
      <div class="toolbar">
        <input type="text" id="dQ" class="search-input" placeholder="Search projects" value="${esc(dFilters.q)}">
        <select id="dStatus" class="select-input"><option value="">All statuses</option>
          ${["Ongoing", "Approved", "Completed"].map(s => `<option${dFilters.status === s ? " selected" : ""}>${s}</option>`).join("")}</select>
        <select id="dCat" class="select-input"><option value="">All categories</option>${categoryList().map(c =>
          `<option${norm(dFilters.category) === norm(c) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
      </div>
      <section class="design-grid" id="designGrid"></section>
    </div>`;

    const root = view.querySelector(".page");
    const grid = root.querySelector("#designGrid");
    const paint = () => {
      const list = state.designs.filter(designMatches);
      grid.innerHTML = list.length ? list.map(designCard).join("") : '<div class="card empty-card">No projects found. Create one with “+ New Project”.</div>';
    };
    paint();
    root.querySelector("#dQ").addEventListener("input", e => { dFilters.q = e.target.value; paint(); });
    root.querySelector("#dStatus").addEventListener("change", e => { dFilters.status = e.target.value; paint(); });
    root.querySelector("#dCat").addEventListener("change", e => { dFilters.category = e.target.value; paint(); });
    root.querySelector("#newProject").addEventListener("click", () => openDesignForm(null));
    grid.addEventListener("click", e => { const c = e.target.closest("[data-open]"); if (c) openDesign(c.dataset.open); });
  }

  const matPayload = m => {
    const p = product(m.name);
    return { sku: p ? p.sku : (m.sku || ""), name: p ? p.name : String(m.name || "").trim(),
      unit: p ? p.unit : (String(m.unit || "").trim() || "pcs"), qty: Number(m.qty) };
  };
  const designPayload = (d, over) => Object.assign({
    id: d.id, name: d.name, category: d.category, status: d.status, progress: d.progress,
    description: d.description, requirements: d.requirements, cover_path: d.coverPath || null,
    materials: d.materials.map(matPayload),
    files: d.files.map(f => ({ name: f.name, size: f.size, type: f.type, path: f.path }))
  }, over || {});

  function designSims(p) {
    if (p.status === "Ongoing") return p.returned ? [] : [["approve", "Admin approves project"], ["return", "Admin returns project"]];
    if (p.status === "Approved" && p.inventoryCheck === "Waiting") return [["has_stock", "Inventory has the products"], ["no_stock", "Inventory is short on stock"]];
    if (p.inventoryCheck === "Unavailable" && !p.sentToPurchasing) return [["to_purchasing", "Inventory sends it to Purchasing"]];
    if (p.sentToPurchasing) {
      const pp = designPurch(p.id), out = [];
      if (pp.requested) out.push(["purchased_in", "Purchasing bought it · now in Inventory"], ["purchased_out", "Purchasing bought it · not in Inventory yet"]);
      if (pp.purchased > pp.inInv) out.push(["arrived", "Purchased products arrive in Inventory"]);
      return out;
    }
    return [];
  }

  /* Product rows of a project: quantity needed, live stock from Inventory, and a red signal when low */
  function designProductRows(p) {
    if (!p.materials.length) return '<tr><td colspan="4" class="empty-state">No products listed.</td></tr>';
    return p.materials.map(x => {
      const pr = productFor(x);
      if (!pr) {
        return `<tr><td class="product">${esc(x.name)}</td><td class="right">${fmtNum(x.qty)} ${esc(x.unit)}</td>
          <td class="right">—</td><td><span class="badge badge-blue">New product</span></td></tr>`;
      }
      const st = productStatus(pr);
      const short = pr.stock < x.qty ? ' <span class="badge badge-red">Short by ' + fmtNum(x.qty - pr.stock) + "</span>" : "";
      return `<tr><td class="product">${esc(x.name)}</td><td class="right">${fmtNum(x.qty)} ${esc(x.unit)}</td>
        <td class="right"${stockStyle(st)}>${fmtNum(pr.stock)} ${esc(pr.unit)}</td><td>${stockBadge(st)}${short}</td></tr>`;
    }).join("");
  }
  const trackRows = t => `
    <tr><td class="product">Admin approval</td><td>${pill(t.admin)}</td><td>${esc(t.admin.note)}</td></tr>
    <tr><td class="product">Inventory check</td><td>${pill(t.inv)}</td><td>${esc(t.inv.note)}</td></tr>
    <tr><td class="product">Purchasing</td><td>${pill(t.pur)}</td><td>${esc(t.pur.note || "—")}</td></tr>`;
  const stampText = () => "Stock comes live from Inventory · checked " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

  async function openDesign(id) {
    try { await syncData(false); } catch (err) { console.warn(err); }
    const p = getDesign(id);
    if (!p) return;
    await ensureUrls(p.files.map(f => f.path));
    const cover = urlOf(p.coverPath);
    const sims = DEMO_TOOLS ? designSims(p) : [];
    let m = null;

    const refreshStock = () => {
      const cur = getDesign(id);
      if (!cur || !m) return;
      const rows = m.querySelector("#dpRows"), track = m.querySelector("#dpTrack"), stamp = m.querySelector("#dpStamp");
      if (rows) rows.innerHTML = designProductRows(cur);
      if (track) track.innerHTML = trackRows(designTrack(cur));
      if (stamp) stamp.textContent = stampText();
    };

    m = modal(`
      ${cover ? `<div class="detail-cover"><img src="${esc(cover)}" alt="Cover photo"></div>` : ""}
      <div class="modal-head"><div><h2 class="modal-title">${esc(p.name)}</h2><p class="muted">${esc(p.id)} · ${esc(p.category)} · From ${esc(p.submittedFrom)} · Updated ${fmtDate(p.updatedAt)}</p></div>${designBadge(p.status)}</div>
      <div class="bar-label"><span>Progress</span><strong>${p.progress}%</strong></div>${bar(p.progress)}
      ${p.returned ? `<div class="remark remark-bad" style="margin-top:14px"><b>Returned by Admin:</b> ${esc(p.adminRemarks || "Please revise and resubmit.")}</div>` : ""}

      <h3 class="sub-title">Approval &amp; product tracking</h3>
      <div class="table-scroll"><table class="table table-compact"><thead><tr><th>Step</th><th>Status</th><th>Details</th></tr></thead><tbody id="dpTrack">${trackRows(designTrack(p))}</tbody></table></div>

      <div class="detail-grid" style="margin-top:16px"><div class="full"><span>Description</span>${esc(p.description || "—")}</div>
        <div class="full"><span>Design Requirements / Materials needed</span>${esc(p.requirements || "—")}</div></div>
      <h3 class="sub-title">Product Classification</h3>
      <div class="table-scroll"><table class="table table-compact"><thead><tr><th>Product</th><th class="right">Quantity needed</th><th class="right">In stock now</th><th>Status</th></tr></thead><tbody id="dpRows">${designProductRows(p)}</tbody></table></div>
      <p class="muted" id="dpStamp" style="margin-top:6px">${stampText()}</p>
      <h3 class="sub-title">Design files</h3>
      ${p.files.length ? '<div class="file-list">' + p.files.map(f => {
        const u = urlOf(f.path);
        const ico = f.type.indexOf("image/") === 0 && u ? `<img src="${esc(u)}" alt="">` : `<span>${esc(ext(f.name))}</span>`;
        const inner = `<div class="file-ico">${ico}</div><div class="file-info"><strong>${esc(f.name)}</strong><span>${fmtSize(f.size)}${u ? " · click to open" : ""}</span></div>`;
        return u ? `<a class="file-row" href="${esc(u)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="file-row">${inner}</div>`;
      }).join("") + "</div>" : '<p class="muted">No files attached.</p>'}
      ${sims.length ? `<div class="demo-box"><p><b>Demo tools</b> — pretend to be another department to see how this project moves forward. Remove when the Admin, Inventory and Purchasing pages are connected.</p>
        <div class="demo-btns">${sims.map(s => `<button type="button" class="btn btn-light btn-sm" data-sim="${s[0]}">${s[1]}</button>`).join("")}</div></div>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" data-delete>Delete</button>
        ${p.status !== "Ongoing" ? `<button type="button" class="btn btn-light" data-toggle>${p.status === "Completed" ? "Set back to approved" : "Mark as completed"}</button>` : ""}
        <button type="button" class="btn btn-light" data-edit>${p.returned ? "Edit &amp; resubmit" : "Edit"}</button>
        <button type="button" class="btn btn-light" data-close>Close</button>
      </div>`, { wide: true, onClose: () => { if (onSynced === refreshStock) onSynced = null; } });
    onSynced = refreshStock;

    m.addEventListener("click", async e => {
      const sim = e.target.closest("[data-sim]");
      if (sim) {
        sim.disabled = true;
        const ok = await act(async () => { await demoDesignStep(id, sim.dataset.sim); await reload(); }, "Project updated.");
        if (ok) { m.close(); openDesign(id); } else sim.disabled = false;
        return;
      }
      if (e.target.closest("[data-edit]")) { m.close(); openDesignForm(id); }
      else if (e.target.closest("[data-toggle]")) {
        const cur = getDesign(id) || p;
        const completing = cur.status !== "Completed";
        await act(async () => {
          await saveDesignRpc(designPayload(cur, { status: completing ? "Completed" : "Approved", progress: completing ? 100 : 90 }));
          m.close(); await reload();
        }, "Project status updated.");
      } else if (e.target.closest("[data-delete]")) {
        const cur = getDesign(id) || p;
        const ok = await confirmDeleteProject(cur);
        if (!ok) return;
        await act(async () => {
          const { data, error } = await sb.from("marketing_designs").delete().eq("id", id).select("id");
          if (error) throw error;
          if (!data || !data.length) throw new Error("You do not have permission to delete this project.");
          removeFiles([cur.coverPath].concat(cur.files.map(f => f.path)).filter(Boolean));
          m.close(); await reload();
        }, "Project deleted permanently.");
      }
    });
  }

  async function uploadFile(file) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = uid() + "/" + safe;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false, cacheControl: "3600" });
    if (error) throw error;
    return path;
  }

  /* Uploads new photos/files first, then saves everything in one database call */
  async function persistDesign(s, existingId) {
    const uploaded = [];
    try {
      let coverPath = s.cover && s.cover.path ? s.cover.path : null;
      if (s.cover && s.cover.file) { coverPath = await uploadFile(s.cover.file); uploaded.push(coverPath); }
      const files = [];
      for (const f of s.files) {
        if (f.file) { const p = await uploadFile(f.file); uploaded.push(p); files.push({ name: f.name, size: f.size, type: f.type, path: p }); }
        else files.push({ name: f.name, size: f.size, type: f.type, path: f.path });
      }
      const id = await saveDesignRpc({
        id: existingId, name: s.name, category: s.category, status: s.status, progress: Number(s.progress),
        description: s.description, requirements: s.requirements, cover_path: coverPath,
        materials: s.materials.map(matPayload), files
      });
      removeFiles(s.removed);
      return id;
    } catch (err) {
      removeFiles(uploaded);
      throw err;
    }
  }

  function openDesignForm(id) {
    const existing = id ? getDesign(id) : null;
    const locked = !!existing && existing.status !== "Ongoing";   // approved products cannot change
    const s = existing ? {
      name: existing.name, category: existing.category, status: existing.status, progress: existing.progress,
      description: existing.description, requirements: existing.requirements,
      materials: existing.materials.map(x => ({ name: x.name, qty: x.qty, sku: x.sku, unit: x.unit })),
      files: existing.files.map(f => ({ name: f.name, size: f.size, type: f.type, path: f.path })),
      cover: existing.coverPath ? { path: existing.coverPath, url: urlOf(existing.coverPath) } : null, removed: []
    } : { name: "", category: "", status: "Ongoing", progress: 0, description: "", requirements: "",
          materials: [{ name: "", qty: "" }], files: [], cover: null, removed: [] };

    const saveLabel = !existing ? "Submit to Admin" : existing.returned ? "Save & resubmit" : "Save changes";
    const statusField = locked
      ? `<div class="field"><label>Status</label><select name="status">
           <option value="Approved"${existing.status === "Approved" ? " selected" : ""}>Approved (in production)</option>
           <option value="Completed"${existing.status === "Completed" ? " selected" : ""}>Completed (product is made)</option></select></div>`
      : `<div class="field"><label>Status</label><input type="text" value="Ongoing — waiting for Admin approval" disabled></div>`;

    const m = modal(`
      <h2 class="modal-title">${existing ? "Edit Design Project" : "New Design Project"}</h2>
      ${!existing ? `<div class="remark">The whole project — design details, files and every product below — is sent to Admin <b>from the ${DEPT_FROM}</b> for approval. Its status starts as <b>Ongoing</b> and changes to <b>Approved</b> once Admin approves.</div>` : ""}
      ${existing && existing.returned ? `<div class="remark remark-bad"><b>Returned by Admin:</b> ${esc(existing.adminRemarks || "Please revise and resubmit.")}</div>` : ""}
      <form id="designForm" novalidate>
        <h3 class="sub-title" style="margin-top:6px">Cover photo</h3>
        <div class="cover-preview" id="dCover"></div>
        <div class="cover-actions">
          <label class="btn btn-light btn-sm file-add">Choose photo<input type="file" id="dCoverInput" accept="image/*" hidden></label>
          <button type="button" class="btn btn-light btn-sm" id="dCoverRemove">Remove photo</button>
        </div>
        <p class="muted" style="margin:6px 0 16px">JPG, PNG, WEBP or GIF · up to 5 MB. Shown on the project card.</p>

        <div class="form-grid">
          <div class="field full"><label>Project name *</label><input type="text" name="pname" maxlength="80" value="${esc(s.name)}" placeholder="e.g. Vintage Cup"></div>
          <div class="field"><label>Category *</label>
            <input type="text" name="category" list="catList" maxlength="40" autocomplete="off" placeholder="Choose or type a new category" value="${esc(s.category)}">
            <datalist id="catList">${categoryList().map(c => `<option value="${esc(c)}"></option>`).join("")}</datalist>
            <p class="muted" style="margin-top:4px">Type a new name to add it as a new category.</p></div>
          ${statusField}
          <div class="field full"><label>Progress: <b id="progVal">${s.progress}%</b></label><input type="range" name="progress" min="0" max="100" step="5" value="${s.progress}"></div>
          <div class="field full"><label>Description</label><textarea name="description" rows="2">${esc(s.description)}</textarea></div>
          <div class="field full"><label>Design Requirements / Materials needed</label><textarea name="requirements" rows="2">${esc(s.requirements)}</textarea></div>
        </div>
        <h3 class="sub-title">Product Classification</h3>
        <datalist id="matList">${state.catalog.map(p => `<option value="${esc(p.name)}"></option>`).join("")}</datalist>
        <div id="dMats"></div>
        ${locked ? '<p class="muted" style="margin-top:8px">Products were approved by Admin and can no longer be edited.</p>'
                 : '<button type="button" class="btn btn-light btn-sm" id="dAddMat">+ Add Product</button><p class="muted" style="margin-top:8px">Type any product. Names that are not in Inventory are listed as new design products.</p>'}
        <h3 class="sub-title">Design files &amp; references</h3><div class="file-list" id="dFiles"></div>
        <label class="btn btn-light btn-sm file-add">+ Add files<input type="file" id="dFileInput" multiple accept="image/*,.pdf,.svg,.ai,.psd,.zip,.doc,.docx" hidden></label>
        <input type="file" id="dReplaceInput" hidden>
        <p class="muted" style="margin-top:8px">Up to ${MAX_FILES} files, 10 MB each. Files are stored securely in your database.</p>
        <div class="form-error" id="dError" hidden></div>
        <div class="modal-actions"><button type="button" class="btn btn-light" data-close>Cancel</button>
          <button type="submit" class="btn btn-dark" id="dSave">${saveLabel}</button></div>
      </form>`, { wide: true });

    const f = m.querySelector("#designForm");
    const matsEl = m.querySelector("#dMats");
    const filesEl = m.querySelector("#dFiles");
    const errEl = m.querySelector("#dError");
    const coverEl = m.querySelector("#dCover");
    const coverRemove = m.querySelector("#dCoverRemove");
    let replaceIdx = -1;

    const matHint = r => {
      const p = product(r.name);
      if (p) return "Existing product · " + fmtNum(p.stock) + " " + p.unit + " in stock" + (productStatus(p) !== "ok" ? " (low stock)" : "");
      return String(r.name || "").trim() ? "New product · will be listed as a new design product" : "";
    };

    function paintCover() {
      const url = s.cover ? (s.cover.objectUrl || s.cover.url) : "";
      coverEl.innerHTML = url ? `<img src="${esc(url)}" alt="Cover photo">` : '<span class="muted">No cover photo yet</span>';
      coverRemove.hidden = !s.cover;
    }
    function paintMats() {
      if (locked) {
        matsEl.innerHTML = s.materials.length ? `<div class="table-scroll"><table class="table table-compact"><thead><tr><th>Product</th><th class="right">Quantity</th></tr></thead><tbody>${
          s.materials.map(x => `<tr><td class="product">${esc(x.name)}</td><td class="right">${fmtNum(x.qty)}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">No products listed.</p>';
        return;
      }
      matsEl.innerHTML = s.materials.length ? s.materials.map((r, i) =>
        `<div class="item-row" data-i="${i}">
          <div class="field"><input type="text" class="row-name" list="matList" autocomplete="off" placeholder="Type or choose a product" value="${esc(r.name)}"></div>
          <div class="field"><input type="number" class="row-qty" min="0" step="any" placeholder="Qty" value="${esc(r.qty || "")}"></div>
          <button type="button" class="icon-btn row-remove" title="Remove product">&times;</button>
          <p class="row-hint">${esc(matHint(r))}</p></div>`).join("")
        : '<p class="muted">No products listed yet.</p>';
    }
    function paintFiles() {
      filesEl.innerHTML = s.files.length ? s.files.map((fl, i) =>
        `<div class="file-row"><div class="file-ico"><span>${esc(ext(fl.name))}</span></div>
          <div class="file-info"><strong>${esc(fl.name)}</strong><span>${fmtSize(fl.size)}</span></div>
          <button type="button" class="btn btn-light btn-sm" data-replace="${i}">Replace</button>
          <button type="button" class="icon-btn" data-remove="${i}" title="Remove file">&times;</button></div>`).join("")
        : '<p class="muted">No files added yet.</p>';
    }
    paintCover(); paintMats(); paintFiles();

    m.querySelector("#dCoverInput").addEventListener("change", e => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.type.indexOf("image/") !== 0) return toast("Please choose an image file (JPG, PNG, WEBP or GIF).", "error");
      if (file.size > MAX_COVER_BYTES) return toast("The cover photo must be 5 MB or smaller.", "error");
      if (s.cover && s.cover.path) s.removed.push(s.cover.path);
      if (s.cover && s.cover.objectUrl) URL.revokeObjectURL(s.cover.objectUrl);
      s.cover = { file, objectUrl: URL.createObjectURL(file) };
      paintCover();
    });
    coverRemove.addEventListener("click", () => {
      if (s.cover && s.cover.path) s.removed.push(s.cover.path);
      if (s.cover && s.cover.objectUrl) URL.revokeObjectURL(s.cover.objectUrl);
      s.cover = null; paintCover();
    });

    f.progress.addEventListener("input", () => { m.querySelector("#progVal").textContent = f.progress.value + "%"; });
    if (f.status && f.status.tagName === "SELECT") {
      f.status.addEventListener("change", () => {
        if (f.status.value === "Completed") { f.progress.value = 100; m.querySelector("#progVal").textContent = "100%"; }
      });
    }

    const addMat = m.querySelector("#dAddMat");
    if (addMat) addMat.addEventListener("click", () => { s.materials.push({ name: "", qty: "" }); paintMats(); });
    matsEl.addEventListener("input", e => {
      const row = e.target.closest(".item-row");
      if (!row) return;
      const i = +row.dataset.i;
      if (e.target.classList.contains("row-name")) { s.materials[i].name = e.target.value; row.querySelector(".row-hint").textContent = matHint(s.materials[i]); }
      else if (e.target.classList.contains("row-qty")) s.materials[i].qty = e.target.value;
    });
    matsEl.addEventListener("change", e => {
      if (!e.target.classList.contains("row-name")) return;
      const row = e.target.closest(".item-row"), i = +row.dataset.i, p = product(e.target.value);
      if (p) { s.materials[i].name = p.name; e.target.value = p.name; }
      row.querySelector(".row-hint").textContent = matHint(s.materials[i]);
    });
    matsEl.addEventListener("click", e => { const b = e.target.closest(".row-remove"); if (b) { s.materials.splice(+b.closest(".item-row").dataset.i, 1); paintMats(); } });

    m.querySelector("#dFileInput").addEventListener("change", e => {
      const list = Array.prototype.slice.call(e.target.files);
      e.target.value = "";
      let dup = 0, full = 0, big = 0;
      list.forEach(file => {
        if (s.files.length >= MAX_FILES) { full++; return; }
        if (file.size > MAX_FILE_BYTES) { big++; return; }
        if (s.files.some(x => x.name.toLowerCase() === file.name.toLowerCase())) { dup++; return; }
        s.files.push({ name: file.name, size: file.size, type: file.type, file });
      });
      paintFiles();
      if (dup) toast(dup + " file(s) skipped: same name already added. Use Replace instead.", "error");
      if (full) toast("You can attach up to " + MAX_FILES + " files per project.", "error");
      if (big) toast(big + " file(s) skipped: files must be 10 MB or smaller.", "error");
    });
    filesEl.addEventListener("click", e => {
      const rm = e.target.closest("[data-remove]"), rp = e.target.closest("[data-replace]");
      if (rm) { const old = s.files.splice(+rm.dataset.remove, 1)[0]; if (old && old.path) s.removed.push(old.path); paintFiles(); }
      if (rp) { replaceIdx = +rp.dataset.replace; m.querySelector("#dReplaceInput").click(); }
    });
    m.querySelector("#dReplaceInput").addEventListener("change", e => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file || replaceIdx < 0) return;
      if (file.size > MAX_FILE_BYTES) { replaceIdx = -1; return toast("Files must be 10 MB or smaller.", "error"); }
      const old = s.files[replaceIdx];
      if (old && old.path) s.removed.push(old.path);
      s.files[replaceIdx] = { name: file.name, size: file.size, type: file.type, file };
      replaceIdx = -1; paintFiles(); toast("File replaced.");
    });

    f.addEventListener("submit", async e => {
      e.preventDefault();
      const name = f.pname.value.trim();
      let category = f.category.value.replace(/\s+/g, " ").trim();
      const errors = [];
      const add = msg => { if (errors.indexOf(msg) === -1) errors.push(msg); };
      if (name.length < 2) add("Enter the project name.");
      else if (state.designs.some(p => p.id !== (existing && existing.id) && norm(p.name) === norm(name))) add("Another project already uses this name.");
      if (category.length < 2) add("Choose or type a category (at least 2 characters).");
      else if (category.length > 40) add("The category name must be 40 characters or fewer.");
      else {
        const known = categoryList().filter(c => norm(c) === norm(category))[0];
        if (known) category = known;
      }

      let mats = s.materials;
      if (!locked) {
        mats = s.materials.filter(r => String(r.name || "").trim() || r.qty);
        if (!mats.length) add("Add at least one product.");
        const seenMats = {};
        mats.forEach(r => {
          const nm = String(r.name || "").trim();
          if (!nm) { add("Type a product name for every row (or remove the empty row)."); return; }
          if (seenMats[norm(nm)]) add(nm + " is listed more than once.");
          seenMats[norm(nm)] = true;
          if (!(Number(r.qty) > 0)) add("Enter a quantity greater than zero for " + nm + ".");
        });
      }
      if (errors.length) { errEl.hidden = false; errEl.innerHTML = "<ul>" + errors.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>"; return; }
      errEl.hidden = true;

      s.name = name; s.category = category;
      s.status = locked ? f.status.value : "Ongoing";
      s.progress = f.progress.value;
      s.description = f.description.value; s.requirements = f.requirements.value;
      s.materials = mats;

      const btn = m.querySelector("#dSave");
      btn.disabled = true; btn.textContent = "Saving…";
      const ok = await act(async () => { await persistDesign(s, existing ? existing.id : null); });
      if (!ok) { btn.disabled = false; btn.textContent = saveLabel; return; }
      m.close();
      await act(reload);
      toast(!existing ? "Project sent to Admin from the " + DEPT_FROM + " for approval." : existing.returned ? "Project resubmitted to Admin." : "Project updated.");
    });
    f.pname.focus();
  }

  /* ======================================================================
     9. PRODUCTS & MATERIALS (live from Inventory + new design products)
     ====================================================================== */
  const pFilters = { q: "", category: "", avail: "", sort: "name-asc" };

  function filteredProducts() {
    const q = pFilters.q.trim().toLowerCase();
    const list = state.catalog.filter(p => {
      if (pFilters.category && p.category !== pFilters.category) return false;
      if (pFilters.avail && productStatus(p) !== pFilters.avail) return false;
      return !q || (p.name + " " + p.category + " " + p.supplier + " " + p.location + " " + p.sku).toLowerCase().indexOf(q) !== -1;
    });
    list.sort((a, b) => pFilters.sort === "stock-asc" ? a.stock - b.stock : pFilters.sort === "stock-desc" ? b.stock - a.stock : a.name.localeCompare(b.name));
    return list;
  }

  /* Products typed in design projects that Inventory does not have yet */
  function newDesignProducts() {
    const rows = [];
    state.designs.forEach(d => {
      if (d.status === "Completed") return;
      d.materials.forEach(x => {
        if (!productFor(x)) rows.push({ name: x.name, qty: x.qty, project: d.name, status: d.status, designId: d.id });
      });
    });
    return rows;
  }

  function pageProducts(view) {
    const cats = state.catalog.map(p => p.category).filter((c, i, a) => a.indexOf(c) === i).sort();
    const count = s => state.catalog.filter(p => productStatus(p) === s).length;
    const newCount = newDesignProducts().length;

    view.innerHTML = `
    <div class="page">
      <header class="page-header"><h1>Products &amp; Materials</h1><p>Existing products from Inventory, updated live, plus new products that your ongoing design projects need. Low stock shows in red. This page is view-only.</p></header>
      ${state.catalogError ? '<div class="notice">The product list could not be loaded. Make sure the Inventory SQL was run in Supabase.</div>' : ""}
      <section class="grid grid-4">${[["Existing Products", state.catalog.length, "Registered by Inventory"], ["In Stock", count("ok"), "Available right now"],
        ["Low / Out of Stock", count("low") + count("out"), "Limited or unavailable"], ["New Design Products", newCount, "From ongoing design projects"]].map(c =>
        `<article class="stat-card"><p class="stat-label">${c[0]}</p><p class="stat-value"${c[0] === "Low / Out of Stock" && c[1] > 0 ? LOW_STYLE : ""}>${c[1]}</p><p class="stat-note">${c[2]}</p></article>`).join("")}</section>

      <div class="toolbar">
        <input type="text" id="pQ" class="search-input" placeholder="Search product, category, supplier or project" value="${esc(pFilters.q)}">
        <select id="pCat" class="select-input"><option value="">All categories</option>${cats.map(c => `<option${pFilters.category === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="pAvail" class="select-input">${[["", "All availability"], ["ok", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]].map(o =>
          `<option value="${o[0]}"${pFilters.avail === o[0] ? " selected" : ""}>${o[1]}</option>`).join("")}</select>
        <select id="pSort" class="select-input">${[["name-asc", "Sort: Name (A–Z)"], ["stock-asc", "Sort: Stock (low → high)"], ["stock-desc", "Sort: Stock (high → low)"]].map(o =>
          `<option value="${o[0]}"${pFilters.sort === o[0] ? " selected" : ""}>${o[1]}</option>`).join("")}</select>
      </div>

      <section class="section" style="margin-top:8px">
        <div class="section-head"><h2>Existing products</h2></div>
        <div class="card table-card"><table class="table"><thead><tr><th>Product</th><th>Category</th><th class="right">Available</th><th>Unit</th><th>Status</th></tr></thead>
          <tbody id="pBody"></tbody></table></div>
        <p class="muted" id="pCount" style="margin-top:10px"></p>
      </section>

      <section class="section">
        <div class="section-head"><h2>Ongoing new design products</h2></div>
        <p class="muted" style="margin:-6px 0 12px">Products typed into design projects that are not in Inventory yet. They leave this list when the project is completed.</p>
        <div class="card table-card"><table class="table"><thead><tr><th>Product</th><th>Design project</th><th class="right">Quantity</th><th>Project status</th></tr></thead>
          <tbody id="nBody"></tbody></table></div>
        <p class="muted" id="nCount" style="margin-top:10px"></p>
      </section>
    </div>`;

    const root = view.querySelector(".page");
    const body = root.querySelector("#pBody");
    const nBody = root.querySelector("#nBody");
    const paint = () => {
      const list = filteredProducts();
      body.innerHTML = list.length ? list.map(p => {
        const st = productStatus(p);
        return `<tr><td><strong>${esc(p.name)}</strong><span class="cell-sub">${esc([p.supplier, p.location].filter(Boolean).join(" · ") || p.sku)}</span></td>
          <td>${esc(p.category)}</td><td class="right"${stockStyle(st)}>${fmtNum(p.stock)}</td><td>${esc(p.unit)}</td><td>${stockBadge(st)}</td></tr>`;
      }).join("")
        : '<tr><td colspan="5" class="empty-state">No products match your filters.</td></tr>';
      root.querySelector("#pCount").textContent = plural(list.length, "existing product") + " shown";

      const q = pFilters.q.trim().toLowerCase();
      const nl = newDesignProducts().filter(x => !q || (x.name + " " + x.project).toLowerCase().indexOf(q) !== -1);
      nBody.innerHTML = nl.length ? nl.map(x =>
        `<tr class="row-link" data-design="${esc(x.designId)}"><td><strong>${esc(x.name)}</strong><span class="cell-sub">New design product</span></td>
          <td>${esc(x.project)}</td><td class="right">${fmtNum(x.qty)}</td><td>${designBadge(x.status)}</td></tr>`).join("")
        : '<tr><td colspan="4" class="empty-state">No new design products right now.</td></tr>';
      root.querySelector("#nCount").textContent = plural(nl.length, "new product") + " shown";
    };
    paint();
    root.querySelector("#pQ").addEventListener("input", e => { pFilters.q = e.target.value; paint(); });
    root.querySelector("#pCat").addEventListener("change", e => { pFilters.category = e.target.value; paint(); });
    root.querySelector("#pAvail").addEventListener("change", e => { pFilters.avail = e.target.value; paint(); });
    root.querySelector("#pSort").addEventListener("change", e => { pFilters.sort = e.target.value; paint(); });
    nBody.addEventListener("click", e => { const r = e.target.closest("[data-design]"); if (r) openDesign(r.dataset.design); });
  }

  /* ======================================================================
     10. REQUEST HISTORY (+ request detail window used by every page)
     ====================================================================== */
  const hFilters = { q: "", status: "", from: "", to: "" };

  function filteredRequests() {
    const q = hFilters.q.trim().toLowerCase();
    return requisitions().filter(r => {
      const day = dateKey(r.createdAt);
      if (hFilters.status && r.status !== hFilters.status) return false;
      if (hFilters.from && day < hFilters.from) return false;
      if (hFilters.to && day > hFilters.to) return false;
      if (!q) return true;
      return [r.id, r.project, r.reason, r.status].concat(r.items.map(i => i.name)).join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }

  function historyRows(list) {
    if (!list.length) return '<tr><td colspan="7" class="empty-state">No requests match your filters.</td></tr>';
    return list.map(r => {
      const pct = fulfilment(r);
      const showBar = r.status === "Approved" || r.status === "Partial" || r.status === "Completed";
      return `<tr class="row-link" data-open="${r.id}">
        <td><strong>${r.id}</strong></td><td>${fmtDate(r.createdAt)}</td><td class="product">${esc(materialLabel(r))}</td>
        <td>${esc(r.project)}</td><td class="right">${esc(qtyLabel(r))}</td><td>${statusBadge(r.status)}</td>
        <td class="fulfil">${showBar ? bar(pct) + `<span class="muted">${pct}% released</span>` : '<span class="muted">—</span>'}</td></tr>`;
    }).join("");
  }

  /* New design products appear here only after Purchasing has bought them */
  function purchaseRows() {
    const q = hFilters.q.trim().toLowerCase();
    const list = state.purchasing.filter(x => x.designId && x.status === "Purchased").filter(x => {
      if (!q) return true;
      const d = getDesign(x.designId);
      return (x.id + " " + x.product + " " + (d ? d.name : "")).toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) return '<tr><td colspan="7" class="empty-state">Nothing has been purchased for your design projects yet.</td></tr>';
    return list.map(x => {
      const d = getDesign(x.designId);
      return `<tr class="row-link" data-design="${esc(x.designId)}">
        <td><strong>${esc(x.id)}</strong></td><td>${esc(d ? d.name : "—")}</td><td class="product">${esc(x.product)}</td>
        <td class="right">${fmtNum(x.qty)} ${esc(x.unit)}</td><td>${esc(x.requestedBy)}</td><td>${fmtDate(x.updatedAt)}</td>
        <td>${x.inInventory ? '<span class="badge badge-green">In Inventory</span>' : '<span class="badge badge-yellow">Not in Inventory yet</span>'}</td></tr>`;
    }).join("");
  }

  function pageHistory(view, arg) {
    if (arg && arg.indexOf("status-") === 0) hFilters.status = arg.slice(7);

    view.innerHTML = `
    <div class="page">
      <header class="page-header page-header-row"><div><h1>Request History</h1><p>Every requisition submitted by Marketing, with approval remarks and release progress.</p></div>
        <button type="button" class="btn btn-light" id="exportCsv">Export CSV</button></header>
      <div class="toolbar">
        <input type="text" id="hQ" class="search-input" placeholder="Search ID, material, project" value="${esc(hFilters.q)}">
        <select id="hStatus" class="select-input"><option value="">All statuses</option>${["Pending", "Approved", "Partial", "Rejected", "Completed"].map(s =>
          `<option value="${s}"${hFilters.status === s ? " selected" : ""}>${s === "Partial" ? "Partially fulfilled" : s}</option>`).join("")}</select>
        <label class="date-filter">From <input type="date" id="hFrom" value="${hFilters.from}"></label>
        <label class="date-filter">To <input type="date" id="hTo" value="${hFilters.to}"></label>
        <button type="button" class="link-btn" id="hClear">Clear filters</button>
      </div>
      <div class="card table-card"><table class="table"><thead><tr>
        <th>Request ID</th><th>Date</th><th>Material</th><th>Project</th><th class="right">Quantity</th><th>Status</th><th>Fulfilment</th>
        </tr></thead><tbody id="hBody"></tbody></table></div>
      <p class="muted" id="hCount" style="margin-top:10px"></p>

      <section class="section">
        <div class="section-head"><h2>New Design Purchases</h2></div>
        <p class="muted" style="margin:-6px 0 12px">Shown only after Purchasing has bought the products for a new design. It tells you whether they are already in Inventory.</p>
        <div class="card table-card"><table class="table"><thead><tr>
          <th>Purchase ID</th><th>Design project</th><th>Product</th><th class="right">Quantity</th><th>Requested by</th><th>Purchased</th><th>Inventory</th>
          </tr></thead><tbody id="pcBody"></tbody></table></div>
      </section>
    </div>`;

    const root = view.querySelector(".page");
    const body = root.querySelector("#hBody");
    const pcBody = root.querySelector("#pcBody");
    const paint = () => {
      const list = filteredRequests();
      body.innerHTML = historyRows(list);
      pcBody.innerHTML = purchaseRows();
      root.querySelector("#hCount").textContent = plural(list.length, "request") + " shown";
    };
    paint();

    root.querySelector("#hQ").addEventListener("input", e => { hFilters.q = e.target.value; paint(); });
    root.querySelector("#hStatus").addEventListener("change", e => { hFilters.status = e.target.value; paint(); });
    root.querySelector("#hFrom").addEventListener("change", e => { hFilters.from = e.target.value; paint(); });
    root.querySelector("#hTo").addEventListener("change", e => { hFilters.to = e.target.value; paint(); });
    root.querySelector("#hClear").addEventListener("click", () => { hFilters.q = hFilters.status = hFilters.from = hFilters.to = ""; render(true); });
    root.querySelector("#exportCsv").addEventListener("click", () => {
      const list = filteredRequests();
      if (!list.length) return toast("Nothing to export for these filters.", "error");
      downloadCSV("pynx-marketing-requests-" + today() + ".csv",
        [["Request ID", "Date", "Project", "Reason", "Materials", "Status", "Fulfilment %", "Admin remarks", "Needed by"]].concat(
          list.map(r => [r.id, fmtDate(r.createdAt), r.project, r.reason,
            r.items.map(i => i.name + " " + i.qty + " " + i.unit + " (released " + i.released + ")").join("; "),
            r.status, fulfilment(r), r.remarks, r.neededBy])));
    });
    body.addEventListener("click", e => { const row = e.target.closest("[data-open]"); if (row) openRequest(row.dataset.open); });
    pcBody.addEventListener("click", e => { const row = e.target.closest("[data-design]"); if (row) openDesign(row.dataset.design); });
    if (arg && /^REQ-\d+$/.test(arg)) openRequest(arg);
  }

  function openRequest(id) {
    if (!getRequisition(id)) { toast("Request not found.", "error"); return; }
    const m = modal("", { wide: true, onClose: () => { if (/^#history\/REQ/.test(window.location.hash)) history.replaceState(null, "", "#history"); } });
    const box = m.querySelector(".modal");

    function simButtons(r) {
      if (r.status === "Pending") return [["approve", "Admin approves"], ["reject", "Admin returns it"]];
      if (r.status === "Approved" && !r.inventoryConfirmed) return [["confirm", "Inventory confirms stock"]];
      if (r.inventoryConfirmed && (r.status === "Approved" || r.status === "Partial")) return [["release_partial", "Inventory releases part"], ["release_all", "Inventory releases all"]];
      return [];
    }

    function paint() {
      const r = getRequisition(id);
      if (!r) { m.close(); return; }
      const sims = DEMO_TOOLS ? simButtons(r) : [];
      box.innerHTML = `
        <div class="modal-head"><div><h2 class="modal-title">${r.id}</h2><p class="muted">Submitted ${fmtDate(r.createdAt)} · Needed by ${fmtDate(r.neededBy)}</p></div>${statusBadge(r.status)}</div>
        <div class="detail-grid">
          <div><span>Project / Purpose</span>${esc(r.project)}</div>
          <div><span>Current update</span>${esc(statusText(r))}</div>
          <div class="full"><span>Reason for request</span>${esc(r.reason)}</div>
        </div>
        <div class="table-scroll"><table class="table table-compact"><thead><tr><th>Material</th><th class="right">Requested</th><th class="right">Released</th><th class="right">Remaining</th></tr></thead><tbody>${
          r.items.map(i => { const rem = Math.max(0, i.qty - i.released);
            return `<tr><td class="product">${esc(i.name)}</td><td class="right">${fmtNum(i.qty)} ${esc(i.unit)}</td><td class="right">${fmtNum(i.released)}</td>
              <td class="right">${rem ? fmtNum(rem) : '<span class="badge badge-green">Done</span>'}</td></tr>`; }).join("")}</tbody></table></div>
        ${r.remarks ? `<div class="remark ${r.status === "Rejected" ? "remark-bad" : ""}"><b>Admin remarks:</b> ${esc(r.remarks)}</div>` : ""}
        <h3 class="sub-title">Activity</h3>
        <ul class="timeline">${r.timeline.map(t => `<li><b>${esc(t.by)}</b> · ${esc(t.text)}<span>${fmtDateTime(t.at)}</span></li>`).join("")}</ul>
        ${sims.length ? `<div class="demo-box"><p><b>Demo tools</b> — pretend to be another department to see how this request and your notifications update. Remove when the Admin and Inventory pages are connected.</p>
          <div class="demo-btns">${sims.map(s => `<button type="button" class="btn btn-light btn-sm" data-sim="${s[0]}">${s[1]}</button>`).join("")}</div></div>` : ""}
        <div class="modal-actions">${r.status === "Rejected" ? '<button type="button" class="btn btn-dark" data-resubmit>Revise &amp; resubmit</button>' : ""}
          <button type="button" class="btn btn-light" data-close>Close</button></div>`;
    }
    paint();

    m.addEventListener("click", async e => {
      const sim = e.target.closest("[data-sim]");
      if (sim) {
        sim.disabled = true;
        const ok = await act(async () => { await demoStep(id, sim.dataset.sim); await reload(); }, "Request updated.");
        if (ok) paint(); else sim.disabled = false;
        return;
      }
      if (e.target.closest("[data-resubmit]")) { m.close(); resubmit(id); }
    });
  }

  /* ======================================================================
     11. NOTIFICATIONS
     ====================================================================== */
  let nFilter = "all";
  const N_FILTERS = [["all", "All"], ["unread", "Unread"], ["Requisition", "Requisition"], ["Purchasing", "Purchasing"], ["Stock", "Low stock"]];

  const visibleNotifs = () => state.notifications.filter(n => nFilter === "all" ? true : nFilter === "unread" ? !n.read : n.source === nFilter);

  function notifItem(n) {
    return `<li class="notif-item${n.read ? "" : " unread"}" data-id="${n.id}">
      <span class="dot"></span>
      <div class="notif-body"><p>${esc(n.text)}</p><span class="muted">${ago(n.at)}</span></div>
      <span class="badge badge-${n.tone}">${esc(n.source)}</span>
      <div class="notif-actions">
        ${n.reqId ? '<button type="button" class="btn btn-light btn-sm" data-view>View request</button>' : ""}
        ${n.designId ? '<button type="button" class="btn btn-light btn-sm" data-viewd>View project</button>' : ""}
        ${n.refSku ? '<button type="button" class="btn btn-light btn-sm" data-viewp>View products</button>' : ""}
        <button type="button" class="btn btn-light btn-sm" data-toggle>${n.read ? "Mark unread" : "Mark read"}</button>
        <button type="button" class="icon-btn" data-delete title="Delete notification">&times;</button>
      </div></li>`;
  }

  function pageNotifications(view) {
    view.innerHTML = `
    <div class="page">
      <header class="page-header page-header-row"><div><h1>Notifications</h1><p>Low stock alerts, purchasing requests from any department, Purchasing results and requisition updates.</p></div>
        <button type="button" class="btn btn-light" id="markAll">Mark all as read</button></header>
      <label class="switch-row"><input type="checkbox" id="projSwitch"${state.settings.projectNotifications ? " checked" : ""}>
        <span>Show design project notifications</span></label>
      <div class="chips" id="chips">${N_FILTERS.map(f => `<button type="button" class="chip${nFilter === f[0] ? " active" : ""}" data-f="${f[0]}">${f[1]}</button>`).join("")}</div>
      <div class="card"><ul class="notif-page-list" id="nList"></ul></div>
    </div>`;

    const root = view.querySelector(".page");
    const list = root.querySelector("#nList");
    const paint = () => {
      const items = visibleNotifs();
      list.innerHTML = items.length ? items.map(notifItem).join("") : '<li class="empty-state">No notifications here.</li>';
    };
    paint();

    root.querySelector("#chips").addEventListener("click", e => {
      const c = e.target.closest("[data-f]");
      if (!c) return;
      nFilter = c.dataset.f;
      root.querySelectorAll(".chip").forEach(x => x.classList.toggle("active", x === c));
      paint();
    });
    root.querySelector("#markAll").addEventListener("click", async () => {
      if (!unreadCount()) return toast("You are all caught up.");
      await act(async () => { await markAllRead(); await reload(); }, "All notifications marked as read.");
    });
    root.querySelector("#projSwitch").addEventListener("change", async e => {
      const on = e.target.checked;
      const ok = await act(async () => { await setProjectNotifications(on); await reload(); }, on ? "Design notifications turned on." : "Design notifications turned off.");
      if (!ok) e.target.checked = !on;
    });
    list.addEventListener("click", async e => {
      const li = e.target.closest(".notif-item");
      if (!li) return;
      const id = li.dataset.id;
      const n = state.notifications.find(x => String(x.id) === id);
      if (!n) return;
      if (e.target.closest("[data-delete]")) { await act(async () => { await removeNotification(n.id); await reload(); }); return; }
      if (e.target.closest("[data-toggle]")) { await act(async () => { await setRead(n.id, !n.read); await reload(); }); return; }
      if (e.target.closest("[data-viewp]")) { await act(async () => { await setRead(n.id, true); await reload(); }); go("products"); return; }
      if (e.target.closest("[data-viewd]")) { await act(async () => { await setRead(n.id, true); await reload(); }); openDesign(n.designId); return; }
      if (e.target.closest("[data-view]")) { await act(async () => { await setRead(n.id, true); await reload(); }); openRequest(n.reqId); return; }
      if (!n.read) await act(async () => { await setRead(n.id, true); await reload(); });
    });
  }

  pages.dashboard     = { title: "Marketing Dashboard", render: pageDashboard };
  pages.requisition   = { title: "Requisition", render: pageRequisition };
  pages.designs       = { title: "Project Designs", render: pageDesigns };
  pages.products      = { title: "Products & Materials", render: pageProducts };
  pages.history       = { title: "Request History", render: pageHistory };
  pages.notifications = { title: "Notifications", render: pageNotifications };

  /* ======================================================================
     12. START-UP: sign-in check, load data, show first screen
     ====================================================================== */
  function showFatal(err) {
    console.error(err);
    $id("view").innerHTML = `<div class="card"><h2 class="card-title">Something went wrong</h2>
      <p class="muted">${esc((err && err.message) || "The Marketing data could not be loaded.")}</p>
      <p class="muted" style="margin-top:8px">Check that the Login, Inventory and Marketing SQL were all run in Supabase, and that you are signed in with the Marketing account.</p></div>`;
  }

  async function init() {
    if (!sb) { $id("view").innerHTML = '<div class="card"><h2 class="card-title">Supabase is not connected</h2><p class="muted">Check that ../config/supabase.js loads before this page.</p></div>'; return; }

    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData && sessionData.session;
    if (!session) { window.location.replace(LOGIN_URL); return; }
    state.userId = session.user.id;

    const { data: profile, error } = await sb.from("profiles").select("username, department, role").eq("id", state.userId).single();
    if (error || !profile || ALLOWED_DEPARTMENTS.indexOf(String(profile.department).toLowerCase()) === -1) {
      window.location.replace(LOGIN_URL); return;
    }
    state.profile = profile;
    sb.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") window.location.replace(LOGIN_URL); });

    renderSidebar();
    $id("view").innerHTML = '<div class="page"><header class="page-header"><h1>Loading…</h1></header></div>';
    try { await syncData(false); } catch (err) { showFatal(err); return; }

    window.addEventListener("hashchange", () => render(false));
    if (!window.location.hash) history.replaceState(null, "", "#dashboard");
    render(false);
    startLive();
  }

  init();
})();