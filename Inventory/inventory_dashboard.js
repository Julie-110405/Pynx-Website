/* ==========================================================================
   PYNX Inventory — one script for all menus
   Menus: Dashboard, Requisition, Products, Delivery, Inventory Reports, Logout
   Data: Supabase tables inventory_products and inventory_movements
   ========================================================================== */
(function () {
  'use strict';

  const sb = window.supabaseClient;
  const LOGIN_URL = '../Log_in/login.html';
  const ALLOWED_DEPARTMENTS = ['inventory', 'admin'];

  const CFG = {
    locale: 'en-US',
    currency: '₱',
    toastMs: 2400,
    skuPrefix: 'INV-',
    defaultView: 'dashboard'
  };

  const NAV = [
    { id: 'dashboard',   icon: '▦', label: 'Dashboard' },
    { id: 'requisition', icon: '☰', label: 'Requisition' },
    { id: 'products',    icon: '▤', label: 'Products' },
    { id: 'delivery',    icon: '▷', label: 'Delivery' },
    { id: 'reports',     icon: '▥', label: 'Inventory Reports' }
  ];

  const state = { products: [], movements: [], profile: null };
  let current = null;
  let loadToken = 0;

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

  const STATUS = { In: 'In Stock', Low: 'Low Stock', Out: 'Out of Stock' };
  const TONE = { In: 'ok', Low: 'warn', Out: 'bad' };
  const statusOf = p => (Number(p.qty) <= 0 ? 'Out' : Number(p.qty) <= Number(p.min_level) ? 'Low' : 'In');
  const pill = (tone, label) => `<span class="pill pill--${tone}">${esc(label)}</span>`;
  const statusPill = p => pill(TONE[statusOf(p)], STATUS[statusOf(p)]);

  const activeProducts = () => state.products.filter(p => !p.archived);
  const findProduct = sku => state.products.find(p => p.sku === sku);
  const productName = sku => (findProduct(sku) || {}).name || sku;
  const productUnit = sku => (findProduct(sku) || {}).unit || '';

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

  /* ---------- Modal ---------- */
  let onModalClose = null;

  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.classList.remove('modal-open');
    if (onModalClose) { const f = onModalClose; onModalClose = null; f(); }
  }

  function modal(html) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal';
    m.id = 'modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="card">${html}</div>`;
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
    const [p, m] = await Promise.all([
      sb.from('inventory_products').select('*').order('name'),
      sb.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(1000)
    ]);
    if (p.error) throw p.error;
    if (m.error) throw m.error;
    state.products = p.data || [];
    state.movements = (m.data || []).sort((a, b) =>
      String(b.movement_date).localeCompare(String(a.movement_date)) || b.id - a.id);
  }

  async function refresh() {
    try {
      await loadData();
      render();
    } catch (err) {
      showError(err);
    }
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
    $('#nav').innerHTML = NAV.map(n => `
      <a href="#${esc(n.id)}" class="${n.id === current ? 'on' : ''}" ${n.id === current ? 'aria-current="page"' : ''}>
        <span class="nav-icon" aria-hidden="true">${n.icon}</span>${esc(n.label)}
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
    const root = document.createElement('div');
    root.className = 'view';
    $('#main').replaceChildren(root);
    const views = { dashboard: viewDashboard, requisition: viewRequisition, products: viewProducts, delivery: viewDelivery, reports: viewReports };
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
        <div class="card"><div class="mut">Pending Requisitions</div><div class="big">—</div><div class="mut">Shown once the Requisition module is connected</div></div>
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
     REQUISITION (Stage 5): validate stock, release, forward shortages to Procurement
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

    const toValidate = reqs.filter(r => r.status === 'Approved' && !r.inventory_confirmed).length;
    const ready = reqs.filter(r => r.inventory_confirmed && r.status !== 'Completed').length;
    const partial = reqs.filter(r => r.status === 'Partial').length;

    const stat = r => r.status === 'Completed' ? pill('ok', 'Completed')
      : r.status === 'Partial' ? pill('warn', 'Partially released')
      : r.inventory_confirmed ? pill('ok', 'Ready to release') : pill('warn', 'To validate');

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      ${head('Requisition', 'Validate approved requests against stock, release materials, and forward shortages to Procurement.')}
      <div class="grid g3">
        <div class="card"><div class="mut">To validate</div><div class="big">${toValidate}</div><div class="mut">Approved, availability not checked</div></div>
        <div class="card"><div class="mut">Ready to release</div><div class="big">${ready}</div><div class="mut">Validated, materials still to release</div></div>
        <div class="card"><div class="mut">Partially released</div><div class="big">${partial}</div><div class="mut">Waiting for remaining stock</div></div>
      </div>
      <div class="card">
        <div class="tools">
          <select id="rq-status" aria-label="Filter">
            ${options([['active', 'Active requests'], ['completed', 'Completed'], ['all', 'All']], rq.status)}
          </select>
        </div>
        <div id="rq-table"></div>
        <p class="mut" style="margin:10px 0 0">Logistics requisitions will appear here once their Procurement link is added.</p>
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
      const r = reqs.find(x => x.id === el.dataset.open);
      if (r) openRequisition(r, root);
    });

    if (openId) { const r = reqs.find(x => x.id === openId); if (r) openRequisition(r, root); }
  }

  async function openRequisition(r, root) {
    const prs = await sb.from('purchase_requests').select('code, item, qty, status').eq('requisition_id', r.id);
    const key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random());
    const canAct = r.status === 'Approved' || r.status === 'Partial';

    const lines = r.items.map(it => {
      const p = it.sku ? findProduct(it.sku) : null;
      const remaining = Number(it.qty) - Number(it.released);
      const onHand = p ? Number(p.qty) : 0;
      return { it, p, remaining, onHand,
        canRelease: Math.max(0, Math.min(remaining, onHand)),
        shortage: Math.max(0, remaining - onHand) };
    });

    const rows = lines.map(L => `<tr>
      <td><b>${esc(L.it.material_name)}</b><small>${esc(L.it.sku || 'No SKU')}</small></td>
      <td class="r">${num(L.it.qty)} ${esc(L.it.unit)}</td>
      <td class="r">${num(L.it.released)}</td>
      <td class="r">${num(L.remaining)}</td>
      <td class="r">${L.p ? num(L.onHand) : '—'}</td>
      <td class="r">${L.shortage > 0 ? pill('bad', num(L.shortage)) : pill('ok', '0')}</td>
      <td class="r">${canAct && r.inventory_confirmed && L.canRelease > 0
        ? `<input type="number" class="rel" data-item="${L.it.id}" min="0" max="${L.canRelease}" step="any" value="${L.canRelease}" style="width:90px">` : '—'}</td>
      <td>${canAct && r.inventory_confirmed && L.shortage > 0
        ? `<button type="button" class="sm" data-fwd="${L.it.id}" data-q="${L.shortage}">Forward ${num(L.shortage)}</button>` : ''}</td>
    </tr>`).join('');

    const m = modal(`
      <h2>${esc(r.id)} · ${esc(r.project)}</h2>
      <p class="mut">${esc(r.reason)} · Needed by ${fdate(r.needed_by)}</p>
      ${table(['Material', '#Requested', '#Released', '#Remaining', '#On hand', '#Shortage', '#Release now', ''], rows)}
      ${prs.data && prs.data.length
        ? `<p class="mut">Purchase requests: ${prs.data.map(x =>
            `${esc(x.code)} (${num(x.qty)} ${esc(x.item)}, ${esc(x.status)})`).join('; ')}</p>` : ''}
      ${canAct && !r.inventory_confirmed
        ? '<p class="hint">Check the quantities above against stock, then confirm availability to enable releasing.</p>' : ''}
      <p class="acts">
        <button type="button" data-close>Close</button>
        ${canAct && !r.inventory_confirmed ? '<button type="button" class="pri" data-confirm>Confirm availability</button>' : ''}
        ${canAct && r.inventory_confirmed ? '<button type="button" class="pri" data-release>Release selected</button>' : ''}
      </p>`);

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

    on(m, 'click', '[data-fwd]', async el => {
      const q = Number(el.dataset.q);
      const L = lines.find(x => String(x.it.id) === el.dataset.fwd);
      closeModal();
      const ok = await confirmBox('Forward shortage?',
        `Create a purchase request for ${num(q)} ${L.it.unit} of ${L.it.material_name}?`, 'Forward', false);
      if (!ok) return viewRequisition(root, r.id);
      const { error } = await sb.rpc('rw_forward_shortage', { p_req: r.id, p_item_id: L.it.id, p_qty: q });
      if (error) toast(error.message); else toast('Shortage forwarded to Procurement');
      viewRequisition(root, r.id);
    });
  }

  /* ---------------------------------------------------------------------
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
    const wantArchived = pf.status === 'Archived';
    return state.products
      .filter(p => (wantArchived ? p.archived : !p.archived))
      .filter(p =>
        (p.name + p.sku + p.supplier).toLowerCase().includes(needle) &&
        (!pf.category || p.category === pf.category) &&
        (!pf.status || wantArchived || statusOf(p) === pf.status))
      .sort(SORTERS[pf.sort] || SORTERS.name);
  }

  function productRow(p) {
    const actions = p.archived
      ? `<button class="sm" data-act="restore" data-sku="${esc(p.sku)}">Restore</button>
         <button class="sm dng" data-act="delete" data-sku="${esc(p.sku)}">Delete</button>`
      : `<button class="sm" data-act="edit" data-sku="${esc(p.sku)}">Edit</button>
         <button class="sm" data-act="archive" data-sku="${esc(p.sku)}">Archive</button>
         <button class="sm dng" data-act="delete" data-sku="${esc(p.sku)}">Delete</button>`;
    return `<tr>
      <td>${esc(p.sku)}</td>
      <td><b>${esc(p.name)}</b><small>${esc(p.supplier)}</small></td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.location)}</td>
      <td class="r">${num(p.qty)} ${esc(p.unit)}</td>
      <td class="r">${num(p.min_level)}</td>
      <td class="r">${money(p.unit_cost)}</td>
      <td>${p.archived ? pill('mut', 'Archived') : statusPill(p)}</td>
      <td><div class="acts">${actions}</div></td>
    </tr>`;
  }

  function viewProducts(root) {
    const cats = [...new Set(state.products.map(p => p.category))].sort();

    root.innerHTML = `
      ${head('Products', 'Master records of all products and materials. Stock quantities change through deliveries, requisition releases and manual adjustments.')}
      <div class="card">
        <div class="tools">
          <input class="grow" id="p-q" type="search" placeholder="Search name, SKU or supplier" value="${esc(pf.q)}" aria-label="Search">
          <select id="p-cat" aria-label="Category">
            <option value="">All categories</option>${options(cats.map(c => [c, c]), pf.category)}
          </select>
          <select id="p-status" aria-label="Status">
            ${options([['', 'All statuses'], ['In', 'In Stock'], ['Low', 'Low Stock'], ['Out', 'Out of Stock'], ['Archived', 'Archived']], pf.status)}
          </select>
          <select id="p-sort" aria-label="Sort">
            ${options([['name', 'Sort: Name'], ['sku', 'Sort: SKU'], ['qty', 'Sort: Stock (low first)'], ['cost', 'Sort: Unit cost']], pf.sort)}
          </select>
          <button class="pri" type="button" data-act="add">+ Add product</button>
        </div>
        <div id="p-table"></div>
        <p class="mut" id="p-count" style="margin:10px 0 0"></p>
      </div>`;

    const box = $('#p-table', root);
    function draw() {
      const list = listProducts();
      box.innerHTML = table(['SKU', 'Product', 'Category', 'Location', '#On hand', '#Min. level', '#Unit cost', 'Status', ''],
        list.map(productRow).join(''), 'No products match your filters.');
      $('#p-count', root).textContent = list.length + ' product' + (list.length === 1 ? '' : 's') + ' shown';
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
      if (el.dataset.act === 'archive') setArchived(sku, true);
      if (el.dataset.act === 'restore') setArchived(sku, false);
      if (el.dataset.act === 'delete') deleteProduct(sku);
    });
  }

  function nextSku() {
    const max = state.products.reduce((m, p) => {
      const n = parseInt(String(p.sku).replace(/\D/g, ''), 10);
      return n > m ? n : m;
    }, 0);
    return CFG.skuPrefix + String(max + 1).padStart(3, '0');
  }

  function productForm(sku) {
    const p = sku ? findProduct(sku) : null;
    if (sku && !p) return;
    const v = p || { sku: nextSku(), name: '', supplier: '', category: '', location: '', unit: 'pcs', qty: 0, min_level: 0, unit_cost: 0 };
    const cats = [...new Set(state.products.map(x => x.category))].sort();
    const units = [...new Set(['pcs', 'meters', 'packs', 'liters', 'rolls', 'kg', ...state.products.map(x => x.unit), v.unit])].filter(Boolean);

    const m = modal(`
      <h2>${p ? 'Edit product' : 'Add product'}</h2>
      <form id="pform" novalidate>
        <label for="f-sku">SKU *</label>
        <input id="f-sku" name="sku" value="${esc(v.sku)}" ${p ? 'readonly' : ''} required>

        <label for="f-name">Product name *</label>
        <input id="f-name" name="name" value="${esc(v.name)}" required>

        <div class="two">
          <div><label for="f-cat">Category *</label>
            <input id="f-cat" name="category" list="dl-cat" value="${esc(v.category)}" required>
            <datalist id="dl-cat">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div><label for="f-unit">Unit *</label>
            <select id="f-unit" name="unit" required>${options(units.map(u => [u, u]), v.unit)}</select></div>
        </div>

        <div class="two">
          <div><label for="f-sup">Supplier</label><input id="f-sup" name="supplier" value="${esc(v.supplier)}"></div>
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
          : 'The on hand quantity you enter is saved as the opening stock of this product.'}</div>

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
        supplier: String(d.supplier || '').trim(),
        category: String(d.category || '').trim(),
        location: String(d.location || '').trim(),
        unit: String(d.unit || '').trim(),
        min_level: Number(d.min_level) || 0,
        unit_cost: Number(d.unit_cost) || 0
      };
      const newSku = String(d.sku || '').trim();
      const newQty = Number(d.qty) || 0;

      if (!newSku) return toast('SKU is required');
      if (!row.name) return toast('Product name is required');
      if (!row.category) return toast('Category is required');
      if (!row.unit) return toast('Unit is required');
      if (row.min_level < 0 || row.unit_cost < 0 || newQty < 0) return toast('Numbers cannot be negative');

      const btn = $('#f-save', m);
      btn.disabled = true;

      const res = p
        ? await sb.from('inventory_products').update({ ...row, updated_at: new Date().toISOString() }).eq('sku', p.sku).select()
        : await sb.from('inventory_products').insert({ sku: newSku, ...row }).select();

      if (res.error) {
        btn.disabled = false;
        return toast(res.error.code === '23505' ? 'SKU already exists' : res.error.message);
      }
      if (!res.data || !res.data.length) {
        btn.disabled = false;
        return toast('You do not have permission to save products.');
      }

      /* Quantity change is recorded as a stock movement, so history and reports stay correct */
      const targetSku = p ? p.sku : newSku;
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

  async function setArchived(sku, value) {
    const p = findProduct(sku);
    if (!p) return;
    if (value) {
      const ok = await confirmBox('Archive product?', `"${p.name}" will be hidden from the product list and reports. You can restore it later.`, 'Archive', false);
      if (!ok) return;
    }
    const res = await sb.from('inventory_products')
      .update({ archived: value, updated_at: new Date().toISOString() }).eq('sku', sku).select();
    if (res.error) return toast(res.error.message);
    if (!res.data || !res.data.length) return toast('You do not have permission to change products.');
    toast(value ? 'Product archived' : 'Product restored');
    refresh();
  }

  async function deleteProduct(sku) {
    const p = findProduct(sku);
    if (!p) return;
    if (Number(p.qty) > 0) return toast('Only products with zero stock can be deleted');
    const ok = await confirmBox('Delete product?', `Permanently delete "${p.name}" (${p.sku})? This cannot be undone.`, 'Delete', true);
    if (!ok) return;
    const res = await sb.from('inventory_products').delete().eq('sku', sku).select();
    if (res.error) {
      return toast(res.error.code === '23503'
        ? 'This product has stock history, so it cannot be deleted. Archive it instead.'
        : res.error.message);
    }
    if (!res.data || !res.data.length) return toast('This product cannot be deleted.');
    toast('Product deleted');
    refresh();
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
      rows: act.sort(SORTERS.name).map(p => [
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
          <div class="card"><div class="mut">Total Products</div><div class="big md">${act.length}</div></div>
          <div class="card"><div class="mut">Total Units on Hand</div><div class="big md">${num(act.reduce((s, p) => s + Number(p.qty), 0))}</div></div>
          <div class="card"><div class="mut">Inventory Value</div><div class="big md">${money(act.reduce((s, p) => s + p.qty * p.unit_cost, 0))}</div></div>
          <div class="card"><div class="mut">Low / Out of Stock</div><div class="big md">${act.filter(p => statusOf(p) !== 'In').length}</div></div>
        </div>` : '';

      const rows = data.rows.map(r => `<tr>${r.map((c, i) =>
        `<td class="${data.headers[i][0] === '#' ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
      const dated = rep.tab === 'in' || rep.tab === 'out' || rep.tab === 'movement';
      const range = dated && (rep.from || rep.to)
        ? ` (${rep.from ? fdate(rep.from) : 'start'} – ${rep.to ? fdate(rep.to) : 'today'})` : '';
      $('#r-table', root).innerHTML =
        `<h2>${esc(REP_TABS.find(t => t[0] === rep.tab)[1])}${esc(range)}</h2>` +
        table(data.headers, rows, 'No records for this report.');
      $('#r-filters', root).style.display = '';
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

    show(idFromHash() || CFG.defaultView);
  }

  init();
})();