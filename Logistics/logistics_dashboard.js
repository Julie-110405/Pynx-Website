
/* ==========================================
   PYNX LOGISTICS DASHBOARD
   SUPABASE INTEGRATION
========================================== */

const $ = selector => document.querySelector(selector);

const sb = window.supabaseClient;

const LOGIN_URL = '../Log_in/login.html';

let ME = null;

/* ==========================================
   HELPERS
========================================== */

const esc = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

const CLS = {
    Pending: 'Pen',
    Scheduled: 'Part',
    Received: 'Part',
    Completed: 'Rel',
    'With Issues': 'Out',
    Delayed: 'Out',
    Approved: 'All',
    Rejected: 'Out',
    Open: 'Pen',
    Resolved: 'Rel'
};

const pill = status =>
    `<span class="pill ${CLS[status] || 'Pen'}">${esc(status)}</span>`;

const fmt = date =>
    date
        ? new Date(date + 'T00:00:00').toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        })
        : '';

function generateCode(prefix) {
    return `${prefix}-${Date.now()}`;
}

function toast(message) {
    const element = document.createElement('div');

    element.className = 'toast';
    element.textContent = message;

    document.body.appendChild(element);

    setTimeout(() => element.remove(), 2500);
}

/* ==========================================
   AUTHENTICATION
========================================== */

async function guard(allowedDepartments) {

    if (!sb) {
        alert('Supabase configuration was not loaded. Check config/supabase.js.');
        return false;
    }

    const {
        data: { session },
        error: sessionError
    } = await sb.auth.getSession();

    if (sessionError || !session) {
        window.location.href = LOGIN_URL;
        return false;
    }

    const { data: profile, error } = await sb
        .from('profiles')
        .select('username, department, role')
        .eq('id', session.user.id)
        .single();

    if (error || !profile) {
        console.error('Profile error:', error);

        alert('Unable to verify your department. Please log in again.');

        await sb.auth.signOut();
        window.location.href = LOGIN_URL;

        return false;
    }

    const department = (profile.department || '').toLowerCase();

    if (!allowedDepartments.includes(department)) {
        alert('You are not authorized to access Logistics.');

        await sb.auth.signOut();
        window.location.href = LOGIN_URL;

        return false;
    }

    ME = {
        id: session.user.id,
        ...profile
    };

    return true;
}

async function logout() {

    if (!confirm('Are you sure you want to log out?')) {
        return;
    }

    const { error } = await sb.auth.signOut();

    if (error) {
        toast('Logout error: ' + error.message);
        return;
    }

    window.location.href = LOGIN_URL;
}

/* ==========================================
   DATABASE
========================================== */

const D = {
    dels: [],
    disc: [],
    reqs: []
};

async function get(tableName, columns, orderColumn) {

    const { data, error } = await sb
        .from(tableName)
        .select(columns)
        .order(orderColumn, { ascending: true });

    if (error) {
        console.error(`Error loading ${tableName}:`, error);
        return null;
    }

    return data;
}

/* ==========================================
   LOAD RECORDS
========================================== */

async function load() {

    const [deliveries, discrepancies, requisitions] =
        await Promise.all([

            get(
                'deliveries',
                '*, suppliers(name), purchase_orders(code)',
                'expected_date'
            ),

            get(
                'delivery_discrepancies',
                '*, deliveries(code)',
                'id'
            ),

            get(
                'logistics_requisitions',
                '*',
                'created_at'
            )

        ]);

    if (
        deliveries === null ||
        discrepancies === null ||
        requisitions === null
    ) {
        toast('Some data could not load. Check the browser console.');
    }

    D.dels = (deliveries || []).map(row => ({
        id: row.code,
        _id: row.id,
        po: row.purchase_orders?.code || '',
        supplier: row.suppliers?.name || '',
        date: fmt(row.expected_date),
        items: row.items || '',
        status: row.status
    }));

    D.disc = (discrepancies || []).map(row => ({
        id: row.code,
        _id: row.id,
        delId: row.delivery_id,
        del: row.deliveries?.code || '',
        issue: row.issue,
        status: row.status,
        res: row.resolution || ''
    }));

    D.reqs = (requisitions || []).map(row => ({
        id: row.code,
        _id: row.id,
        item: row.item,
        qty: row.qty,
        status: row.status
    }));
}

/* ==========================================
   NAVIGATION
========================================== */

const VIEWS = [
    ['dashboard', 'Dashboard'],
    ['requisition', 'Requisition'],
    ['delivery', 'Delivery']
];

const TABS = [
    'Incoming Deliveries',
    'Inspection',
    'Discrepancies',
    'Resolutions',
    'Reports'
];

const ICONS = {

    dashboard: `
        <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="8" height="8" rx="1"/>
            <rect x="13" y="3" width="8" height="5" rx="1"/>
            <rect x="13" y="10" width="8" height="11" rx="1"/>
            <rect x="3" y="13" width="8" height="8" rx="1"/>
        </svg>
    `,

    requisition: `
        <svg viewBox="0 0 24 24">
            <path d="M8 4h8l4 4v13H4V4z"/>
            <path d="M14 4v5h6"/>
            <path d="M8 13h8M8 17h8"/>
        </svg>
    `,

    delivery: `
        <svg viewBox="0 0 24 24">
            <path d="M3 6h11v12H3z"/>
            <path d="M14 10h4l3 4v4h-7z"/>
            <circle cx="7.5" cy="19" r="2"/>
            <circle cx="17.5" cy="19" r="2"/>
        </svg>
    `,

    logout: `
        <svg viewBox="0 0 24 24">
            <path d="M10 17l5-5-5-5"/>
            <path d="M15 12H3"/>
            <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>
        </svg>
    `
};

let view = 'dashboard';
let tab = TABS[0];
let q = '';

const by = statuses =>
    D.dels.filter(delivery => statuses.includes(delivery.status));

const find = id =>
    D.dels.find(delivery => delivery.id === id);

function go(newView, newTab) {

    view = newView;

    if (newTab) {
        tab = newTab;
    }

    q = '';

    render();
}

/* ==========================================
   MODAL HELPERS
========================================== */

function modal(content) {

    $('#layer').innerHTML = `
        <div class="modal" onclick="if(event.target === this) closeM()">
            <div class="card">
                ${content}
            </div>
        </div>
    `;
}

function closeM() {
    $('#layer').innerHTML = '';
}

const cancel = `
    <button onclick="closeM()">Cancel</button>
`;

const btns = (...buttons) => `
    <div class="tools noprint"
         style="margin-top:16px;justify-content:flex-end">
        ${buttons.join('')}
    </div>
`;

const has = item =>
    !q || JSON.stringify(item).toLowerCase().includes(q.toLowerCase());

const search = placeholder => `
    <input
        placeholder="${esc(placeholder)}"
        value="${esc(q)}"
        oninput="q=this.value;render(true)"
        aria-label="${esc(placeholder)}"
    >
`;

const table = (columns, rows) => `
    <div class="tw">
        <table>
            <thead>
                <tr>
                    ${columns.map(column => `<th>${column}</th>`).join('')}
                </tr>
            </thead>

            <tbody>
                ${rows.join('') || `
                    <tr>
                        <td colspan="${columns.length}" class="mut">
                            Nothing here yet.
                        </td>
                    </tr>
                `}
            </tbody>
        </table>
    </div>
`;

/* ==========================================
   DASHBOARD
========================================== */

function dashboard() {

    const incoming = by(['Pending', 'Scheduled', 'Delayed']);

    const open = D.disc.filter(
        discrepancy => discrepancy.status === 'Open'
    );

    return `
        <h1>Welcome to Logistics!</h1>

        <p class="sub">
            Receive, inspect, and report on incoming deliveries.
        </p>

        <div class="grid g4">

            <div class="card">
                <div class="mut">Incoming Deliveries</div>
                <div class="big">${incoming.length}</div>
                <div class="mut">Expected deliveries</div>
            </div>

            <div class="card">
                <div class="mut">Pending Inspections</div>
                <div class="big">${by(['Received']).length}</div>
                <div class="mut">Awaiting inspection</div>
            </div>

            <div class="card">
                <div class="mut">Discrepancies</div>
                <div class="big">${open.length}</div>
                <div class="mut">Missing or damaged items</div>
            </div>

            <div class="card">
                <div class="mut">Completed Deliveries</div>
                <div class="big">${by(['Completed']).length}</div>
                <div class="mut">Successfully inspected</div>
            </div>

        </div>

        <div class="grid g2">

            <div class="card">
                <h2>Quick Actions</h2>

                <div class="row">
                    <span>
                        <b>Receive Delivery</b><br>
                        <span class="mut">Record an arrived delivery</span>
                    </span>

                    <button class="pri sm"
                        onclick="go('delivery','Incoming Deliveries')">
                        Receive
                    </button>
                </div>

                <div class="row">
                    <span>
                        <b>Start Inspection</b><br>
                        <span class="mut">Check received items</span>
                    </span>

                    <button class="sm"
                        onclick="go('delivery','Inspection')">
                        Inspect
                    </button>
                </div>

                <div class="row">
                    <span>
                        <b>Report Discrepancy</b><br>
                        <span class="mut">Missing or damaged items</span>
                    </span>

                    <button class="sm" onclick="reportD()">
                        Report
                    </button>
                </div>
            </div>

            <div class="card">
                <h2>Delivery Alerts</h2>

                <div class="row">
                    <span>${open.length} deliveries have discrepancies.</span>

                    <button class="sm"
                        onclick="go('delivery','Discrepancies')">
                        View
                    </button>
                </div>

                <div class="row">
                    <span>${by(['Delayed']).length} deliveries are delayed.</span>

                    <button class="sm"
                        onclick="go('delivery','Incoming Deliveries')">
                        View
                    </button>
                </div>
            </div>

        </div>

        <div class="card">
            <h2>Upcoming Deliveries</h2>

            ${table(
                ['Delivery ID', 'PO number', 'Supplier', 'Expected', 'Status'],

                incoming.slice(0, 3).map(delivery => `
                    <tr>
                        <td>${esc(delivery.id)}</td>
                        <td>${esc(delivery.po)}</td>
                        <td>${esc(delivery.supplier)}</td>
                        <td>${esc(delivery.date)}</td>
                        <td>${pill(delivery.status)}</td>
                    </tr>
                `)
            )}
        </div>
    `;
}

/* ==========================================
   REQUISITION
========================================== */

function requisition() {

    return `
        <h1>Requisition</h1>

        <p class="sub">
            Request materials and supplies. Logistics acts as Requester.
        </p>

        <div class="card">

            <div class="tools">
                ${search('Search requisitions')}

                <button class="pri" onclick="newReq()">
                    New requisition
                </button>
            </div>

            ${table(
                ['ID', 'Item', 'Qty', 'Status'],

                D.reqs.filter(has).map(request => `
                    <tr>
                        <td>${esc(request.id)}</td>
                        <td>${esc(request.item)}</td>
                        <td>${request.qty}</td>
                        <td>${pill(request.status)}</td>
                    </tr>
                `)
            )}

        </div>
    `;
}

function newReq() {

    modal(`
        <h2>New requisition</h2>

        <label for="a1">Item</label>
        <input id="a1" placeholder="Enter item name">

        <label for="a2">Quantity</label>
        <input id="a2" type="number" min="1" value="1">

        <label for="a3">Reason</label>
        <input id="a3" placeholder="Reason for request">

        ${btns(
            cancel,
            '<button class="pri" onclick="saveReq()">Submit requisition</button>'
        )}
    `);
}

async function saveReq() {

    const item = $('#a1').value.trim();
    const qty = Number($('#a2').value);
    const reason = $('#a3').value.trim();

    if (!item || !Number.isInteger(qty) || qty < 1) {
        toast('Enter an item and a valid quantity.');
        return;
    }

    const record = {
        code: generateCode('LR'),
        item,
        qty,
        reason,
        status: 'Pending',
        created_by: ME.id
    };

    const { error } = await sb
        .from('logistics_requisitions')
        .insert(record);

    if (error) {
        console.error('Requisition error:', error);
        toast('Could not submit: ' + error.message);
        return;
    }

    closeM();

    await load();
    render();

    toast('Requisition submitted successfully.');
}

/* ==========================================
   DELIVERY PAGES
========================================== */

function delivery() {

    let content = '';

    const action = (id, label, functionName, primary = false) => `
        <td class="r">
            <button
                class="sm ${primary ? 'pri' : ''}"
                onclick="${functionName}('${esc(id)}')">
                ${label}
            </button>
        </td>
    `;

    /* INCOMING DELIVERIES */

    if (tab === TABS[0]) {

        content = table(
            ['Delivery ID', 'PO number', 'Supplier', 'Items', 'Expected', 'Status', ''],

            by(['Pending', 'Scheduled', 'Delayed'])
                .filter(has)
                .map(delivery => `
                    <tr>
                        <td>${esc(delivery.id)}</td>
                        <td>${esc(delivery.po)}</td>
                        <td>${esc(delivery.supplier)}</td>
                        <td>${esc(delivery.items)}</td>
                        <td>${esc(delivery.date)}</td>
                        <td>${pill(delivery.status)}</td>
                        ${action(delivery.id, 'Receive', 'receive', true)}
                    </tr>
                `)
        );
    }

    /* INSPECTION */

    if (tab === TABS[1]) {

        content = table(
            ['Delivery ID', 'PO number', 'Supplier', 'Items', 'Status', ''],

            by(['Received'])
                .filter(has)
                .map(delivery => `
                    <tr>
                        <td>${esc(delivery.id)}</td>
                        <td>${esc(delivery.po)}</td>
                        <td>${esc(delivery.supplier)}</td>
                        <td>${esc(delivery.items)}</td>
                        <td>${pill(delivery.status)}</td>
                        ${action(delivery.id, 'Start inspection', 'inspect', true)}
                    </tr>
                `)
        );
    }

    /* DISCREPANCIES */

    if (tab === TABS[2]) {

        content = `
            <div class="tools">
                <button class="pri" onclick="reportD()">
                    Report discrepancy
                </button>
            </div>
        `;

        content += table(
            ['ID', 'Delivery', 'Issue', 'Status', ''],

            D.disc
                .filter(d => d.status === 'Open' && has(d))
                .map(discrepancy => `
                    <tr>
                        <td>${esc(discrepancy.id)}</td>
                        <td>${esc(discrepancy.del)}</td>
                        <td>${esc(discrepancy.issue)}</td>
                        <td>${pill(discrepancy.status)}</td>
                        ${action(discrepancy.id, 'Resolve', 'resolve')}
                    </tr>
                `)
        );
    }

    /* RESOLUTIONS */

    if (tab === TABS[3]) {

        content = table(
            ['ID', 'Delivery', 'Issue', 'Resolution', 'Status'],

            D.disc
                .filter(d => d.status === 'Resolved' && has(d))
                .map(discrepancy => `
                    <tr>
                        <td>${esc(discrepancy.id)}</td>
                        <td>${esc(discrepancy.del)}</td>
                        <td>${esc(discrepancy.issue)}</td>
                        <td>${esc(discrepancy.res)}</td>
                        <td>${pill(discrepancy.status)}</td>
                    </tr>
                `)
        );
    }

    /* REPORTS */

    if (tab === TABS[4]) {

        content = `
            <div class="tools noprint">
                ${search('Search deliveries')}

                <button class="pri" onclick="window.print()">
                    Print report
                </button>
            </div>
        `;

        content += table(
            ['Delivery ID', 'PO number', 'Supplier', 'Expected', 'Status', ''],

            D.dels
                .filter(has)
                .map(delivery => `
                    <tr>
                        <td>${esc(delivery.id)}</td>
                        <td>${esc(delivery.po)}</td>
                        <td>${esc(delivery.supplier)}</td>
                        <td>${esc(delivery.date)}</td>
                        <td>${pill(delivery.status)}</td>

                        ${
                            ['Pending', 'Scheduled', 'Delayed'].includes(delivery.status)
                                ? '<td></td>'
                                : action(delivery.id, 'Receipt', 'receipt')
                        }
                    </tr>
                `)
        );
    }

    return `
        <h1>Delivery</h1>

        <p class="sub">
            Logistics acts as Delivery Handler and Receiving Staff.
        </p>

        <div class="tabs">

            ${TABS.map(item => `
                <button
                    class="${item === tab ? 'on' : ''}"
                    onclick="tab='${item}';q='';render()">
                    ${item}
                </button>
            `).join('')}

        </div>

        <div class="card">
            ${content}
        </div>
    `;
}

/* ==========================================
   RECEIVE DELIVERY
========================================== */

async function receive(id) {

    const delivery = find(id);

    if (!delivery) {
        toast('Delivery not found.');
        return;
    }

    const { error } = await sb
        .from('deliveries')
        .update({
            status: 'Received',
            received_date: new Date().toISOString().slice(0, 10),
            received_by: ME.id
        })
        .eq('id', delivery._id);

    if (error) {
        console.error('Receive error:', error);
        toast('Could not save: ' + error.message);
        return;
    }

    await load();
    render();

    receipt(id);
}

/* ==========================================
   RECEIVING RECEIPT
========================================== */

function receipt(id) {

    const delivery = find(id);

    if (!delivery) {
        toast('Delivery not found.');
        return;
    }

    modal(`
        <h2>Receiving receipt</h2>

        <div class="rc">

            <div class="row">
                <span>Delivery</span>
                <b>${esc(delivery.id)}</b>
            </div>

            <div class="row">
                <span>PO number</span>
                <span>${esc(delivery.po)}</span>
            </div>

            <div class="row">
                <span>Supplier</span>
                <span>${esc(delivery.supplier)}</span>
            </div>

            <div class="row">
                <span>Items</span>
                <span>${esc(delivery.items)}</span>
            </div>

            <div class="row">
                <span>Received on</span>
                <span>${new Date().toLocaleDateString('en-PH')}</span>
            </div>

            <div class="row">
                <span>Status</span>
                <span>${esc(delivery.status)}</span>
            </div>

        </div>

        ${btns(
            '<button onclick="closeM()">Close</button>',
            '<button class="pri" onclick="window.print()">Print receipt</button>'
        )}
    `);
}

/* ==========================================
   INSPECTION
========================================== */

function inspect(id) {

    const delivery = find(id);

    if (!delivery) {
        toast('Delivery not found.');
        return;
    }

    modal(`
        <h2>Inspect ${esc(delivery.id)}</h2>

        <p class="mut">
            ${esc(delivery.items)} from ${esc(delivery.supplier)}
        </p>

        <label for="i1">Result</label>

        <select id="i1">
            <option value="ok">
                All items complete and in good condition
            </option>

            <option value="bad">
                Missing or damaged items
            </option>
        </select>

        <label for="i2">Issue details (if any)</label>

        <input id="i2" placeholder="Example: 3 rolls damaged">

        ${btns(
            cancel,
            `<button class="pri" onclick="saveInspect('${esc(id)}')">
                Save inspection
            </button>`
        )}
    `);
}

/* ==========================================
   CREATE DISCREPANCY
========================================== */

async function addIssue(delivery, issue) {

    const { error: insertError } = await sb
        .from('delivery_discrepancies')
        .insert({
            code: generateCode('DSC'),
            delivery_id: delivery._id,
            issue,
            status: 'Open',
            reported_by: ME.id
        });

    if (insertError) {
        return insertError;
    }

    const { error: updateError } = await sb
        .from('deliveries')
        .update({
            status: 'With Issues'
        })
        .eq('id', delivery._id);

    return updateError;
}

/* ==========================================
   SAVE INSPECTION
========================================== */

async function saveInspect(id) {

    const delivery = find(id);

    if (!delivery) {
        toast('Delivery not found.');
        return;
    }

    const isBad = $('#i1').value === 'bad';
    const issue = $('#i2').value.trim();

    if (isBad && !issue) {
        toast('Describe the missing or damaged items.');
        return;
    }

    let error;

    if (isBad) {

        error = await addIssue(delivery, issue);

    } else {

        const result = await sb
            .from('deliveries')
            .update({
                status: 'Completed'
            })
            .eq('id', delivery._id);

        error = result.error;
    }

    if (error) {
        console.error('Inspection error:', error);
        toast('Could not save: ' + error.message);
        return;
    }

    closeM();

    await load();

    go(
        'delivery',
        isBad ? 'Discrepancies' : 'Inspection'
    );

    toast(
        isBad
            ? 'Discrepancy reported.'
            : 'Delivery completed. Coordinate stock-in with Inventory.'
    );
}

/* ==========================================
   REPORT DISCREPANCY
========================================== */

function reportD() {

    const availableDeliveries = D.dels.filter(
        delivery =>
            !['Pending', 'Scheduled', 'Delayed'].includes(delivery.status)
    );

    if (!availableDeliveries.length) {
        toast('There are no received deliveries to report.');
        return;
    }

    modal(`
        <h2>Report discrepancy</h2>

        <label for="r1">Delivery</label>

        <select id="r1">
            ${availableDeliveries.map(delivery => `
                <option value="${esc(delivery.id)}">
                    ${esc(delivery.id)} - ${esc(delivery.supplier)}
                </option>
            `).join('')}
        </select>

        <label for="r2">Issue</label>

        <input id="r2" placeholder="Missing or damaged items">

        ${btns(
            cancel,
            '<button class="pri" onclick="saveD()">Report</button>'
        )}
    `);
}

async function saveD() {

    const id = $('#r1').value;
    const issue = $('#r2').value.trim();

    if (!id || !issue) {
        toast('Pick a delivery and describe the issue.');
        return;
    }

    const delivery = find(id);

    if (!delivery) {
        toast('Delivery not found.');
        return;
    }

    const error = await addIssue(delivery, issue);

    if (error) {
        console.error('Discrepancy error:', error);
        toast('Could not save: ' + error.message);
        return;
    }

    closeM();

    await load();

    go('delivery', 'Discrepancies');

    toast('Discrepancy reported.');
}

/* ==========================================
   RESOLVE DISCREPANCY
========================================== */

function resolve(id) {

    modal(`
        <h2>Resolve ${esc(id)}</h2>

        <label for="v1">
            Resolution agreed with supplier
        </label>

        <select id="v1">
            <option>Replacement</option>
            <option>Refund</option>
            <option>Credit note</option>
        </select>

        ${btns(
            cancel,
            `<button class="pri" onclick="saveRes('${esc(id)}')">
                Save resolution
            </button>`
        )}
    `);
}

async function saveRes(id) {

    const discrepancy = D.disc.find(
        item => item.id === id
    );

    if (!discrepancy) {
        toast('Discrepancy not found.');
        return;
    }

    const resolution = $('#v1').value;

    const { error } = await sb
        .from('delivery_discrepancies')
        .update({
            status: 'Resolved',
            resolution,
            resolved_by: ME.id,
            resolved_at: new Date().toISOString()
        })
        .eq('id', discrepancy._id);

    if (error) {
        console.error('Resolution error:', error);
        toast('Could not save: ' + error.message);
        return;
    }

    const { error: deliveryError } = await sb
        .from('deliveries')
        .update({
            status: 'Completed'
        })
        .eq('id', discrepancy.delId);

    if (deliveryError) {
        console.error('Delivery update error:', deliveryError);
        toast('Resolution saved, but delivery status could not update.');
    }

    closeM();

    await load();

    go('delivery', 'Resolutions');

    toast('Discrepancy resolved.');
}

/* ==========================================
   SIDEBAR AND PAGE RENDERING
========================================== */

function render(keepSearch = false) {

    $('#nav').innerHTML = `
        ${VIEWS.map(([key, label]) => `
            <a
                class="${key === view ? 'on' : ''}"
                tabindex="0"
                onclick="go('${key}')"
                onkeydown="if(event.key === 'Enter') go('${key}')">

                <span class="nav-icon">
                    ${ICONS[key]}
                </span>

                <span>${label}</span>
            </a>
        `).join('')}

        <a
            tabindex="0"
            onclick="logout()"
            onkeydown="if(event.key === 'Enter') logout()">

            <span class="nav-icon">
                ${ICONS.logout}
            </span>

            <span>Log out</span>
        </a>
    `;

    const scrollPosition = window.scrollY;

    $('#main').innerHTML = ({
        dashboard,
        requisition,
        delivery
    })[view]();

    if (keepSearch) {

        const input = document.querySelector('main input');

        if (input) {
            input.focus();
            input.setSelectionRange(q.length, q.length);
        }

        window.scrollTo(0, scrollPosition);
    }
}

/* ==========================================
   INITIALIZE
========================================== */

async function init() {

    $('#main').innerHTML = `
        <p class="mut">Loading Logistics dashboard...</p>
    `;

    if (!(await guard(['logistics']))) {
        return;
    }

    $('#userDepartment').textContent =
        ME.department + ' • ' + (ME.username || '');

    await load();

    render();
}

init();
