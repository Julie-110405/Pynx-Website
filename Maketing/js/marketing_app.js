/* ============================================================
   PYNX ERP — Marketing App (router)
   One HTML file, many pages: the address after "#" decides which
   page is drawn inside <main id="view">.
     #dashboard  #requisition  #designs  #products  #history  #notifications
     #history/REQ-012  opens that request's details
   Each page file calls MarketingApp.register(key, { title, render }).
   ============================================================ */

const MarketingApp = (function () {
  "use strict";

  const pages = {};
  let draft = null;

  function register(key, page) { pages[key] = page; }

  /* Lets one page hand a pre-filled requisition to the Requisition page */
  function setDraft(d) { draft = d; }
  function takeDraft() { const d = draft; draft = null; return d; }

  function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const parts = raw.split("/");
    return {
      key: pages[parts[0]] ? parts[0] : "dashboard",
      arg: parts[1] ? decodeURIComponent(parts.slice(1).join("/")) : null
    };
  }

  function render(isRefresh) {
    const route = parseHash();
    const page = pages[route.key];
    const view = document.getElementById("view");
    const y = window.scrollY;

    if (!isRefresh) MarketingUI.closeModals();
    try {
      view.innerHTML = "";
      page.render(view, isRefresh ? null : route.arg);
    } catch (err) {
      console.error(err);
      view.innerHTML = '<div class="card"><h2 class="card-title">Something went wrong</h2><p class="muted">' + MarketingUI.esc(err.message) + "</p></div>";
    }
    MarketingSidebar.setActive(route.key);
    document.title = page.title + " | PYNX Marketing";
    window.scrollTo(0, isRefresh ? y : 0);
  }

  /* Go to a page (e.g. "history/REQ-012"); re-draws even if already there */
  function go(hash) {
    if (window.location.hash === "#" + hash) render(false);
    else window.location.hash = hash;
  }

  /* Re-draw the current page after data changed (keeps scroll, keeps open modals) */
  function refresh() { render(true); }

  function init() {
    MarketingSidebar.render();
    window.addEventListener("hashchange", function () { render(false); });
    document.addEventListener("marketing:changed", MarketingSidebar.updateBadge);
    document.addEventListener("marketing:storage-error", function () {
      MarketingUI.toast("Browser storage is full — recent changes may be lost after a refresh.", "error");
    });
    if (!window.location.hash) history.replaceState(null, "", "#dashboard");
    render(false);
  }

  document.addEventListener("DOMContentLoaded", init);

  return { register: register, go: go, refresh: refresh, setDraft: setDraft, takeDraft: takeDraft };
})();