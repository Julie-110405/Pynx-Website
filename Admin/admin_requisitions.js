// Admin/admin_requisitions.js  -  PHYNX ERP Admin: live Requisition Management
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
  // Date-only values (YYYY-MM-DD) stay date-only; full timestamps also show the time.
  const fmtStamp = d => {
    if (!d) return '';
    const s = String(d);
    if (s.length === 10) return fmtDate(s + 'T00:00');
    const x = new Date(s);
    if (isNaN(x)) return '';
    return x.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
      x.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  };
  const toTime = d => { if (!d) return NaN; const s = String(d); return new Date(s.length === 10 ? s + 'T00:00' : s).getTime(); };
  const num = n => Number(n).toLocaleString('en-PH', { maximumFractionDigits: 3 });
  const STAGES = {
    'Admin Review':         ['Pending Approval', 'pending'],
    'Rejected':             ['Rejected', 'rejected'],
    'Inventory Validation': ['Approved - with Inventory', 'received'],
    'Partially Released':   ['Partially Released', 'inspection'],
    'Released':             ['Released', 'approved'],
    'Awaiting Procurement': ['Forwarded to Purchasing', 'received'],
    'Completed':            ['Completed', 'approved']
  };
  // Simplified labels used only inside the detail view.
  const PROGRESS = {
    'Admin Review':         ['Pending Approval', 'pill--warn'],
    'Rejected':             ['Rejected', 'pill--bad'],
    'Inventory Validation': ['Approved', 'pill--ok'],
    'Awaiting Procurement': ['Processing', 'pill--proc'],
    'Partially Released':   ['Partially Fulfilled', 'pill--warn'],
    'Released':             ['Completed', 'pill--ok'],
    'Completed':            ['Completed', 'pill--ok']
  };
  // The real requisition status is the authority for "waiting for Admin", so a stale stage can never hide Approve/Reject.
  const stageOf = r => (r.source_status === 'Pending' ? 'Admin Review' : r.workflow_stage);
  const stageBadge = s => { const [l, c] = STAGES[s] || [s, '']; return `<span class="status ${c}">${esc(l)}</span>`; };
  const progressBadge = s => { const [l, c] = PROGRESS[s] || [s, '']; return `<span class="pill ${c}">${esc(l)}</span>`; };
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

  const actions = $('.actions', sec);
  if (actions) {
    const rb = document.createElement('button');
    rb.type = 'button'; rb.className = 'button button-light'; rb.id = 'rw-refresh'; rb.textContent = 'Refresh';
    actions.prepend(rb);
    rb.addEventListener('click', () => load());
  }

  // Dashboard counters 3 and 4 are filled by admin_modules.js; only touch them if it is not loaded.
  [2, 3].forEach(i => {
    if (dashVals[i] && dashVals[i].textContent.trim() === '…') {
      setTimeout(() => {
        if (dashVals[i].textContent.trim() === '…') { dashVals[i].textContent = '–'; if (dashFoots[i]) dashFoots[i].textContent = 'Not available'; }
      }, 8000);
    }
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
    const html = cols => `<tr><td colspan="${cols}" class="error-msg">Could not load requisitions: ${esc(msg)}
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
    const pending = r.source_status === 'Pending';
    return `<tr>
      <td class="primary-cell">${esc(r.reference)}</td><td>${esc(r.department)}</td>
      <td>${esc(itemsText(r))}</td><td>${fmtDate(r.submitted_at)}</td><td>${stageBadge(stageOf(r))}</td>
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
      (!statusSel.value || stageOf(r) === statusSel.value) &&
      (!q || [r.reference, r.department, r.title, itemsText(r)].join(' ').toLowerCase().includes(q)));
    tbody.innerHTML = list.length ? list.map(rowHtml).join('')
      : `<tr><td colspan="6" class="empty-msg">No requisitions found.</td></tr>`;

    const now = new Date(), sameMonth = d => d && new Date(d).getMonth() === now.getMonth()
      && new Date(d).getFullYear() === now.getFullYear();
    const set = (i, v) => { if (reqMetrics[i]) reqMetrics[i].textContent = v; };
    set(0, rows.filter(r => stageOf(r) === 'Admin Review').length);
    set(1, rows.filter(r => sameMonth(r.reviewed_at) && stageOf(r) !== 'Rejected').length);
    set(2, rows.filter(r => stageOf(r) === 'Rejected').length);
    set(3, rows.filter(r => stageOf(r) === 'Awaiting Procurement').length);
  }

  [search, deptSel, statusSel].forEach(el => el.addEventListener(el === search ? 'input' : 'change', render));

  // ---------- Dashboard (counters + awaiting-approval table) ----------
  function renderDashboard() {
    const pending = rows.filter(r => r.source_status === 'Pending');
    const now = new Date();
    const month = rows.filter(r => { const d = new Date(r.submitted_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
    if (dashVals[0]) dashVals[0].textContent = rows.length;
    if (dashFoots[0]) dashFoots[0].textContent = `${month} submitted this month`;
    if (dashVals[1]) dashVals[1].textContent = pending.length;
    if (dashFoots[1]) dashFoots[1].textContent = 'Waiting for Admin decision';
    if (dashBody) dashBody.innerHTML = pending.length ? pending.slice(0, 5).map(r => `<tr>
      <td class="primary-cell">${esc(r.reference)}</td><td>${esc(r.department)}</td>
      <td>${esc(itemsText(r))}</td><td>${fmtDate(r.submitted_at)}</td><td>${stageBadge('Admin Review')}</td></tr>`).join('')
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

  // ==========================================================================
  // Requisition detail (modal)
  // A Request Information · B Requested Items · C Request Progress
  // D Procurement Progress · E Admin Decision
  // Everything shown comes from the database; nothing is invented.
  // ==========================================================================
  function closeModal() {
    const m = $('#rw-modal'); if (m) m.remove();
    document.body.classList.remove('modal-open');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  const section = (letter, title, body, id) =>
    `<section class="rq-sec"><h3 class="rq-sec-title"><span class="rq-letter">${letter}</span>${esc(title)}</h3>
     <div${id ? ` id="${id}"` : ''}>${body}</div></section>`;

  // ----- A. Request information -----
  function infoHtml(r) {
    const f = (label, value, wide) =>
      `<div class="rq-field${wide ? ' rq-wide' : ''}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    return `<dl class="rq-info">
      ${f('Requisition no.', esc(r.reference))}
      ${f('Department', esc(r.department))}
      ${f('Submitted by', esc(r.submitted_by_name || '–'))}
      ${f('Date submitted', fmtDate(r.submitted_at))}
      ${f('Needed by', fmtDate(r.needed_by))}
      ${f('Project / Purpose', esc(r.title || '–'))}
      ${f('Reason for request', esc(r.reason || '–'), true)}
    </dl>`;
  }

  // ----- B. Requested items -----
  function itemsHtml(r) {
    const items = r.items || [];
    if (!items.length) return '<div class="mut">No items on this requisition.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>ITEM NAME</th><th>SKU</th>
      <th class="r">REQUESTED</th><th class="r">RELEASED</th><th class="r">REMAINING</th></tr></thead><tbody>` +
      items.map(i => {
        const req = Number(i.qty) || 0, rel = Number(i.released) || 0, rem = Math.max(0, req - rel);
        return `<tr><td class="primary-cell">${esc(i.name)}</td><td>${esc(i.sku || '–')}</td>
          <td class="r">${num(req)} ${esc(i.unit)}</td><td class="r">${num(rel)} ${esc(i.unit)}</td>
          <td class="r"><b class="${rem > 0 ? 'rq-rem' : 'rq-done'}">${num(rem)} ${esc(i.unit)}</b></td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  // ----- C. Request progress (timeline from real records only) -----
  // History "to" stages mapped to readable events. null = already covered by another event.
  const HISTORY_EVENT = {
    'Admin Review': null,
    'Rejected': 'Admin Rejected',
    'Inventory Validation': 'Inventory Checking',
    'Partially Released': 'Partially Released',
    'Awaiting Procurement': 'Procurement Forwarded',
    'Released': 'Inventory Released',
    'Completed': 'Request Completed'
  };
  const isDelivered = p => !!p.received_date || ['Received', 'Completed'].includes(p.delivery_status);

  function buildEvents(r, tl, proc) {
    const ev = [];
    const ap = (tl && tl.approvals) || [], hi = (tl && tl.history) || [];
    ev.push({ t: r.submitted_at, title: 'Request Submitted',
      sub: r.submitted_by_name ? `by ${r.submitted_by_name} (${r.department})` : r.department, kind: 'info' });
    ap.forEach(a => ev.push({ t: a.at,
      title: a.decision === 'Approved' ? 'Admin Approved' : a.decision === 'Rejected' ? 'Admin Rejected' : `Admin ${a.decision}`,
      sub: a.by ? `by ${a.by}` : '', note: a.remarks,
      kind: a.decision === 'Approved' ? 'ok' : a.decision === 'Rejected' ? 'bad' : 'info' }));
    const hasRejection = ap.some(a => a.decision === 'Rejected');
    hi.forEach(h => {
      const known = Object.prototype.hasOwnProperty.call(HISTORY_EVENT, h.to);
      const title = known ? HISTORY_EVENT[h.to] : h.to;
      if (!title) return;
      if (h.to === 'Rejected' && hasRejection) return;
      ev.push({ t: h.at, title, sub: h.note ? h.note : '',
        kind: h.to === 'Rejected' ? 'bad' : (h.to === 'Completed' || h.to === 'Released') ? 'ok' : 'info' });
    });

    const dated = ev.filter(e => !isNaN(toTime(e.t)));
    const undated = ev.filter(e => isNaN(toTime(e.t)));
    // Delivery received: real received_date. Purchase order: no creation date exists in the data, so it is shown without one.
    const seenDel = new Set(), seenPo = new Set(), poEv = [];
    (proc || []).forEach(p => {
      if (p.po_code && !seenPo.has(p.po_code)) {
        seenPo.add(p.po_code);
        poEv.push({ t: null, title: 'Purchase Order Created', sub: `${p.po_code}${p.po_status ? ' · ' + p.po_status : ''}`, kind: 'info' });
      }
      if (p.delivery_code && isDelivered(p) && p.received_date && !seenDel.has(p.delivery_code)) {
        seenDel.add(p.delivery_code);
        dated.push({ t: p.received_date, title: 'Delivery Received',
          sub: `${p.delivery_code}${p.accepted_qty != null ? ' · accepted ' + num(p.accepted_qty) : ''}`, kind: 'ok' });
      }
    });
    dated.sort((a, b) => toTime(a.t) - toTime(b.t));
    const result = [...dated];
    const at = result.findIndex(e => e.title === 'Delivery Received');
    const extra = [...undated, ...poEv];
    if (at === -1) result.push(...extra); else result.splice(at, 0, ...extra);
    return result;
  }

  function timelineHtml(events) {
    return `<ol class="rq-timeline">` + events.map(e => `<li class="rq-ev rq-ev--${e.kind}">
      <span class="rq-dot"></span>
      <div class="rq-ev-body">
        <div class="rq-ev-title">${esc(e.title)}</div>
        ${e.sub ? `<div class="rq-ev-sub">${esc(e.sub)}</div>` : ''}
        ${e.note ? `<div class="rq-ev-note">“${esc(e.note)}”</div>` : ''}
        <div class="rq-ev-time">${fmtStamp(e.t) || 'Date not recorded'}</div>
      </div></li>`).join('') + '</ol>';
  }

  // ----- D. Procurement progress -----
  function procStatus(p) {
    if (isDelivered(p)) return ['Delivery Received', 'pill--ok'];
    if (p.delivery_code) return ['Awaiting Supplier Delivery', 'pill--warn'];
    if (p.po_code) return ['Purchase Order Created', 'pill--proc'];
    return ['Shortage Forwarded', 'pill--mut'];
  }

  function procurementHtml(r, proc) {
    if (!proc.length) {
      return stageOf(r) === 'Awaiting Procurement'
        ? '<div class="rq-state"><span class="pill pill--proc">Shortage forwarded to Procurement</span><span class="mut">No purchase request has been recorded yet.</span></div>'
        : '<div class="rq-state"><span class="pill pill--mut">Not started</span><span class="mut">No shortage forwarded to Procurement.</span></div>';
    }
    const allDone = proc.every(isDelivered);
    const stage = stageOf(r);
    let overall;
    if (allDone && (stage === 'Completed' || stage === 'Released')) overall = ['Remaining Items Released', 'pill--ok'];
    else if (allDone) overall = ['Delivery Received', 'pill--ok'];
    else if (proc.some(p => p.delivery_code)) overall = ['Awaiting Supplier Delivery', 'pill--warn'];
    else if (proc.some(p => p.po_code)) overall = ['Purchase Order Created', 'pill--proc'];
    else overall = ['Shortage Forwarded to Procurement', 'pill--proc'];

    return `<div class="rq-state"><span class="pill ${overall[1]}">${esc(overall[0])}</span></div>
      <div class="table-wrap"><table><thead><tr><th>ITEM</th><th>PURCHASE REQUEST</th><th>PURCHASE ORDER</th><th>DELIVERY</th><th>STATUS</th></tr></thead><tbody>` +
      proc.map(p => { const [l, c] = procStatus(p); return `<tr><td>${esc(p.item)} × ${num(p.pr_qty)}</td>
        <td>${esc(p.pr_code)}<div class="secondary-cell">${esc(p.pr_status)}</div></td>
        <td>${p.po_code ? `${esc(p.po_code)}<div class="secondary-cell">${esc(p.po_status)} · ₱${num(p.po_total)}</div>` : '–'}</td>
        <td>${p.delivery_code ? `${esc(p.delivery_code)}<div class="secondary-cell">${esc(p.delivery_status)}${p.accepted_qty != null ? ' · accepted ' + num(p.accepted_qty) : ''}${p.received_date ? ' · ' + fmtDate(p.received_date) : ''}</div>` : '–'}</td>
        <td><span class="pill ${c}">${esc(l)}</span></td></tr>`; }).join('') +
      '</tbody></table></div>';
  }

  // ----- E. Admin decision -----
  function decisionFormHtml() {
    return `<p class="mut rq-lead">This request is waiting for an Admin decision. Remarks are required when rejecting.</p>
      <label for="rw-remarks" class="rq-label">Remarks</label>
      <textarea id="rw-remarks" rows="3" placeholder="Add remarks (required when rejecting)"></textarea>
      <div id="rw-msg" class="error-msg rq-msg" role="alert"></div>
      <div class="rq-decide">
        <button type="button" class="pri" id="rw-approve">Approve Request</button>
        <button type="button" class="dng" id="rw-reject">Reject Request</button>
      </div>`;
  }
  function decisionResultHtml(tl) {
    const ap = ((tl && tl.approvals) || []).slice().sort((a, b) => toTime(a.at) - toTime(b.at));
    const last = ap[ap.length - 1];
    if (!last) return '<div class="mut">No Admin decision has been recorded for this request.</div>';
    const ok = last.decision === 'Approved';
    return `<div class="rq-result ${ok ? 'rq-result--ok' : 'rq-result--bad'}">
      <div class="rq-result-top"><span class="pill ${ok ? 'pill--ok' : 'pill--bad'}">${esc(ok ? 'Approved' : last.decision)}</span>
        <span class="mut">${last.by ? 'by ' + esc(last.by) + ' · ' : ''}${esc(fmtStamp(last.at) || '–')}</span></div>
      <div class="rq-result-remarks"><span>Remarks</span>${last.remarks ? esc(last.remarks) : '<i class="mut">No remarks entered.</i>'}</div></div>`;
  }

  async function openModal(r, mode) {
    closeModal();
    const pending = r.source_status === 'Pending';
    const ov = document.createElement('div');
    ov.id = 'rw-modal'; ov.className = 'rq-overlay';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="rq-dialog">
      <header class="rq-head">
        <div><div class="rq-kicker">Requisition</div><h2>${esc(r.reference)}</h2>
          <div class="panel-sub">${esc(r.department)} · ${esc(r.title || '')}</div></div>
        <div class="rq-head-side">${progressBadge(stageOf(r))}
          <button type="button" class="rq-x" id="rw-x" aria-label="Close">×</button></div>
      </header>
      <div class="rq-body">
        ${section('A', 'Request Information', infoHtml(r))}
        ${section('B', 'Requested Items', itemsHtml(r))}
        ${section('C', 'Request Progress', '<div class="loading-msg">Loading…</div>', 'rw-timeline')}
        ${section('D', 'Procurement Progress', '<div class="loading-msg">Loading…</div>', 'rw-proc')}
        ${section('E', 'Admin Decision', pending ? decisionFormHtml() : '<div class="loading-msg">Loading…</div>', 'rw-decision')}
      </div>
      <footer class="rq-foot"><button type="button" id="rw-close">Close</button></footer>
    </div>`;
    document.body.appendChild(ov);
    document.body.classList.add('modal-open');
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
    $('#rw-close').onclick = closeModal;
    $('#rw-x').onclick = closeModal;

    if (pending) {
      $('#rw-approve').onclick = () => decide(r, 'Approved');
      $('#rw-reject').onclick = () => decide(r, 'Rejected');
      if (mode === 'reject') $('#rw-remarks').focus();
    }

    // Procurement rows + approval timeline load in parallel; each fails on its own.
    const [pRes, tRes] = await Promise.all([
      sb.from('v_requisition_procurement').select('*')
        .eq('source_table', r.source_table).eq('requisition_id', r.source_id).order('pr_id'),
      sb.rpc('rw_requisition_timeline', { p_workflow_id: r.workflow_id })
    ]);
    if (!$('#rw-modal')) return;   // closed while loading

    const proc = pRes.error ? null : (pRes.data || []);
    const tl = tRes.error ? null : (tRes.data || { approvals: [], history: [] });
    if (pRes.error) console.error(pRes.error);
    if (tRes.error) console.error(tRes.error);

    const tlBox = $('#rw-timeline'), prBox = $('#rw-proc'), dcBox = $('#rw-decision');
    if (tlBox) tlBox.innerHTML = tl ? timelineHtml(buildEvents(r, tl, proc || []))
      : '<div class="error-msg">Could not load request progress.</div>';
    if (prBox) prBox.innerHTML = proc ? procurementHtml(r, proc)
      : '<div class="error-msg">Could not load procurement progress.</div>';
    if (dcBox && !pending) dcBox.innerHTML = tl ? decisionResultHtml(tl)
      : '<div class="error-msg">Could not load the Admin decision.</div>';
  }

  let deciding = false;
  async function decide(r, decision) {
    if (deciding) return;
    const remarks = ($('#rw-remarks').value || '').trim(), msg = $('#rw-msg');
    if (decision === 'Rejected' && remarks.length < 5) { msg.textContent = 'Enter a rejection reason (at least 5 characters).'; return; }
    msg.textContent = '';
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