/* ============================================================
   PYNX ERP — Requisition page
   Create material requests, track open requests, read Admin remarks,
   revise & resubmit rejected requests.
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

(function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  /* Form values are kept here so they survive a re-draw of the page */
  let form = blank();
  function blank() { return { project: "", neededBy: "", reason: "", rows: [{ name: "", qty: "" }] }; }

  function opt(value, label, selected) {
    return '<option value="' + U.esc(value) + '"' + (selected ? " selected" : "") + ">" + U.esc(label) + "</option>";
  }

  function projectOptions(selected) {
    const designs = D.designs().slice().sort(function (a, b) {
      return (a.status === "Ongoing" ? 0 : 1) - (b.status === "Ongoing" ? 0 : 1) || a.name.localeCompare(b.name);
    });
    const names = designs.map(function (p) { return p.name; });
    let html = '<option value="">— Select project / purpose —</option><optgroup label="Design projects">';
    html += designs.map(function (p) { return opt(p.name, p.name + " (" + p.status + ")", p.name === selected); }).join("");
    if (selected && selected !== D.PROJECT_OTHER && names.indexOf(selected) === -1) html += opt(selected, selected, true);
    html += '</optgroup><optgroup label="Other">' + opt(D.PROJECT_OTHER, D.PROJECT_OTHER, selected === D.PROJECT_OTHER) + "</optgroup>";
    return html;
  }

  function rowMeta(r) {
    const p = D.product(r.name);
    if (!p) return { unit: "", hint: "", warn: false };
    if (p.stock <= 0) return { unit: p.unit, hint: "Out of stock right now — Inventory will need to restock before this can be released.", warn: true };
    if (Number(r.qty) > p.stock) return { unit: p.unit, hint: "Only " + U.fmtNum(p.stock) + " " + p.unit + " in stock. You can still submit; Inventory will check what can be released.", warn: true };
    return { unit: p.unit, hint: U.fmtNum(p.stock) + " " + p.unit + " available", warn: false };
  }

  function openRequestsHtml() {
    const list = D.requisitions().filter(function (r) { return r.status !== "Completed"; });
    if (!list.length) return '<p class="muted">You have no open requests.</p>';
    return '<ul class="req-list">' + list.map(function (r) {
      return '<li class="req-item" data-open="' + r.id + '">' +
        '<div class="req-top"><strong>' + r.id + "</strong>" + U.statusBadge(r.status) + "</div>" +
        '<div class="req-material">' + U.esc(D.materialLabel(r)) + " · " + U.esc(D.qtyLabel(r)) + "</div>" +
        '<div class="muted">' + U.esc(r.project) + " · " + U.fmtDate(r.createdAt) + "</div>" +
        (r.status === "Partial" ? '<div class="req-progress">' + U.bar(D.fulfilment(r)) + '<span class="muted">' + D.fulfilment(r) + "% released</span></div>" : "") +
        (r.status === "Rejected" ? '<div class="remark remark-bad"><b>Admin remarks:</b> ' + U.esc(r.remarks || "No remarks provided.") +
          '</div><button type="button" class="btn btn-light btn-sm" data-resubmit="' + r.id + '">Revise &amp; resubmit</button>' : "") +
        "</li>";
    }).join("") + "</ul>";
  }

  function render(view) {
    const draft = MarketingApp.takeDraft();
    if (draft) {
      form = {
        project: draft.project || "", neededBy: "", reason: draft.reason || "",
        rows: draft.items && draft.items.length ? draft.items.map(function (i) { return { name: i.name, qty: i.qty }; }) : [{ name: "", qty: "" }]
      };
    }

    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header"><h1>Requisition</h1><p>Request the materials and supplies you need. Admin approves first, then Inventory checks stock.</p></header>' +
      '<div class="two-col">' +
        '<section class="card"><h2 class="card-title">New Requisition</h2>' +
          '<form id="reqForm" novalidate>' +
            '<div class="form-grid">' +
              '<div class="field"><label>Project / Purpose *</label><select name="project">' + projectOptions(form.project) + "</select></div>" +
              '<div class="field"><label>Needed by *</label><input type="date" name="neededBy" min="' + U.today() + '" value="' + U.esc(form.neededBy) + '"></div>' +
              '<div class="field full"><label>Reason for request *</label><textarea name="reason" rows="3" placeholder="Why do you need these materials?">' + U.esc(form.reason) + "</textarea></div>" +
            "</div>" +
            '<h3 class="sub-title">Materials needed</h3>' +
            '<div id="itemRows"></div>' +
            '<button type="button" class="btn btn-light btn-sm" id="addRow">+ Add material</button>' +
            '<div class="form-error" id="formError" hidden></div>' +
            '<div class="form-actions"><button type="button" class="btn btn-light" id="clearForm">Clear</button>' +
            '<button type="submit" class="btn btn-dark">Submit to Admin</button></div>' +
          "</form></section>" +
        '<section class="card"><h2 class="card-title">Open Requests</h2><div id="openRequests">' + openRequestsHtml() + "</div></section>" +
      "</div></div>";

    const root = view.querySelector(".page");
    const f = root.querySelector("#reqForm");
    const rowsEl = root.querySelector("#itemRows");
    const errEl = root.querySelector("#formError");

    function paintRows() {
      rowsEl.innerHTML = form.rows.map(function (r, i) {
        const m = rowMeta(r);
        return '<div class="item-row" data-i="' + i + '">' +
          '<div class="field"><select class="row-material">' + U.materialOptions(r.name) + "</select></div>" +
          '<div class="field qty"><input type="number" class="row-qty" min="0" step="any" placeholder="Qty" value="' + U.esc(r.qty) + '"><span class="unit">' + U.esc(m.unit) + "</span></div>" +
          '<button type="button" class="icon-btn row-remove" title="Remove material"' + (form.rows.length === 1 ? " disabled" : "") + ">&times;</button>" +
          '<p class="row-hint' + (m.warn ? " warn" : "") + '">' + U.esc(m.hint) + "</p></div>";
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

    rowsEl.addEventListener("change", function (e) {
      if (!e.target.classList.contains("row-material")) return;
      const el = e.target.closest(".item-row"), i = +el.dataset.i;
      form.rows[i].name = e.target.value;
      updateRow(el, i);
    });
    rowsEl.addEventListener("input", function (e) {
      if (!e.target.classList.contains("row-qty")) return;
      const el = e.target.closest(".item-row"), i = +el.dataset.i;
      form.rows[i].qty = e.target.value;
      updateRow(el, i);
    });
    rowsEl.addEventListener("click", function (e) {
      const btn = e.target.closest(".row-remove");
      if (!btn || form.rows.length === 1) return;
      form.rows.splice(+btn.closest(".item-row").dataset.i, 1);
      paintRows();
    });
    root.querySelector("#addRow").addEventListener("click", function () {
      form.rows.push({ name: "", qty: "" });
      paintRows();
    });

    function sync() { form.project = f.project.value; form.neededBy = f.neededBy.value; form.reason = f.reason.value; }
    f.addEventListener("input", sync);
    f.addEventListener("change", sync);

    root.querySelector("#clearForm").addEventListener("click", function () {
      form = blank();
      MarketingApp.refresh();
    });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      sync();
      const errors = [];
      function add(msg) { if (errors.indexOf(msg) === -1) errors.push(msg); }

      if (!form.project) add("Choose the project or purpose of this request.");
      if (!form.neededBy) add("Select the date you need the materials.");
      else if (form.neededBy < U.today()) add("The needed-by date cannot be in the past.");
      if (form.reason.trim().length < 10) add("Explain why you need these materials (at least 10 characters).");

      const filled = form.rows.filter(function (r) { return r.name || r.qty; });
      if (!filled.length) add("Add at least one material.");
      const seen = {};
      filled.forEach(function (r) {
        if (!r.name) { add("Choose a material for every row."); return; }
        if (seen[r.name]) add(r.name + " is listed more than once. Combine the quantities into one row.");
        seen[r.name] = true;
        if (!(Number(r.qty) > 0)) add("Enter a quantity greater than zero for " + r.name + ".");
      });

      if (errors.length) {
        errEl.hidden = false;
        errEl.innerHTML = "<ul>" + errors.map(function (m) { return "<li>" + U.esc(m) + "</li>"; }).join("") + "</ul>";
        return;
      }
      errEl.hidden = true;

      U.confirm({
        title: "Submit requisition?",
        message: "Send <b>" + filled.length + " material" + (filled.length > 1 ? "s" : "") + "</b> for <b>" + U.esc(form.project) + "</b> to Admin for approval?",
        confirmText: "Submit"
      }).then(function (ok) {
        if (!ok) return;
        const r = D.addRequisition({ project: form.project, reason: form.reason.trim(), neededBy: form.neededBy, items: filled });
        form = blank();
        MarketingApp.refresh();
        U.toast(r.id + " submitted to Admin.");
      });
    });

    root.addEventListener("click", function (e) {
      const re = e.target.closest("[data-resubmit]");
      if (re) {
        const r = D.getRequisition(re.dataset.resubmit);
        MarketingApp.setDraft({ project: r.project, reason: r.reason, items: r.items.map(function (i) { return { name: i.name, qty: i.qty }; }) });
        MarketingApp.go("requisition");
        U.toast("Details copied into a new form. Review and resubmit.");
        return;
      }
      const row = e.target.closest("[data-open]");
      if (row) MarketingHistory.openDetail(row.dataset.open);
    });
  }

  MarketingApp.register("requisition", { title: "Requisition", render: render });
})();