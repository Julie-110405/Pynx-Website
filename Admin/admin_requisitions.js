// Admin/admin_requisitions.js  -  PHYNX ERP Admin: live Requisition Management (Stage 2)
// Uses the existing global client (window.supabaseClient). No keys here.
// The auth check below is only for navigation; the database enforces who may approve.
(async function () {
  const sb = window.supabaseClient;
  const LOGIN = '../Log_in/login.html';
  if (!sb) { console.error('supabaseClient not found: load your connection file first.'); return; }

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH',
    { month: 'short', day: 'numeric', year: 'numeric' }) : '–';
  const num = n => Number(n).toLocaleString('en-PH', { maximumFractionDigits: 3 });
  const STAGES = {
    'Admin Review':         ['Pending Approval', 'pending'],
    'Rejected':             ['Rejected', 'rejected'],
    'Inventory Validation': ['Inventory Validation', 'received'],
    'Partially Released':   ['Partially Released', 'inspection'],
    'Released':             ['Released', 'approved'],
    'Awaiting Procurement': ['Forwarded to Purchasing', 'received'],
    'Completed':            ['Completed', 'approved']
  };
  const stageBadge = s => { const [l, c] = STAGES[s] || [s, '']; return `<span class="status ${c}">${esc(l)}</span>`; };
  const itemsText = r => (r.items || []).map(i => `${i.name}, ${num(i.qty)} ${i.unit}`).join('; ') || '–';

  function toast(message) {
    document.querySelectorAll('.rw-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'rw-toast'; t.setAttribute('role', 'status'); t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  async function logout() {
    try { await sb.auth.signOut(); } catch (e) { console.warn(e); }
    location.href = LOGIN;
  }
  const logoutLink = $('#logout-link');
  if (logoutLink) logoutLink.addEventListener('click', e => { e.preventDefault(); logout(); });

  // ---------- Auth gate ----------
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = LOGIN; return; }
  const { data: me } = await sb.from('profiles').select('username, department')
    .eq('id', session.user.id).single();
  if (!me || String(me.department).toLowerCase() !== 'admin') {
    alert('This page is for Admin accounts only.'); location.href = LOGIN; return;
  }
  const nameEl = $('.staff span'), avEl = $('.avatar');
  if (nameEl) nameEl.textContent = me.username;
  if (avEl) avEl.textContent = me.username.charAt(0).toUpperCase();
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.href = LOGIN; });

  // ---------- Elements (found by structure, so no HTML ids are required) ----------
  const sec = $('#requisitions');
  const tbody = $('tbody', sec);
  const search = $('.toolbar input[type=search]', sec);
  const [deptSel, statusSel] = sec.querySelectorAll('.toolbar select');
  const reqMetrics = sec.querySelectorAll('.metrics .metric-value');
  const dashVals = document.querySelectorAll('#dashboard .metrics .metric-value');
  const dashFoots = document.querySelectorAll('#dashboard .metrics .metric-foot');
  const dashBody = $('#dashboard .content-grid .panel tbody');

  // Refresh button next to "Export list"
  const actions = $('.actions', sec);
  if (actions) {
    const rb = document.createElement('button');
    rb.type = 'button'; rb.className = 'button button-light'; rb.id = 'rw-refresh'; rb.textContent = 'Refresh';
    actions.prepend(rb);
    rb.addEventListener('click', () => load());
  }

  // Dashboard counters that are connected in a later stage: hide the old sample numbers
  [2, 3].forEach(i => {
    if (dashVals[i]) dashVals[i].textContent = '–';
    if (dashFoots[i]) dashFoots[i].textContent = 'Not connected yet';
  });

  let rows = [];
  let loading = false;

  // ---------- Loading / error states ----------
  function showLoading() {
    reqMetrics.forEach(m => { m.textContent = '…'; });
    [0, 1].forEach(i => { if (dashVals[i]) dashVals[i].textContent = '…'; });
    tbody.innerHTML = '<tr><td colspan="6" class="loading-msg">Loading requisitions…</td></tr>';
    if (dashBody) dashBody.innerHTML = '<tr><td colspan="5" class="loading-msg">Loading…</td></tr>';
  }
  function showError(msg) {
    reqMetrics.forEach(m => { m.textContent = '–'; });
    [0, 1].forEach(i => { if (dashVals[i]) dashVals[i].textContent = '–'; });
    const html = (cols) => `<tr><td colspan="${cols}" class="error-msg">Could not load requisitions: ${esc(msg)}
      <button type="button" class="mini" data-retry>Try again</button></td></tr>`;
    tbody.innerHTML = html(6);
    if (dashBody) dashBody.innerHTML = html(5);
  }

  // ---------- Data ----------
  async function load(silent) {
    if (loading) return;
    loading = true;
    if (!silent) showLoading();
    const { data, error } = await sb.from('v_admin_requisitions').select('*')
      .order('submitted_at', { ascending: false });
    loading = false;
    if (error) {
      console.error(error);
      if (!silent) showError(error.message);
      return;
    }
    rows = data || [];
    fillFilters(); render(); renderDashboard();
  }

  function fillFilters() {
    const d = deptSel.value, s = statusSel.value;
    const depts = [...new Set(rows.map(r => r.department))].sort();
    deptSel.innerHTML = '<option value="">All departments</option>' +
      depts.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    statusSel.innerHTML = '<option value="">All statuses</option>' +
      Object.entries(STAGES).map(([k, [l]]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
    deptSel.value = d; statusSel.value = s;
  }

  // ---------- Requisition Management page ----------
  function rowHtml(r) {
    const pending = r.workflow_stage === 'Admin Review';
    return `<tr>
      <td class="primary-cell">${esc(r.reference)}</td><td>${esc(r.department)}</td>
      <td>${esc(itemsText(r))}</td><td>${fmtDate(r.submitted_at)}</td><td>${stageBadge(r.workflow_stage)}</td>
      <td><div class="row-actions">
        <button class="mini" data-act="view" data-id="${r.workflow_id}">View</button>
        ${pending ? `<button class="mini approve" data-act="approve" data-id="${r.workflow_id}">Approve</button>
                     <button class="mini reject" data-act="reject" data-id="${r.workflow_id}">Reject</button>` : ''}
      </div></td></tr>`;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = rows.filter(r =>
      (!deptSel.value || r.department === deptSel.value) &&
      (!statusSel.value || r.workflow_stage === statusSel.value) &&
      (!q || [r.reference, r.department, r.title, itemsText(r)].join(' ').toLowerCase().includes(q)));
    tbody.innerHTML = list.length ? list.map(rowHtml).join('')
      : `<tr><td colspan="6" class="empty-msg">No requisitions found.</td></tr>`;

    const now = new Date(), sameMonth = d => d && new Date(d).getMonth() === now.getMonth()
      && new Date(d).getFullYear() === now.getFullYear();
    const set = (i, v) => { if (reqMetrics[i]) reqMetrics[i].textContent = v; };
    set(0, rows.filter(r => r.workflow_stage === 'Admin Review').length);
    set(1, rows.filter(r => sameMonth(r.reviewed_at) && r.workflow_stage !== 'Rejected').length);
    set(2, rows.filter(r => r.workflow_stage === 'Rejected').length);
    set(3, rows.filter(r => r.workflow_stage === 'Awaiting Procurement').length);
  }

  [search, deptSel, statusSel].forEach(el => el.addEventListener(el === search ? 'input' : 'change', render));

  // ---------- Dashboard (counters + awaiting-approval table) ----------
  function renderDashboard() {
    const pending = rows.filter(r => r.workflow_stage === 'Admin Review');
    const now = new Date();
    const month = rows.filter(r => { const d = new Date(r.submitted_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
    if (dashVals[0]) dashVals[0].textContent = rows.length;
    if (dashFoots[0]) dashFoots[0].textContent = `${month} submitted this month`;
    if (dashVals[1]) dashVals[1].textContent = pending.length;
    if (dashFoots[1]) dashFoots[1].textContent = 'Waiting for Admin decision';
    if (dashBody) dashBody.innerHTML = pending.length ? pending.slice(0, 5).map(r => `<tr>
      <td class="primary-cell">${esc(r.reference)}</td><td>${esc(r.department)}</td>
      <td>${esc(itemsText(r))}</td><td>${fmtDate(r.submitted_at)}</td><td>${stageBadge(r.workflow_stage)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-msg">No requisitions are waiting for approval.</td></tr>';
  }

  // ---------- Row buttons ----------
  function onTableClick(e) {
    if (e.target.closest('[data-retry]')) { load(); return; }
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const r = rows.find(x => String(x.workflow_id) === b.dataset.id);
    if (r) openModal(r, b.dataset.act);
  }
  tbody.addEventListener('click', onTableClick);
  if (dashBody) dashBody.addEventListener('click', onTableClick);

  // ---------- Details modal ----------
  function closeModal() { const m = $('#rw-modal'); if (m) m.remove(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  async function loadProcurement(r) {
    const box = $('#rw-proc'); if (!box) return;
    if (r.source_table !== 'marketing') { box.textContent = 'Logistics requisitions are not yet linked to Procurement.'; return; }
    const { data, error } = await sb.from('v_requisition_procurement').select('*')
      .eq('requisition_id', r.source_id).order('pr_id');
    if (error) { box.textContent = 'Could not load procurement progress.'; return; }
    box.innerHTML = (data || []).length
      ? `<div class="table-wrap"><table><thead><tr><th>ITEM</th><th>PURCHASE REQUEST</th><th>PURCHASE ORDER</th><th>DELIVERY</th></tr></thead><tbody>` +
        data.map(p => `<tr><td>${esc(p.item)} × ${num(p.pr_qty)}</td>
          <td>${esc(p.pr_code)}<div class="secondary-cell">${esc(p.pr_status)}</div></td>
          <td>${p.po_code ? `${esc(p.po_code)}<div class="secondary-cell">${esc(p.po_status)} · ₱${num(p.po_total)}</div>` : '–'}</td>
          <td>${p.delivery_code ? `${esc(p.delivery_code)}<div class="secondary-cell">${esc(p.delivery_status)}${p.received_date ? ' · ' + fmtDate(p.received_date) : ''}</div>` : '–'}</td></tr>`).join('') +
        '</tbody></table></div>'
      : 'No shortage has been forwarded to Procurement.';
  }

  async function openModal(r, mode) {
    closeModal();
    const pending = r.workflow_stage === 'Admin Review';
    const ov = document.createElement('div');
    ov.id = 'rw-modal';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px';
    ov.innerHTML = `<div class="panel" style="max-width:660px;width:100%;max-height:90vh;overflow:auto;background:#fff;padding:20px">
      <div class="panel-head"><div><h2>${esc(r.reference)} · ${esc(r.department)}</h2>
        <div class="panel-sub">${esc(r.title)} · submitted by ${esc(r.submitted_by_name || '–')} on ${fmtDate(r.submitted_at)}</div></div>
        ${stageBadge(r.workflow_stage)}</div>
      <p><b>Reason:</b> ${esc(r.reason)}</p>
      <p><b>Needed by:</b> ${fmtDate(r.needed_by)}
         ${r.source_table === 'marketing' ? ` · <b>Inventory confirmed:</b> ${r.inventory_confirmed ? 'Yes' : 'Not yet'}` : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>MATERIAL</th><th>SKU</th><th>QTY</th><th>RELEASED</th></tr></thead><tbody>
        ${(r.items || []).map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.sku || '–')}</td>
          <td>${num(i.qty)} ${esc(i.unit)}</td><td>${i.released == null ? '–' : num(i.released)}</td></tr>`).join('')}
      </tbody></table></div>
      <h3 style="margin:16px 0 6px">Approval history</h3><div id="rw-timeline">Loading…</div>
      <h3 style="margin:16px 0 6px">Procurement progress</h3><div id="rw-proc">Loading…</div>
      ${pending ? `<h3 style="margin:16px 0 6px">Decision</h3>
        <textarea id="rw-remarks" rows="3" style="width:100%" aria-label="Remarks" placeholder="Remarks (required when rejecting)"></textarea>
        <div id="rw-msg" class="error-msg" style="min-height:20px;margin-top:6px"></div>` : ''}
      <div class="row-actions" style="margin-top:12px">
        ${pending ? `<button class="mini approve" id="rw-approve">Approve</button><button class="mini reject" id="rw-reject">Reject</button>` : ''}
        <button class="mini" id="rw-close">Close</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    $('#rw-close').onclick = closeModal;

    if (pending) {
      $('#rw-approve').onclick = () => decide(r, 'Approved');
      $('#rw-reject').onclick = () => decide(r, 'Rejected');
      if (mode === 'reject') $('#rw-remarks').focus();
    }

    loadProcurement(r);
    const { data, error } = await sb.rpc('rw_requisition_timeline', { p_workflow_id: r.workflow_id });
    const box = $('#rw-timeline'); if (!box) return;
    if (error) { box.textContent = 'Could not load history.'; return; }
    const ap = data.approvals || [], hi = data.history || [];
    box.innerHTML = (ap.length ? ap.map(a => `<div><b>${esc(a.decision)}</b> by ${esc(a.by)} · ${fmtDate(a.at)}
        ${a.remarks ? `<div class="secondary-cell">“${esc(a.remarks)}”</div>` : ''}</div>`).join('') : '<div>No decision yet.</div>')
      + (hi.length ? `<div class="secondary-cell" style="margin-top:8px">` + hi.map(h =>
        `${esc(h.from || 'New')} → ${esc(h.to)} (${fmtDate(h.at)})`).join('<br>') + '</div>' : '');
  }

  let deciding = false;
  async function decide(r, decision) {
    if (deciding) return;
    const remarks = ($('#rw-remarks').value || '').trim(), msg = $('#rw-msg');
    if (decision === 'Rejected' && remarks.length < 5) { msg.textContent = 'Enter a rejection reason (at least 5 characters).'; return; }
    deciding = true;
    const btns = document.querySelectorAll('#rw-modal button'); btns.forEach(b => b.disabled = true);
    const { error } = await sb.rpc('rw_admin_decide', {
      p_source: r.source_table, p_source_id: r.source_id, p_decision: decision, p_remarks: remarks });
    deciding = false;
    if (error) { msg.textContent = error.message; btns.forEach(b => b.disabled = false); return; }
    closeModal();
    toast(`${r.reference} ${decision.toLowerCase()}.`);
    await load(true);
  }

  // ---------- Start, then refresh every 60 seconds ----------
  await load();
  setInterval(() => {
    if (!document.hidden && !$('#rw-modal') && !deciding) load(true);
  }, 60000);
})();