/* ============================================================
   PYNX ERP — Request History page + shared request detail window
   MarketingHistory.openDetail(id) is also used by the Dashboard,
   Requisition and Notifications pages.
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

const MarketingHistory = (function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  const filters = { q: "", status: "", from: "", to: "" };

  function filtered() {
    const q = filters.q.trim().toLowerCase();
    return D.requisitions().filter(function (r) {
      const day = U.dateKey(r.createdAt);
      if (filters.status && r.status !== filters.status) return false;
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      if (!q) return true;
      const text = [r.id, r.project, r.reason, r.status].concat(r.items.map(function (i) { return i.name; })).join(" ").toLowerCase();
      return text.indexOf(q) !== -1;
    });
  }

  function rowsHtml(list) {
    if (!list.length) return '<tr><td colspan="7" class="empty-state">No requests match your filters.</td></tr>';
    return list.map(function (r) {
      const pct = D.fulfilment(r);
      const showBar = r.status === "Approved" || r.status === "Partial" || r.status === "Completed";
      return '<tr class="row-link" data-open="' + r.id + '">' +
        "<td><strong>" + r.id + "</strong></td>" +
        "<td>" + U.fmtDate(r.createdAt) + "</td>" +
        '<td class="product">' + U.esc(D.materialLabel(r)) + "</td>" +
        "<td>" + U.esc(r.project) + "</td>" +
        '<td class="right">' + U.esc(D.qtyLabel(r)) + "</td>" +
        "<td>" + U.statusBadge(r.status) + "</td>" +
        '<td class="fulfil">' + (showBar ? U.bar(pct) + '<span class="muted">' + pct + "% released</span>" : '<span class="muted">—</span>') + "</td></tr>";
    }).join("");
  }

  /* ---------- Page ---------- */
  function render(view, arg) {
    if (arg && arg.indexOf("status-") === 0) filters.status = arg.slice(7);

    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header page-header-row"><div><h1>Request History</h1><p>Every requisition submitted by Marketing, with approval remarks and release progress.</p></div>' +
      '<button type="button" class="btn btn-light" id="exportCsv">Export CSV</button></header>' +
      '<div class="toolbar">' +
        '<input type="text" id="hQ" class="search-input" placeholder="Search ID, material, project" value="' + U.esc(filters.q) + '">' +
        '<select id="hStatus" class="select-input"><option value="">All statuses</option>' +
          ["Pending", "Approved", "Partial", "Rejected", "Completed"].map(function (s) {
            return '<option value="' + s + '"' + (filters.status === s ? " selected" : "") + ">" + (s === "Partial" ? "Partially fulfilled" : s) + "</option>";
          }).join("") + "</select>" +
        '<label class="date-filter">From <input type="date" id="hFrom" value="' + filters.from + '"></label>' +
        '<label class="date-filter">To <input type="date" id="hTo" value="' + filters.to + '"></label>' +
        '<button type="button" class="link-btn" id="hClear">Clear filters</button>' +
      "</div>" +
      '<div class="card table-card"><table class="table"><thead><tr>' +
        '<th>Request ID</th><th>Date</th><th>Material</th><th>Project</th><th class="right">Quantity</th><th>Status</th><th>Fulfilment</th>' +
        '</tr></thead><tbody id="hBody"></tbody></table></div>' +
      '<p class="muted" id="hCount" style="margin-top:10px"></p></div>';

    const root = view.querySelector(".page");
    const body = root.querySelector("#hBody");

    function paint() {
      const list = filtered();
      body.innerHTML = rowsHtml(list);
      root.querySelector("#hCount").textContent = list.length + " request" + (list.length === 1 ? "" : "s") + " shown";
    }
    paint();

    root.querySelector("#hQ").addEventListener("input", function (e) { filters.q = e.target.value; paint(); });
    root.querySelector("#hStatus").addEventListener("change", function (e) { filters.status = e.target.value; paint(); });
    root.querySelector("#hFrom").addEventListener("change", function (e) { filters.from = e.target.value; paint(); });
    root.querySelector("#hTo").addEventListener("change", function (e) { filters.to = e.target.value; paint(); });
    root.querySelector("#hClear").addEventListener("click", function () {
      filters.q = filters.status = filters.from = filters.to = "";
      MarketingApp.refresh();
    });

    root.querySelector("#exportCsv").addEventListener("click", function () {
      const list = filtered();
      if (!list.length) return U.toast("Nothing to export for these filters.", "error");
      U.downloadCSV("pynx-marketing-requests-" + U.today() + ".csv",
        [["Request ID", "Date", "Project", "Reason", "Materials", "Status", "Fulfilment %", "Admin remarks", "Needed by"]].concat(
          list.map(function (r) {
            return [r.id, U.fmtDate(r.createdAt), r.project, r.reason,
              r.items.map(function (i) { return i.name + " " + i.qty + " " + i.unit + " (released " + i.released + ")"; }).join("; "),
              r.status, D.fulfilment(r), r.remarks, r.neededBy];
          })));
    });

    body.addEventListener("click", function (e) {
      const row = e.target.closest("[data-open]");
      if (row) openDetail(row.dataset.open);
    });

    if (arg && /^REQ-\d+$/.test(arg)) openDetail(arg);
  }

  /* ---------- Request detail window ---------- */
  function openDetail(id) {
    if (!D.getRequisition(id)) { U.toast("Request not found.", "error"); return; }

    const m = U.modal("", {
      wide: true,
      onClose: function () { if (/^#history\/REQ/.test(window.location.hash)) history.replaceState(null, "", "#history"); }
    });
    const box = m.querySelector(".modal");

    function simButtons(r) {
      const b = [];
      if (r.status === "Pending") {
        b.push(["approve", "Admin approves"], ["reject", "Admin returns it"]);
      } else if (r.status === "Approved" && !r.inventoryConfirmed) {
        b.push(["confirm", "Inventory confirms stock"]);
      } else if (r.inventoryConfirmed && (r.status === "Approved" || r.status === "Partial")) {
        b.push(["release_partial", "Inventory releases part"], ["release_all", "Inventory releases all"]);
      }
      return b;
    }

    function paint() {
      const r = D.getRequisition(id);
      const sims = D.DEMO_TOOLS ? simButtons(r) : [];
      box.innerHTML =
        '<div class="modal-head"><div><h2 class="modal-title">' + r.id + '</h2><p class="muted">Submitted ' + U.fmtDate(r.createdAt) +
          " · Needed by " + U.fmtDate(r.neededBy) + "</p></div>" + U.statusBadge(r.status) + "</div>" +
        '<div class="detail-grid">' +
          "<div><span>Project / Purpose</span>" + U.esc(r.project) + "</div>" +
          "<div><span>Current update</span>" + U.esc(D.statusText(r)) + "</div>" +
          '<div class="full"><span>Reason for request</span>' + U.esc(r.reason) + "</div>" +
        "</div>" +
        '<div class="table-scroll"><table class="table table-compact"><thead><tr><th>Material</th><th class="right">Requested</th><th class="right">Released</th><th class="right">Remaining</th></tr></thead><tbody>' +
          r.items.map(function (i) {
            const rem = Math.max(0, i.qty - i.released);
            return '<tr><td class="product">' + U.esc(i.name) + '</td><td class="right">' + U.fmtNum(i.qty) + " " + U.esc(i.unit) +
              '</td><td class="right">' + U.fmtNum(i.released) + '</td><td class="right">' + (rem ? U.fmtNum(rem) : '<span class="badge badge-green">Done</span>') + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
        (r.remarks ? '<div class="remark ' + (r.status === "Rejected" ? "remark-bad" : "") + '"><b>Admin remarks:</b> ' + U.esc(r.remarks) + "</div>" : "") +
        '<h3 class="sub-title">Activity</h3><ul class="timeline">' +
          r.timeline.map(function (t) {
            return "<li><b>" + U.esc(t.by) + "</b> · " + U.esc(t.text) + "<span>" + U.fmtDateTime(t.at) + "</span></li>";
          }).join("") + "</ul>" +
        (sims.length ? '<div class="demo-box"><p><b>Demo tools</b> — pretend to be another department to see how this request updates. Remove when the backend is ready.</p><div class="demo-btns">' +
          sims.map(function (s) { return '<button type="button" class="btn btn-light btn-sm" data-sim="' + s[0] + '">' + s[1] + "</button>"; }).join("") + "</div></div>" : "") +
        '<div class="modal-actions">' +
          (r.status === "Rejected" ? '<button type="button" class="btn btn-dark" data-resubmit>Revise &amp; resubmit</button>' : "") +
          '<button type="button" class="btn btn-light" data-close>Close</button></div>';
    }
    paint();

    m.addEventListener("click", function (e) {
      const sim = e.target.closest("[data-sim]");
      if (sim) {
        try {
          D.simulate(id, sim.dataset.sim);
          paint();
          MarketingApp.refresh();
          U.toast("Request updated.");
        } catch (err) { U.toast(err.message, "error"); }
        return;
      }
      if (e.target.closest("[data-resubmit]")) {
        const r = D.getRequisition(id);
        MarketingApp.setDraft({ project: r.project, reason: r.reason, items: r.items.map(function (i) { return { name: i.name, qty: i.qty }; }) });
        m.close();
        MarketingApp.go("requisition");
        U.toast("Details copied into a new form. Review and resubmit.");
      }
    });
  }

  MarketingApp.register("history", { title: "Request History", render: render });
  return { openDetail: openDetail };
})();