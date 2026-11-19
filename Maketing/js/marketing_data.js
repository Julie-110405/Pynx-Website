/* ============================================================
   PYNX ERP — Marketing Data Store
   Sample data is saved in the browser (localStorage) so every menu
   works without a database. When Supabase / the backend is ready,
   replace the bodies of the functions in the returned object at the
   bottom with API calls. The pages will not need to change.
   ============================================================ */

const MarketingData = (function () {
  "use strict";

  const STORE_KEY = "pynx_marketing_v1";
  const DEMO_TOOLS = true; // set to false to hide the "simulate Admin / Inventory" buttons

  /* Paths are relative to Maketing/marketing_dashboard.html */
  const paths = {
    logo: "../logo/pynx-logo.png",
    login: "../Log_in/login.html"
  };

  const user = { name: "Marketing Staff", department: "Marketing" };

  const menu = [
    { key: "dashboard",     label: "Dashboard",            href: "#dashboard" },
    { key: "requisition",   label: "Requisition",          href: "#requisition" },
    { key: "designs",       label: "Project Designs",      href: "#designs" },
    { key: "products",      label: "Products & Materials", href: "#products" },
    { key: "history",       label: "Request History",      href: "#history" },
    { key: "notifications", label: "Notifications",        href: "#notifications" },
    { key: "logout",        label: "Log Out",              href: paths.login }
  ];

  const DESIGN_CATEGORIES = ["Clothing Collection", "Branding", "Packaging", "Marketing Materials"];
  const PROJECT_OTHER = "Departmental / Daily Use";

  /* ---------- Products & materials catalog (view-only for Marketing) ---------- */
  const catalog = [
    ["INV-001", "Cotton Fabric (White)",      "Fabrics",            "meters", 450,  100, "Soft white cotton fabric for shirts, tees and linings."],
    ["INV-002", "Denim Fabric (Indigo)",      "Fabrics",            "meters", 320,  80,  "Mid-weight indigo denim for jeans and jackets."],
    ["INV-003", "Polyester Blend Fabric",     "Fabrics",            "meters", 60,   100, "Lightweight polyester blend for sportswear and linings."],
    ["INV-004", "Sewing Thread (Black)",      "Sewing Supplies",    "rolls",  120,  40,  "All-purpose black sewing thread."],
    ["INV-005", "Metal Zipper 7in",           "Sewing Supplies",    "pcs",    900,  300, "7-inch metal zipper for pants and jackets."],
    ["INV-006", "Shirt Buttons (Assorted)",   "Sewing Supplies",    "packs",  0,    30,  "Assorted shirt buttons sold per pack."],
    ["INV-007", "Clothing Labels",            "Labels & Tags",      "pcs",    1500, 500, "Woven neck labels with the PYNX logo."],
    ["INV-008", "Hang Tags",                  "Labels & Tags",      "pcs",    240,  300, "Printed PYNX hang tags for finished garments."],
    ["INV-009", "Packaging Poly Bags",        "Packaging",          "pcs",    2000, 600, "Clear poly bags for packing garments."],
    ["INV-010", "Shipping Boxes (Medium)",    "Packaging",          "pcs",    300,  100, "Medium-size boxes for online orders."],
    ["INV-011", "Screen Printing Ink (Black)","Printing Materials", "liters", 5,    10,  "Black ink for screen printing designs on garments."],
    ["INV-012", "Heat Transfer Vinyl",        "Printing Materials", "rolls",  40,   15,  "Heat transfer vinyl for logos and custom prints."],
    ["INV-013", "Plain White T-Shirt (M)",    "Finished Goods",     "pcs",    180,  60,  "Blank white tee, size M, for printing and photoshoot samples."],
    ["INV-014", "Pynx Hoodie (L, Black)",     "Finished Goods",     "pcs",    75,   40,  "Black PYNX hoodie, size L."],
    ["INV-015", "Clothes Hangers",            "Store Supplies",     "pcs",    800,  200, "Plastic hangers for store and photoshoot displays."]
  ].map(function (c) {
    return { sku: c[0], name: c[1], category: c[2], unit: c[3], stock: c[4], min: c[5], description: c[6] };
  });

  function productStatus(p) { return p.stock <= 0 ? "out" : p.stock <= p.min ? "low" : "ok"; }
  function product(name) { return catalog.find(function (p) { return p.name === name; }) || null; }

  /* ---------- Small helpers ---------- */
  function pad(n, l) { return String(n).padStart(l || 2, "0"); }
  function isoDaysAgo(days, hour) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour == null ? 10 : hour, 0, 0, 0);
    return d.toISOString();
  }
  function dateOnly(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function unitOf(name) { const p = product(name); return p ? p.unit : "pcs"; }
  function item(name, qty, released) { return { name: name, unit: unitOf(name), qty: qty, released: released || 0 }; }
  function mat(name, qty) { return { name: name, unit: unitOf(name), qty: qty }; }
  function ev(at, by, text) { return { at: at, by: by, text: text }; }

  function releasedSummary(r) {
    return r.items.filter(function (i) { return i.released > 0; })
      .map(function (i) { return i.released + " of " + i.qty + " " + i.unit; }).join("; ");
  }

  /* ---------- Sample data ---------- */
  function makeReq(num, daysAgo, project, reason, items, status, remarks, confirmed) {
    const created = isoDaysAgo(daysAgo, 9);
    const r = {
      id: "REQ-" + pad(num, 3), createdAt: created, updatedAt: created,
      project: project, reason: reason, neededBy: dateOnly(14 - daysAgo),
      items: items, status: status, remarks: remarks || "",
      inventoryConfirmed: !!confirmed || status === "Partial" || status === "Completed",
      timeline: [ev(created, "Marketing", "Requisition submitted to Admin for approval")]
    };
    function add(by, text, d, h) {
      const at = isoDaysAgo(Math.max(d, 0), h);
      r.timeline.push(ev(at, by, text));
      r.updatedAt = at;
    }
    if (status === "Rejected") add("Admin", "Returned by Admin: " + remarks, daysAgo - 1, 14);
    else if (status !== "Pending") add("Admin", "Approved by Admin" + (remarks ? ": " + remarks : ""), daysAgo - 1, 14);
    if (r.inventoryConfirmed) add("Inventory", "Inventory confirmed stock availability", daysAgo - 2, 11);
    if (status === "Partial") add("Inventory", "Partially released: " + releasedSummary(r), daysAgo - 3, 15);
    if (status === "Completed") add("Inventory", "Fully released to Marketing", daysAgo - 3, 15);
    return r;
  }

  function makeDesign(num, name, category, status, progress, daysAgo, description, requirements, materials, files) {
    return {
      id: "DP-" + pad(num, 3), name: name, category: category, status: status, progress: progress,
      description: description, requirements: requirements, materials: materials,
      files: files.map(function (f) { return { name: f[0], size: f[1], type: f[2], preview: null }; }),
      createdAt: isoDaysAgo(daysAgo + 25, 9), updatedAt: isoDaysAgo(daysAgo, 10)
    };
  }

  function seed() {
    const requisitions = [
      makeReq(12, 2,  "PYNX Summer Collection 2027", "Hang tags for the upcoming Summer 2027 collection.", [item("Hang Tags", 100)], "Pending"),
      makeReq(11, 4,  "PYNX Summer Collection 2027", "Lightweight fabric for the summer sample pieces.", [item("Polyester Blend Fabric", 30)], "Approved", "Approved. Proceed with Inventory checking.", true),
      makeReq(10, 6,  "Brand Promotion", "Neck labels for the brand promotion sample garments.", [item("Clothing Labels", 200, 200)], "Completed", "Approved."),
      makeReq(9,  8,  "New Collection", "Black ink for printing the new collection graphics.", [item("Screen Printing Ink (Black)", 5)], "Rejected", "Ink stock is reserved for production. Please reduce to 2 liters and resubmit next week."),
      makeReq(8,  10, "New Collection", "White cotton for the new collection prototypes.", [item("Cotton Fabric (White)", 50, 30)], "Partial", "Approved."),
      makeReq(7,  12, "Brand Promotion", "Buttons for the promotional sample shirts.", [item("Shirt Buttons (Assorted)", 20)], "Pending"),
      makeReq(6,  14, "Holiday Capsule 2026", "Thread and zippers for the holiday capsule samples.", [item("Sewing Thread (Black)", 10), item("Metal Zipper 7in", 100)], "Approved", "Approved for sample making."),
      makeReq(5,  16, "Holiday Capsule 2026", "Poly bags for packing the photoshoot samples.", [item("Packaging Poly Bags", 500)], "Approved", "Approved.", true),
      makeReq(4,  19, "Brand Promotion", "Vinyl for merch prototypes.", [item("Heat Transfer Vinyl", 20)], "Rejected", "Quantity is above the department budget. Reduce to 5 rolls and resubmit."),
      makeReq(3,  23, "Store Packaging Refresh", "Blank tees for the photoshoot.", [item("Plain White T-Shirt (M)", 20, 20)], "Completed", "Approved."),
      makeReq(2,  27, "Store Packaging Refresh", "Denim for the packaging mock-ups.", [item("Denim Fabric (Indigo)", 40)], "Approved", "Approved."),
      makeReq(1,  31, "Hang Tag Redesign", "Hang tags for the redesign test print.", [item("Hang Tags", 50)], "Pending")
    ];

    const designs = [
      makeDesign(1, "PYNX Summer Collection 2027", "Clothing Collection", "Ongoing", 45, 1,
        "Lightweight summer pieces: tees, shorts and a linen-look shirt.",
        "Pastel palette, woven neck labels and printed hang tags on every piece.",
        [mat("Polyester Blend Fabric", 30), mat("Clothing Labels", 200), mat("Hang Tags", 100)],
        [["summer-2027-moodboard.png", 482000, "image/png"], ["summer-2027-techpacks.pdf", 1250000, "application/pdf"]]),
      makeDesign(2, "Holiday Capsule 2026", "Clothing Collection", "Ongoing", 70, 3,
        "Small holiday drop with hoodies and denim jackets.",
        "Dark tones, gold foil logo, gift-ready packaging.",
        [mat("Denim Fabric (Indigo)", 40), mat("Packaging Poly Bags", 300)],
        [["holiday-capsule-sketches.pdf", 910000, "application/pdf"]]),
      makeDesign(3, "Brand Promotion", "Marketing Materials", "Completed", 100, 9,
        "Promotional materials and sample garments for the brand campaign.",
        "Use the black and white brand identity.",
        [mat("Clothing Labels", 200)], [["brand-promo-final.png", 640000, "image/png"]]),
      makeDesign(4, "New Collection", "Clothing Collection", "Completed", 100, 15,
        "Fall essentials prototypes.", "Neutral colors, cotton-based.",
        [mat("Cotton Fabric (White)", 50)], [["new-collection-lookbook.pdf", 2100000, "application/pdf"]]),
      makeDesign(5, "Hang Tag Redesign", "Branding", "Completed", 100, 30,
        "Refreshed hang tag layout with the new logo.", "Matte paper, black print.",
        [mat("Hang Tags", 50)], [["hang-tag-v3.svg", 38000, "image/svg+xml"]]),
      makeDesign(6, "Store Packaging Refresh", "Packaging", "Completed", 100, 40,
        "New poly bags and boxes for online orders.", "Minimal black logo print.",
        [mat("Packaging Poly Bags", 500), mat("Shipping Boxes (Medium)", 100)], [])
    ];

    const notifications = [
      { id: "N-1", text: "REQ-012 submitted successfully — waiting for Admin approval", source: "Requisition", tone: "blue",  at: isoDaysAgo(2, 9),  read: true,  reqId: "REQ-012", kind: "requisition" },
      { id: "N-2", text: "REQ-011 (Polyester Blend Fabric) was approved",                source: "Admin",       tone: "green", at: isoDaysAgo(3, 14), read: false, reqId: "REQ-011", kind: "requisition" },
      { id: "N-3", text: "Inventory confirmed stock availability for REQ-011",           source: "Inventory",   tone: "blue",  at: isoDaysAgo(2, 11), read: false, reqId: "REQ-011", kind: "requisition" },
      { id: "N-4", text: "REQ-010 (Clothing Labels) is fully released and ready",         source: "Inventory",   tone: "green", at: isoDaysAgo(3, 15), read: false, reqId: "REQ-010", kind: "requisition" },
      { id: "N-5", text: "REQ-009 (Screen Printing Ink) was returned by Admin",          source: "Admin",       tone: "red",   at: isoDaysAgo(7, 14), read: false, reqId: "REQ-009", kind: "requisition" },
      { id: "N-6", text: "REQ-008 partially fulfilled — 30 of 50 meters released",       source: "Inventory",   tone: "yellow",at: isoDaysAgo(7, 15), read: true,  reqId: "REQ-008", kind: "requisition" },
      { id: "N-7", text: "Project \"PYNX Summer Collection 2027\" was updated to 45%",    source: "Project",     tone: "blue",  at: isoDaysAgo(1, 10), read: true,  reqId: null,      kind: "project" }
    ];

    return { requisitions: requisitions, designs: designs, notifications: notifications, settings: { projectNotifications: true } };
  }

  /* ---------- Storage ---------- */
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.requisitions && s.designs && s.notifications) {
          s.settings = s.settings || { projectNotifications: true };
          return s;
        }
      }
    } catch (e) { /* ignore and use sample data */ }
    return seed();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      document.dispatchEvent(new CustomEvent("marketing:storage-error"));
    }
    document.dispatchEvent(new CustomEvent("marketing:changed"));
  }

  function reset() { state = seed(); save(); }

  /* ---------- Requisitions ---------- */
  function requisitions() {
    return state.requisitions.slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt) || b.id.localeCompare(a.id);
    });
  }
  function getRequisition(id) { return state.requisitions.find(function (r) { return r.id === id; }) || null; }

  function summary() {
    const list = state.requisitions;
    function count(s) { return list.filter(function (r) { return r.status === s; }).length; }
    return {
      total: list.length,
      pending: count("Pending"),
      approved: count("Approved") + count("Partial"),
      rejected: count("Rejected"),
      completed: count("Completed"),
      last: requisitions()[0] || null
    };
  }

  function materialLabel(r) {
    return r.items[0].name + (r.items.length > 1 ? " +" + (r.items.length - 1) + " more" : "");
  }
  function qtyLabel(r) {
    if (r.items.length > 1) return r.items.length + " items";
    return Number(r.items[0].qty).toLocaleString("en-US") + " " + r.items[0].unit;
  }
  function fulfilment(r) {
    if (!r.items.length) return 0;
    const sum = r.items.reduce(function (a, i) { return a + Math.min(1, i.released / i.qty); }, 0);
    return Math.round((sum / r.items.length) * 100);
  }
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

  function pushNotification(n) {
    state.notifications.push({
      id: "N-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      text: n.text, source: n.source, tone: n.tone, at: new Date().toISOString(),
      read: false, reqId: n.reqId || null, kind: n.kind || "requisition"
    });
  }

  function addRequisition(data) {
    const max = state.requisitions.reduce(function (m, r) { return Math.max(m, parseInt(r.id.replace(/\D/g, ""), 10) || 0); }, 0);
    const now = new Date().toISOString();
    const r = {
      id: "REQ-" + pad(max + 1, 3), createdAt: now, updatedAt: now,
      project: data.project, reason: data.reason, neededBy: data.neededBy,
      items: data.items.map(function (i) { return { name: i.name, unit: unitOf(i.name), qty: Number(i.qty), released: 0 }; }),
      status: "Pending", remarks: "", inventoryConfirmed: false,
      timeline: [ev(now, "Marketing", "Requisition submitted to Admin for approval")]
    };
    state.requisitions.push(r);
    pushNotification({ text: r.id + " submitted successfully — waiting for Admin approval", source: "Requisition", tone: "blue", reqId: r.id });
    save();
    return r;
  }

  /* Demo only: lets you see how a request moves once Admin / Inventory act on it.
     Delete this function (and DEMO_TOOLS) when the real backend exists. */
  function simulate(id, action) {
    const r = getRequisition(id);
    if (!r) throw new Error("Requisition not found.");
    const now = new Date().toISOString();
    const label = r.id + " (" + materialLabel(r) + ")";

    if (action === "approve" && r.status === "Pending") {
      r.status = "Approved"; r.remarks = "Approved. Proceed with Inventory checking.";
      r.timeline.push(ev(now, "Admin", "Approved by Admin: " + r.remarks));
      pushNotification({ text: label + " was approved", source: "Admin", tone: "green", reqId: r.id });
    } else if (action === "reject" && r.status === "Pending") {
      r.status = "Rejected"; r.remarks = "Please revise the quantity or purpose and resubmit.";
      r.timeline.push(ev(now, "Admin", "Returned by Admin: " + r.remarks));
      pushNotification({ text: label + " was returned by Admin", source: "Admin", tone: "red", reqId: r.id });
    } else if (action === "confirm" && r.status === "Approved" && !r.inventoryConfirmed) {
      r.inventoryConfirmed = true;
      r.timeline.push(ev(now, "Inventory", "Inventory confirmed stock availability"));
      pushNotification({ text: "Inventory confirmed availability for " + label, source: "Inventory", tone: "blue", reqId: r.id });
    } else if ((action === "release_partial" || action === "release_all") && r.inventoryConfirmed && (r.status === "Approved" || r.status === "Partial")) {
      r.items.forEach(function (i) {
        const remaining = i.qty - i.released;
        if (remaining <= 0) return;
        i.released += action === "release_all" ? remaining : Math.max(1, Math.floor(remaining / 2));
      });
      const done = r.items.every(function (i) { return i.released >= i.qty; });
      r.status = done ? "Completed" : "Partial";
      r.timeline.push(ev(now, "Inventory", done ? "Fully released to Marketing" : "Partially released: " + releasedSummary(r)));
      pushNotification({
        text: done ? label + " is fully released and ready" : label + " partially fulfilled — " + releasedSummary(r),
        source: "Inventory", tone: done ? "green" : "yellow", reqId: r.id
      });
    } else {
      throw new Error("That step is not available for this request right now.");
    }
    r.updatedAt = now;
    save();
  }

  /* ---------- Design projects ---------- */
  function designs() { return state.designs.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }); }
  function getDesign(id) { return state.designs.find(function (p) { return p.id === id; }) || null; }
  function designStats() {
    return {
      total: state.designs.length,
      ongoing: state.designs.filter(function (p) { return p.status === "Ongoing"; }).length,
      completed: state.designs.filter(function (p) { return p.status === "Completed"; }).length,
      files: state.designs.reduce(function (a, p) { return a + p.files.length; }, 0)
    };
  }

  function saveDesign(d) {
    const now = new Date().toISOString();
    let p = d.id ? getDesign(d.id) : null;
    const isNew = !p;
    const prevStatus = p ? p.status : null;
    if (isNew) {
      const max = state.designs.reduce(function (m, x) { return Math.max(m, parseInt(x.id.replace(/\D/g, ""), 10) || 0); }, 0);
      p = { id: "DP-" + pad(max + 1, 3), createdAt: now };
      state.designs.push(p);
    }
    p.name = d.name.trim();
    p.category = d.category;
    p.status = d.status;
    p.progress = d.status === "Completed" ? 100 : Math.max(0, Math.min(100, Number(d.progress) || 0));
    p.description = d.description.trim();
    p.requirements = d.requirements.trim();
    p.materials = d.materials.map(function (m) { return { name: m.name, unit: unitOf(m.name), qty: Number(m.qty) }; });
    p.files = d.files;
    p.updatedAt = now;
    if (state.settings.projectNotifications) {
      if (isNew) pushNotification({ text: "Project \"" + p.name + "\" was created", source: "Project", tone: "blue", kind: "project" });
      else if (prevStatus !== p.status) pushNotification({ text: "Project \"" + p.name + "\" is now " + p.status.toLowerCase(), source: "Project", tone: "blue", kind: "project" });
    }
    save();
    return p;
  }

  function deleteDesign(id) {
    state.designs = state.designs.filter(function (p) { return p.id !== id; });
    save();
  }

  /* ---------- Notifications ---------- */
  function notifications() { return state.notifications.slice().sort(function (a, b) { return new Date(b.at) - new Date(a.at); }); }
  function unreadCount() { return state.notifications.filter(function (n) { return !n.read; }).length; }
  function setRead(id, read) {
    const n = state.notifications.find(function (x) { return x.id === id; });
    if (n && n.read !== read) { n.read = read; save(); }
  }
  function markAllRead() { state.notifications.forEach(function (n) { n.read = true; }); save(); }
  function removeNotification(id) { state.notifications = state.notifications.filter(function (n) { return n.id !== id; }); save(); }

  function settings() { return state.settings; }
  function setSetting(key, value) { state.settings[key] = value; save(); }

  return {
    DEMO_TOOLS: DEMO_TOOLS, paths: paths, user: user, menu: menu,
    DESIGN_CATEGORIES: DESIGN_CATEGORIES, PROJECT_OTHER: PROJECT_OTHER,
    catalog: catalog, product: product, productStatus: productStatus,
    requisitions: requisitions, getRequisition: getRequisition, summary: summary,
    materialLabel: materialLabel, qtyLabel: qtyLabel, fulfilment: fulfilment, statusText: statusText,
    addRequisition: addRequisition, simulate: simulate,
    designs: designs, getDesign: getDesign, designStats: designStats, saveDesign: saveDesign, deleteDesign: deleteDesign,
    notifications: notifications, unreadCount: unreadCount, setRead: setRead, markAllRead: markAllRead,
    removeNotification: removeNotification, settings: settings, setSetting: setSetting,
    reset: reset
  };
})();