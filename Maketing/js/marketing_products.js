/* ============================================================
   PYNX ERP — Products & Materials page (view-only catalog)
   Marketing can search, check availability and start a requisition,
   but cannot add, edit or delete inventory records.
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

(function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  const filters = { q: "", category: "", avail: "", sort: "name-asc" };

  function filtered() {
    const q = filters.q.trim().toLowerCase();
    const list = D.catalog.filter(function (p) {
      if (filters.category && p.category !== filters.category) return false;
      if (filters.avail && D.productStatus(p) !== filters.avail) return false;
      return !q || (p.name + " " + p.category + " " + p.description + " " + p.sku).toLowerCase().indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      switch (filters.sort) {
        case "stock-asc":  return a.stock - b.stock;
        case "stock-desc": return b.stock - a.stock;
        default:           return a.name.localeCompare(b.name);
      }
    });
    return list;
  }

  function rowsHtml(list) {
    if (!list.length) return '<tr><td colspan="6" class="empty-state">No products match your filters.</td></tr>';
    return list.map(function (p) {
      return "<tr><td><strong>" + U.esc(p.name) + '</strong><span class="cell-sub">' + U.esc(p.description) + "</span></td>" +
        "<td>" + U.esc(p.category) + "</td>" +
        '<td class="right">' + U.fmtNum(p.stock) + "</td>" +
        "<td>" + U.esc(p.unit) + "</td>" +
        "<td>" + U.stockBadge(D.productStatus(p)) + "</td>" +
        '<td class="right"><button type="button" class="btn btn-dark btn-sm" data-request="' + U.esc(p.name) + '">Request</button></td></tr>';
    }).join("");
  }

  function render(view) {
    const cats = D.catalog.map(function (p) { return p.category; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort();
    function count(s) { return D.catalog.filter(function (p) { return D.productStatus(p) === s; }).length; }

    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header"><h1>Products &amp; Materials</h1><p>Browse what the company has in stock. This list is view-only — stock records are managed by Inventory.</p></header>' +
      '<section class="grid grid-4">' + [
        ["Total Items", D.catalog.length, "Registered products and materials"], ["In Stock", count("ok"), "Available to request"],
        ["Low Stock", count("low"), "Limited quantity"], ["Out of Stock", count("out"), "Unavailable right now"]
      ].map(function (c) {
        return '<article class="stat-card"><p class="stat-label">' + c[0] + '</p><p class="stat-value">' + c[1] + '</p><p class="stat-note">' + c[2] + "</p></article>";
      }).join("") + "</section>" +
      '<div class="toolbar">' +
        '<input type="text" id="pQ" class="search-input" placeholder="Search product, category or description" value="' + U.esc(filters.q) + '">' +
        '<select id="pCat" class="select-input"><option value="">All categories</option>' + cats.map(function (c) {
          return "<option" + (filters.category === c ? " selected" : "") + ">" + U.esc(c) + "</option>";
        }).join("") + "</select>" +
        '<select id="pAvail" class="select-input">' + [["", "All availability"], ["ok", "In Stock"], ["low", "Low Stock"], ["out", "Out of Stock"]].map(function (o) {
          return '<option value="' + o[0] + '"' + (filters.avail === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select>" +
        '<select id="pSort" class="select-input">' + [["name-asc", "Sort: Name (A–Z)"], ["stock-asc", "Sort: Stock (low → high)"], ["stock-desc", "Sort: Stock (high → low)"]].map(function (o) {
          return '<option value="' + o[0] + '"' + (filters.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></div>" +
      '<div class="card table-card"><table class="table"><thead><tr><th>Product / Material</th><th>Category</th><th class="right">Available</th><th>Unit</th><th>Status</th><th></th></tr></thead>' +
        '<tbody id="pBody"></tbody></table></div>' +
      '<p class="muted" id="pCount" style="margin-top:10px"></p></div>';

    const root = view.querySelector(".page");
    const body = root.querySelector("#pBody");

    function paint() {
      const list = filtered();
      body.innerHTML = rowsHtml(list);
      root.querySelector("#pCount").textContent = list.length + " item" + (list.length === 1 ? "" : "s") + " shown";
    }
    paint();

    root.querySelector("#pQ").addEventListener("input", function (e) { filters.q = e.target.value; paint(); });
    root.querySelector("#pCat").addEventListener("change", function (e) { filters.category = e.target.value; paint(); });
    root.querySelector("#pAvail").addEventListener("change", function (e) { filters.avail = e.target.value; paint(); });
    root.querySelector("#pSort").addEventListener("change", function (e) { filters.sort = e.target.value; paint(); });

    body.addEventListener("click", function (e) {
      const b = e.target.closest("[data-request]");
      if (!b) return;
      MarketingApp.setDraft({ project: "", reason: "", items: [{ name: b.dataset.request, qty: "" }] });
      MarketingApp.go("requisition");
      U.toast(b.dataset.request + " added to a new requisition.");
    });
  }

  MarketingApp.register("products", { title: "Products & Materials", render: render });
})();