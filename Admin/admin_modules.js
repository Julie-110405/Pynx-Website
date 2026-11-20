// Admin/admin_modules.js - PHYNX ERP Admin: live Dashboard, Inventory, Purchasing, Delivery,
// Users, Finance, Documents and Reports. Read-only. Uses the existing window.supabaseClient.
// Security: everything here is limited by Supabase RLS; no keys, no service role.
(function () {
  'use strict';
  const sb = window.supabaseClient;
  if (!sb) { console.error('supabaseClient not found'); return; }

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });
  const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fd = d => {
    if (!d) return '–';
    const x = new Date(String(d).length === 10 ? d + 'T00:00' : d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const badge = (label, cls) => `<span class="status ${cls || ''}">${esc(label)}</span>`;
  const CLS = { Pending: 'pending', Approved: 'approved', Rejected: 'rejected', Ordered: 'received', Sent: 'received',
    Confirmed: 'approved', Delayed: 'rejected', Received: 'approved', Cancelled: 'rejected', Scheduled: 'received',
    Completed: 'approved', 'With Issues': 'inspection', Open: 'rejected', Resolved: 'approved' };
  const sbadge = s => badge(s, CLS[s]);

  async function get(table, cols = '*', mod) {
    let q = sb.from(table).select(cols);
    if (mod) q = mod(q);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const setHead = (table, heads) => { $('thead tr', table).innerHTML = heads.map(h => `<th>${h}</th>`).join(''); };
  const msgRow = (cols, text, cls) => `<tr><td colspan="${cols}" class="${cls}">${esc(text)}</td></tr>`;
  const loading = (tb, cols) => { tb.innerHTML = msgRow(cols, 'Loading…', 'loading-msg'); };
  const fail = (tb, cols, e) => { console.error(e); tb.innerHTML = msgRow(cols, 'Could not load data: ' + (e.message || e), 'error-msg'); };
  function metric(sec, i, label, value, foot) {
    const m = $$('.metrics .metric', sec)[i]; if (!m) return;
    if (label != null) $('.metric-top span', m).textContent = label;
    $('.metric-value', m).textContent = value;
    $('.metric-foot', m).textContent = foot;
  }
  function metricsLoading(sec) { $$('.metrics .metric-value', sec).forEach(v => { v.textContent = '…'; }); }
  function fillSelect(sel, first, values) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(first)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  }
  const bar = (label, value, pct, cls) => `<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><span>${esc(value)}</span></div>
    <div class="bar ${cls || ''}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div></div>`;
  const stockOf = p => (Number(p.qty) <= 0 ? 'Out' : Number(p.qty) <= Number(p.min_level) ? 'Low' : 'In');
  const STOCK_LABEL = { In: 'In Stock', Low: 'Low Stock', Out: 'Out of Stock' };
  const STOCK_CLS = { In: 'approved', Low: 'pending', Out: 'rejected' };
  const INCOMING = ['Pending', 'Scheduled', 'Delayed'];
  const ACTIVE_PO = ['Sent', 'Confirmed', 'Delayed'];
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

  function csv(filename, headers, rows) {
    const q = c => '"' + String(c ?? '').replace(/"/g, '""') + '"';
    const text = [headers, ...rows].map(r => r.map(q).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // =====================================================================
  // DASHBOARD (counters, recent transactions, summaries, notifications)
  // The two requisition counters are handled by admin_requisitions.js
  // =====================================================================
  async function loadDashboard() {
    const sec = $('#dashboard');
    const stacks = $$('.content-grid .stack', sec);
    const txBody = $$('.panel', stacks[0])[1] && $('tbody', $$('.panel', stacks[0])[1]);
    const side = $$('.panel', stacks[1]);
    const vals = $$('.metrics .metric-value', sec), foots = $$('.metrics .metric-foot', sec);
    [2, 3].forEach(i => { vals[i].textContent = '…'; });
    if (txBody) loading(txBody, 4);
    try {
      const [prods, moves, pos, dels, discs, notes, pend] = await Promise.all([
        get('inventory_products'),
        get('inventory_movements', '*', q => q.order('created_at', { ascending: false }).limit(10)),
        get('purchase_orders', '*', q => q.order('created_at', { ascending: false })),
        get('deliveries', '*', q => q.order('created_at', { ascending: false })),
        get('delivery_discrepancies', 'id,status'),
        get('marketing_notifications', 'message,created_at', q => q.order('created_at', { ascending: false }).limit(3)),
        get('requisition_workflow', 'id', q => q.eq('workflow_stage', 'Admin Review'))
      ]);
      const act = prods.filter(p => !p.archived), pname = {}; prods.forEach(p => { pname[p.sku] = p; });
      const activePos = pos.filter(p => ACTIVE_PO.includes(p.status));
      const incoming = dels.filter(d => INCOMING.includes(d.status));
      const today = todayIso();
      const delayed = incoming.filter(d => d.status === 'Delayed' || (d.expected_date && d.expected_date < today));

      vals[2].textContent = activePos.length;
      foots[2].textContent = `${pos.filter(p => p.status === 'Sent').length} awaiting supplier confirmation`;
      vals[3].textContent = incoming.length;
      foots[3].textContent = `${delayed.length} delayed`;

      // Recent transactions: stock movements, purchase orders, received deliveries
      const items = [];
      moves.forEach(m => { const p = pname[m.sku] || {}; items.push({ date: m.movement_date,
        title: `Stock ${m.type === 'in' ? 'received' : 'released'}, ${m.ref_no}`, sub: `${p.name || m.sku}, ${num(m.qty)} ${p.unit || ''}`,
        dept: 'Inventory', badge: badge(m.type === 'in' ? 'Received' : 'Released', m.type === 'in' ? 'approved' : 'pending') }); });
      pos.slice(0, 10).forEach(p => items.push({ date: p.order_date, title: `${p.code} ${String(p.status).toLowerCase()}`,
        sub: `${p.item}, ${num(p.qty)}`, dept: 'Procurement', badge: sbadge(p.status) }));
      dels.filter(d => d.received_date).slice(0, 10).forEach(d => items.push({ date: d.received_date, title: `${d.code} received`,
        sub: d.items || '', dept: 'Logistics', badge: sbadge(d.status) }));
      items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (txBody) txBody.innerHTML = items.length ? items.slice(0, 5).map(i => `<tr>
        <td><div class="primary-cell">${esc(i.title)}</div><div class="secondary-cell">${esc(i.sub)}</div></td>
        <td>${esc(i.dept)}</td><td>${fd(i.date)}</td><td>${i.badge}</td></tr>`).join('')
        : msgRow(4, 'No transactions recorded yet.', 'empty-msg');

      // Inventory summary (no reserved stock: the database does not track it)
      const low = act.filter(p => stockOf(p) === 'Low'), out = act.filter(p => stockOf(p) === 'Out');
      const total = act.length || 1;
      $('.panel-body', side[0]).innerHTML =
        bar('In stock', `${act.length - low.length - out.length} of ${act.length}`, (act.length - low.length - out.length) / total * 100, 'ok') +
        bar('Low-stock items', `${low.length} items`, low.length / total * 100, 'warn') +
        bar('Out of stock', `${out.length} items`, out.length / total * 100, 'danger');

      // Delivery status
      const onTime = incoming.length - delayed.length;
      const doneN = dels.filter(d => ['Received', 'Completed'].includes(d.status)).length;
      const tot = dels.length || 1;
      $('.panel-body', side[1]).innerHTML =
        bar('On schedule', onTime, onTime / tot * 100, 'ok') + bar('Delayed', delayed.length, delayed.length / tot * 100, 'danger') +
        bar('Received / completed', doneN, doneN / tot * 100, '');

      // Notifications (all calculated from real records)
      const n = [];
      if (pend.length) n.push([`${pend.length} requisition${pend.length > 1 ? 's' : ''} need a decision`, 'Now']);
      low.slice(0, 2).forEach(p => n.push([`${p.name} is below minimum stock`, `${num(p.qty)} ${p.unit} left`]));
      out.slice(0, 2).forEach(p => n.push([`${p.name} is out of stock`, 'Needs restocking']));
      if (delayed.length) n.push([`${delayed.length} deliver${delayed.length > 1 ? 'ies are' : 'y is'} delayed`, 'Check Delivery Monitoring']);
      const openD = discs.filter(d => d.status === 'Open').length;
      if (openD) n.push([`${openD} open delivery discrepanc${openD > 1 ? 'ies' : 'y'}`, 'Needs resolution']);
      notes.forEach(x => n.push([x.message, fd(x.created_at)]));
      $('.list', side[2]).innerHTML = n.length
        ? n.slice(0, 7).map(x => `<li><div>${esc(x[0])}<small>${esc(x[1])}</small></div></li>`).join('')
        : '<li><div>No notifications.</div></li>';
    } catch (e) {
      console.error(e);
      [2, 3].forEach(i => { vals[i].textContent = '–'; foots[i].textContent = 'Could not load'; });
      if (txBody) fail(txBody, 4, e);
    }
  }

  // =====================================================================
  // INVENTORY MONITORING
  // =====================================================================
  const inv = { prods: [], moves: [], pname: {} };
  async function loadInventory() {
    const sec = $('#inventory'), tables = $$('table', sec), [tb1, tb2] = $$('tbody', sec);
    metricsLoading(sec); loading(tb1, 5); loading(tb2, 5);
    setHead(tables[0], ['MATERIAL', 'CATEGORY', 'AVAILABLE', 'MINIMUM', 'STATUS']);
    try {
      const [prods, moves] = await Promise.all([get('inventory_products', '*', q => q.order('name')),
        get('inventory_movements', '*', q => q.order('created_at', { ascending: false }).limit(50))]);
      inv.prods = prods.filter(p => !p.archived); inv.moves = moves; inv.pname = {};
      prods.forEach(p => { inv.pname[p.sku] = p; });
      const low = inv.prods.filter(p => stockOf(p) === 'Low').length, out = inv.prods.filter(p => stockOf(p) === 'Out').length;
      metric(sec, 0, 'Total Items', inv.prods.length, 'Active products');
      metric(sec, 1, 'In Stock', inv.prods.length - low - out, 'Above minimum level');
      metric(sec, 2, 'Out of Stock', out, 'Currently unavailable');
      metric(sec, 3, 'Low Stock', low, 'At or below minimum level');
      fillSelect($$('.toolbar select', sec)[0], 'All categories', [...new Set(inv.prods.map(p => p.category))].sort());
      const lv = $$('.toolbar select', sec)[1];
      lv.innerHTML = '<option value="">All stock levels</option><option value="In">In stock</option><option value="Low">Low stock</option><option value="Out">Out of stock</option>';
      drawInventory();
      tb2.innerHTML = inv.moves.length ? inv.moves.slice(0, 20).map(m => { const p = inv.pname[m.sku] || {};
        return `<tr><td>${fd(m.movement_date)}</td><td>${badge(m.type === 'in' ? 'Stock-in' : 'Stock-out', m.type === 'in' ? 'approved' : 'pending')}</td>
        <td>${esc(p.name || m.sku)}</td><td>${m.type === 'in' ? '+' : '-'}${num(m.qty)} ${esc(p.unit || '')}</td>
        <td>${esc(m.ref_no)}${m.reference ? `<div class="secondary-cell">${esc(m.reference)}</div>` : ''}</td></tr>`; }).join('')
        : msgRow(5, 'No stock movements recorded yet.', 'empty-msg');
    } catch (e) { fail(tb1, 5, e); fail(tb2, 5, e); }
  }
  function drawInventory() {
    const sec = $('#inventory'), tb = $('tbody', sec);
    const q = ($('.toolbar input', sec).value || '').trim().toLowerCase();
    const [cat, lvl] = $$('.toolbar select', sec);
    const list = inv.prods.filter(p => (!cat.value || p.category === cat.value) && (!lvl.value || stockOf(p) === lvl.value) &&
      (!q || (p.name + p.sku + p.category + p.supplier).toLowerCase().includes(q)));
    tb.innerHTML = list.length ? list.map(p => `<tr><td><div class="primary-cell">${esc(p.name)}</div><div class="secondary-cell">${esc(p.sku)}</div></td>
      <td>${esc(p.category)}</td><td>${num(p.qty)} ${esc(p.unit)}</td><td>${num(p.min_level)} ${esc(p.unit)}</td>
      <td>${badge(STOCK_LABEL[stockOf(p)], STOCK_CLS[stockOf(p)])}</td></tr>`).join('')
      : msgRow(5, 'No products found.', 'empty-msg');
  }

  // =====================================================================
  // PURCHASING MONITORING
  // =====================================================================
  
  // =====================================================================
  // PURCHASING MONITORING
  // =====================================================================

  let purRows = [];

  async function loadPurchasing() {
    const sec = $('#purchasing');
    const tb = $('tbody', sec);

    metricsLoading(sec);
    loading(tb, 9);

    setHead($('table', sec), [
      'PURCHASE REQUEST',
      'PURCHASE ORDER',
      'SUPPLIER',
      'ITEM',
      'QTY',
      'COST',
      'ORDER DATE',
      'STATUS',
      'ACTION'
    ]);

    try {
      const [prs, pos, sups] = await Promise.all([
        get('purchase_requests', '*',
          q => q.order('created_at', { ascending: false })),
        get('purchase_orders', '*',
          q => q.order('created_at', { ascending: false })),
        get('suppliers', 'id,name')
      ]);

      const sname = {};
      sups.forEach(s => {
        sname[s.id] = s.name;
      });

      const prById = {};
      prs.forEach(p => {
        prById[p.id] = p;
      });

      const usedPr = new Set();

      purRows = pos.map(o => {
        const pr = prById[o.purchase_request_id];

        if (pr) usedPr.add(pr.id);

        return {
          prId: pr ? pr.id : null,
          pr: pr ? pr.code : '–',
          po: o.code,
          supplier: sname[o.supplier_id] || '–',
          item: o.item,
          qty: o.qty,
          cost: o.total,
          date: o.order_date,
          status: o.status
        };
      });

      prs.filter(p => !usedPr.has(p.id)).forEach(p => {
        purRows.push({
          prId: p.id,
          pr: p.code,
          po: '–',
          supplier: sname[p.supplier_id] || '–',
          item: p.item,
          qty: p.qty,
          cost: p.est_cost,
          date: String(p.created_at).slice(0, 10),
          status: p.status
        });
      });

      const open = pos.filter(o => ACTIVE_PO.includes(o.status));

      metric(
        sec, 0, 'Purchase Requests',
        prs.length,
        `${prs.filter(p => p.status === 'Pending').length} pending`
      );

      metric(
        sec, 1, 'Active Orders',
        open.length,
        'Sent, confirmed or delayed'
      );

      metric(
        sec, 2, 'Open Order Value',
        peso(open.reduce((s, o) => s + Number(o.total), 0)),
        'Total of active orders'
      );

      metric(
        sec, 3, 'Cancelled',
        pos.filter(o => o.status === 'Cancelled').length,
        'Purchase orders'
      );

      const sels = $$('.toolbar select', sec);

      fillSelect(
        sels[0],
        'All suppliers',
        [...new Set(purRows.map(r => r.supplier)
          .filter(s => s !== '–'))].sort()
      );

      fillSelect(
        sels[1],
        'All statuses',
        [...new Set(purRows.map(r => r.status))].sort()
      );

      drawPurchasing();

    } catch (e) {
      fail(tb, 9, e);
    }
  }

  function drawPurchasing() {
    const sec = $('#purchasing');
    const tb = $('tbody', sec);
    const sels = $$('.toolbar select', sec);

    const q = ($('.toolbar input', sec).value || '')
      .trim().toLowerCase();

    const list = purRows.filter(r =>
      (!sels[0].value || r.supplier === sels[0].value) &&
      (!sels[1].value || r.status === sels[1].value) &&
      (!q || [r.pr, r.po, r.supplier, r.item]
        .join(' ').toLowerCase().includes(q))
    );

    tb.innerHTML = list.length
      ? list.map(r => `
        <tr>
          <td class="primary-cell">${esc(r.pr)}</td>
          <td class="primary-cell">${esc(r.po)}</td>
          <td>${esc(r.supplier)}</td>
          <td>${esc(r.item)}</td>
          <td>${num(r.qty)}</td>
          <td>${peso(r.cost)}</td>
          <td>${fd(r.date)}</td>
          <td>${sbadge(r.status)}</td>
          <td>
            ${
              r.prId && r.status === 'Pending'
                ? `<button type="button"
                     data-approve-pr="${r.prId}">
                     Approve
                   </button>`
                : '–'
            }
          </td>
        </tr>
      `).join('')
      : msgRow(9, 'No purchase requests or orders found.', 'empty-msg');
  }


  // =====================================================================
  // DELIVERY MONITORING
  // =====================================================================
  let delRows = [];
  async function loadDelivery() {
    const sec = $('#delivery'), tb = $('tbody', sec);
    metricsLoading(sec); loading(tb, 8);
    setHead($('table', sec), ['DELIVERY', 'SUPPLIER', 'PURCHASE ORDER', 'ITEMS', 'QTY', 'EXPECTED', 'RECEIVED', 'STATUS']);
    try {
      const [dels, pos, sups, discs] = await Promise.all([get('deliveries', '*', q => q.order('created_at', { ascending: false })),
        get('purchase_orders', 'id,code'), get('suppliers', 'id,name'),
        get('delivery_discrepancies', '*', q => q.order('created_at', { ascending: false }))]);
      const sname = {}, pcode = {}, dcode = {}; sups.forEach(s => { sname[s.id] = s.name; }); pos.forEach(p => { pcode[p.id] = p.code; });
      dels.forEach(d => { dcode[d.id] = d.code; });
      delRows = dels.map(d => ({ code: d.code, supplier: sname[d.supplier_id] || '–', po: pcode[d.purchase_order_id] || '–', items: d.items || '–',
        qty: d.qty, expected: d.expected_date, received: d.received_date, status: d.status }));
      const today = todayIso(), week = addDays(today, 6), inc = dels.filter(d => INCOMING.includes(d.status));
      metric(sec, 0, 'Incoming', inc.length, 'Pending, scheduled or delayed');
      metric(sec, 1, 'Expected This Week', inc.filter(d => d.expected_date && d.expected_date >= today && d.expected_date <= week).length, `${fd(today)} – ${fd(week)}`);
      metric(sec, 2, 'Delayed', inc.filter(d => d.status === 'Delayed' || (d.expected_date && d.expected_date < today)).length, 'Delayed or past expected date');
      metric(sec, 3, 'Issue Reports', discs.filter(d => d.status === 'Open').length, 'Open discrepancies');
      const sels = $$('.toolbar select', sec);
      fillSelect(sels[0], 'All suppliers', [...new Set(delRows.map(r => r.supplier).filter(s => s !== '–'))].sort());
      fillSelect(sels[1], 'All statuses', [...new Set(delRows.map(r => r.status))].sort());
      drawDelivery();

      let box = $('#dl-disc', sec);
      if (!box) { box = document.createElement('div'); box.id = 'dl-disc'; box.className = 'panel'; sec.appendChild(box); }
      box.innerHTML = `<div class="panel-head"><div><h2>Delivery discrepancies</h2><div class="panel-sub">Damaged, missing or incomplete items reported by Logistics and Inventory</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>REFERENCE</th><th>DELIVERY</th><th>ISSUE</th><th>REPORTED</th><th>RESOLUTION</th><th>STATUS</th></tr></thead><tbody>` +
        (discs.length ? discs.map(x => `<tr><td class="primary-cell">${esc(x.code)}</td><td>${esc(dcode[x.delivery_id] || '–')}</td><td>${esc(x.issue)}</td>
          <td>${fd(x.created_at)}</td><td>${esc(x.resolution || '–')}</td><td>${sbadge(x.status)}</td></tr>`).join('')
          : msgRow(6, 'No discrepancies reported.', 'empty-msg')) + '</tbody></table></div>';
    } catch (e) { fail(tb, 8, e); }
  }
  function drawDelivery() {
    const sec = $('#delivery'), tb = $('tbody', sec), sels = $$('.toolbar select', sec);
    const q = ($('.toolbar input', sec).value || '').trim().toLowerCase();
    const list = delRows.filter(r => (!sels[0].value || r.supplier === sels[0].value) && (!sels[1].value || r.status === sels[1].value) &&
      (!q || [r.code, r.po, r.supplier, r.items].join(' ').toLowerCase().includes(q)));
    tb.innerHTML = list.length ? list.map(r => `<tr><td class="primary-cell">${esc(r.code)}</td><td>${esc(r.supplier)}</td><td>${esc(r.po)}</td>
      <td>${esc(r.items)}</td><td>${r.qty == null ? '–' : num(r.qty)}</td><td>${fd(r.expected)}</td><td>${fd(r.received)}</td><td>${sbadge(r.status)}</td></tr>`).join('')
      : msgRow(8, 'No deliveries found.', 'empty-msg');
  }

  // =====================================================================
  // USER MANAGEMENT (view only; needs 06_admin_profiles_read.sql)
  // =====================================================================
  let userRows = [];
  async function loadUsers() {
    const sec = $('#users'), tb = $('tbody', sec);
    metricsLoading(sec); loading(tb, 3);
    setHead($('table', sec), ['USERNAME', 'DEPARTMENT', 'ROLE']);
    const btn = $('.actions button', sec); if (btn) { btn.disabled = true; btn.title = 'Account creation needs a secure server function and is not enabled yet.'; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }
    const note = $('.note', sec); if (note) note.textContent = 'View only. Passwords are never shown. Creating or editing accounts needs a secure server function and is not enabled yet.';
    try {
      userRows = await get('profiles', 'username,department,role,created_at', q => q.order('username'));
      const depts = [...new Set(userRows.map(u => u.department))].sort();
      metric(sec, 0, 'Total Accounts', userRows.length, 'All departments');
      metric(sec, 1, 'Admins', userRows.filter(u => String(u.role).toLowerCase() === 'admin').length, 'Role: admin');
      metric(sec, 2, 'Staff', userRows.filter(u => String(u.role).toLowerCase() !== 'admin').length, 'Other roles');
      metric(sec, 3, 'Departments', depts.length, depts.join(', ') || '–');
      const sels = $$('.toolbar select', sec);
      fillSelect(sels[0], 'All departments', depts);
      fillSelect(sels[1], 'All roles', [...new Set(userRows.map(u => u.role))].sort());
      drawUsers();
    } catch (e) { fail(tb, 3, e); }
  }
  function drawUsers() {
    const sec = $('#users'), tb = $('tbody', sec), sels = $$('.toolbar select', sec);
    const q = ($('.toolbar input', sec).value || '').trim().toLowerCase();
    const list = userRows.filter(u => (!sels[0].value || u.department === sels[0].value) && (!sels[1].value || u.role === sels[1].value) &&
      (!q || (u.username + u.department + u.role).toLowerCase().includes(q)));
    tb.innerHTML = list.length ? list.map(u => `<tr><td class="primary-cell">${esc(u.username)}</td><td>${esc(u.department)}</td><td>${esc(u.role)}</td></tr>`).join('')
      : msgRow(3, 'No users found.', 'empty-msg');
  }

  // =====================================================================
  // FINANCE MONITORING (only real figures; no finance tables exist yet)
  // =====================================================================
  async function loadFinance() {
    const sec = $('#finance'), heading = $('.heading', sec);
    while (heading.nextElementSibling) heading.nextElementSibling.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="panel"><div class="panel-body loading-msg">Loading…</div></div>';
    sec.appendChild(wrap);
    try {
      const [pos, prs, prods] = await Promise.all([get('purchase_orders', 'total,status'), get('purchase_requests', 'est_cost,status'), get('inventory_products', 'qty,unit_cost,archived')]);
      const sum = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0);
      wrap.innerHTML = `<div class="metrics">
        <div class="metric"><div class="metric-top"><span>Open Purchase Orders</span></div><div class="metric-value">${peso(sum(pos.filter(p => ACTIVE_PO.includes(p.status)), p => p.total))}</div><div class="metric-foot">Sent, confirmed or delayed</div></div>
        <div class="metric"><div class="metric-top"><span>Received Orders</span></div><div class="metric-value">${peso(sum(pos.filter(p => p.status === 'Received'), p => p.total))}</div><div class="metric-foot">Purchase orders marked received</div></div>
        <div class="metric"><div class="metric-top"><span>Pending Requests (est.)</span></div><div class="metric-value">${peso(sum(prs.filter(p => p.status === 'Pending'), p => p.est_cost))}</div><div class="metric-foot">Estimated cost of pending purchase requests</div></div>
        <div class="metric"><div class="metric-top"><span>Inventory Value</span></div><div class="metric-value">${peso(sum(prods.filter(p => !p.archived), p => Number(p.qty) * Number(p.unit_cost)))}</div><div class="metric-foot">Quantity × unit cost</div></div></div>
        <div class="panel"><div class="panel-head"><div><h2>Budgets, expenses, invoices and payments</h2><div class="panel-sub">Not available yet</div></div></div>
        <div class="note">The database has no tables for department budgets, expenses, supplier invoices or payments, so these are not shown and no figures are invented.
        The four numbers above come from real purchase order, purchase request and inventory records. Once the finance tables are approved and created, this page can show budgets, expenses, outstanding invoices and payments.</div></div>`;
    } catch (e) { console.error(e); wrap.innerHTML = `<div class="panel"><div class="panel-body error-msg">Could not load data: ${esc(e.message || e)}</div></div>`; }
  }

  // =====================================================================
  // RECEIPTS AND DOCUMENTS (the receipts table only)
  // =====================================================================
  let docRows = [];
  async function loadDocuments() {
    const sec = $('#documents'), tb = $('tbody', sec);
    loading(tb, 4);
    setHead($('table', sec), ['REFERENCE', 'TYPE', 'RELATED TO', 'DATE']);
    const up = $('.actions button', sec); if (up) { up.disabled = true; up.title = 'Uploads are not enabled yet.'; up.style.opacity = '.5'; up.style.cursor = 'not-allowed'; }
    try {
      const [rc, pos, dels, discs, wf] = await Promise.all([get('receipts', '*', q => q.order('issued_at', { ascending: false })),
        get('purchase_orders', 'id,code'), get('deliveries', 'id,code'), get('delivery_discrepancies', 'id'), get('requisition_workflow', 'id')]);
      const pc = {}, dc = {}; pos.forEach(p => { pc[p.id] = p.code; }); dels.forEach(d => { dc[d.id] = d.code; });
      docRows = rc.map(r => ({ ref: r.code, type: r.type === 'purchase_order' ? 'Purchase order receipt' : 'Delivery receipt',
        rel: [pc[r.purchase_order_id], dc[r.delivery_id]].filter(Boolean).join(' / ') || '–', date: r.issued_at }));
      const n1 = rc.filter(r => r.type === 'purchase_order').length, n2 = rc.filter(r => r.type === 'delivery').length;
      $('.doc-cats', sec).innerHTML = `<div>Purchase order receipts<span>${n1} record${n1 === 1 ? '' : 's'}</span></div>
        <div>Delivery receipts<span>${n2} record${n2 === 1 ? '' : 's'}</span></div>
        <div>Delivery discrepancy reports<span>${discs.length} record${discs.length === 1 ? '' : 's'}</span></div>
        <div>Requisition records<span>${wf.length} record${wf.length === 1 ? '' : 's'}</span></div>`;
      fillSelect($$('.toolbar select', sec)[0], 'All categories', [...new Set(docRows.map(r => r.type))]);
      const second = $$('.toolbar select', sec)[1]; if (second) second.style.display = 'none';
      drawDocuments();
    } catch (e) { fail(tb, 4, e); }
  }
  function drawDocuments() {
    const sec = $('#documents'), tb = $('tbody', sec), cat = $$('.toolbar select', sec)[0];
    const q = ($('.toolbar input', sec).value || '').trim().toLowerCase();
    const list = docRows.filter(r => (!cat.value || r.type === cat.value) && (!q || (r.ref + r.rel).toLowerCase().includes(q)));
    tb.innerHTML = list.length ? list.map(r => `<tr><td class="primary-cell">${esc(r.ref)}</td><td>${esc(r.type)}</td><td>${esc(r.rel)}</td><td>${fd(r.date)}</td></tr>`).join('')
      : msgRow(4, 'No receipts found.', 'empty-msg');
  }

  // =====================================================================
  // REPORTS (real records, filters, CSV of the filtered result)
  // =====================================================================
  const REPORTS = ['requisition', 'inventory', 'purchasing', 'delivery', 'activity'];
  const rep = { type: 'requisition', result: { headers: [], rows: [] } };
  const itemsText = r => (r.items || []).map(i => `${i.name}, ${num(i.qty)} ${i.unit}`).join('; ') || '–';

  async function buildReport(type) {
    if (type === 'requisition') {
      const d = await get('v_admin_requisitions', '*', q => q.order('submitted_at', { ascending: false }));
      return { headers: ['Reference', 'Department', 'Title', 'Items', 'Submitted', 'Stage'],
        rows: d.map(r => ({ cells: [r.reference, r.department, r.title, itemsText(r), fd(r.submitted_at), r.workflow_stage], date: String(r.submitted_at).slice(0, 10), dept: r.department, status: r.workflow_stage })) };
    }
    if (type === 'inventory') {
      const [m, p] = await Promise.all([get('inventory_movements', '*', q => q.order('created_at', { ascending: false }).limit(1000)), get('inventory_products', 'sku,name,unit')]);
      const pn = {}; p.forEach(x => { pn[x.sku] = x; });
      return { headers: ['Date', 'Reference', 'Type', 'SKU', 'Product', 'Quantity', 'Reason / source'],
        rows: m.map(x => ({ cells: [fd(x.movement_date), x.ref_no, x.type === 'in' ? 'Stock-in' : 'Stock-out', x.sku, (pn[x.sku] || {}).name || x.sku, `${num(x.qty)} ${(pn[x.sku] || {}).unit || ''}`, [x.reason, x.party].filter(Boolean).join(' / ')], date: x.movement_date, dept: '', status: x.type === 'in' ? 'Stock-in' : 'Stock-out' })) };
    }
    if (type === 'purchasing') {
      const [pos, prs, s] = await Promise.all([get('purchase_orders', '*', q => q.order('created_at', { ascending: false })), get('purchase_requests', 'id,code'), get('suppliers', 'id,name')]);
      const sn = {}, pc = {}; s.forEach(x => { sn[x.id] = x.name; }); prs.forEach(x => { pc[x.id] = x.code; });
      return { headers: ['PO number', 'Purchase request', 'Supplier', 'Item', 'Quantity', 'Total', 'Order date', 'Status'],
        rows: pos.map(o => ({ cells: [o.code, pc[o.purchase_request_id] || '–', sn[o.supplier_id] || '–', o.item, num(o.qty), Number(o.total).toFixed(2), fd(o.order_date), o.status], date: o.order_date, dept: '', status: o.status })) };
    }
    if (type === 'delivery') {
      const [d, pos, s] = await Promise.all([get('deliveries', '*', q => q.order('created_at', { ascending: false })), get('purchase_orders', 'id,code'), get('suppliers', 'id,name')]);
      const sn = {}, pc = {}; s.forEach(x => { sn[x.id] = x.name; }); pos.forEach(x => { pc[x.id] = x.code; });
      return { headers: ['Delivery', 'Supplier', 'Purchase order', 'Items', 'Quantity', 'Expected', 'Received', 'Status'],
        rows: d.map(x => ({ cells: [x.code, sn[x.supplier_id] || '–', pc[x.purchase_order_id] || '–', x.items || '–', x.qty ?? '–', fd(x.expected_date), fd(x.received_date), x.status], date: x.expected_date || String(x.created_at).slice(0, 10), dept: '', status: x.status })) };
    }
    if (type === 'activity') {
      const [ap, wf] = await Promise.all([get('requisition_approvals', '*', q => q.order('decided_at', { ascending: false })), get('requisition_workflow', 'id,reference,department')]);
      const w = {}; wf.forEach(x => { w[x.id] = x; });
      return { headers: ['Date', 'Reference', 'Department', 'Decision', 'Remarks'],
        rows: ap.map(a => ({ cells: [fd(a.decided_at), (w[a.workflow_id] || {}).reference || '–', (w[a.workflow_id] || {}).department || '–', a.decision, a.remarks || ''], date: String(a.decided_at).slice(0, 10), dept: (w[a.workflow_id] || {}).department || '', status: a.decision })) };
    }
    return { headers: [], rows: [], unavailable: true };
  }

  async function generateReport() {
    const sec = $('#reports'), tb = $('tbody', sec), [from, to] = $$('.toolbar input', sec), [dsel, ssel] = $$('.toolbar select', sec);
    const note = $('.note', sec);
    loading(tb, 4);
    try {
      const res = await buildReport(rep.type);
      if (res.unavailable) {
        setHead($('table', sec), ['REPORT']); tb.innerHTML = msgRow(1, 'Finance reports are not available yet: the database has no budget, expense, invoice or payment tables.', 'empty-msg');
        rep.result = { headers: [], rows: [] }; if (note) note.textContent = ''; return;
      }
      fillSelect(dsel, 'All departments', [...new Set(res.rows.map(r => r.dept).filter(Boolean))].sort());
      fillSelect(ssel, 'All statuses', [...new Set(res.rows.map(r => r.status).filter(Boolean))].sort());
      const list = res.rows.filter(r => (!from.value || (r.date && String(r.date).slice(0, 10) >= from.value)) &&
        (!to.value || (r.date && String(r.date).slice(0, 10) <= to.value)) && (!dsel.value || r.dept === dsel.value) && (!ssel.value || r.status === ssel.value));
      rep.result = { headers: res.headers, rows: list.map(r => r.cells) };
      setHead($('table', sec), res.headers.map(h => esc(h.toUpperCase())));
      tb.innerHTML = list.length ? list.slice(0, 50).map(r => `<tr>${r.cells.map((c, i) => `<td${i === 0 ? ' class="primary-cell"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
        : msgRow(res.headers.length, 'No records match these filters.', 'empty-msg');
      if (note) note.textContent = `${list.length} record${list.length === 1 ? '' : 's'} found. The preview shows the first 50 rows; Export CSV includes all of them. The department filter applies to requisition and approval reports.`;
    } catch (e) { fail(tb, 4, e); }
  }
  function bindReports() {
    const sec = $('#reports'), cards = $$('.doc-cats div', sec);
    cards.forEach((c, i) => {
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => { rep.type = REPORTS[i]; cards.forEach(x => { x.style.outline = ''; }); c.style.outline = '2px solid #111'; generateReport(); });
    });
    cards[0].style.outline = '2px solid #111';
    $('.toolbar button', sec).addEventListener('click', generateReport);
    $$('.toolbar select', sec).forEach(s => s.addEventListener('change', generateReport));
    $$('.toolbar input', sec).forEach(s => s.addEventListener('change', generateReport));
    const [pr, ex] = $$('.actions button', sec);
    on(pr, 'click', () => window.print());
    on(ex, 'click', () => {
      if (!rep.result.rows.length) { alert('Nothing to export for this report.'); return; }
      csv(`phynx-${rep.type}-report-${todayIso()}.csv`, rep.result.headers, rep.result.rows);
    });
  }

  // =====================================================================
  // Wiring: load a page when it is opened, and bind filters once
  // =====================================================================
  const LOADERS = { dashboard: loadDashboard, inventory: loadInventory, purchasing: loadPurchasing, delivery: loadDelivery,
    users: loadUsers, finance: loadFinance, documents: loadDocuments, reports: generateReport };
  const route = () => { const id = location.hash.slice(1) || 'dashboard'; if (LOADERS[id]) LOADERS[id](); };

  [['#inventory', drawInventory], ['#purchasing', drawPurchasing], ['#delivery', drawDelivery], ['#users', drawUsers], ['#documents', drawDocuments]].forEach(([id, fn]) => {
    const sec = $(id); if (!sec) return;
    on($('.toolbar input', sec), 'input', fn);
    $$('.toolbar select', sec).forEach(s => s.addEventListener('change', fn));
  });

  // ADMIN APPROVAL FOR PURCHASE REQUESTS

  on($('#purchasing tbody'), 'click', async e => {
    const btn = e.target.closest('[data-approve-pr]');

    if (!btn) return;

    const id = Number(btn.dataset.approvePr);

    if (!Number.isInteger(id)) {
      alert('Invalid purchase request ID.');
      return;
    }

    if (!confirm('Approve this purchase request?')) {
      return;
    }

    try {
      const {
        data: { user },
        error: userError
      } = await sb.auth.getUser();

      if (userError || !user) {
        alert('Unable to verify Admin account.');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Approving...';

      const { data, error } = await sb
        .from('purchase_requests')
        .update({
          status: 'Approved',
          approved_by: user.id
        })
        .eq('id', id)
        .eq('status', 'Pending')
        .select('id');

      if (error) throw error;

      if (!data || data.length === 0) {
        alert(
          'No request was updated. Check Admin permissions and request status.'
        );
        await loadPurchasing();
        return;
      }

      alert('Purchase request approved successfully!');

      await loadPurchasing();

    } catch (error) {
      console.error('Purchase approval error:', error);
      alert('Approval failed: ' + error.message);
      await loadPurchasing();
    }
  });

  bindReports();
  window.addEventListener('hashchange', route);
  route();
  setInterval(() => { if (!document.hidden && (location.hash.slice(1) || 'dashboard') === 'dashboard') loadDashboard(); }, 60000);
})();