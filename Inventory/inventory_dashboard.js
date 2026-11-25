/* ==========================================================================
   PYNX Inventory — one script for all menus
   Menus: Dashboard, Requisition, Products, Purchasing, Delivery, Inventory Reports, Logout
   Data: inventory_products, inventory_movements, inventory_purchase_requests,
         inventory_requisition_checks (Supabase)
   ========================================================================== */
(function () {
  'use strict';

  const sb = window.supabaseClient;
  const LOGIN_URL = '../Log_in/login.html';
  const ALLOWED_DEPARTMENTS = ['inventory', 'admin'];
  const REQ_DEPT = 'Marketing & Design';
  const PRODUCT_CATEGORIES = ['Bikini', 'Cap'];
  const PRODUCT_SUPPLIER = 'House of Fabrics';

  const CFG = {
    locale: 'en-US',
    currency: '₱',
    toastMs: 2800,
    defaultView: 'dashboard'
  };

  const NAV = [
    { id: 'dashboard',   icon: '▦', label: 'Dashboard' },
    { id: 'requisition', icon: '☰', label: 'Requisition' },
    { id: 'products',    icon: '▤', label: 'Products' },
    { id: 'purchasing',  icon: '◧', label: 'Purchasing' },
    { id: 'delivery',    icon: '▷', label: 'Delivery' },
    { id: 'reports',     icon: '▥', label: 'Inventory Reports' }
  ];

  const state = { products: [], movements: [], purchases: [], checks: [], profile: null };
  let current = null;
  let loadToken = 0;
  let livePending = false;
  let liveTimer = null;

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const num = x => Number(x || 0).toLocaleString(CFG.locale, { maximumFractionDigits: 3 });
  const money = x => CFG.currency + Number(x || 0).toLocaleString(CFG.locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const today = () => iso(new Date());

  const fdate = s => {
    if (!s) return '—';
    const d = new Date(s + 'T00:00');
    return isNaN(d) ? String(s) : d.toLocaleDateString(CFG.locale, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /* Date for timestamp columns (created_at, delivered_at, ...) */
  const fstamp = s => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d) ? '—' : d.toLocaleDateString(CFG.locale, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const STATUS = { In: 'In Stock', Low: 'Low Stock', Out: 'Out of Stock' };
  const TONE = { In: 'ok', Low: 'warn', Out: 'bad' };
  const statusOf = p => (Number(p.qty) <= 0 ? 'Out' : Number(p.qty) <= Number(p.min_level) ? 'Low' : 'In');
  const pill = (tone, label) => `<span class="pill pill--${tone}">${esc(label)}</span>`;
  const statusPill = p => pill(TONE[statusOf(p)], STATUS[statusOf(p)]);

  const activeProducts = () => state.products.filter(p => !p.archived);
  const findProduct = sku => state.products.find(p => p.sku === sku);
  const productName = sku => (findProduct(sku) || {}).name || sku;
  const productUnit = sku => (findProduct(sku) || {}).unit || '';

  /* Purchasing helpers */
  const CLOSED = ['Rejected', 'Stocked', 'Cancelled'];
  const isOpenReq = r => !CLOSED.includes(r.status);
  const PU_TONE = {
    'Pending Admin': 'warn', 'With Purchasing': 'warn', 'Ordered': 'warn',
    'Delivered': 'ok', 'Stocked': 'ok', 'Rejected': 'bad', 'Cancelled': 'mut'
  };
  const ADMIN_TONE = { Pending: 'warn', Approved: 'ok', Rejected: 'bad' };
  const INV_TONE = { Accepted: 'ok', Rejected: 'bad' };
  const openPurchaseFor = sku => state.purchases.find(r => r.sku === sku && isOpenReq(r));
  const deliveredCount = () => state.purchases.filter(r => r.status === 'Delivered').length;
  const originLabel = r => (r.source === 'inventory' ? 'Inventory Department' : r.origin_department);
  const isAdmin = () => !!state.profile && String(state.profile.department).toLowerCase() === 'admin';
  const isDeclined = r => state.checks.some(c => String(c.requisition_id) === String(r.id) && c.decision === 'Declined');

  const head = (title, sub = '') => `<h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}`;

  /* Headers starting with '#' are right-aligned numeric columns. */
  function table(headers, rowsHtml, empty = 'Nothing to show yet.') {
    const th = headers.map(h => `<th class="${h[0] === '#' ? 'r' : ''}">${esc(h.replace('#', ''))}</th>`).join('');
    const body = rowsHtml || `<tr><td colspan="${headers.length}" class="mut">${esc(empty)}</td></tr>`;
    return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const options = (pairs, selected) =>
    pairs.map(([v, l]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');

  function on(root, type, selector, fn) {
    root.addEventListener(type, ev => {
      const el = ev.target.closest(selector);
      if (el && root.contains(el)) fn(el, ev);
    });
  }

  function toast(message) {
    document.querySelectorAll('.toast').forEach(el => el.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), CFG.toastMs);
  }

  /* Calls a Supabase function; shows the error as a toast and returns false on failure */
  async function call(name, args) {
    const { error } = await sb.rpc(name, args);
    if (error) { toast(error.message); return false; }
    return true;
  }

  /* ---------- Modal ---------- */
  let onModalClose = null;

  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.classList.remove('modal-open');
    if (onModalClose) { const f = onModalClose; onModalClose = null; f(); }
    if (livePending && !$('#modal')) { livePending = false; softRefresh(); }
  }

  function modal(html, wide) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal';
    m.id = 'modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="card${wide ? ' wide' : ''}">${html}</div>`;
    m.addEventListener('click', ev => {
      if (ev.target === m || ev.target.closest('[data-close]')) closeModal();
    });
    document.body.appendChild(m);
    document.body.classList.add('modal-open');
    return m;
  }
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

  function confirmBox(title, message, okLabel, danger) {
    return new Promise(resolve => {
      const m = modal(`
        <h2>${esc(title)}</h2>
        <p>${esc(message)}</p>
        <p class="acts">
          <button type="button" data-close>Cancel</button>
          <button type="button" class="${danger ? 'dng' : 'pri'}" data-yes>${esc(okLabel)}</button>
        </p>`);
      onModalClose = () => resolve(false);
      $('[data-yes]', m).addEventListener('click', () => {
        onModalClose = null;
        closeModal();
        resolve(true);
      });
    });
  }

  /* ---------- CSV ---------- */
  function downloadCsv(filename, rows) {
    const text = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------------------
     Data (Supabase)
     --------------------------------------------------------------------- */
  async function loadData() {
    const [p, m, pr, ck] = await Promise.all([
      sb.from('inventory_products').select('*').order('name'),
      sb.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('inventory_purchase_requests').select('*').order('created_at', { ascending: false }).limit(1000),
      sb.from('inventory_requisition_checks').select('*')
    ]);
    if (p.error) throw p.error;
    if (m.error) throw m.error;
    if (pr.error) throw pr.error;
    if (ck.error) throw ck.error;
    state.products = p.data || [];
    state.movements = (m.data || []).sort((a, b) =>
      String(b.movement_date).localeCompare(String(a.movement_date)) || b.id - a.id);
    state.purchases = pr.data || [];
    state.checks = ck.data || [];
  }

  async function refresh() {
    try {
      await loadData();
      render();
    } catch (err) {
      showError(err);
    }
  }

  /* Live updates: when Purchasing or Admin changes a request, the screen updates by itself */
  function softRefresh() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      if ($('#modal')) { livePending = true; return; }
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { livePending = true; return; }
      try { await loadData(); render(); } catch (err) { console.warn(err); }
    }, 600);
  }

  function startLive() {
    try {
      sb.channel('inventory-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_purchase_requests' }, softRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'marketing_requisitions' }, softRefresh)
        .subscribe();
    } catch (err) { console.warn(err); }
  }

  function showError(err) {
    console.error(err);
    $('#main').innerHTML = head('Something went wrong', (err && err.message) || 'The inventory data could not be loaded.') +
      '<div class="card"><p>Check that you ran the Inventory SQL in Supabase and that you are signed in with an Inventory account.</p></div>';
  }

  /* ---------------------------------------------------------------------
     Navigation
     --------------------------------------------------------------------- */
  function renderNav() {
    const dc = deliveredCount();
    $('#nav').innerHTML = NAV.map(n => `
      <a href="#${esc(n.id)}" class="${n.id === current ? 'on' : ''}" ${n.id === current ? 'aria-current="page"' : ''}>
        <span class="nav-icon" aria-hidden="true">${n.icon}</span>${esc(n.label)}${n.id === 'delivery' && dc ? `<span class="count-badge">${dc}</span>` : ''}
      </a>`).join('') + `
      <a href="#" class="logout" data-logout>
        <span class="nav-icon" aria-hidden="true">⇥</span>Log out
      </a>`;
  }

  async function logout() {
    const ok = await confirmBox('Log out?', 'You will be returned to the login page.', 'Log out', false);
    if (!ok) return;
    try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
    window.location.href = LOGIN_URL;
  }

  const idFromHash = () => {
    const h = location.hash.slice(1);
    return NAV.some(n => n.id === h) ? h : null;
  };

  async function show(id) {
    current = id;
    closeModal();
    renderNav();
    const token = ++loadToken;
    $('#main').innerHTML = head('Loading…');
    try {
      await loadData();
      if (token !== loadToken) return;
      render();
      scrollTo(0, 0);
    } catch (err) {
      if (token === loadToken) showError(err);
    }
  }

  function render() {
    renderNav();
    const root = document.createElement('div');
    root.className = 'view';
    $('#main').replaceChildren(root);
    const views = {
      dashboard: viewDashboard, requisition: viewRequisition, products: viewProducts,
      purchasing: viewPurchasing, delivery: viewDelivery, reports: viewReports
    };
    (views[current] || viewDashboard)(root);
  }

  function go(id) {
    if (location.hash.slice(1) === id) show(id);
    else location.hash = id;
  }

  /* ---------------------------------------------------------------------
     Shared product table rows
     --------------------------------------------------------------------- */
  function dashboardRow(p) {
    return `<tr>
      <td>${esc(p.sku)}</td>
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(p.category)}</td>
      <td class="r">${num(p.qty)} ${esc(p.unit)}</td>
      <td class="r">${num(p.min_level)}</td>
      <td>${statusPill(p)}</td>
    </tr>`;
  }

  /* ---------------------------------------------------------------------
     DASHBOARD
     --------------------------------------------------------------------- */
  function viewDashboard(root) {
    const act = activeProducts();
    const totalUnits = act.reduce((s, p) => s + Number(p.qty), 0);
    const lowCount = act.filter(p => statusOf(p) === 'Low').length;
    const outCount = act.filter(p => statusOf(p) === 'Out').length;

    const byCat = {};
    act.forEach(p => { byCat[p.category] = (byCat[p.category] || 0) + Number(p.qty); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topMax = Math.max(1, ...top.map(t => t[1]));

    const alerts = act.filter(p => statusOf(p) !== 'In').sort((a, b) => a.qty - b.qty);
    const lastIn = state.movements.find(m => m.type === 'in' && m.party !== 'Opening balance' && m.party !== 'Stock adjustment');
    const recent = state.movements.filter(m => m.party !== 'Opening balance').slice(0, 6);

    const activityRows = recent.map(m => `<tr>
      <td>${fdate(m.movement_date)}</td>
      <td>${esc(m.ref_no)}</td>
      <td>${m.type === 'in' ? pill('ok', 'Received') : pill('warn', 'Released')}</td>
      <td><b>${esc(productName(m.sku))}</b></td>
      <td class="r">${m.type === 'in' ? '+' : '-'}${num(m.qty)} ${esc(productUnit(m.sku))}</td>
      <td>${esc(m.type === 'in' ? (m.party || '—') : [m.reason, m.party].filter(Boolean).join(' / ') || '—')}</td>
    </tr>`).join('');

    root.innerHTML = `
      ${head('Welcome to Inventory!', new Date().toLocaleDateString(CFG.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}

      <div class="grid g3">
        <div class="card">
          <h2>Stock History</h2>
          <div class="big">${num(totalUnits)}</div>
          <div class="mut">Total units on hand</div>
          <p class="mut" style="margin-top:22px">${lastIn
            ? `Last restocked: ${fdate(lastIn.movement_date)} · ${esc(productName(lastIn.sku))}`
            : 'No restocking recorded yet'}</p>
        </div>

        <div class="card">
          <h2>Top Categories</h2>
          ${top.length ? top.map(([c, q]) => `
            <div class="row tight"><span>${esc(c)}</span><b>${num(q)}</b></div>
            <div class="bar"><i style="width:${Math.round(q / topMax * 100)}%"></i></div>`).join('')
            : '<p class="mut">No products yet.</p>'}
        </div>

        <div class="card">
          <h2>Low Stock Alerts <span class="count-badge">${alerts.length}</span></h2>
          ${alerts.length ? alerts.slice(0, 5).map(p => `
            <div class="row"><span>${esc(p.name)}</span>
              <span>${num(p.qty)} ${esc(p.unit)} ${statusPill(p)}</span></div>`).join('')
            : '<p class="mut">All products are above their minimum level.</p>'}
        </div>
      </div>

      <div class="grid g4">
        <div class="card"><div class="mut">Total Products</div><div class="big">${act.length}</div><div class="mut">Active registered items</div></div>
        <div class="card"><div class="mut">Low Stock Items</div><div class="big">${lowCount}</div><div class="mut">At or below minimum level</div></div>
        <div class="card"><div class="mut">Out of Stock</div><div class="big">${outCount}</div><div class="mut">Currently unavailable</div></div>
        <div class="card"><div class="mut">Open Purchasing</div><div class="big">${state.purchases.filter(isOpenReq).length}</div><div class="mut">Requests not yet stocked</div></div>
      </div>

      <div class="card">
        <h2>Recent Inventory Activity</h2>
        ${table(['Date', 'Reference', 'Type', 'Product', '#Quantity', 'Source / Issued to'], activityRows,
          'No deliveries or releases recorded yet.')}
      </div>

      <div class="tools">
        <h2 class="title">Products</h2>
        <span class="sp"></span>
        <input class="grow" id="dash-q" type="search" placeholder="Search product" aria-label="Search product">
        <button type="button" data-go="products">View all products →</button>
      </div>
      <div class="card" id="dash-table"></div>`;

    const box = $('#dash-table', root);
    function drawRows() {
      const needle = $('#dash-q', root).value.trim().toLowerCase();
      const rows = act.filter(p => (p.name + p.sku + p.supplier + p.category).toLowerCase().includes(needle))
        .slice(0, 8).map(dashboardRow).join('');
      box.innerHTML = table(['SKU', 'Product', 'Category', '#On hand', '#Min. level', 'Status'], rows, 'No products found.');
    }
    drawRows();
    $('#dash-q', root).addEventListener('input', drawRows);
    on(root, 'click', '[data-go]', el => go(el.dataset.go));
  }

  /* ---------------------------------------------------------------------
     REQUISITION: validate stock, release, decline and request purchasing
     --------------------------------------------------------------------- */
  const rq = { status: 'active' };

  async function viewRequisition(root, openId) {
    root.innerHTML = head('Requisition', 'Process approved material requests from other departments.') +
      '<div class="card"><p class="mut">Loading requisitions…</p></div>';

    const { data, error } = await sb.from('marketing_requisitions')
      .select('id, project, reason, needed_by, status, inventory_confirmed, created_at, ' +
              'marketing_requisition_items(id, sku, material_name, unit, qty, released)')
      .in('status', ['Approved', 'Partial', 'Completed'])
      .order('created_at', { ascending: false });
    if (error) {
      root.innerHTML = head('Requisition') + `<div class="card"><p>${esc(error.message)}</p></div>`;
      return;
    }
    const reqs = (data || []).map(r => ({
      ...r, items: (r.marketing_requisition_items || []).sort((a, b) => a.id - b.id)
    }));

    const toValidate = reqs.filter(r => r.status === 'Approved' && !r.inventory_confirmed && !isDeclined(r)).length;
    const ready = reqs.filter(r => r.inventory_confirmed && r.status !== 'Completed').length;

    const stat = r => r.status === 'Completed' ? pill('ok', 'Completed')
      : r.status === 'Partial' ? pill('warn', 'Partially released')
      : r.inventory_confirmed ? pill('ok', 'Ready to release')
      : isDeclined(r) ? pill('bad', 'Declined · not enough stock')
      : pill('warn', 'To validate');

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${head('Requisition', 'Validate approved requests against stock, release materials, and request purchasing for shortages.')}
      <div class="grid g2">
        <div class="card"><div class="mut">To validate</div><div class="big">${toValidate}</div><div class="mut">Approved, availability not checked</div></div>
        <div class="card"><div class="mut">Ready to release</div><div class="big">${ready}</div><div class="mut">Validated, materials still to release</div></div>
      </div>
      <div class="card">
        <div class="tools">
          <select id="rq-status" aria-label="Filter">
            ${options([['active', 'Active requests'], ['completed', 'Completed'], ['all', 'All']], rq.status)}
          </select>
        </div>
        <div id="rq-table"></div>
      </div>`;
    root.replaceChildren(wrap);

    function draw() {
      const list = reqs.filter(r => rq.status === 'all' ||
        (rq.status === 'completed' ? r.status === 'Completed' : r.status !== 'Completed'));
      const rows = list.map(r => {
        const done = r.items.filter(i => Number(i.released) >= Number(i.qty)).length;
        const first = r.items[0] ? esc(r.items[0].material_name) : '—';
        const more = r.items.length > 1 ? ` +${r.items.length - 1} more` : '';
        return `<tr>
          <td><b>${esc(r.id)}</b></td><td>${esc(r.project)}</td><td>${fdate(r.needed_by)}</td>
          <td>${first}${more}<small>${done} of ${r.items.length} released</small></td>
          <td>${stat(r)}</td>
          <td><div class="acts"><button type="button" class="sm" data-open="${esc(r.id)}">Open</button></div></td></tr>`;
      }).join('');
      $('#rq-table', wrap).innerHTML = table(['Reference', 'Project', 'Needed by', 'Materials', 'Status', ''], rows,
        'No requisitions waiting for Inventory.');
    }
    draw();
    $('#rq-status', wrap).addEventListener('change', e => { rq.status = e.target.value; draw(); });
    on(wrap, 'click', '[data-open]', el => {
      const r = reqs.find(x => String(x.id) === el.dataset.open);
      if (r) openRequisition(r, root);
    });

    if (openId) { const r = reqs.find(x => String(x.id) === String(openId)); if (r) openRequisition(r, root); }
  }

  function openRequisition(r, root) {
    const key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random());
    const canAct = r.status === 'Approved' || r.status === 'Partial';
    const declined = isDeclined(r);

    const lines = r.items.map(it => {
      const p = it.sku ? findProduct(it.sku) : null;
      const remaining = Number(it.qty) - Number(it.released);
      const onHand = p ? Number(p.qty) : 0;
      return { it, p, remaining, onHand,
        canRelease: Math.max(0, Math.min(remaining, onHand)),
        shortage: Math.max(0, remaining - onHand) };
    });
    const totalShort = lines.reduce((s, L) => s + L.shortage, 0);

    const myPurchases = state.purchases.filter(x => String(x.requisition_id) === String(r.id));
    const prFor = L => myPurchases.find(x =>
      String(x.item_name).toLowerCase() === String(L.it.material_name).toLowerCase() && isOpenReq(x));

    const rows = lines.map(L => {
      const pr = prFor(L);
      let action = '';
      if (pr) action = pill(PU_TONE[pr.status] || 'mut', 'Purchasing: ' + pr.status);
      else if (canAct && L.shortage > 0 && (declined || r.inventory_confirmed)) {
        action = `<button type="button" class="sm pri" data-fwd="${L.it.id}">Request Purchasing</button>`;
      }
      return `<tr>
        <td><b>${esc(L.it.material_name)}</b><small>${esc(L.it.sku || 'No SKU')}</small></td>
        <td class="r">${num(L.it.qty)} ${esc(L.it.unit)}</td>
        <td class="r">${num(L.it.released)}</td>
        <td class="r">${num(L.remaining)}</td>
        <td class="r">${L.p ? num(L.onHand) : '—'}</td>
        <td class="r">${L.shortage > 0 ? pill('bad', num(L.shortage)) : pill('ok', '0')}</td>
        <td class="r">${canAct && r.inventory_confirmed && L.canRelease > 0
          ? `<input type="number" class="rel" data-item="${L.it.id}" min="0" max="${L.canRelease}" step="any" value="${L.canRelease}" style="width:90px">` : '—'}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');

    let hint = '';
    if (canAct && !r.inventory_confirmed) {
      if (declined) hint = 'This request was declined because there is not enough stock. Use Request Purchasing for the short items. After the delivery is added to Products, you can validate this request again.';
      else if (totalShort > 0) hint = 'There is not enough stock for some materials. Decline this request to send the shortage to the Purchasing department.';
      else hint = 'Stock is enough for every material. Confirm availability to enable releasing.';
    }

    const m = modal(`
      <h2>${esc(r.id)} · ${esc(r.project)}</h2>
      <p class="mut">${esc(r.reason)} · Needed by ${fdate(r.needed_by)}</p>
      ${table(['Material', '#Requested', '#Released', '#Remaining', '#On hand', '#Shortage', '#Release now', ''], rows)}
      ${myPurchases.length
        ? `<p class="mut">Purchasing: ${myPurchases.map(x =>
            `${esc(x.code)} (${num(x.qty)} ${esc(x.unit)} ${esc(x.item_name)}, ${esc(x.status)})`).join('; ')}</p>` : ''}
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      <p class="acts">
        <button type="button" data-close>Close</button>
        ${canAct && !r.inventory_confirmed && totalShort > 0 && !declined ? '<button type="button" class="dng" data-decline>Decline (not enough stock)</button>' : ''}
        ${canAct && !r.inventory_confirmed && totalShort === 0 ? '<button type="button" class="pri" data-confirm>Confirm availability</button>' : ''}
        ${canAct && r.inventory_confirmed ? '<button type="button" class="pri" data-release>Release selected</button>' : ''}
      </p>`, true);

    const reload = async (reopen) => { await loadData(); viewRequisition(root, reopen ? r.id : undefined); };

    on(m, 'click', '[data-confirm]', async el => {
      el.disabled = true;
      const { error } = await sb.rpc('rw_inventory_confirm', { p_req: r.id });
      if (error) { el.disabled = false; return toast(error.message); }
      closeModal(); toast('Availability confirmed'); reload(true);
    });

    on(m, 'click', '[data-release]', async el => {
      const payload = [];
      m.querySelectorAll('input.rel').forEach(i => {
        const q = Number(i.value);
        if (q > 0) payload.push({ item_id: Number(i.dataset.item), qty: q });
      });
      if (!payload.length) return toast('Enter a quantity to release.');
      for (const l of payload) {
        const L = lines.find(x => x.it.id === l.item_id);
        if (l.qty > L.canRelease) return toast(`${L.it.material_name}: only ${num(L.canRelease)} can be released now.`);
      }
      el.disabled = true;
      const { data: res, error } = await sb.rpc('rw_release_items',
        { p_req: r.id, p_lines: payload, p_request_key: key });
      if (error) { el.disabled = false; return toast(error.message); }
      closeModal();
      toast(res && res.duplicate ? 'Already released' : 'Stock released');
      reload(false);
    });

    on(m, 'click', '[data-decline]', async () => {
      closeModal();
      const ok = await confirmBox('Decline requisition?',
        'This request cannot be fulfilled from the current stock. After declining, you can send the shortage to the Purchasing department.',
        'Decline', true);
      if (!ok) return viewRequisition(root, r.id);
      const done = await call('inventory_decline_requisition', { p_req: String(r.id), p_reason: 'Insufficient stock' });
      if (done) toast('Requisition declined. You can now request purchasing.');
      await loadData();
      viewRequisition(root, r.id);
    });

    on(m, 'click', '[data-fwd]', async el => {
      const L = lines.find(x => String(x.it.id) === el.dataset.fwd);
      if (!L) return;
      closeModal();
      const ok = await confirmBox('Request purchasing?',
        `Send a purchase request for ${num(L.shortage)} ${L.it.unit} of ${L.it.material_name} to the Purchasing department? It will show that it came from ${REQ_DEPT}.`,
        'Request Purchasing', false);
      if (!ok) return viewRequisition(root, r.id);
      const done = await call('inventory_create_purchase_request', {
        p_source: 'requisition',
        p_sku: L.it.sku || null,
        p_item_name: L.it.material_name,
        p_unit: L.it.unit,
        p_qty: L.shortage,
        p_origin_department: REQ_DEPT,
        p_requisition_id: String(r.id),
        p_inventory_decision: declined ? 'Rejected' : 'Accepted',
        p_notes: `Requisition ${r.id} · ${r.project}`
      });
      if (done) toast('Purchase request sent to Purchasing');
      await loadData();
      viewRequisition(root, r.id);
    });
  }

  /* ---------------------------------------------------------------------
<<<<<<< HEAD
     DELIVERY (handled by other team members)
     --------------------------------------------------------------------- */
 

async function viewDelivery(root) {
    root.innerHTML = head(
        'Delivery',
        'Verify received deliveries from Logistics and record accepted quantities as stock-in.'
    ) + `
        <div class="card">
            <p class="mut">Loading deliveries...</p>
        </div>`;

    const { data, error } = await sb
        .from('deliveries')
        .select(`
            id,
            code,
            status,
            accepted_qty,
            actual_received_qty,
            damaged_qty,
            missing_qty,
            inspection_notes,
            purchase_orders(item, code),
            suppliers(name)
        `)
        .in('status', ['Completed', 'With Issues'])
        .order('created_at', { ascending: false });

    if (error) {
        root.innerHTML = head('Delivery') +
            `<div class="card"><p>${esc(error.message)}</p></div>`;
        return;
    }

    const rows = await Promise.all((data || []).map(async d => {
        const itemName = d.purchase_orders?.item || '';
        const product = state.products.find(p =>
            p.name.trim().toLowerCase() === itemName.trim().toLowerCase()
        );

        const reference = `Delivery stock-in: ${d.code}`;

        const { data: existing, error: checkError } = await sb
    .from('inventory_movements')
    .select('id')
    .in('reference', [d.code, reference])
    .limit(1);

        if (checkError) {
            console.error(checkError);
        }

        const alreadyRecorded = !!(existing && existing.length);
        const accepted = Number(d.accepted_qty) || 0;

        let action = '<span class="mut">No accepted stock</span>';

        if (alreadyRecorded) {
            action = pill('ok', 'Stock-in recorded');
        } else if (!product) {
            action = pill('bad', 'Product not matched');
        } else if (accepted > 0) {
            action = `
                <button
                    type="button"
                    class="sm pri"
                    data-stockin="${esc(d.id)}">
                    Record Stock-In
                </button>`;
        }

        return `
            <tr>
                <td><b>${esc(d.code)}</b></td>
                <td>${esc(d.purchase_orders?.code || '—')}</td>
                <td>${esc(itemName || '—')}</td>
                <td>${esc(d.suppliers?.name || '—')}</td>
                <td class="r">${num(d.actual_received_qty)}</td>
                <td class="r">${num(d.accepted_qty)}</td>
                <td class="r">${num(d.damaged_qty)}</td>
                <td class="r">${num(d.missing_qty)}</td>
                <td>${pill(d.status === 'Completed' ? 'ok' : 'warn',
                    d.status)}</td>
                <td>${action}</td>
            </tr>`;
    }));

    root.innerHTML = `
        ${head('Delivery', 'Verify received deliveries from Logistics and record accepted quantities as stock-in.')}

        <div class="card">
            <p class="mut">
                Only accepted quantities will be added to inventory.
                Damaged and missing items will not be added.
            </p>

            ${table(
                [
                    'Delivery',
                    'PO Number',
                    'Product',
                    'Supplier',
                    '#Received',
                    '#Accepted',
                    '#Damaged',
                    '#Missing',
                    'Status',
                    'Action'
                ],
                rows.join(''),
                'No inspected deliveries from Logistics yet.'
            )}
        </div>`;

    on(root, 'click', '[data-stockin]', el => {
        recordDeliveryStockIn(el.dataset.stockin, el);
    });
}

async function recordDeliveryStockIn(deliveryId, button) {
    if (button.disabled) return;

    button.disabled = true;

    const { data: delivery, error } = await sb
        .from('deliveries')
        .select(`
            id,
            code,
            accepted_qty,
            status,
            purchase_orders(item),
            suppliers(name)
        `)
        .eq('id', deliveryId)
        .single();

    if (error || !delivery) {
        button.disabled = false;
        return toast(error?.message || 'Delivery not found.');
    }

    if (!['Completed', 'With Issues'].includes(delivery.status)) {
        button.disabled = false;
        return toast('This delivery has not been inspected.');
    }

    const accepted = Number(delivery.accepted_qty) || 0;

    if (accepted <= 0) {
        button.disabled = false;
        return toast('There is no accepted quantity to record.');
    }

    const itemName = delivery.purchase_orders?.item || '';

    const product = state.products.find(p =>
        p.name.trim().toLowerCase() === itemName.trim().toLowerCase()
    );

    if (!product) {
        button.disabled = false;
        return toast('Matching inventory product not found.');
    }

    const reference = `Delivery stock-in: ${delivery.code}`;

   const { data: existing, error: checkError } = await sb
    .from('inventory_movements')
    .select('id')
    .in('reference', [delivery.code, reference])
    .limit(1);

    if (checkError) {
        button.disabled = false;
        return toast(checkError.message);
    }

    if (existing && existing.length) {
        button.disabled = false;
        return toast('This delivery has already been recorded.');
    }

    const { error: insertError } = await sb
        .from('inventory_movements')
        .insert({
            type: 'in',
            sku: product.sku,
            qty: accepted,
            party: delivery.suppliers?.name || 'Supplier',
            reference
        });

    if (insertError) {
        button.disabled = false;
        console.error(insertError);
        return toast('Stock-in failed: ' + insertError.message);
    }

    toast(`${accepted} ${product.unit} recorded as stock-in.`);
    await refresh();
}


async function confirmStockIn(delivery) {
  if (!delivery.product) {
    return toast('This delivery has no matching Inventory product SKU.');
  }

  if (delivery.alreadyStocked) {
    return toast('This delivery has already been recorded.');
  }

  const ok = await confirmBox(
    'Update Inventory?',
    `Record ${delivery.qty} ${delivery.product.unit} of ${delivery.product.name} from ${delivery.code} as new stock?`,
    'Confirm Stock-In',
    false
  );

  if (!ok) return;

  const btn = document.querySelector(`[data-stock-in="${delivery.id}"]`);
  if (btn) btn.disabled = true;

  try {
    // Double-check the movement history before inserting.
    const { data: existing, error: checkError } = await sb
      .from('inventory_movements')
      .select('id')
      .eq('type', 'in')
      .eq('reference', delivery.code)
      .limit(1);

    if (checkError) throw checkError;

    if (existing && existing.length) {
      toast('This delivery was already recorded.');
      await refresh();
      return;
    }

    const { data: userData } = await sb.auth.getUser();
    const userId = userData?.user?.id || null;

    const refNo = `SI-${today().replace(/-/g, '')}-${String(delivery.id).slice(-4)}`;

    // Record the stock movement. The existing database trigger
    // should update inventory_products.qty automatically.
    const { error: movementError } = await sb
      .from('inventory_movements')
      .insert({
        ref_no: refNo,
        type: 'in',
        sku: delivery.product.sku,
        qty: delivery.qty,
        movement_date: today(),
        party: delivery.supplier,
        reason: 'Supplier delivery',
        reference: delivery.code,
        notes: `Purchase Order: ${delivery.poCode}`,
        created_by: userId
      });

    if (movementError) throw movementError;

    const { error: updateError } = await sb
      .from('deliveries')
      .update({ status: 'Stocked In' })
      .eq('id', delivery.id)
      .eq('status', 'Completed');

    if (updateError) {
      throw new Error(
        'Stock movement saved, but delivery status could not be updated: ' +
        updateError.message
      );
    }

    toast('Stock-in recorded successfully!');
    await refresh();

  } catch (err) {
    console.error('Stock-in error:', err);
    toast('Could not record stock-in: ' + err.message);
    if (btn) btn.disabled = false;
  }
}


  /* ---------------------------------------------------------------------
     PRODUCTS (master records: add, edit, archive, delete)
=======
     PRODUCTS (add, edit, request purchasing, archive)
>>>>>>> e940cca (Update marketing is complete)
     --------------------------------------------------------------------- */
  const pf = { q: '', category: '', status: '', sort: 'name' };

  const SORTERS = {
    name: (a, b) => a.name.localeCompare(b.name),
    sku:  (a, b) => a.sku.localeCompare(b.sku),
    qty:  (a, b) => a.qty - b.qty,
    cost: (a, b) => b.unit_cost - a.unit_cost
  };

  function listProducts() {
    const needle = pf.q.trim().toLowerCase();
    return state.products
      .filter(p => !p.archived)
      .filter(p =>
        (p.name + p.sku + p.supplier).toLowerCase().includes(needle) &&
        (!pf.category || p.category === pf.category) &&
        (!pf.status || statusOf(p) === pf.status))
      .sort(SORTERS[pf.sort] || SORTERS.name);
  }

  function productRow(p) {
    const st = statusOf(p);
    const open = openPurchaseFor(p.sku);
    const actions = [`<button type="button" class="sm" data-act="edit" data-sku="${esc(p.sku)}">Edit</button>`];

    if (open) {
      actions.push(pill(PU_TONE[open.status] || 'mut', 'Purchasing: ' + open.status));
    } else {
      if (st !== 'In') actions.push(`<button type="button" class="sm" data-act="request" data-sku="${esc(p.sku)}">Request Purchasing</button>`);
      if (st === 'Out') actions.push(`<button type="button" class="sm" data-act="archive" data-sku="${esc(p.sku)}">Archive</button>`);
    }

    return `<tr>
      <td>${esc(p.sku)}</td>
      <td><b>${esc(p.name)}</b><small>${esc(p.supplier)}</small></td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.location)}</td>
      <td class="r">${num(p.qty)} ${esc(p.unit)}</td>
      <td class="r">${num(p.min_level)}</td>
      <td class="r">${money(p.unit_cost)}</td>
      <td>${statusPill(p)}</td>
      <td><div class="acts">${actions.join('')}</div></td>
    </tr>`;
  }

  function archivedRow(p) {
    const open = openPurchaseFor(p.sku);
    return `<tr>
      <td>${esc(p.sku)}</td>
      <td><b>${esc(p.name)}</b><small>${esc(p.supplier)}</small></td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.location)}</td>
      <td>${open ? pill(PU_TONE[open.status] || 'mut', 'Purchasing: ' + open.status) : pill('mut', 'Archived')}</td>
      <td><div class="acts">${open ? '' : `<button type="button" class="sm" data-act="request" data-sku="${esc(p.sku)}">Request Purchasing</button>`}</div></td>
    </tr>`;
  }

  function viewProducts(root) {
    const cats = [...new Set(state.products.filter(p => !p.archived).map(p => p.category))].sort();

    root.innerHTML = `
      ${head('Products', 'Master records of all products and materials. Stock quantities change through deliveries, requisition releases and manual adjustments.')}
      <div class="card">
        <div class="tools">
          <input class="grow" id="p-q" type="search" placeholder="Search name, SKU or supplier" value="${esc(pf.q)}" aria-label="Search">
          <select id="p-cat" aria-label="Category">
            <option value="">All categories</option>${options(cats.map(c => [c, c]), pf.category)}
          </select>
          <select id="p-status" aria-label="Status">
            ${options([['', 'All statuses'], ['In', 'In Stock'], ['Low', 'Low Stock'], ['Out', 'Out of Stock']], pf.status)}
          </select>
          <select id="p-sort" aria-label="Sort">
            ${options([['name', 'Sort: Name'], ['sku', 'Sort: SKU'], ['qty', 'Sort: Stock (low first)'], ['cost', 'Sort: Unit cost']], pf.sort)}
          </select>
          <button class="pri" type="button" data-act="add">+ Add product</button>
        </div>
        <div id="p-table"></div>
        <p class="mut" id="p-count" style="margin:10px 0 0"></p>
      </div>

      <div class="card" id="p-archive">
        <h2>Archived Products</h2>
        <p class="hint" style="margin-top:0">
          The archive is for products that are out of stock and will not be restocked. Archived products are hidden from the product list, dashboard and reports.
          The only way to bring an archived product back is to send a purchasing request: once the purchased items are delivered and added to inventory, the product returns to the Products list.
        </p>
        <div id="p-archive-table"></div>
      </div>`;

    const box = $('#p-table', root);
    function draw() {
      const list = listProducts();
      box.innerHTML = table(['SKU', 'Product', 'Category', 'Location', '#On hand', '#Min. level', '#Unit cost', 'Status', ''],
        list.map(productRow).join(''), 'No products match your filters.');
      $('#p-count', root).textContent = list.length + ' product' + (list.length === 1 ? '' : 's') + ' shown';

      const archived = state.products.filter(p => p.archived).sort(SORTERS.name);
      $('#p-archive-table', root).innerHTML = table(['SKU', 'Product', 'Category', 'Location', 'Status', ''],
        archived.map(archivedRow).join(''), 'No archived products.');
    }
    draw();

    $('#p-q', root).addEventListener('input', e => { pf.q = e.target.value; draw(); });
    $('#p-cat', root).addEventListener('change', e => { pf.category = e.target.value; draw(); });
    $('#p-status', root).addEventListener('change', e => { pf.status = e.target.value; draw(); });
    $('#p-sort', root).addEventListener('change', e => { pf.sort = e.target.value; draw(); });

    on(root, 'click', '[data-act]', el => {
      const sku = el.dataset.sku;
      if (el.dataset.act === 'add') productForm(null);
      if (el.dataset.act === 'edit') productForm(sku);
      if (el.dataset.act === 'archive') setArchived(sku);
      if (el.dataset.act === 'request') purchaseForm(sku);
    });
  }

  /* The SKU of a new product is created by the database (INV-001, INV-002, ...) */
  function productForm(sku) {
    const p = sku ? findProduct(sku) : null;
    if (sku && !p) return;
    const v = p || { sku: '', name: '', supplier: PRODUCT_SUPPLIER, category: PRODUCT_CATEGORIES[0], location: 'Main Storage', unit: 'pcs', qty: 0, min_level: 0, unit_cost: 0 };
    const units = [...new Set(['pcs', 'meters', 'packs', 'liters', 'rolls', 'kg', ...state.products.map(x => x.unit), v.unit])].filter(Boolean);

    const m = modal(`
      <h2>${p ? 'Edit product' : 'Add product'}</h2>
      <form id="pform" novalidate>
        <label for="f-sku">SKU</label>
        <input id="f-sku" value="${p ? esc(v.sku) : ''}" placeholder="Assigned automatically when saved" readonly>

        <label for="f-name">Product name *</label>
        <input id="f-name" name="name" value="${esc(v.name)}" required>

        <div class="two">
          <div><label for="f-cat">Category *</label>
            <select id="f-cat" name="category" required>${options(PRODUCT_CATEGORIES.map(c => [c, c]), v.category)}</select></div>
          <div><label for="f-unit">Unit *</label>
            <select id="f-unit" name="unit" required>${options(units.map(u => [u, u]), v.unit)}</select></div>
        </div>

        <div class="two">
          <div><label for="f-sup">Supplier</label><input id="f-sup" name="supplier" value="${PRODUCT_SUPPLIER}" readonly></div>
          <div><label for="f-loc">Storage location</label><input id="f-loc" name="location" value="${esc(v.location)}"></div>
        </div>

        <div class="two">
          <div><label for="f-qty">On hand quantity</label><input id="f-qty" name="qty" type="number" min="0" step="any" value="${esc(v.qty)}"></div>
          <div><label for="f-min">Minimum stock level</label><input id="f-min" name="min_level" type="number" min="0" step="any" value="${esc(v.min_level)}"></div>
        </div>

        <label for="f-cost">Unit cost (${CFG.currency})</label>
        <input id="f-cost" name="unit_cost" type="number" min="0" step="any" value="${esc(v.unit_cost)}">

        <div class="hint">${p
          ? 'Changing the on hand quantity is saved as a stock adjustment in the movement history.'
          : 'The SKU is created automatically. The on hand quantity you enter is saved as the opening stock of this product.'}</div>

        <p class="acts" style="margin-top:16px">
          <button type="button" data-close>Cancel</button>
          <button type="submit" class="pri" id="f-save">Save</button>
        </p>
      </form>`);

    $('#f-name', m).focus();

    $('#pform', m).addEventListener('submit', async ev => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      const row = {
        name: String(d.name || '').trim(),
        supplier: PRODUCT_SUPPLIER,
        category: String(d.category || '').trim(),
        location: String(d.location || '').trim(),
        unit: String(d.unit || '').trim(),
        min_level: Number(d.min_level) || 0,
        unit_cost: Number(d.unit_cost) || 0
      };
      const newQty = Number(d.qty) || 0;

      if (!row.name) return toast('Product name is required');
      if (!PRODUCT_CATEGORIES.includes(row.category)) return toast('Category must be Bikini or Cap');
      if (!row.unit) return toast('Unit is required');
      if (row.min_level < 0 || row.unit_cost < 0 || newQty < 0) return toast('Numbers cannot be negative');

      const btn = $('#f-save', m);
      btn.disabled = true;

      const res = p
        ? await sb.from('inventory_products').update({ ...row, updated_at: new Date().toISOString() }).eq('sku', p.sku).select()
        : await sb.from('inventory_products').insert(row).select();

      if (res.error) {
        btn.disabled = false;
        return toast(res.error.code === '23505' ? 'This product already exists' : res.error.message);
      }
      if (!res.data || !res.data.length) {
        btn.disabled = false;
        return toast('You do not have permission to save products.');
      }

      /* Quantity change is recorded as a stock movement, so history and reports stay correct */
      const targetSku = p ? p.sku : res.data[0].sku;
      const before = p ? Number(p.qty) : 0;
      const diff = Math.round((newQty - before) * 1000) / 1000;

      if (diff !== 0) {
        const movement = diff > 0
          ? { type: 'in', sku: targetSku, qty: diff, party: p ? 'Stock adjustment' : 'Opening balance', reference: p ? 'Product edit' : 'New product' }
          : { type: 'out', sku: targetSku, qty: -diff, reason: 'Adjustment', party: 'Inventory', reference: 'Product edit' };
        const mres = await sb.from('inventory_movements').insert(movement);
        if (mres.error) {
          closeModal();
          toast('Product saved, but the quantity was not changed: ' + mres.error.message);
          refresh();
          return;
        }
      }

      closeModal();
      toast(p ? 'Product updated' : 'Product added');
      refresh();
    });
  }

  /* Request purchasing for a low / out of stock product (goes to admin first) */
  function purchaseForm(sku) {
    const p = findProduct(sku);
    if (!p) return;
    if (openPurchaseFor(sku)) return toast('A purchasing request is already open for this product.');
    const suggest = Math.max(1, Math.ceil(Number(p.min_level) * 2 - Number(p.qty)));

    const m = modal(`
      <h2>Request purchasing</h2>
      <p class="mut">${esc(p.name)} (${esc(p.sku)}) · On hand ${num(p.qty)} ${esc(p.unit)} · Minimum ${num(p.min_level)}</p>
      <form id="prform" novalidate>
        <label for="pr-qty">Quantity to purchase (${esc(p.unit)}) *</label>
        <input id="pr-qty" type="number" min="0" step="any" value="${suggest}" required>

        <label for="pr-notes">Notes (optional)</label>
        <textarea id="pr-notes" rows="3"></textarea>

        <div class="hint">This request is from the Inventory Department. It is sent to the admin first. After the admin approves it, it moves to the Purchasing department.</div>

        <p class="acts" style="margin-top:16px">
          <button type="button" data-close>Cancel</button>
          <button type="submit" class="pri" id="pr-save">Submit to admin</button>
        </p>
      </form>`);

    $('#pr-qty', m).focus();

    $('#prform', m).addEventListener('submit', async ev => {
      ev.preventDefault();
      const qty = Number($('#pr-qty', m).value);
      if (!(qty > 0)) return toast('Enter a quantity greater than zero.');
      const btn = $('#pr-save', m);
      btn.disabled = true;
      const done = await call('inventory_create_purchase_request', {
        p_source: 'inventory',
        p_sku: p.sku,
        p_item_name: p.name,
        p_unit: p.unit,
        p_qty: qty,
        p_origin_department: 'Inventory',
        p_requisition_id: null,
        p_inventory_decision: null,
        p_notes: $('#pr-notes', m).value.trim()
      });
      if (!done) { btn.disabled = false; return; }
      closeModal();
      toast('Request sent to admin for approval');
      refresh();
    });
  }

  async function setArchived(sku) {
    const p = findProduct(sku);
    if (!p) return;
    const ok = await confirmBox('Archive product?',
      `"${p.name}" will move to the Archived area below the products list and will be hidden from the dashboard and reports. It can only be brought back by sending a purchasing request.`,
      'Archive', false);
    if (!ok) return;
    const done = await call('inventory_archive_product', { p_sku: sku });
    if (done) { toast('Product archived'); refresh(); }
  }

  /* ---------------------------------------------------------------------
     PURCHASING (history, status and updates of every purchase request)
     --------------------------------------------------------------------- */
  const pu = { tab: 'all', q: '' };
  const PU_TABS = [
    ['all', 'All'],
    ['pending', 'Pending admin'],
    ['progress', 'With Purchasing'],
    ['delivered', 'Delivered'],
    ['history', 'History']
  ];

  function purchaseTab(r, tab) {
    if (tab === 'pending') return r.status === 'Pending Admin';
    if (tab === 'progress') return r.status === 'With Purchasing' || r.status === 'Ordered';
    if (tab === 'delivered') return r.status === 'Delivered';
    if (tab === 'history') return CLOSED.includes(r.status);
    return true;
  }

  function viewPurchasing(root) {
    const all = state.purchases;
    const count = t => all.filter(r => purchaseTab(r, t)).length;

    root.innerHTML = `
      ${head('Purchasing', 'Purchase requests from Inventory and other departments, with their approval status and purchasing updates.')}
      <div class="grid g4">
        <div class="card"><div class="mut">Pending admin</div><div class="big">${count('pending')}</div><div class="mut">Inventory requests waiting for approval</div></div>
        <div class="card"><div class="mut">With Purchasing</div><div class="big">${count('progress')}</div><div class="mut">Approved, being purchased</div></div>
        <div class="card"><div class="mut">Delivered</div><div class="big">${count('delivered')}</div><div class="mut">Waiting to be added to inventory</div></div>
        <div class="card"><div class="mut">Added to inventory</div><div class="big">${all.filter(r => r.status === 'Stocked').length}</div><div class="mut">Completed purchases</div></div>
      </div>

      <div class="card">
        <div class="tabs" id="pu-tabs">${PU_TABS.map(([id, label]) =>
          `<button type="button" class="${id === pu.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>
        <div class="tools">
          <input class="grow" id="pu-q" type="search" placeholder="Search reference, product or department" value="${esc(pu.q)}" aria-label="Search">
        </div>
        <div id="pu-table"></div>
      </div>`;

    function draw() {
      const needle = pu.q.trim().toLowerCase();
      const list = all.filter(r => purchaseTab(r, pu.tab) &&
        [r.code, r.item_name, r.sku, originLabel(r), r.requisition_id].join(' ').toLowerCase().includes(needle));

      const rows = list.map(r => {
        const adminBtns = isAdmin() && r.status === 'Pending Admin'
          ? `<button type="button" class="sm pri" data-pu="approve" data-id="${r.id}">Approve</button>
             <button type="button" class="sm dng" data-pu="reject" data-id="${r.id}">Reject</button>` : '';
        return `<tr>
          <td><b>${esc(r.code)}</b><small>${fstamp(r.created_at)}</small></td>
          <td><b>${esc(r.item_name)}</b><small>${esc(r.sku || 'Not yet registered')}</small></td>
          <td class="r">${num(r.qty)} ${esc(r.unit)}</td>
          <td>${esc(originLabel(r))}${r.requisition_id ? `<small>Requisition ${esc(r.requisition_id)}</small>` : ''}</td>
          <td>${pill(ADMIN_TONE[r.admin_status] || 'mut', r.admin_status)}</td>
          <td>${r.inventory_decision ? pill(INV_TONE[r.inventory_decision] || 'mut', r.inventory_decision) : '<span class="mut">—</span>'}</td>
          <td>${pill(PU_TONE[r.status] || 'mut', r.status)}</td>
          <td><div class="acts">${adminBtns}<button type="button" class="sm" data-pu="view" data-id="${r.id}">View</button></div></td>
        </tr>`;
      }).join('');

      $('#pu-table', root).innerHTML = table(
        ['Reference', 'Product', '#Quantity', 'From department', 'Admin', 'Inventory', 'Status', ''],
        rows, 'No purchase requests here yet.');
    }
    draw();

    on(root, 'click', '[data-tab]', el => {
      pu.tab = el.dataset.tab;
      root.querySelectorAll('#pu-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === pu.tab));
      draw();
    });
    $('#pu-q', root).addEventListener('input', e => { pu.q = e.target.value; draw(); });
    on(root, 'click', '[data-pu]', el => {
      const r = state.purchases.find(x => String(x.id) === el.dataset.id);
      if (!r) return;
      if (el.dataset.pu === 'view') purchaseDetail(r);
      if (el.dataset.pu === 'approve') decidePurchase(r, true);
      if (el.dataset.pu === 'reject') decidePurchase(r, false);
    });
  }

  async function decidePurchase(r, approve) {
    const ok = await confirmBox(
      approve ? 'Approve request?' : 'Reject request?',
      approve
        ? `Approve ${num(r.qty)} ${r.unit} of ${r.item_name}? It will move to the Purchasing department.`
        : `Reject the purchase request for ${r.item_name}?`,
      approve ? 'Approve' : 'Reject', !approve);
    if (!ok) return;
    const done = await call('purchase_admin_decide', { p_id: r.id, p_approve: approve, p_note: '' });
    if (done) { toast(approve ? 'Approved and moved to Purchasing' : 'Request rejected'); refresh(); }
  }

  async function setPurchaseStatus(r, status, qty) {
    const done = await call('purchase_set_status', { p_id: r.id, p_status: status, p_delivered_qty: qty ?? null });
    if (done) { toast('Status updated: ' + status); refresh(); }
  }

  function purchaseDetail(r) {
    const adminLabel = r.source === 'requisition' && !r.admin_at
      ? 'Approved with the requisition' : 'Admin decision: ' + r.admin_status;
    const timeline = [
      ['Requested', r.created_at],
      [adminLabel, r.source === 'requisition' ? r.created_at : r.admin_at],
      ['Ordered by Purchasing', r.ordered_at],
      ['Delivered' + (r.delivered_qty != null ? ` (${num(r.delivered_qty)} ${r.unit})` : ''), r.delivered_at],
      ['Added to inventory', r.stocked_at]
    ].filter(t => t[1]);

    const admin = isAdmin();
    const adminTools = admin && ['With Purchasing', 'Ordered'].includes(r.status) ? `
      <div class="hint">
        Admin controls. The Purchasing department updates these same statuses from its own module.
        ${r.status === 'With Purchasing' ? '<p><button type="button" class="sm" data-ordered>Mark as ordered</button></p>' : ''}
        <label for="pu-dq">Delivered quantity (${esc(r.unit)})</label>
        <input id="pu-dq" type="number" min="0" step="any" value="${esc(r.qty)}">
        <p><button type="button" class="sm pri" data-delivered>Mark as delivered</button></p>
      </div>` : '';

    const m = modal(`
      <h2>${esc(r.code)}</h2>
      <div class="kv"><span>Product</span><span><b>${esc(r.item_name)}</b>${r.sku ? ` (${esc(r.sku)})` : ''}</span></div>
      <div class="kv"><span>Quantity</span><span>${num(r.qty)} ${esc(r.unit)}</span></div>
      <div class="kv"><span>Requested by</span><span>${esc(originLabel(r))}</span></div>
      ${r.requisition_id ? `<div class="kv"><span>Requisition</span><span>${esc(r.requisition_id)}</span></div>` : ''}
      <div class="kv"><span>Admin</span><span>${pill(ADMIN_TONE[r.admin_status] || 'mut', r.admin_status)}</span></div>
      <div class="kv"><span>Inventory</span><span>${r.inventory_decision ? pill(INV_TONE[r.inventory_decision] || 'mut', r.inventory_decision) : '—'}</span></div>
      <div class="kv"><span>Status</span><span>${pill(PU_TONE[r.status] || 'mut', r.status)}</span></div>
      ${r.notes ? `<div class="kv"><span>Notes</span><span>${esc(r.notes)}</span></div>` : ''}
      ${r.admin_note ? `<div class="kv"><span>Admin note</span><span>${esc(r.admin_note)}</span></div>` : ''}

      <h2 style="margin-top:18px">History</h2>
      ${timeline.map(([label, ts]) => `<div class="kv"><span>${esc(label)}</span><span>${fstamp(ts)}</span></div>`).join('')}

      ${adminTools}
      <p class="acts" style="margin-top:16px">
        ${admin && r.status === 'Pending Admin' ? `
          <button type="button" class="dng" data-reject>Reject</button>
          <button type="button" class="pri" data-approve>Approve</button>` : ''}
        <button type="button" data-close>Close</button>
      </p>`);

    on(m, 'click', '[data-approve]', () => { closeModal(); decidePurchase(r, true); });
    on(m, 'click', '[data-reject]', () => { closeModal(); decidePurchase(r, false); });
    on(m, 'click', '[data-ordered]', () => { closeModal(); setPurchaseStatus(r, 'Ordered'); });
    on(m, 'click', '[data-delivered]', () => {
      const q = Number($('#pu-dq', m).value);
      if (!(q > 0)) return toast('Enter the delivered quantity.');
      closeModal();
      setPurchaseStatus(r, 'Delivered', q);
    });
  }

  /* ---------------------------------------------------------------------
     DELIVERY (notifications for delivered purchases + update inventory)
     --------------------------------------------------------------------- */
  function viewDelivery(root) {
    const list = state.purchases.filter(r => r.status === 'Delivered');

    const cards = list.map(r => {
      const q = r.delivered_qty != null ? r.delivered_qty : r.qty;
      return `<div class="card notice">
        <div>
          <b>New delivery received</b>
          <p>${num(q)} ${esc(r.unit)} of <b>${esc(r.item_name)}</b> have been delivered.</p>
          <p class="mut">${esc(r.code)} · Requested by ${esc(originLabel(r))} · Delivered ${fstamp(r.delivered_at)}${
            r.delivered_qty != null && Number(r.delivered_qty) !== Number(r.qty) ? ` · Ordered ${num(r.qty)}` : ''}</p>
        </div>
        <button type="button" class="pri" data-stock="${r.id}">Update inventory products</button>
      </div>`;
    }).join('');

    root.innerHTML = `
      ${head('Delivery', 'You are notified here when purchased products have been delivered.')}
      ${cards || `<div class="card"><h2>No new deliveries</h2>
        <p class="mut">When newly purchased products are delivered, a notification will appear here. Use the button on it to store the items in the Products inventory.</p></div>`}`;

    on(root, 'click', '[data-stock]', async el => {
      el.disabled = true;
      const done = await call('inventory_receive_purchase', { p_id: Number(el.dataset.stock) });
      if (!done) { el.disabled = false; return; }
      toast('Inventory updated. The products are now in stock.');
      refresh();
    });
  }

  /* ---------------------------------------------------------------------
     INVENTORY REPORTS
     --------------------------------------------------------------------- */
  const rep = { tab: 'summary', from: '', to: '' };
  const REP_TABS = [
    ['summary', 'Stock Summary'],
    ['in', 'Incoming Stock'],
    ['out', 'Outgoing Stock'],
    ['alerts', 'Low & Out of Stock'],
    ['movement', 'Movement Summary']
  ];

  const inRange = m => (!rep.from || m.movement_date >= rep.from) && (!rep.to || m.movement_date <= rep.to);

  /* Returns { headers, rows } — rows are plain values (used for both screen and CSV) */
  function reportData() {
    const act = activeProducts();
    const moves = state.movements.filter(m => !findProduct(m.sku) || !findProduct(m.sku).archived);

    if (rep.tab === 'in') {
      return {
        headers: ['Date', 'Reference no.', 'SKU', 'Product', '#Quantity', 'Supplier / Source', 'Reference'],
        rows: moves.filter(m => m.type === 'in' && inRange(m)).map(m => [
          fdate(m.movement_date), m.ref_no, m.sku, productName(m.sku),
          num(m.qty) + ' ' + productUnit(m.sku), m.party || '—', m.reference || '—'])
      };
    }

    if (rep.tab === 'out') {
      return {
        headers: ['Date', 'Reference no.', 'SKU', 'Product', '#Quantity', 'Reason', 'Issued to', 'Reference'],
        rows: moves.filter(m => m.type === 'out' && inRange(m)).map(m => [
          fdate(m.movement_date), m.ref_no, m.sku, productName(m.sku),
          num(m.qty) + ' ' + productUnit(m.sku), m.reason || '—', m.party || '—', m.reference || '—'])
      };
    }

    if (rep.tab === 'alerts') {
      return {
        headers: ['SKU', 'Product', 'Category', '#On hand', '#Min. level', '#Shortfall', 'Status'],
        rows: act.filter(p => statusOf(p) !== 'In').sort((a, b) => a.qty - b.qty).map(p => [
          p.sku, p.name, p.category, num(p.qty) + ' ' + p.unit, num(p.min_level),
          num(Math.max(0, p.min_level - p.qty)), STATUS[statusOf(p)]])
      };
    }

    if (rep.tab === 'movement') {
      return {
        headers: ['SKU', 'Product', 'Category', '#Received', '#Released', '#Remaining', 'Unit'],
        rows: act.map(p => {
          const mine = moves.filter(m => m.sku === p.sku && inRange(m));
          const rec = mine.filter(m => m.type === 'in').reduce((s, m) => s + Number(m.qty), 0);
          const rel = mine.filter(m => m.type === 'out').reduce((s, m) => s + Number(m.qty), 0);
          return [p.sku, p.name, p.category, num(rec), num(rel), num(p.qty), p.unit];
        })
      };
    }

    return {
      headers: ['SKU', 'Product', 'Category', '#On hand', '#Min. level', '#Unit cost', '#Value', 'Status'],
      rows: [...act].sort(SORTERS.name).map(p => [
        p.sku, p.name, p.category, num(p.qty) + ' ' + p.unit, num(p.min_level),
        money(p.unit_cost), money(p.qty * p.unit_cost), STATUS[statusOf(p)]])
    };
  }

  function viewReports(root) {
    root.innerHTML = `
      ${head('Inventory Reports', 'Stock levels, incoming and outgoing stock, and movement history.')}
      <div class="tabs noprint">${REP_TABS.map(([id, label]) =>
        `<button type="button" class="${id === rep.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>

      <div class="tools noprint" id="r-filters">
        <label style="margin:0">From</label><input type="date" id="r-from" value="${esc(rep.from)}" aria-label="From date">
        <label style="margin:0">To</label><input type="date" id="r-to" value="${esc(rep.to)}" aria-label="To date">
        <button type="button" id="r-clear">Clear dates</button>
        <span class="sp"></span>
        <button type="button" id="r-print">Print</button>
        <button type="button" class="pri" id="r-csv">Export CSV</button>
      </div>

      <div id="r-cards"></div>
      <div class="card" id="r-table"></div>`;

    function draw() {
      const data = reportData();
      const act = activeProducts();

      $('#r-cards', root).innerHTML = rep.tab === 'summary' ? `
        <div class="grid g4">
          <div class="card"><div class="mut">Total Products</div><div class="big">${act.length}</div></div>
          <div class="card"><div class="mut">Total Units on Hand</div><div class="big">${num(act.reduce((s, p) => s + Number(p.qty), 0))}</div></div>
          <div class="card"><div class="mut">Inventory Value</div><div class="big">${money(act.reduce((s, p) => s + p.qty * p.unit_cost, 0))}</div></div>
          <div class="card"><div class="mut">Low / Out of Stock</div><div class="big">${act.filter(p => statusOf(p) !== 'In').length}</div></div>
        </div>` : '';

      const rows = data.rows.map(r => `<tr>${r.map((c, i) =>
        `<td class="${data.headers[i][0] === '#' ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
      const dated = rep.tab === 'in' || rep.tab === 'out' || rep.tab === 'movement';
      const range = dated && (rep.from || rep.to)
        ? ` (${rep.from ? fdate(rep.from) : 'start'} – ${rep.to ? fdate(rep.to) : 'today'})` : '';
      $('#r-table', root).innerHTML =
        `<h2>${esc(REP_TABS.find(t => t[0] === rep.tab)[1])}${esc(range)}</h2>` +
        table(data.headers, rows, 'No records for this report.');
    }
    draw();

    on(root, 'click', '[data-tab]', el => { rep.tab = el.dataset.tab; viewReports(root); });
    $('#r-from', root).addEventListener('change', e => { rep.from = e.target.value; draw(); });
    $('#r-to', root).addEventListener('change', e => { rep.to = e.target.value; draw(); });
    $('#r-clear', root).addEventListener('click', () => { rep.from = ''; rep.to = ''; viewReports(root); });
    $('#r-print', root).addEventListener('click', () => window.print());
    $('#r-csv', root).addEventListener('click', () => {
      const data = reportData();
      if (!data.rows.length) return toast('Nothing to export for this report.');
      downloadCsv(`pynx-inventory-${rep.tab}-${today()}.csv`,
        [data.headers.map(h => h.replace('#', '')), ...data.rows]);
    });
  }

  /* ---------------------------------------------------------------------
     START-UP: sign-in check, then show the first screen
     --------------------------------------------------------------------- */
  async function init() {
    if (!sb) {
      $('#main').innerHTML = head('Supabase is not connected', 'Check that ../config/supabase.js loads before this page.');
      return;
    }

    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData && sessionData.session;
    if (!session) { window.location.replace(LOGIN_URL); return; }

    const { data: profile, error } = await sb.from('profiles')
      .select('username, department, role').eq('id', session.user.id).single();

    if (error || !profile || !ALLOWED_DEPARTMENTS.includes(String(profile.department).toLowerCase())) {
      window.location.replace(LOGIN_URL);
      return;
    }
    state.profile = profile;

    sb.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') window.location.replace(LOGIN_URL);
    });

    const dept = String(profile.department);
    $('#who').innerHTML = `<b>${esc(dept.toLowerCase() === 'inventory' ? 'Inventory Staff' : profile.username)}</b>${esc(dept)}`;

    on($('#nav'), 'click', '[data-logout]', (el, ev) => { ev.preventDefault(); logout(); });
    addEventListener('hashchange', () => { const id = idFromHash(); if (id && id !== current) show(id); });

    startLive();
    show(idFromHash() || CFG.defaultView);
  }

  init();
})();