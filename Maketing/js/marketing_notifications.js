/* ============================================================
   PYNX ERP — Notifications page
   Updates from Admin and Inventory, request confirmations and
   (optional) project updates.
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

(function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  let filter = "all";
  const FILTERS = [["all", "All"], ["unread", "Unread"], ["Admin", "Admin"], ["Inventory", "Inventory"], ["Requisition", "Requisition"], ["Project", "Project"]];

  function visible() {
    return D.notifications().filter(function (n) {
      if (filter === "all") return true;
      if (filter === "unread") return !n.read;
      return n.source === filter;
    });
  }

  function itemHtml(n) {
    return '<li class="notif-item' + (n.read ? "" : " unread") + '" data-id="' + n.id + '">' +
      '<span class="dot"></span>' +
      '<div class="notif-body"><p>' + U.esc(n.text) + '</p><span class="muted">' + U.timeAgo(n.at) + "</span></div>" +
      '<span class="badge badge-' + n.tone + '">' + U.esc(n.source) + "</span>" +
      '<div class="notif-actions">' +
        (n.reqId ? '<button type="button" class="btn btn-light btn-sm" data-view>View request</button>' : "") +
        '<button type="button" class="btn btn-light btn-sm" data-toggle>' + (n.read ? "Mark unread" : "Mark read") + "</button>" +
        '<button type="button" class="icon-btn" data-delete title="Delete notification">&times;</button>' +
      "</div></li>";
  }

  function render(view) {
    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header page-header-row"><div><h1>Notifications</h1><p>Stay up to date on your requisitions and creative projects.</p></div>' +
      '<button type="button" class="btn btn-light" id="markAll">Mark all as read</button></header>' +
      '<label class="switch-row"><input type="checkbox" id="projSwitch"' + (D.settings().projectNotifications ? " checked" : "") + '>' +
        "<span>Notify me about project updates (new projects and status changes)</span></label>" +
      '<div class="chips" id="chips">' + FILTERS.map(function (f) {
        return '<button type="button" class="chip' + (filter === f[0] ? " active" : "") + '" data-f="' + f[0] + '">' + f[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="card"><ul class="notif-page-list" id="nList"></ul></div></div>';

    const root = view.querySelector(".page");
    const list = root.querySelector("#nList");

    function paint() {
      const items = visible();
      list.innerHTML = items.length ? items.map(itemHtml).join("") : '<li class="empty-state">No notifications here.</li>';
    }
    paint();

    root.querySelector("#chips").addEventListener("click", function (e) {
      const c = e.target.closest("[data-f]");
      if (!c) return;
      filter = c.dataset.f;
      root.querySelectorAll(".chip").forEach(function (x) { x.classList.toggle("active", x === c); });
      paint();
    });

    root.querySelector("#markAll").addEventListener("click", function () {
      if (!D.unreadCount()) return U.toast("You are all caught up.");
      D.markAllRead(); MarketingApp.refresh(); U.toast("All notifications marked as read.");
    });

    root.querySelector("#projSwitch").addEventListener("change", function (e) {
      D.setSetting("projectNotifications", e.target.checked);
      U.toast(e.target.checked ? "Project notifications turned on." : "Project notifications turned off.");
    });

    list.addEventListener("click", function (e) {
      const li = e.target.closest(".notif-item");
      if (!li) return;
      const id = li.dataset.id;
      const n = D.notifications().find(function (x) { return x.id === id; });
      if (!n) return;

      if (e.target.closest("[data-delete]")) { D.removeNotification(id); MarketingApp.refresh(); return; }
      if (e.target.closest("[data-toggle]")) { D.setRead(id, !n.read); MarketingApp.refresh(); return; }
      if (e.target.closest("[data-view]")) { D.setRead(id, true); MarketingApp.refresh(); MarketingHistory.openDetail(n.reqId); return; }
      D.setRead(id, true);
      MarketingApp.refresh();
    });
  }

  MarketingApp.register("notifications", { title: "Notifications", render: render });
})();