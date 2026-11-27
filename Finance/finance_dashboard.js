/* ==========================================================================
   PHYNX ERP - Finance dashboard
   Reads real data only:
     v_department_budgets        (budgets set by Finance + expenses + committed purchase orders)
     expenses                    (recorded by Finance)
     v_purchase_costs            (every purchase order with its department / requisition)
     purchase_requests           (Procurement's requests)
     v_finance_purchase_requests (the Budget Approvals queue)
   Finance writes department_budgets and expenses, and decides purchase requests through the
   database function rw_finance_decide (the only way to approve / reject). RLS enforces this.
   ========================================================================== */
(async function () {
  'use strict';

  const sb = window.supabaseClient;
  const LOGIN = '../Log_in/login.html';
  const DEPTS = ['Admin', 'Finance', 'Marketing', 'Procurement', 'Inventory', 'Logistics'];
  const CATEGORIES = ['Materials and Supplies', 'Transportation', 'Delivery Fees', 'Packaging', 'Supplier Payment', 'Operational Expenses'];
  const POLL_MS = 30000;

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v || 0);
  const peso = n => (num(n) < 0 ? '-' : '') + '₱' + Math.abs(num(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pesoWhole = n => (num(n) < 0 ? '-' : '') + '₱' + Math.round(Math.abs(num(n))).toLocaleString('en-PH');
  const compact = n => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.round(n));
  const fdate = s => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '–';
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoOf(new Date());
  const monthKey = s => String(s).slice(0, 7);
  const monthLabel = k => new Date(k + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  const pct = (u, a) => a > 0 ? Math.round(u / a * 100) : (u > 0 ? 100 : 0);
  const barCls = p => p >= 90 ? 'danger' : p >= 75 ? 'warn' : 'ok';
  const used = b => num(b.expenses_total) + num(b.po_committed);
  const isCurrent = b => b.period_start <= todayIso() && todayIso() <= b.period_end;

  const PO_CLS = { Sent: 'received', Confirmed: 'pending', Delayed: 'rejected', Received: 'approved', Cancelled: 'rejected' };
  const PR_CLS = { Pending: 'pending', Approved: 'approved', Ordered: 'received', Rejected: 'rejected' };
  const PR_LABEL = { Pending: 'Awaiting Finance', Approved: 'Approved', Ordered: 'Ordered', Rejected: 'Rejected' };
  const badge = (map, s) => `<span class="status ${map[s] || ''}">${esc(s)}</span>`;
  const prBadge = s => `<span class="status ${PR_CLS[s] || ''}">${esc(PR_LABEL[s] || s)}</span>`;
  const metric = (label, value, foot) =>
    `<div class="metric"><div class="metric-top"><span>${esc(label)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></div>`;

  function toast(message) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function notice(msg) { const el = $('#f-notice'); if (el) { el.hidden = !msg; el.textContent = msg || ''; } }

  /* ---------- sign-in check (the database enforces the real rules) ---------- */
  if (!sb) { document.body.innerHTML = '<p style="padding:24px">Supabase is not connected. Check that ../config/supabase.js loads first.</p>'; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace(LOGIN); return; }
  const { data: me } = await sb.from('profiles').select('username, department').eq('id', session.user.id).single();
  if (!me || String(me.department).toLowerCase() !== 'finance') {
    alert('This page is for Finance accounts only.');
    location.replace(LOGIN);
    return;
  }
  $('#who-name').textContent = me.username;
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.replace(LOGIN); });
  $('#logout').addEventListener('click', async e => {
    e.preventDefault();
    try { await sb.auth.signOut(); } catch (err) { console.warn(err); }
    location.href = LOGIN;
  });

  /* ---------- data ---------- */
  const S = { budgets: [], expenses: [], pos: [], prs: [], prq: [] };

  async function load() {
    const [b, e, c, p, q] = await Promise.all([
      sb.from('v_department_budgets').select('*').order('period_start', { ascending: false }).order('department'),
      sb.from('expenses').select('*').order('expense_date', { ascending: false }).order('id', { ascending: false }),
      sb.from('v_purchase_costs').select('*').order('po_id', { ascending: false }),
      sb.from('purchase_requests').select('*, suppliers(name)').order('id', { ascending: false }),
      sb.from('v_finance_purchase_requests').select('*').order('created_at', { ascending: false })
    ]);
    const errs = [['Budgets', b], ['Expenses', e], ['Purchase orders', c], ['Purchase requests', p], ['Budget approvals', q]]
      .filter(([, r]) => r.error).map(([n, r]) => `${n}: ${r.error.message}`);
    notice(errs.length ? 'Some data could not be loaded (' + errs.join(' · ') + '). If this is the first time, run 07_finance.sql and 01_requisition_chain_fix.sql in Supabase.' : '');
    if (errs.length) console.error(errs);
    S.budgets = b.data || [];
    S.expenses = e.data || [];
    S.pos = c.data || [];
    S.prs = p.data || [];
    S.prq = q.data || [];
  }

  const forLabel = x => x.requisition_id || (x.logistics_requisition_id ? 'Logistics #' + x.logistics_requisition_id : '');
  const pendingApprovals = () => S.prq.filter(x => x.status === 'Pending');
  /* The budget row that covers today for a department (the latest one if several) */
  const budgetFor = dept => S.budgets.find(b => b.department === dept && isCurrent(b)) || null;

  /* ---------- dashboard ---------- */
  function renderDashboard() {
    const cur = S.budgets.filter(isCurrent);
    const budget = cur.reduce((a, b) => a + num(b.amount), 0);
    const usedAmt = cur.reduce((a, b) => a + used(b), 0);
    const remaining = budget - usedAmt;
    const openPOs = S.pos.filter(p => ['Sent', 'Confirmed', 'Delayed'].includes(p.po_status));
    const openValue = openPOs.reduce((a, p) => a + num(p.total), 0);
    const unpaid = S.expenses.filter(e => e.payment_status === 'Unpaid');
    const unpaidSum = unpaid.reduce((a, e) => a + num(e.amount), 0);
    const waiting = pendingApprovals();

    $('#dash-metrics').innerHTML =
      metric('Total Budget', pesoWhole(budget), cur.length ? `${cur.length} active budget${cur.length > 1 ? 's' : ''}` : 'No budget set for today') +
      metric('Budget Used', pesoWhole(usedAmt), budget ? `${pct(usedAmt, budget)}% of budget` : 'Expenses + open orders') +
      metric('Remaining Budget', pesoWhole(remaining), budget ? `${Math.max(0, 100 - pct(usedAmt, budget))}% left` : '–') +
      metric('Awaiting Approval', String(waiting.length), `${pesoWhole(waiting.reduce((a, x) => a + num(x.est_cost), 0))} estimated`) +
      metric('Unpaid Expenses', pesoWhole(unpaidSum), `${unpaid.length} expense${unpaid.length === 1 ? '' : 's'}`);

    const keys = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
    const totals = keys.map(k => S.expenses.filter(e => monthKey(e.expense_date) === k).reduce((a, e) => a + num(e.amount), 0));
    const max = Math.max(...totals, 0);
    $('#dash-chart').innerHTML = max > 0
      ? keys.map((k, i) => `<div class="col${i === keys.length - 1 ? ' now' : ''}"><b>${compact(totals[i])}</b><i style="height:${Math.max(2, totals[i] / max * 100)}%"></i>${esc(new Date(k + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short' }))}</div>`).join('')
      : '<div class="empty-msg" style="width:100%">No expenses recorded yet. Add one in Expense Management.</div>';

    $('#dash-util').innerHTML = cur.length
      ? cur.map(b => { const p = pct(used(b), num(b.amount));
          return `<div class="bar-row"><div class="bar-label"><span>${esc(b.department)}</span><span>${p}%</span></div><div class="bar ${barCls(p)}"><span style="width:${Math.min(100, p)}%"></span></div></div>`; }).join('')
      : '<div class="empty-msg">No budget covers today. <button type="button" class="mini" data-act="set-budget">Set a budget</button></div>';

    $('#dash-pos').innerHTML = S.pos.length
      ? S.pos.slice(0, 5).map(p => `<tr><td class="primary-cell">${esc(p.po_code)}</td><td>${esc(p.supplier || '–')}</td><td>${esc(p.item)}</td><td>${esc(p.department)}</td><td class="amount">${peso(p.total)}</td><td>${badge(PO_CLS, p.po_status)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty-msg">No purchase orders yet. They appear here once Procurement orders an approved shortage or restock.</td></tr>';

    $('#dash-exp').innerHTML = S.expenses.length
      ? S.expenses.slice(0, 5).map(e => `<li><div>${esc(e.description)}<small>${esc(e.code || '')} · ${esc(e.department)} · ${fdate(e.expense_date)}</small></div><strong>${peso(e.amount)}</strong></li>`).join('')
      : '<li><div class="empty-msg">No expenses recorded yet.</div></li>';

    const alerts = [];
    if (waiting.length) alerts.push(`${waiting.length} purchase request${waiting.length > 1 ? 's' : ''} need${waiting.length > 1 ? '' : 's'} your budget approval.`);
    if (!cur.length) alerts.push('No budget has been set for the current period.');
    cur.forEach(b => { const p = pct(used(b), num(b.amount)); if (p >= 90) alerts.push(`${b.department} has used ${p}% of its budget.`); });
    S.pos.filter(p => p.po_status === 'Delayed').forEach(p => alerts.push(`${p.po_code} (${p.supplier || 'supplier'}) is delayed.`));
    S.pos.filter(p => p.po_status === 'Received' && num(p.recorded_expenses) === 0).slice(0, 3)
      .forEach(p => alerts.push(`${p.po_code} was received (${peso(p.total)}). No expense recorded for it yet.`));
    if (unpaid.length) alerts.push(`${unpaid.length} unpaid expense${unpaid.length > 1 ? 's' : ''} totalling ${peso(unpaidSum)}.`);
    $('#dash-alerts').innerHTML = alerts.length ? alerts.slice(0, 6).map(a => `<li><div>${esc(a)}</div></li>`).join('')
      : '<li><div class="empty-msg">Nothing needs attention.</div></li>';
  }

  /* ---------- budget approvals page ---------- */
  function renderApprovals() {
    const all = S.prq;
    const waiting = pendingApprovals();
    const month = monthKey(todayIso());
    const decidedMonth = s => all.filter(x => x.status !== 'Pending' && x.finance_at && monthKey(x.finance_at) === month && (s ? x.finance_status === s : true));
    $('#appr-metrics').innerHTML =
      metric('Waiting for Approval', String(waiting.length), 'Procurement is waiting for these') +
      metric('Estimated Cost Waiting', pesoWhole(waiting.reduce((a, x) => a + num(x.est_cost), 0)), 'Total of waiting requests') +
      metric('Approved This Month', String(decidedMonth('Approved').length), 'Budget approved') +
      metric('Rejected This Month', String(decidedMonth('Rejected').length), 'Returned with a reason');

    const badgeEl = $('#nav-appr');
    if (badgeEl) { badgeEl.textContent = waiting.length; badgeEl.hidden = waiting.length === 0; }

    const f = $('#appr-filter').value, q = $('#appr-q').value.trim().toLowerCase();
    const list = all.filter(x => (!f || x.status === f || (f === 'Approved' && x.status === 'Ordered')) &&
      (!q || [x.code, x.item, x.department, x.requisition_ref].join(' ').toLowerCase().includes(q)));
    $('#appr-body').innerHTML = list.length ? list.map(x => {
      const b = budgetFor(x.department);
      const left = b ? num(b.amount) - used(b) : null;
      const over = left != null && num(x.est_cost) > left;
      const leftCell = left == null ? '<span class="mut">No budget set</span>'
        : `<span class="${over ? 'negative' : ''}">${peso(left)}</span>${over ? '<div class="secondary-cell">Cost is above budget</div>' : ''}`;
      return `<tr>
        <td class="primary-cell">${esc(x.code)}<div class="secondary-cell">${fdate(x.created_at)}</div></td>
        <td>${esc(x.item)}${x.supplier ? `<div class="secondary-cell">${esc(x.supplier)}</div>` : ''}</td>
        <td>${num(x.qty)}</td><td>${esc(x.department)}</td>
        <td>${esc(x.requisition_ref || 'Restock')}</td>
        <td class="amount">${peso(x.est_cost)}</td><td class="amount">${leftCell}</td>
        <td>${prBadge(x.status)}${x.finance_remarks ? `<div class="secondary-cell">${esc(x.finance_remarks)}</div>` : ''}</td>
        <td><div class="row-actions">${x.status === 'Pending'
          ? `<button type="button" class="mini approve" data-act="review-pr" data-id="${x.id}">Review</button>`
          : `<button type="button" class="mini" data-act="view-pr" data-id="${x.id}">View</button>`}</div></td></tr>`;
    }).join('') : `<tr><td colspan="9" class="empty-msg">${all.length ? 'No requests match your filters.' : 'No purchase requests have reached Finance yet.'}</td></tr>`;
  }

  function approvalModal(x) {
    const pending = x.status === 'Pending';
    const b = budgetFor(x.department);
    const cost = num(x.est_cost);
    let budgetHtml;
    if (!b) {
      budgetHtml = `<div class="budget-box"><b>${esc(x.department)}</b> has no budget covering today. Set one in Budget Monitoring first, or approve knowing it is unbudgeted.</div>`;
    } else {
      const left = num(b.amount) - used(b), after = left - cost;
      budgetHtml = `<div class="budget-box"><b>${esc(x.department)} budget</b> (${fdate(b.period_start)} – ${fdate(b.period_end)})<br>
        Allocated ${peso(b.amount)} · Used ${peso(used(b))} · Remaining ${peso(left)}<br>
        After this purchase: <span class="${after < 0 ? 'over' : ''}">${peso(after)}</span>${after < 0 ? ' (over budget)' : ''}</div>`;
    }
    const m = openModal(`
      <h2>${pending ? 'Budget approval' : 'Purchase request'} · ${esc(x.code)}</h2>
      <div class="row"><span class="mut">Item</span><b>${esc(x.item)}</b></div>
      <div class="row"><span class="mut">Quantity</span><span>${num(x.qty)}</span></div>
      <div class="row"><span class="mut">Estimated cost</span><b>${peso(cost)}</b></div>
      <div class="row"><span class="mut">Department</span><span>${esc(x.department)}</span></div>
      <div class="row"><span class="mut">For</span><span>${esc(x.requisition_ref ? 'Requisition ' + x.requisition_ref : 'Inventory restock')}</span></div>
      ${x.supplier ? `<div class="row"><span class="mut">Supplier</span><span>${esc(x.supplier)}</span></div>` : ''}
      ${cost <= 0 ? '<div class="hint">There is no cost estimate. The product may have no unit cost in Inventory.</div>' : ''}
      ${pending ? budgetHtml : `<div class="row"><span class="mut">Decision</span>${prBadge(x.status)}</div>
        <div class="row"><span class="mut">Remarks</span><span>${esc(x.finance_remarks || '–')}</span></div>`}
      ${pending ? `<label for="a-rem">Remarks (required when rejecting, at least 5 characters)</label>
        <textarea id="a-rem" rows="3" placeholder="Add remarks"></textarea>` : ''}
      <div class="acts" style="margin-top:18px">
        <button type="button" class="button button-light" data-x>Close</button>
        ${pending ? '<button type="button" class="button" id="a-rej" style="background:#d33a2c;color:#fff;border-color:#d33a2c">Reject</button><button type="button" class="button button-dark" id="a-ok">Approve budget</button>' : ''}
      </div>`);
    $('[data-x]', m).onclick = closeModal;
    if (!pending) return;
    const run = async (decision, ev) => {
      const rem = $('#a-rem', m).value.trim();
      if (decision === 'Rejected' && rem.length < 5) return toast('Enter a rejection reason (at least 5 characters).');
      m.querySelectorAll('button').forEach(bt => { bt.disabled = true; });
      const { error } = await sb.rpc('rw_finance_decide', { p_pr_id: x.id, p_decision: decision, p_remarks: rem });
      if (error) { m.querySelectorAll('button').forEach(bt => { bt.disabled = false; }); return toast(friendly(error)); }
      afterSave(`${x.code} ${decision.toLowerCase()}.`);
    };
    $('#a-ok', m).onclick = ev => run('Approved', ev);
    $('#a-rej', m).onclick = ev => run('Rejected', ev);
  }

  /* ---------- budget page ---------- */
  function renderBudget() {
    const cur = S.budgets.filter(isCurrent);
    const budget = cur.reduce((a, b) => a + num(b.amount), 0);
    const usedAmt = cur.reduce((a, b) => a + used(b), 0);
    $('#bud-metrics').innerHTML =
      metric('Total Allocated', pesoWhole(budget), cur.length ? 'Budgets covering today' : 'No active budget') +
      metric('Budget Used', pesoWhole(usedAmt), 'Expenses + open purchase orders') +
      metric('Remaining', pesoWhole(budget - usedAmt), budget ? `${Math.max(0, 100 - pct(usedAmt, budget))}% left` : '–') +
      metric('Utilization', budget ? pct(usedAmt, budget) + '%' : '–', 'Overall, active budgets');

    $('#bud-body').innerHTML = S.budgets.length
      ? S.budgets.map(b => {
          const u = used(b), p = pct(u, num(b.amount)), rem = num(b.amount) - u;
          return `<tr>
            <td class="primary-cell">${esc(b.department)}${isCurrent(b) ? '<span class="now-tag">current</span>' : ''}${b.notes ? `<div class="secondary-cell">${esc(b.notes)}</div>` : ''}</td>
            <td>${fdate(b.period_start)} – ${fdate(b.period_end)}</td>
            <td class="amount">${peso(b.amount)}</td><td class="amount">${peso(b.expenses_total)}</td><td class="amount">${peso(b.po_committed)}</td>
            <td class="amount${rem < 0 ? ' negative' : ''}">${peso(rem)}</td>
            <td><div class="bar ${barCls(p)}"><span style="width:${Math.min(100, p)}%"></span></div><div class="secondary-cell">${p}%${p >= 90 ? ' · near limit' : ''}</div></td>
            <td><div class="row-actions"><button type="button" class="mini" data-act="edit-budget" data-id="${b.id}">Edit</button><button type="button" class="mini reject" data-act="del-budget" data-id="${b.id}">Delete</button></div></td></tr>`;
        }).join('')
      : '<tr><td colspan="8" class="empty-msg">No budgets yet. Press “Set budget” to allocate an amount to a department for a period.</td></tr>';
  }

  /* ---------- modal helpers ---------- */
  function closeModal() { const m = $('#f-modal'); if (m) m.remove(); }
  function openModal(html) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'modal'; m.id = 'f-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="card">${html}</div>`;
    m.addEventListener('mousedown', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  const deptOptions = sel => DEPTS.map(d => `<option${d === sel ? ' selected' : ''}>${esc(d)}</option>`).join('');
  async function afterSave(msg) { closeModal(); await load(); renderAll(); toast(msg); }
  const friendly = err => /row-level security|permission denied/i.test(err.message)
    ? 'You do not have permission to do this.' : err.message;

  function budgetModal(b) {
    const d = new Date();
    const v = b || { department: 'Marketing', period_start: isoOf(new Date(d.getFullYear(), d.getMonth(), 1)),
                     period_end: isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)), amount: '', notes: '' };
    const m = openModal(`
      <h2>${b ? 'Edit budget' : 'Set budget'}</h2>
      <label for="b-dept">Department</label>
      <select id="b-dept">${deptOptions(v.department)}</select>
      <div class="two">
        <div><label for="b-start">Period start</label><input id="b-start" type="date" value="${esc(v.period_start)}"></div>
        <div><label for="b-end">Period end</label><input id="b-end" type="date" value="${esc(v.period_end)}"></div>
      </div>
      <label for="b-amount">Allocated amount (₱)</label>
      <input id="b-amount" type="number" min="0" step="0.01" value="${esc(v.amount)}" placeholder="0.00">
      <label for="b-notes">Notes (optional)</label>
      <input id="b-notes" value="${esc(v.notes)}" maxlength="120">
      <div class="acts" style="margin-top:18px">
        <button type="button" class="button button-light" data-x>Cancel</button>
        <button type="button" class="button button-dark" id="b-save">Save budget</button>
      </div>`);
    $('[data-x]', m).onclick = closeModal;
    $('#b-save', m).onclick = async ev => {
      const row = { department: $('#b-dept', m).value, period_start: $('#b-start', m).value, period_end: $('#b-end', m).value,
                    amount: Number($('#b-amount', m).value), notes: $('#b-notes', m).value.trim() };
      if (!row.period_start || !row.period_end) return toast('Choose the period start and end dates.');
      if (row.period_end < row.period_start) return toast('The period end cannot be before the start.');
      if (!(row.amount >= 0) || $('#b-amount', m).value === '') return toast('Enter the allocated amount.');
      ev.target.disabled = true;
      const res = b ? await sb.from('department_budgets').update(row).eq('id', b.id).select()
                    : await sb.from('department_budgets').insert(row).select();
      if (res.error || !res.data || !res.data.length) {
        ev.target.disabled = false;
        return toast(res.error ? (res.error.code === '23505' ? 'That department already has a budget for exactly this period.' : friendly(res.error)) : 'You do not have permission to save budgets.');
      }
      afterSave(b ? 'Budget updated.' : 'Budget saved.');
    };
    $('#b-amount', m).focus();
  }

  async function deleteBudget(id) {
    const b = S.budgets.find(x => String(x.id) === String(id));
    if (!b || !confirm(`Delete the ${b.department} budget for ${fdate(b.period_start)} – ${fdate(b.period_end)}? Recorded expenses are not affected.`)) return;
    const { data, error } = await sb.from('department_budgets').delete().eq('id', b.id).select();
    if (error || !data || !data.length) return toast(error ? friendly(error) : 'You do not have permission to delete budgets.');
    afterSave('Budget deleted.');
  }

  /* ---------- expenses page ---------- */
  function fillExpenseFilters() {
    const cats = [...new Set([...CATEGORIES, ...S.expenses.map(e => e.category)])].sort();
    const keep = { cat: $('#exp-cat').value, dept: $('#exp-dept').value };
    $('#exp-cat').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
    $('#exp-dept').innerHTML = '<option value="">All departments</option>' + DEPTS.map(c => `<option>${esc(c)}</option>`).join('');
    $('#exp-cat').value = keep.cat; $('#exp-dept').value = keep.dept;
  }

  function renderExpenses() {
    const thisMonth = monthKey(todayIso());
    const month = S.expenses.filter(e => monthKey(e.expense_date) === thisMonth);
    const byCat = {};
    month.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + num(e.amount); });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    const unpaid = S.expenses.filter(e => e.payment_status === 'Unpaid');
    $('#exp-metrics').innerHTML =
      metric('This Month', pesoWhole(month.reduce((a, e) => a + num(e.amount), 0)), monthLabel(thisMonth)) +
      metric('Largest Category', top ? pesoWhole(top[1]) : '–', top ? top[0] : 'No expenses this month') +
      metric('Unpaid Expenses', String(unpaid.length), 'Awaiting payment') +
      metric('Unpaid Amount', pesoWhole(unpaid.reduce((a, e) => a + num(e.amount), 0)), 'To be paid');

    const q = $('#exp-q').value.trim().toLowerCase(), cat = $('#exp-cat').value, dept = $('#exp-dept').value, pay = $('#exp-pay').value;
    const poCode = id => { const p = S.pos.find(x => x.po_id === id); return p ? p.po_code : ''; };
    const list = S.expenses.filter(e => (!cat || e.category === cat) && (!dept || e.department === dept) && (!pay || e.payment_status === pay) &&
      (!q || [e.code, e.description, e.category, e.department, poCode(e.purchase_order_id)].join(' ').toLowerCase().includes(q)));
    $('#exp-body').innerHTML = list.length
      ? list.map(e => `<tr>
          <td class="primary-cell">${esc(e.code || '')}</td><td>${fdate(e.expense_date)}</td><td>${esc(e.department)}</td><td>${esc(e.category)}</td>
          <td>${esc(e.description)}</td><td>${esc(poCode(e.purchase_order_id) || '–')}</td><td class="amount">${peso(e.amount)}</td>
          <td><span class="status ${e.payment_status === 'Paid' ? 'approved' : 'pending'}">${esc(e.payment_status)}</span></td>
          <td><div class="row-actions">
            <button type="button" class="mini" data-act="toggle-paid" data-id="${e.id}">${e.payment_status === 'Paid' ? 'Mark unpaid' : 'Mark paid'}</button>
            <button type="button" class="mini reject" data-act="del-expense" data-id="${e.id}">Delete</button></div></td></tr>`).join('')
      : `<tr><td colspan="9" class="empty-msg">${S.expenses.length ? 'No expenses match your filters.' : 'No expenses recorded yet. Press “Add expense”.'}</td></tr>`;
  }

  function expenseModal() {
    const pos = S.pos.filter(p => p.po_status !== 'Cancelled');
    const m = openModal(`
      <h2>Add expense</h2>
      <label for="x-po">Linked purchase order (optional)</label>
      <select id="x-po"><option value="">None – general expense</option>${pos.map(p =>
        `<option value="${p.po_id}">${esc(p.po_code)} · ${esc(p.supplier || '–')} · ${esc(p.item)} · ${peso(p.total)}</option>`).join('')}</select>
      <div class="two">
        <div><label for="x-dept">Department</label><select id="x-dept">${deptOptions('Procurement')}</select></div>
        <div><label for="x-cat">Category</label><select id="x-cat">${CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      </div>
      <label for="x-desc">Description</label>
      <input id="x-desc" maxlength="140" placeholder="What was this expense for?">
      <div class="two">
        <div><label for="x-amount">Amount (₱)</label><input id="x-amount" type="number" min="0" step="0.01" placeholder="0.00"></div>
        <div><label for="x-date">Date</label><input id="x-date" type="date" value="${todayIso()}" max="${todayIso()}"></div>
      </div>
      <label for="x-pay">Payment status</label>
      <select id="x-pay"><option>Unpaid</option><option>Paid</option></select>
      <div class="acts" style="margin-top:18px">
        <button type="button" class="button button-light" data-x>Cancel</button>
        <button type="button" class="button button-dark" id="x-save">Save expense</button>
      </div>`);
    $('[data-x]', m).onclick = closeModal;

    $('#x-po', m).addEventListener('change', () => {
      const p = pos.find(x => String(x.po_id) === $('#x-po', m).value);
      if (!p) return;
      $('#x-dept', m).value = DEPTS.includes(p.department) ? p.department : 'Procurement';
      $('#x-cat', m).value = 'Supplier Payment';
      if (!$('#x-desc', m).value.trim()) $('#x-desc', m).value = `${p.item} (${p.po_code})`;
      const balance = num(p.total) - num(p.recorded_expenses);
      $('#x-amount', m).value = (balance > 0 ? balance : num(p.total)).toFixed(2);
    });

    $('#x-save', m).onclick = async ev => {
      const po = pos.find(x => String(x.po_id) === $('#x-po', m).value);
      const row = { department: $('#x-dept', m).value, category: $('#x-cat', m).value, description: $('#x-desc', m).value.trim(),
                    amount: Number($('#x-amount', m).value), expense_date: $('#x-date', m).value,
                    payment_status: $('#x-pay', m).value, purchase_order_id: po ? po.po_id : null };
      if (row.description.length < 2) return toast('Describe the expense.');
      if (!(row.amount > 0)) return toast('Enter an amount greater than zero.');
      if (!row.expense_date) return toast('Choose the expense date.');
      if (po && num(po.recorded_expenses) + row.amount > num(po.total) + 0.005 &&
          !confirm(`${po.po_code} total is ${peso(po.total)} and ${peso(po.recorded_expenses)} is already recorded. Save this ${peso(row.amount)} anyway?`)) return;
      ev.target.disabled = true;
      const { data, error } = await sb.from('expenses').insert(row).select();
      if (error || !data || !data.length) { ev.target.disabled = false; return toast(error ? friendly(error) : 'You do not have permission to add expenses.'); }
      afterSave(`${data[0].code || 'Expense'} saved.`);
    };
    $('#x-desc', m).focus();
  }

  async function togglePaid(id) {
    const e = S.expenses.find(x => String(x.id) === String(id));
    if (!e) return;
    const { data, error } = await sb.from('expenses').update({ payment_status: e.payment_status === 'Paid' ? 'Unpaid' : 'Paid' }).eq('id', e.id).select();
    if (error || !data || !data.length) return toast(error ? friendly(error) : 'You do not have permission to change expenses.');
    afterSave(`${e.code} marked ${data[0].payment_status.toLowerCase()}.`);
  }

  async function deleteExpense(id) {
    const e = S.expenses.find(x => String(x.id) === String(id));
    if (!e || !confirm(`Delete ${e.code} (${peso(e.amount)}, ${e.description})? This cannot be undone.`)) return;
    const { data, error } = await sb.from('expenses').delete().eq('id', e.id).select();
    if (error || !data || !data.length) return toast(error ? friendly(error) : 'You do not have permission to delete expenses.');
    afterSave(`${e.code} deleted.`);
  }

  /* ---------- purchasing costs page (read-only) ---------- */
  function renderPurchasing() {
    const open = S.pos.filter(p => ['Sent', 'Confirmed', 'Delayed'].includes(p.po_status));
    const received = S.pos.filter(p => p.po_status === 'Received');
    $('#pur-metrics').innerHTML =
      metric('Purchase Requests', String(S.prs.length), `${pendingApprovals().length} awaiting your approval`) +
      metric('Purchase Orders', String(S.pos.length), `${S.pos.filter(p => p.po_status === 'Cancelled').length} cancelled`) +
      metric('Open Order Value', pesoWhole(open.reduce((a, p) => a + num(p.total), 0)), `${open.length} not yet received`) +
      metric('Received Order Value', pesoWhole(received.reduce((a, p) => a + num(p.total), 0)), `${received.length} received`);

    $('#po-body').innerHTML = S.pos.length
      ? S.pos.map(p => {
          const bal = num(p.total) - num(p.recorded_expenses);
          return `<tr><td class="primary-cell">${esc(p.po_code)}</td><td>${fdate(p.order_date)}</td><td>${esc(p.supplier || '–')}</td><td>${esc(p.item)}</td>
            <td>${esc(p.department)}</td><td>${esc(p.requisition_ref || 'Restock')}</td><td>${num(p.qty)} / ${num(p.accepted_qty)}</td>
            <td class="amount">${peso(p.total)}</td>
            <td class="amount">${peso(p.recorded_expenses)}${p.po_status !== 'Cancelled' && bal > 0.005 ? `<div class="secondary-cell">${peso(bal)} left</div>` : ''}</td>
            <td>${badge(PO_CLS, p.po_status)}</td></tr>`;
        }).join('')
      : '<tr><td colspan="10" class="empty-msg">No purchase orders yet.</td></tr>';

    $('#pr-body').innerHTML = S.prs.length
      ? S.prs.map(p => `<tr><td class="primary-cell">${esc(p.code)}</td><td>${esc(p.item)}</td><td>${num(p.qty)}</td>
          <td>${esc(forLabel(p) || 'Restock')}</td><td class="amount">${peso(p.est_cost)}</td><td>${prBadge(p.status)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty-msg">No purchase requests yet.</td></tr>';
  }

  /* ---------- reports ---------- */
  let lastReport = null;
  const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

  function buildReport(type) {
    const from = $('#rep-from').value, to = $('#rep-to').value;
    if (from && to && to < from) { toast('The end date is before the start date.'); return null; }

    if (type === 'monthly') {
      const list = S.expenses.filter(e => inRange(e.expense_date, from, to));
      const cats = [...new Set(list.map(e => e.category))].sort();
      const months = [...new Set(list.map(e => monthKey(e.expense_date)))].sort().reverse();
      const rows = months.map(m => {
        const cells = cats.map(c => list.filter(e => monthKey(e.expense_date) === m && e.category === c).reduce((a, e) => a + num(e.amount), 0));
        return [monthLabel(m), ...cells, cells.reduce((a, b) => a + b, 0)];
      });
      if (rows.length) rows.push(['Total', ...cats.map((c, i) => rows.reduce((a, r) => a + r[i + 1], 0)), rows.reduce((a, r) => a + r[r.length - 1], 0)]);
      return { head: ['Month', ...cats, 'Total'], rows, money: cats.map((c, i) => i + 1).concat(cats.length + 1),
               note: 'Recorded expenses only. Purchase orders appear here once an expense is recorded against them.', file: 'monthly-expenses' };
    }

    if (type === 'budget') {
      const list = S.budgets.filter(b => (!from || b.period_end >= from) && (!to || b.period_start <= to));
      return { head: ['Department', 'Period', 'Allocated', 'Expenses', 'PO committed', 'Remaining', 'Used'],
               rows: list.map(b => [b.department, `${fdate(b.period_start)} – ${fdate(b.period_end)}`, num(b.amount), num(b.expenses_total),
                                    num(b.po_committed), num(b.amount) - used(b), pct(used(b), num(b.amount)) + '%']),
               money: [2, 3, 4, 5], note: 'Used = recorded expenses + purchase orders with no expense recorded yet.', file: 'department-budgets' };
    }

    const list = S.pos.filter(p => p.po_status !== 'Cancelled' && inRange(p.order_date, from, to));
    const g = {};
    list.forEach(p => {
      const k = p.supplier || 'Unknown supplier';
      const x = g[k] || (g[k] = { n: 0, total: 0, received: 0, open: 0, recorded: 0 });
      x.n++; x.total += num(p.total); x.recorded += num(p.recorded_expenses);
      if (p.po_status === 'Received') x.received += num(p.total); else x.open += num(p.total);
    });
    return { head: ['Supplier', 'Orders', 'Total ordered', 'Received', 'Open', 'Expenses recorded'],
             rows: Object.entries(g).sort((a, b) => b[1].total - a[1].total).map(([k, x]) => [k, x.n, x.total, x.received, x.open, x.recorded]),
             money: [2, 3, 4, 5], note: 'Cancelled orders are excluded.', file: 'supplier-purchases' };
  }

  function runReport() {
    const r = buildReport($('#rep-type').value);
    if (!r) return;
    lastReport = r;
    $('#rep-head').innerHTML = `<tr>${r.head.map((h, i) => `<th${r.money.includes(i) ? ' class="amount"' : ''}>${esc(h.toUpperCase())}</th>`).join('')}</tr>`;
    $('#rep-body').innerHTML = r.rows.length
      ? r.rows.map(row => `<tr>${row.map((c, i) => r.money.includes(i)
          ? `<td class="amount${row[0] === 'Total' ? ' primary-cell' : ''}">${peso(c)}</td>`
          : `<td${i === 0 ? ' class="primary-cell"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${r.head.length}" class="empty-msg">No records for this report and date range.</td></tr>`;
    $('#rep-note').textContent = r.note;
  }

  function exportCsv() {
    if (!lastReport || !lastReport.rows.length) return toast('Generate a report with data first.');
    const q = c => '"' + String(c ?? '').replace(/"/g, '""') + '"';
    const text = [lastReport.head, ...lastReport.rows].map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `pynx-finance-${lastReport.file}-${todayIso()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- wiring ---------- */
  function renderAll() { renderDashboard(); renderApprovals(); renderBudget(); fillExpenseFilters(); renderExpenses(); renderPurchasing(); if (lastReport) runReport(); }

  $('#bud-add').addEventListener('click', () => budgetModal(null));
  $('#exp-add').addEventListener('click', expenseModal);
  ['#exp-q'].forEach(s => $(s).addEventListener('input', renderExpenses));
  ['#exp-cat', '#exp-dept', '#exp-pay'].forEach(s => $(s).addEventListener('change', renderExpenses));
  $('#appr-q').addEventListener('input', renderApprovals);
  $('#appr-filter').addEventListener('change', renderApprovals);
  $('#rep-run').addEventListener('click', runReport);
  $('#rep-type').addEventListener('change', runReport);
  $('#rep-csv').addEventListener('click', exportCsv);
  $('#rep-print').addEventListener('click', () => window.print());

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'set-budget') budgetModal(null);
    if (b.dataset.act === 'edit-budget') budgetModal(S.budgets.find(x => String(x.id) === id));
    if (b.dataset.act === 'del-budget') deleteBudget(id);
    if (b.dataset.act === 'toggle-paid') togglePaid(id);
    if (b.dataset.act === 'del-expense') deleteExpense(id);
    if (b.dataset.act === 'review-pr' || b.dataset.act === 'view-pr') {
      const x = S.prq.find(r => String(r.id) === id);
      if (x) approvalModal(x);
    }
  });

  await load();
  renderAll();
  runReport();

  /* New shortages arrive from Inventory without a page refresh: check every 30 seconds */
  setInterval(async () => {
    if (document.hidden || $('#f-modal') || document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    try { await load(); renderAll(); } catch (err) { console.warn(err); }
  }, POLL_MS);
})();