/* ============================================================
   PYNX ERP — Project Designs page
   Create / edit design projects, track progress, attach design files,
   list the materials a project needs and send them to Requisition.
   Depends on: marketing_data.js, marketing_ui.js, marketing_app.js
   ============================================================ */

(function () {
  "use strict";
  const D = MarketingData, U = MarketingUI;

  const filters = { q: "", status: "", category: "" };
  const MAX_FILES = 10;
  const MAX_PREVIEW = 150 * 1024; // only small images keep a preview in the browser

  function matches(p) {
    const q = filters.q.trim().toLowerCase();
    if (filters.status && p.status !== filters.status) return false;
    if (filters.category && p.category !== filters.category) return false;
    return !q || (p.name + " " + p.description + " " + p.category).toLowerCase().indexOf(q) !== -1;
  }

  function ext(name) { const i = name.lastIndexOf("."); return i > -1 ? name.slice(i + 1, i + 5).toUpperCase() : "FILE"; }

  function thumb(p) {
    const img = p.files.find(function (f) { return f.preview; });
    if (img) return '<img src="' + img.preview + '" alt="">';
    return '<div class="thumb-ph">' + U.esc(p.name.split(" ").slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase()) + "</div>";
  }

  function cardHtml(p) {
    return '<article class="design-card" data-open="' + p.id + '">' +
      '<div class="design-thumb">' + thumb(p) + "</div>" +
      '<div class="design-body">' +
        '<div class="design-top"><span class="tag">' + U.esc(p.category) + "</span>" + U.designBadge(p.status) + "</div>" +
        "<h3>" + U.esc(p.name) + "</h3>" +
        '<p class="muted clamp">' + U.esc(p.description || "No description yet.") + "</p>" +
        '<div class="bar-label"><span>Progress</span><strong>' + p.progress + "%</strong></div>" + U.bar(p.progress) +
        '<p class="muted design-meta">' + p.materials.length + " material" + (p.materials.length === 1 ? "" : "s") + " · " +
          p.files.length + " file" + (p.files.length === 1 ? "" : "s") + " · Updated " + U.fmtDate(p.updatedAt) + "</p>" +
      "</div></article>";
  }

  /* ---------- Page ---------- */
  function render(view) {
    const st = D.designStats();
    view.innerHTML =
      '<div class="page">' +
      '<header class="page-header page-header-row"><div><h1>Project Designs</h1><p>Plan creative projects, keep design files in one place and list the materials each project needs.</p></div>' +
      '<button type="button" class="btn btn-dark" id="newProject">+ New Project</button></header>' +
      '<section class="grid grid-4">' + [
        ["Total Projects", st.total, "All design projects"], ["Ongoing", st.ongoing, "Currently in progress"],
        ["Completed", st.completed, "Finished projects"], ["Design Files", st.files, "Files and references"]
      ].map(function (c) {
        return '<article class="stat-card"><p class="stat-label">' + c[0] + '</p><p class="stat-value">' + c[1] + '</p><p class="stat-note">' + c[2] + "</p></article>";
      }).join("") + "</section>" +
      '<div class="toolbar">' +
        '<input type="text" id="dQ" class="search-input" placeholder="Search projects" value="' + U.esc(filters.q) + '">' +
        '<select id="dStatus" class="select-input"><option value="">All statuses</option><option' + (filters.status === "Ongoing" ? " selected" : "") + '>Ongoing</option><option' + (filters.status === "Completed" ? " selected" : "") + ">Completed</option></select>" +
        '<select id="dCat" class="select-input"><option value="">All categories</option>' + D.DESIGN_CATEGORIES.map(function (c) {
          return "<option" + (filters.category === c ? " selected" : "") + ">" + U.esc(c) + "</option>";
        }).join("") + "</select></div>" +
      '<section class="design-grid" id="designGrid"></section></div>';

    const root = view.querySelector(".page");
    const grid = root.querySelector("#designGrid");

    function paint() {
      const list = D.designs().filter(matches);
      grid.innerHTML = list.length ? list.map(cardHtml).join("") : '<div class="card empty-card">No projects found. Create one with “+ New Project”.</div>';
    }
    paint();

    root.querySelector("#dQ").addEventListener("input", function (e) { filters.q = e.target.value; paint(); });
    root.querySelector("#dStatus").addEventListener("change", function (e) { filters.status = e.target.value; paint(); });
    root.querySelector("#dCat").addEventListener("change", function (e) { filters.category = e.target.value; paint(); });
    root.querySelector("#newProject").addEventListener("click", function () { openForm(null); });
    grid.addEventListener("click", function (e) {
      const card = e.target.closest("[data-open]");
      if (card) openDetail(card.dataset.open);
    });
  }

  /* ---------- Detail window ---------- */
  function openDetail(id) {
    const p = D.getDesign(id);
    if (!p) return;
    const m = U.modal(
      '<div class="modal-head"><div><h2 class="modal-title">' + U.esc(p.name) + '</h2><p class="muted">' + U.esc(p.category) +
        " · Updated " + U.fmtDate(p.updatedAt) + "</p></div>" + U.designBadge(p.status) + "</div>" +
      '<div class="bar-label"><span>Progress</span><strong>' + p.progress + "%</strong></div>" + U.bar(p.progress) +
      '<div class="detail-grid" style="margin-top:16px"><div class="full"><span>Description</span>' + U.esc(p.description || "—") + "</div>" +
        '<div class="full"><span>Design requirements</span>' + U.esc(p.requirements || "—") + "</div></div>" +
      '<h3 class="sub-title">Materials needed</h3>' +
      (p.materials.length ? '<table class="table table-compact"><thead><tr><th>Material</th><th class="right">Quantity</th></tr></thead><tbody>' +
        p.materials.map(function (x) { return '<tr><td class="product">' + U.esc(x.name) + '</td><td class="right">' + U.fmtNum(x.qty) + " " + U.esc(x.unit) + "</td></tr>"; }).join("") + "</tbody></table>"
        : '<p class="muted">No materials listed.</p>') +
      '<h3 class="sub-title">Design files</h3>' +
      (p.files.length ? '<div class="file-list">' + p.files.map(function (f) {
        return '<div class="file-row"><div class="file-ico">' + (f.preview ? '<img src="' + f.preview + '" alt="">' : "<span>" + U.esc(ext(f.name)) + "</span>") +
          '</div><div class="file-info"><strong>' + U.esc(f.name) + "</strong><span>" + U.fmtSize(f.size) + "</span></div></div>";
      }).join("") + "</div>" : '<p class="muted">No files attached.</p>') +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-light" data-delete>Delete</button>' +
        '<button type="button" class="btn btn-light" data-toggle>' + (p.status === "Completed" ? "Reopen project" : "Mark as completed") + "</button>" +
        '<button type="button" class="btn btn-light" data-edit>Edit</button>' +
        (p.materials.length ? '<button type="button" class="btn btn-dark" data-request>Request these materials</button>' : "") +
        '<button type="button" class="btn btn-light" data-close>Close</button></div>',
      { wide: true });

    m.addEventListener("click", function (e) {
      if (e.target.closest("[data-edit]")) { m.close(); openForm(id); }
      else if (e.target.closest("[data-request]")) {
        MarketingApp.setDraft({ project: p.name, reason: "Materials for " + p.name + ".", items: p.materials.map(function (x) { return { name: x.name, qty: x.qty }; }) });
        m.close();
        MarketingApp.go("requisition");
        U.toast("Materials copied into a new requisition.");
      } else if (e.target.closest("[data-toggle]")) {
        D.saveDesign({ id: p.id, name: p.name, category: p.category, status: p.status === "Completed" ? "Ongoing" : "Completed",
          progress: p.status === "Completed" ? 90 : 100, description: p.description, requirements: p.requirements, materials: p.materials, files: p.files });
        m.close(); MarketingApp.refresh(); U.toast("Project status updated.");
      } else if (e.target.closest("[data-delete]")) {
        U.confirm({ title: "Delete project?", message: "Delete <b>" + U.esc(p.name) + "</b>? Past requisitions keep their records.", confirmText: "Delete", danger: true })
          .then(function (ok) { if (ok) { m.close(); D.deleteDesign(id); MarketingApp.refresh(); U.toast("Project deleted."); } });
      }
    });
  }

  /* ---------- Create / edit window ---------- */
  function toMeta(file) {
    return new Promise(function (resolve) {
      const meta = { name: file.name, size: file.size, type: file.type, preview: null };
      if (file.type.indexOf("image/") === 0 && file.size <= MAX_PREVIEW) {
        const fr = new FileReader();
        fr.onload = function () { meta.preview = fr.result; resolve(meta); };
        fr.onerror = function () { resolve(meta); };
        fr.readAsDataURL(file);
      } else resolve(meta);
    });
  }

  function openForm(id) {
    const existing = id ? D.getDesign(id) : null;
    const s = existing ? JSON.parse(JSON.stringify(existing)) :
      { name: "", category: D.DESIGN_CATEGORIES[0], status: "Ongoing", progress: 0, description: "", requirements: "", materials: [], files: [] };

    const m = U.modal(
      '<h2 class="modal-title">' + (existing ? "Edit Design Project" : "New Design Project") + "</h2>" +
      '<form id="designForm" novalidate>' +
        '<div class="form-grid">' +
          '<div class="field full"><label>Project name *</label><input type="text" name="pname" maxlength="80" value="' + U.esc(s.name) + '" placeholder="e.g. PYNX Summer Collection 2027"></div>' +
          '<div class="field"><label>Category *</label><select name="category">' + D.DESIGN_CATEGORIES.map(function (c) {
            return "<option" + (c === s.category ? " selected" : "") + ">" + U.esc(c) + "</option>";
          }).join("") + "</select></div>" +
          '<div class="field"><label>Status</label><select name="status"><option' + (s.status === "Ongoing" ? " selected" : "") + ">Ongoing</option><option" + (s.status === "Completed" ? " selected" : "") + ">Completed</option></select></div>" +
          '<div class="field full"><label>Progress: <b id="progVal">' + s.progress + '%</b></label><input type="range" name="progress" min="0" max="100" step="5" value="' + s.progress + '"></div>' +
          '<div class="field full"><label>Description</label><textarea name="description" rows="2">' + U.esc(s.description) + "</textarea></div>" +
          '<div class="field full"><label>Design requirements</label><textarea name="requirements" rows="2">' + U.esc(s.requirements) + "</textarea></div>" +
        "</div>" +
        '<h3 class="sub-title">Materials needed</h3><div id="dMats"></div>' +
        '<button type="button" class="btn btn-light btn-sm" id="dAddMat">+ Add material</button>' +
        '<h3 class="sub-title">Design files &amp; references</h3><div class="file-list" id="dFiles"></div>' +
        '<label class="btn btn-light btn-sm file-add">+ Add files<input type="file" id="dFileInput" multiple accept="image/*,.pdf,.svg,.ai,.psd,.zip,.doc,.docx" hidden></label>' +
        '<input type="file" id="dReplaceInput" hidden>' +
        '<p class="muted" style="margin-top:8px">Prototype note: only file names and small image previews are kept in this browser. Real file storage comes with the database.</p>' +
        '<div class="form-error" id="dError" hidden></div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-light" data-close>Cancel</button>' +
        '<button type="submit" class="btn btn-dark">' + (existing ? "Save changes" : "Create project") + "</button></div>" +
      "</form>", { wide: true });

    const f = m.querySelector("#designForm");
    const matsEl = m.querySelector("#dMats");
    const filesEl = m.querySelector("#dFiles");
    const errEl = m.querySelector("#dError");
    let replaceIdx = -1;

    function paintMats() {
      matsEl.innerHTML = s.materials.length ? s.materials.map(function (r, i) {
        const p = D.product(r.name);
        return '<div class="item-row" data-i="' + i + '">' +
          '<div class="field"><select class="row-material">' + U.materialOptions(r.name) + "</select></div>" +
          '<div class="field qty"><input type="number" class="row-qty" min="0" step="any" placeholder="Qty" value="' + U.esc(r.qty || "") + '"><span class="unit">' + U.esc(p ? p.unit : "") + "</span></div>" +
          '<button type="button" class="icon-btn row-remove" title="Remove material">&times;</button></div>';
      }).join("") : '<p class="muted">No materials listed yet.</p>';
    }
    function paintFiles() {
      filesEl.innerHTML = s.files.length ? s.files.map(function (fl, i) {
        return '<div class="file-row"><div class="file-ico">' + (fl.preview ? '<img src="' + fl.preview + '" alt="">' : "<span>" + U.esc(ext(fl.name)) + "</span>") +
          '</div><div class="file-info"><strong>' + U.esc(fl.name) + "</strong><span>" + U.fmtSize(fl.size) + "</span></div>" +
          '<button type="button" class="btn btn-light btn-sm" data-replace="' + i + '">Replace</button>' +
          '<button type="button" class="icon-btn" data-remove="' + i + '" title="Remove file">&times;</button></div>';
      }).join("") : '<p class="muted">No files added yet.</p>';
    }
    paintMats(); paintFiles();

    f.progress.addEventListener("input", function () { m.querySelector("#progVal").textContent = f.progress.value + "%"; });
    f.status.addEventListener("change", function () {
      if (f.status.value === "Completed") { f.progress.value = 100; m.querySelector("#progVal").textContent = "100%"; }
    });

    m.querySelector("#dAddMat").addEventListener("click", function () { s.materials.push({ name: "", qty: "" }); paintMats(); });
    matsEl.addEventListener("change", function (e) {
      if (!e.target.classList.contains("row-material")) return;
      const row = e.target.closest(".item-row"), p = D.product(e.target.value);
      s.materials[+row.dataset.i].name = e.target.value;
      row.querySelector(".unit").textContent = p ? p.unit : "";
    });
    matsEl.addEventListener("input", function (e) {
      if (e.target.classList.contains("row-qty")) s.materials[+e.target.closest(".item-row").dataset.i].qty = e.target.value;
    });
    matsEl.addEventListener("click", function (e) {
      const b = e.target.closest(".row-remove");
      if (b) { s.materials.splice(+b.closest(".item-row").dataset.i, 1); paintMats(); }
    });

    m.querySelector("#dFileInput").addEventListener("change", function (e) {
      const list = Array.prototype.slice.call(e.target.files);
      e.target.value = "";
      Promise.all(list.map(toMeta)).then(function (metas) {
        let dup = 0, full = 0;
        metas.forEach(function (meta) {
          if (s.files.length >= MAX_FILES) { full++; return; }
          if (s.files.some(function (x) { return x.name.toLowerCase() === meta.name.toLowerCase(); })) { dup++; return; }
          s.files.push(meta);
        });
        paintFiles();
        if (dup) U.toast(dup + " file(s) skipped: same name already added. Use Replace instead.", "error");
        if (full) U.toast("You can attach up to " + MAX_FILES + " files per project.", "error");
      });
    });
    filesEl.addEventListener("click", function (e) {
      const rm = e.target.closest("[data-remove]"), rp = e.target.closest("[data-replace]");
      if (rm) { s.files.splice(+rm.dataset.remove, 1); paintFiles(); }
      if (rp) { replaceIdx = +rp.dataset.replace; m.querySelector("#dReplaceInput").click(); }
    });
    m.querySelector("#dReplaceInput").addEventListener("change", function (e) {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file || replaceIdx < 0) return;
      toMeta(file).then(function (meta) { s.files[replaceIdx] = meta; replaceIdx = -1; paintFiles(); U.toast("File replaced."); });
    });

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      const name = f.pname.value.trim();
      const errors = [];
      function add(msg) { if (errors.indexOf(msg) === -1) errors.push(msg); }

      if (name.length < 2) add("Enter the project name.");
      else if (D.designs().some(function (p) { return p.id !== (existing && existing.id) && p.name.trim().toLowerCase() === name.toLowerCase(); })) add("Another project already uses this name.");

      const seen = {};
      s.materials.forEach(function (r) {
        if (!r.name) add("Choose a material for every row (or remove the empty row).");
        else {
          if (seen[r.name]) add(r.name + " is listed more than once.");
          seen[r.name] = true;
          if (!(Number(r.qty) > 0)) add("Enter a quantity greater than zero for " + r.name + ".");
        }
      });

      if (errors.length) {
        errEl.hidden = false;
        errEl.innerHTML = "<ul>" + errors.map(function (x) { return "<li>" + U.esc(x) + "</li>"; }).join("") + "</ul>";
        return;
      }
      D.saveDesign({
        id: existing ? existing.id : null, name: name, category: f.category.value, status: f.status.value, progress: f.progress.value,
        description: f.description.value, requirements: f.requirements.value, materials: s.materials, files: s.files
      });
      m.close();
      MarketingApp.refresh();
      U.toast(existing ? "Project updated." : "Project created.");
    });
    f.pname.focus();
  }

  MarketingApp.register("designs", { title: "Project Designs", render: render });
})();