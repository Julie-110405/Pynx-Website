/* ============================================================
   PYNX ERP — Marketing Dashboard page
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

(function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  function requisitionRows(term) {
    term = (term || "").trim().toLowerCase();
    const rows = D.requisitions().filter(function (r) {
      return !term || [r.id, D.materialLabel(r), r.project, r.status].some(function (v) { return v.toLowerCase().indexOf(term) !== -1; });
    }).slice(0, 6);

    return rows.map(function (r) {
      return '<tr class="row-link" data-open="' + r.id + '">' +
        "<td>" + r.id + "</td>" +
        '<td class="product">' + U.esc(D.materialLabel(r)) + "</td>" +
        "<td>" + U.esc(r.project) + "</td>" +
        '<td class="right">' + U.esc(D.qtyLabel(r)) + "</td>" +
        "<td>" + U.fmtDate(r.createdAt) + "</td>" +
        "<td>" + U.statusBadge(r.status) + "</td></tr>";
    }).join("");
  }

  function render(view) {
    const s = D.summary();
    const ds = D.designStats();
    const maxD = Math.max(ds.ongoing, ds.completed, 1);
    const notifs = D.notifications().slice(0, 4);
    const updates = D.requisitions().slice().sort(function (a, b) {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    }).slice(0, 4);
    const dateText = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const cards = [
      { label: "Pending Requests",   value: s.pending,   note: "Awaiting Admin approval" },
      { label: "Approved Requests",  value: s.approved,  note: "Ready for Inventory checking" },
      { label: "Rejected Requests",  value: s.rejected,  note: "Needs attention" },
      { label: "Completed Requests", value: s.completed, note: "Materials fully released" }
    ];

    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header"><h1>Welcome to Marketing!</h1><p>' + dateText + "</p></header>" +

      '<section class="grid grid-3">' +
        '<article class="card card-lg">' +
          '<h2 class="card-title">Requisition History</h2>' +
          '<p class="big-number">' + s.total + "</p>" +
          '<p class="muted">Total submitted requisitions</p>' +
          '<p class="muted small">Last submitted: ' + (s.last ? U.fmtDate(s.last.createdAt) + " · " + U.esc(D.materialLabel(s.last)) : "—") + "</p>" +
          '<a href="#requisition" class="btn btn-dark">+ New Requisition</a>' +
        "</article>" +

        '<article class="card card-lg">' +
          '<h2 class="card-title">Design Projects</h2>' +
          '<div class="bar-item"><div class="bar-label"><span>Ongoing</span><strong>' + ds.ongoing + "</strong></div>" + U.bar((ds.ongoing / maxD) * 100) + "</div>" +
          '<div class="bar-item"><div class="bar-label"><span>Completed</span><strong>' + ds.completed + "</strong></div>" + U.bar((ds.completed / maxD) * 100) + "</div>" +
          '<a class="link-more" href="#designs">View all projects &rarr;</a>' +
        "</article>" +

        '<article class="card card-lg">' +
          '<h2 class="card-title">Notifications <span class="count-badge">' + D.unreadCount() + "</span></h2>" +
          '<ul class="notif-list">' + (notifs.length ? notifs.map(function (n) {
            return '<li><span class="notif-text' + (n.read ? "" : " unread") + '">' + U.esc(n.text) + "</span>" +
              '<span class="badge badge-' + n.tone + '">' + U.esc(n.source) + "</span></li>";
          }).join("") : '<li class="muted">No notifications yet.</li>') + "</ul>" +
          '<a class="link-more" href="#notifications">View all notifications &rarr;</a>' +
        "</article>" +
      "</section>" +

      '<section class="grid grid-4">' + cards.map(function (c) {
        return '<article class="stat-card"><p class="stat-label">' + c.label + '</p><p class="stat-value">' + c.value +
          '</p><p class="stat-note">' + c.note + "</p></article>";
      }).join("") + "</section>" +

      '<section class="section">' +
        '<div class="section-head"><h2>Recent Requisitions</h2><div class="section-tools">' +
          '<input type="text" id="requisitionSearch" class="search-input" placeholder="Search requisition" />' +
          '<a href="#history" class="btn btn-light">View all requests &rarr;</a></div></div>' +
        '<div class="card table-card"><table class="table"><thead><tr>' +
          '<th>Request ID</th><th>Material</th><th>Project</th><th class="right">Quantity</th><th>Date</th><th>Status</th>' +
          '</tr></thead><tbody id="requisitionTableBody">' + requisitionRows("") + "</tbody></table>" +
          '<p class="empty-state" id="requisitionEmpty" hidden>No requisitions found.</p></div>' +
      "</section>" +

      '<section class="section">' +
        '<div class="section-head"><h2>Latest Updates on Requested Materials</h2></div>' +
        '<div class="card update-card"><ul class="update-list">' + updates.map(function (r) {
          const last = r.timeline[r.timeline.length - 1];
          return '<li class="row-link" data-open="' + r.id + '"><div class="update-main"><strong>' +
            U.esc(D.materialLabel(r)) + " · " + U.esc(D.qtyLabel(r)) + "</strong><span>" + r.id + " · " +
            U.esc(r.status === "Partial" || r.status === "Pending" || r.status === "Approved" ? D.statusText(r) : last.text) +
            "</span></div>" + U.statusBadge(r.status) + "</li>";
        }).join("") + "</ul></div>" +
      "</section>" +

      (D.DEMO_TOOLS ? '<p class="demo-note">Demo mode: data is saved in this browser only. <button type="button" class="link-btn" id="resetDemo">Reset sample data</button></p>' : "") +
      "</div>";

    const root = view.querySelector(".page");
    const input = root.querySelector("#requisitionSearch");
    const body = root.querySelector("#requisitionTableBody");
    const empty = root.querySelector("#requisitionEmpty");

    input.addEventListener("input", function () {
      body.innerHTML = requisitionRows(input.value);
      empty.hidden = body.children.length !== 0;
    });

    root.addEventListener("click", function (e) {
      const row = e.target.closest("[data-open]");
      if (row) MarketingHistory.openDetail(row.getAttribute("data-open"));
    });

    const reset = root.querySelector("#resetDemo");
    if (reset) reset.addEventListener("click", function () {
      U.confirm({ title: "Reset sample data?", message: "All requisitions, projects and notifications in this browser go back to the original samples.", confirmText: "Reset", danger: true })
        .then(function (ok) { if (ok) { D.reset(); MarketingApp.refresh(); U.toast("Sample data restored."); } });
    });
  }

  MarketingApp.register("dashboard", { title: "Marketing Dashboard", render: render });
})();