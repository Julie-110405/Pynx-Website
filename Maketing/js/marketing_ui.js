/* ============================================================
   PYNX ERP — Marketing UI helpers (badges, dates, modal, toast...)
   Depends on: marketing_data.js
   ============================================================ */

const MarketingUI = (function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Badges ---------- */
  const REQ_BADGE = { Pending: "badge-yellow", Approved: "badge-green", Rejected: "badge-red", Completed: "badge-blue", Partial: "badge-yellow" };
  function statusBadge(s) { return '<span class="badge ' + (REQ_BADGE[s] || "badge-blue") + '">' + esc(s) + "</span>"; }
  function designBadge(s) { return '<span class="badge ' + (s === "Completed" ? "badge-green" : "badge-yellow") + '">' + esc(s) + "</span>"; }
  function stockBadge(status) {
    if (status === "out") return '<span class="badge badge-red">Out of Stock</span>';
    if (status === "low") return '<span class="badge badge-yellow">Low Stock</span>';
    return '<span class="badge badge-green">In Stock</span>';
  }
  function bar(pct) {
    return '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>';
  }

  /* ---------- Formatting ---------- */
  function fmtNum(n) { return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "Just now";
    const m = Math.floor(s / 60); if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60); if (h < 24) return h + " hr ago";
    const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
    return fmtDate(iso);
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function dateKey(iso) {
    const d = new Date(iso);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function today() { return dateKey(new Date().toISOString()); }

  /* ---------- Material dropdown (grouped by category) ---------- */
  function materialOptions(selected) {
    const groups = {};
    MarketingData.catalog.forEach(function (p) { (groups[p.category] = groups[p.category] || []).push(p); });
    let html = '<option value="">— Select material —</option>';
    Object.keys(groups).sort().forEach(function (cat) {
      html += '<optgroup label="' + esc(cat) + '">' + groups[cat].map(function (p) {
        return '<option value="' + esc(p.name) + '"' + (p.name === selected ? " selected" : "") + ">" +
          esc(p.name) + " — " + fmtNum(p.stock) + " " + esc(p.unit) + "</option>";
      }).join("") + "</optgroup>";
    });
    return html;
  }

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    let root = document.getElementById("toastRoot");
    if (!root) { root = document.createElement("div"); root.id = "toastRoot"; document.body.appendChild(root); }
    const t = document.createElement("div");
    t.className = "toast" + (type === "error" ? " toast-error" : "");
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  /* ---------- Modal ---------- */
  function modal(html, opts) {
    opts = opts || {};
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal' + (opts.wide ? " modal-wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    backdrop.close = function () {
      if (!backdrop.parentNode) return;
      backdrop.parentNode.removeChild(backdrop);
      if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
      if (opts.onClose) opts.onClose();
    };
    backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) backdrop.close(); });
    backdrop.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) backdrop.close(); });
    return backdrop;
  }

  function closeModals() {
    document.querySelectorAll(".modal-backdrop").forEach(function (m) { if (m.close) m.close(); else m.remove(); });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    const all = document.querySelectorAll(".modal-backdrop");
    if (all.length && all[all.length - 1].close) all[all.length - 1].close();
  });

  function confirmBox(o) {
    return new Promise(function (resolve) {
      let done = false;
      const m = modal(
        '<h2 class="modal-title">' + esc(o.title) + '</h2><p class="modal-text">' + o.message + "</p>" +
        '<div class="modal-actions"><button type="button" class="btn btn-light" data-close>Cancel</button>' +
        '<button type="button" class="btn ' + (o.danger ? "btn-danger" : "btn-dark") + '" data-yes>' + esc(o.confirmText || "Confirm") + "</button></div>",
        { onClose: function () { if (!done) { done = true; resolve(false); } } }
      );
      m.querySelector("[data-yes]").addEventListener("click", function () { done = true; m.close(); resolve(true); });
    });
  }

  /* ---------- CSV ---------- */
  function downloadCSV(filename, rows) {
    const csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  return {
    esc: esc, statusBadge: statusBadge, designBadge: designBadge, stockBadge: stockBadge, bar: bar,
    fmtNum: fmtNum, fmtDate: fmtDate, fmtDateTime: fmtDateTime, timeAgo: timeAgo, fmtSize: fmtSize,
    dateKey: dateKey, today: today, materialOptions: materialOptions,
    toast: toast, modal: modal, closeModals: closeModals, confirm: confirmBox, downloadCSV: downloadCSV
  };
})();