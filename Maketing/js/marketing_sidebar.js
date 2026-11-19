/* ============================================================
   PYNX ERP — Marketing Sidebar (logo, menu icons, logout)
   Depends on: marketing_data.js, marketing_ui.js
   The sidebar is drawn once; marketing_app.js calls render() and
   setActive() as the user moves between menus.
   ============================================================ */

const MarketingSidebar = (function () {
  "use strict";

  /* Small line icons shown beside each menu item */
  const ICONS = {
    dashboard:
      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    requisition:
      '<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    designs:
      '<svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    products:
      '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="10" y1="10" x2="10" y2="20"/></svg>',
    history:
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    notifications:
      '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
  };

  function render() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    const links = MarketingData.menu
      .filter(function (item) { return item.key !== "logout"; })
      .map(function (item) {
        return '<a href="' + item.href + '" class="nav-item" data-key="' + item.key + '" title="' + item.label + '">' +
          '<span class="nav-icon">' + ICONS[item.key] + "</span>" +
          '<span class="nav-label">' + item.label + "</span>" +
          (item.key === "notifications" ? '<span class="nav-badge" id="navNotifBadge" hidden>0</span>' : "") +
          "</a>";
      }).join("");

    sidebar.innerHTML =
      '<div class="sidebar-logo">' +
        '<img src="' + MarketingData.paths.logo + '" alt="Pynx - Beyond the Trend" />' +
      "</div>" +
      '<nav class="sidebar-nav">' + links +
        '<button type="button" class="nav-item" id="logoutBtn" title="Log Out">' +
          '<span class="nav-icon">' + ICONS.logout + "</span>" +
          '<span class="nav-label">Log Out</span>' +
        "</button>" +
      "</nav>" +
      '<div class="sidebar-spacer"></div>' +
      '<div class="sidebar-user">' +
        "<strong>" + MarketingUI.esc(MarketingData.user.name) + "</strong>" +
        "<span>" + MarketingUI.esc(MarketingData.user.department) + "</span>" +
      "</div>";

    /* If the logo file cannot be found, show the brand name instead of a broken image */
    const img = sidebar.querySelector(".sidebar-logo img");
    img.addEventListener("error", function () {
      img.parentNode.innerHTML = '<span class="logo-fallback">pynx</span>';
    });

    document.getElementById("logoutBtn").addEventListener("click", logout);
    updateBadge();
  }

  function logout() {
    MarketingUI.confirm({
      title: "Log out?",
      message: "You will be returned to the login page.",
      confirmText: "Log out"
    }).then(function (ok) {
      if (!ok) return;
      try {
        sessionStorage.clear();
        localStorage.removeItem("pynx_user");
      } catch (e) { /* storage unavailable */ }
      window.location.href = MarketingData.paths.login;
    });
  }

  function setActive(key) {
    document.querySelectorAll("#sidebar .nav-item[data-key]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-key") === key);
    });
  }

  function updateBadge() {
    const badge = document.getElementById("navNotifBadge");
    if (!badge) return;
    const n = MarketingData.unreadCount();
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  return { render: render, setActive: setActive, updateBadge: updateBadge };
})();