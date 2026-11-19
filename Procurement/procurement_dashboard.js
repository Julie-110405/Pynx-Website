
const $ = s => document.querySelector(s);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));

const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH');

const CLS = {
    Pending: 'Pen',
    Approved: 'All',
    Ordered: 'Part',
    Sent: 'Part',
    Confirmed: 'All',
    Received: 'Rel',
    Delayed: 'Out',
    Scheduled: 'Part',
    Rejected: 'Out',
    Active: 'In',
    Inactive: 'Out',
    Open: 'Pen',
    Resolved: 'Rel',
    'In Stock': 'In',
    'Low Stock': 'Low',
    'Out of Stock': 'Out'
};

const pill = s =>
    `<span class="pill ${CLS[s] || 'Pen'}">${esc(s)}</span>`;

const sb = window.supabaseClient;

const LOGIN_URL = '../../Log_in/login.html';

let ME = null;
let view = 'dashboard';
let tab = 'Purchase Requests';
let q = '';
let curReq = null;

const D = {
    suppliers: [],
    reqs: [],
    prs: [],
    pos: [],
    inv: [],
    dels: [],
    disc: []
};

const fmt = d => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    })
    : '';

const stockStatus = i =>
    i.stock === 0
        ? 'Out of Stock'
        : i.stock < i.min
            ? 'Low Stock'
            : 'In Stock';

const pendDel = () =>
    D.dels.filter(d =>
        ['Pending', 'Scheduled', 'Delayed'].includes(d.status)
    ).length;

// DATABASE HELPER

const get = async (table, select, column, ascending) => {
    const result = await sb
        .from(table)
        .select(select)
        .order(column, { ascending: !!ascending });

    if (result.error) {
        console.error(table, result.error);
        return null;
    }

    return result.data;
};

// AUTHENTICATION

async function guard(allowed) {
    if (!sb) {
        alert('Supabase configuration was not loaded.');
        return false;
    }

    const { data: { session }, error } = await sb.auth.getSession();

    if (error || !session) {
        location.href = LOGIN_URL;
        return false;
    }

    const { data: profile, error: profileError } = await sb
        .from('profiles')
        .select('username,department,role')
        .eq('id', session.user.id)
        .single();

    if (
        profileError ||
        !profile ||
        !allowed.includes((profile.department || '').toLowerCase())
    ) {
        await sb.auth.signOut();
        location.href = LOGIN_URL;
        return false;
    }

    ME = {
        id: session.user.id,
        ...profile
    };

    return true;
}

async function logout() {
    await sb.auth.signOut();
    location.href = LOGIN_URL;
}

// DATA LOADING

async function load() {
    const [
        su, pr, po, dl, dc, mr, lr, iv
    ] = await Promise.all([
        get('suppliers', '*', 'id', true),
        get('purchase_requests', '*, suppliers(name)', 'id', true),
        get('purchase_orders', '*, suppliers(name)', 'id', true),
        get('deliveries', '*, suppliers(name), purchase_orders(code)', 'expected_date', true),
        get('delivery_discrepancies', '*, deliveries(code, suppliers(name))', 'id', true),
        get('marketing_requisitions', '*', 'created_at', true),
        get('logistics_requisitions', '*', 'created_at', true),
        get('inventory_products', '*', 'name', true)
    ]);

    if ([su, pr, po, dl, dc, mr, lr, iv].includes(null)) {
        toast('Some data could not load. Check the browser console.');
    }

    D.suppliers = (su || []).map(x => ({
        id: x.code,
        _id: x.id,
        name: x.name,
        item: x.supplies || '',
        contact: x.contact || '',
        status: x.status
    }));

    D.prs = (pr || []).map(x => ({
        id: x.code,
        _id: x.id,
        item: x.item,
        qty: x.qty,
        supplier: x.suppliers?.name || '',
        supplier_id: x.supplier_id,
        cost: x.est_cost,
        status: x.status
    }));

    D.pos = (po || []).map(x => ({
        id: x.code,
        _id: x.id,
        supplier: x.suppliers?.name || '',
        item: x.item,
        qty: x.qty,
        total: x.total,
        date: x.order_date,
        status: x.status
    }));

    D.dels = (dl || []).map(x => ({
        id: x.code,
        po: x.purchase_orders?.code || '',
        supplier: x.suppliers?.name || '',
        date: fmt(x.expected_date),
        status: x.status
    }));

    D.disc = (dc || []).map(x => ({
        id: x.code,
        _id: x.id,
        delId: x.delivery_id,
        del: x.deliveries?.code || '',
        issue: x.issue,
        supplier: x.deliveries?.suppliers?.name || '',
        status: x.status,
        res: x.resolution || ''
    }));

    D.reqs = [
        ...(mr || []).map(x => ({
            id: x.id,
            item: x.project,
            from: 'Marketing',
            needed: x.needed_by || '',
            status: x.status || ''
        })),

        ...(lr || []).map(x => ({
            id: x.code,
            item: x.item,
            from: 'Logistics',
            needed: x.needed_by || '',
            status: x.status,
            qty: x.qty
        }))
    ];

    D.inv = (iv || [])
        .filter(x => !x.archived)
        .map(x => ({
            id: x.sku,
            item: x.name,
            unit: x.unit || '',
            stock: Number(x.qty) || 0,
            min: Number(x.min_level) || 0
        }));
}

// NAVIGATION

const VIEWS = [
    ['dashboard', '▦', 'Dashboard'],
    ['requisition', '▤', 'Requisition'],
    ['inventory', '▣', 'Inventory'],
    ['purchasing', '▥', 'Purchasing'],
    ['delivery', '▧', 'Delivery']
];

function go(v, t) {
    view = v;

    if (t) {
        tab = t;
    }

    q = '';
    render();
}

// NOTIFICATIONS

function toast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;

    document.body.appendChild(t);

    setTimeout(() => t.remove(), 2200);
}

// MODALS

function modal(html) {
    $('#layer').innerHTML = `
        <div class="modal" onclick="if(event.target===this)closeM()">
            <div class="card">${html}</div>
        </div>
    `;
}

function closeM() {
    $('#layer').innerHTML = '';
}

// TABLE HELPERS

function table(cols, rows) {
    return `
        <div class="tw">
            <table>
                <thead>
                    <tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.join('') ||
                    `<tr><td colspan="${cols.length}" class="mut">Nothing here yet.</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
}

const has = o =>
    !q || JSON.stringify(o).toLowerCase().includes(q.toLowerCase());

const search = placeholder => `
    <input
        placeholder="${placeholder}"
        value="${esc(q)}"
        oninput="q=this.value;render(true)"
        aria-label="Search"
    >
`;

// DASHBOARD

function dashboard() {
    const pending = D.prs.filter(p => p.status === 'Pending').length;

    return `
        <h1>Welcome to Procurement!</h1>
        <p class="sub">Purchasing and supplier overview</p>

        <div class="grid g4">

            <div class="card">
                <div class="mut">Purchase Requests</div>
                <div class="big">${D.prs.length}</div>
                <div class="mut">Total requests</div>
            </div>

            <div class="card">
                <div class="mut">Pending Approvals</div>
                <div class="big">${pending}</div>
                <div class="mut">Awaiting Admin</div>
            </div>

            <div class="card">
                <div class="mut">Active Purchase Orders</div>
                <div class="big">${D.pos.length}</div>
                <div class="mut">Currently processing</div>
            </div>

            <div class="card">
                <div class="mut">Pending Deliveries</div>
                <div class="big">${pendDel()}</div>
                <div class="mut">Awaiting arrival</div>
            </div>

        </div>

        <div class="grid g2">

            <div class="card">
                <h2>Quick Actions</h2>

                <div class="row">
                    <span>
                        <b>Create Purchase Request</b><br>
                        <span class="mut">Prepare a new purchase request</span>
                    </span>
                    <button class="pri sm" onclick="newPR()">Create</button>
                </div>

                <div class="row">
                    <span>
                        <b>Manage Suppliers</b><br>
                        <span class="mut">View and update supplier records</span>
                    </span>
                    <button class="sm" onclick="go('purchasing','Suppliers')">Open</button>
                </div>

                <div class="row">
                    <span>
                        <b>Create Purchase Order</b><br>
                        <span class="mut">From an approved purchase request</span>
                    </span>
                    <button class="sm" onclick="go('purchasing','Purchase Orders')">Open</button>
                </div>
            </div>

            <div class="card">
                <h2>Recent Purchase Requests</h2>

                ${D.prs.map(p => `
                    <div class="row">
                        <span>
                            <b>${esc(p.item)}</b><br>
                            <span class="mut">${esc(p.id)} · ${p.qty} units</span>
                        </span>
                        ${pill(p.status)}
                    </div>
                `).join('')}
            </div>

        </div>

        <div class="card">
            <h2>Supplier and Delivery Updates</h2>

            <div class="row">
                <span>${pendDel()} deliveries are on the way or delayed.</span>
                <button class="sm" onclick="go('delivery')">View</button>
            </div>

            <div class="row">
                <span>${D.disc.filter(d => d.status === 'Open').length} discrepancy awaiting supplier response.</span>
                <button class="sm" onclick="go('delivery','Discrepancies')">View</button>
            </div>
        </div>
    `;
}

// REQUISITION

function requisition() {
    const approved = r => /approv/i.test(r.status);

    const rows = D.reqs
        .filter(has)
        .map(r => `
            <tr>
                <td>${esc(r.id)}</td>
                <td>${esc(r.item)}</td>
                <td>${r.from}</td>
                <td>${esc(r.needed)}</td>
                <td>${pill(r.status)}</td>
                <td class="r">
                    ${approved(r)
                        ? `<button class="sm pri" onclick="newPR('${esc(r.id)}')">Make purchase request</button>`
                        : ''}
                </td>
            </tr>
        `);

    return `
        <h1>Requisition</h1>
        <p class="sub">Approved requisitions that need purchasing. Procurement acts as Purchasing Handler.</p>

        <div class="card">
            <div class="tools">${search('Search requisitions')}</div>
            ${table(['ID', 'Request', 'Requested by', 'Needed by', 'Status', ''], rows)}
        </div>
    `;
}

// INVENTORY

function inventory() {
    const rows = D.inv
        .filter(has)
        .map(i => {
            const status = stockStatus(i);

            return `
                <tr>
                    <td>${esc(i.id)}</td>
                    <td>${esc(i.item)}</td>
                    <td>${i.stock} ${esc(i.unit)}</td>
                    <td>${i.min}</td>
                    <td>${pill(status)}</td>
                    <td class="r">
                        ${status !== 'In Stock'
                            ? `<button class="sm" onclick="newPR('', '${esc(i.item)}')">Request restock</button>`
                            : ''}
                    </td>
                </tr>
            `;
        });

    return `
        <h1>Inventory</h1>
        <p class="sub">View-only stock levels. Procurement acts as Purchasing Coordinator.</p>

        <div class="card">
            <div class="tools">${search('Search products')}</div>
            ${table(['ID', 'Product', 'In stock', 'Minimum', 'Status', ''], rows)}
        </div>
    `;
}

// PURCHASING

function purchasing() {
    const T = ['Purchase Requests', 'Purchase Orders', 'Suppliers'];

    let body = '';

    if (tab === 'Purchase Requests') {
        body = `
            <div class="tools">
                ${search('Search purchase requests')}
                <button class="pri" onclick="newPR()">New purchase request</button>
            </div>
        ` + table(
            ['ID', 'Item', 'Qty', 'Supplier', 'Est. cost', 'Status', ''],
            D.prs.filter(has).map(p => `
                <tr>
                    <td>${esc(p.id)}</td>
                    <td>${esc(p.item)}</td>
                    <td>${p.qty}</td>
                    <td>${esc(p.supplier)}</td>
                    <td>${peso(p.cost)}</td>
                    <td>${pill(p.status)}</td>
                    <td class="r">
                        ${p.status === 'Approved'
                            ? `<button class="sm pri" onclick="makePO('${esc(p.id)}')">Create PO</button>`
                            : p.status === 'Pending'
                                ? '<span class="mut">Waiting for Admin</span>'
                                : ''}
                    </td>
                </tr>
            `)
        );
    }

    if (tab === 'Purchase Orders') {
        body = `
            <div class="tools">${search('Search purchase orders')}</div>
        ` + table(
            ['PO number', 'Supplier', 'Item', 'Qty', 'Total', 'Date', 'Status', ''],
            D.pos.filter(has).map(o => `
                <tr>
                    <td>${esc(o.id)}</td>
                    <td>${esc(o.supplier)}</td>
                    <td>${esc(o.item)}</td>
                    <td>${o.qty}</td>
                    <td>${peso(o.total)}</td>
                    <td>${esc(o.date)}</td>
                    <td>${pill(o.status)}</td>
                    <td class="r">
                        <button class="sm" onclick="receipt('${esc(o.id)}')">Receipt</button>
                    </td>
                </tr>
            `)
        );
    }

    if (tab === 'Suppliers') {
        body = `
            <div class="tools">
                ${search('Search suppliers')}
                <button class="pri" onclick="newSup()">Add supplier</button>
            </div>
        ` + table(
            ['ID', 'Supplier', 'Supplies', 'Contact', 'Status'],
            D.suppliers.filter(has).map(s => `
                <tr>
                    <td>${esc(s.id)}</td>
                    <td>${esc(s.name)}</td>
                    <td>${esc(s.item)}</td>
                    <td>${esc(s.contact)}</td>
                    <td>${pill(s.status)}</td>
                </tr>
            `)
        );
    }

    return `
        <h1>Purchasing</h1>
        <p class="sub">Create requests, place orders, and manage suppliers.</p>

        <div class="tabs">
            ${T.map(t => `
                <button
                    class="${t === tab ? 'on' : ''}"
                    onclick="tab='${t}';q='';render()"
                >${t}</button>
            `).join('')}
        </div>

        <div class="card">${body}</div>
    `;
}

// DELIVERY

function delivery() {
    const T = ['Incoming Deliveries', 'Discrepancies'];

    if (!T.includes(tab)) {
        tab = T[0];
    }

    const body = tab === T[0]
        ? table(
            ['Delivery ID', 'PO number', 'Supplier', 'Expected', 'Status'],
            D.dels.map(d => `
                <tr>
                    <td>${esc(d.id)}</td>
                    <td>${esc(d.po)}</td>
                    <td>${esc(d.supplier)}</td>
                    <td>${esc(d.date)}</td>
                    <td>${pill(d.status)}</td>
                </tr>
            `)
        )
        : table(
            ['ID', 'Delivery', 'Issue', 'Supplier', 'Status', ''],
            D.disc.map(d => `
                <tr>
                    <td>${esc(d.id)}</td>
                    <td>${esc(d.del)}</td>
                    <td>${esc(d.issue)}</td>
                    <td>${esc(d.supplier)}</td>
                    <td>${pill(d.status)}</td>
                    <td class="r">
                        ${d.status === 'Open'
                            ? `<button class="sm" onclick="resolveD('${esc(d.id)}')">Mark supplier resolved</button>`
                            : ''}
                    </td>
                </tr>
            `)
        );

    return `
        <h1>Delivery</h1>
        <p class="sub">Follow up suppliers on incoming deliveries and discrepancies. Procurement acts as Supplier Coordinator.</p>

        <div class="tabs">
            ${T.map(t => `
                <button
                    class="${t === tab ? 'on' : ''}"
                    onclick="tab='${t}';render()"
                >${t}</button>
            `).join('')}
        </div>

        <div class="card">${body}</div>
    `;
}

// CREATE PURCHASE REQUEST

function newPR(reqId, item) {
    const r = D.reqs.find(x => String(x.id) === String(reqId));

    curReq = r ? r.id : null;

    const suppliers = D.suppliers.filter(x => x.status === 'Active');

    modal(`
        <h2>New purchase request</h2>

        <label for="f1">Item</label>
        <input id="f1" value="${esc(r ? r.item : item || '')}">

        <label for="f2">Quantity</label>
        <input
            id="f2"
            type="number"
            min="1"
            value="${r && r.qty ? r.qty : 1}"
        >

        <label for="f3">Supplier</label>
        <select id="f3">
            ${suppliers.map(x => `
                <option value="${x._id}">${esc(x.name)}</option>
            `).join('')}
        </select>

        <label for="f4">Estimated cost (₱)</label>
        <input id="f4" type="number" min="0" value="0">

        <div class="tools" style="margin-top:16px;justify-content:flex-end">
            <button onclick="closeM()">Cancel</button>
            <button class="pri" onclick="savePR()">Save request</button>
        </div>
    `);
}

async function savePR() {
    const item = $('#f1').value.trim();
    const qty = Number($('#f2').value);
    const sid = Number($('#f3').value);

    if (!item || qty < 1 || !sid) {
        toast('Enter an item, a quantity of at least 1, and a supplier');
        return;
    }

    const row = {
        item,
        qty,
        supplier_id: sid,
        est_cost: Number($('#f4').value) || 0,
        created_by: ME.id
    };

    if (
        curReq &&
        D.reqs.some(r =>
            String(r.id) === String(curReq) &&
            r.from === 'Marketing'
        )
    ) {
        row.requisition_id = curReq;
    }

    const { error } = await sb
        .from('purchase_requests')
        .insert(row);

    if (error) {
        toast('Could not save: ' + error.message);
        return;
    }

    closeM();
    await load();
    go('purchasing', 'Purchase Requests');

    toast('Purchase request saved');
}

// CREATE PURCHASE ORDER AND DELIVERY


async function makePO(id) {
    const p = D.prs.find(x => String(x.id) === String(id));

    if (!p) {
        toast('Purchase request not found.');
        return;
    }

    if (!p.supplier_id) {
        toast('Please select a supplier first.');
        return;
    }

    // STEP 1: CREATE PURCHASE ORDER
    const { data: po, error: poError } = await sb
        .from('purchase_orders')
        .insert({
            purchase_request_id: p._id,
            supplier_id: p.supplier_id,
            item: p.item,
            qty: p.qty,
            total: p.cost || 0,
            created_by: ME.id
        })
        .select()
        .single();

    if (poError) {
        console.error(poError);
        toast('Could not create PO: ' + poError.message);
        return;
    }

    // STEP 2: CREATE DELIVERY RECORD
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 7);

    const delivery = {
        purchase_order_id: po.id,
        supplier_id: p.supplier_id,
        items: `${p.item} x ${p.qty}`,
        qty: p.qty,
        expected_date: expectedDate.toISOString().slice(0, 10),
        status: 'Pending'
    };

    const { error: deliveryError } = await sb
        .from('deliveries')
        .insert(delivery);

    if (deliveryError) {
        console.error(deliveryError);
        toast('PO created, but delivery creation failed: ' + deliveryError.message);
        return;
    }

    // STEP 3: UPDATE PURCHASE REQUEST
    const { error: requestError } = await sb
        .from('purchase_requests')
        .update({ status: 'Ordered' })
        .eq('id', p._id);

    if (requestError) {
        console.error(requestError);
        toast('PO and delivery created, but request status update failed.');
        return;
    }

    // STEP 4: REFRESH DASHBOARD
    await load();
    go('purchasing', 'Purchase Orders');

    toast('Purchase Order created! Delivery sent to Logistics.');
}

// PURCHASE ORDER RECEIPT

function receipt(id) {
    const o = D.pos.find(x => String(x.id) === String(id));

    if (!o) return;

    modal(`
        <h2>Purchase order receipt</h2>

        <div class="rc">
            <div class="row"><span>PO number</span><b>${esc(o.id)}</b></div>
            <div class="row"><span>Date</span><span>${esc(o.date)}</span></div>
            <div class="row"><span>Supplier</span><span>${esc(o.supplier)}</span></div>
            <div class="row"><span>Item</span><span>${esc(o.item)}</span></div>
            <div class="row"><span>Quantity</span><span>${o.qty}</span></div>
            <div class="row"><span>Total</span><b>${peso(o.total)}</b></div>
        </div>

        <div class="tools noprint" style="margin-top:16px;justify-content:flex-end">
            <button onclick="closeM()">Close</button>
            <button class="pri" onclick="window.print()">Print receipt</button>
        </div>
    `);
}

// SUPPLIERS

function newSup() {
    modal(`
        <h2>Add supplier</h2>

        <label for="s1">Name</label>
        <input id="s1">

        <label for="s2">Supplies</label>
        <input id="s2">

        <label for="s3">Contact</label>
        <input id="s3">

        <div class="tools" style="margin-top:16px;justify-content:flex-end">
            <button onclick="closeM()">Cancel</button>
            <button class="pri" onclick="saveSup()">Save supplier</button>
        </div>
    `);
}

async function saveSup() {
    const name = $('#s1').value.trim();

    if (!name) {
        toast('Enter the supplier name');
        return;
    }

    const { error } = await sb
        .from('suppliers')
        .insert({
            name,
            supplies: $('#s2').value.trim(),
            contact: $('#s3').value.trim()
        });

    if (error) {
        toast('Could not save: ' + error.message);
        return;
    }

    closeM();
    await load();
    render();

    toast('Supplier saved');
}

// DISCREPANCY RESOLUTION

function resolveD(id) {
    const d = D.disc.find(x => String(x.id) === String(id));

    if (!d) return;

    modal(`
        <h2>Resolve ${esc(id)}</h2>

        <label for="v1">Resolution agreed with supplier</label>

        <select id="v1">
            <option>Replacement</option>
            <option>Refund</option>
            <option>Credit note</option>
        </select>

        <div class="tools" style="margin-top:16px;justify-content:flex-end">
            <button onclick="closeM()">Cancel</button>
            <button class="pri" onclick="saveRes('${esc(id)}')">Save resolution</button>
        </div>
    `);
}

async function saveRes(id) {
    const x = D.disc.find(d => String(d.id) === String(id));

    if (!x) return;

    const result = await sb
        .from('delivery_discrepancies')
        .update({
            status: 'Resolved',
            resolution: $('#v1').value,
            resolved_by: ME.id,
            resolved_at: new Date().toISOString()
        })
        .eq('id', x._id);

    if (result.error) {
        toast('Could not save: ' + result.error.message);
        return;
    }

    await sb
        .from('deliveries')
        .update({ status: 'Completed' })
        .eq('id', x.delId);

    closeM();
    await load();
    render();

    toast('Discrepancy resolved');
}

// RENDER DASHBOARD

function render(keep) {
    $('#nav').innerHTML = VIEWS.map(([key, icon, label]) => `
        <a
            class="${key === view ? 'on' : ''}"
            tabindex="0"
            onclick="go('${key}')"
            onkeydown="if(event.key==='Enter')go('${key}')"
        >
            <span class="nav-icon">${icon}</span>
            ${label}
        </a>
    `).join('') + `
        <a tabindex="0" onclick="logout()">
            <span class="nav-icon">⇥</span>
            Logout
        </a>
    `;

    const y = window.scrollY;

    const pages = {
        dashboard,
        requisition,
        inventory,
        purchasing,
        delivery
    };

    $('#main').innerHTML = pages[view]();

    if (keep) {
        const el = document.querySelector('main input');

        if (el) {
            el.focus();
            el.setSelectionRange(q.length, q.length);
        }

        window.scrollTo(0, y);
    }
}

// INITIALIZATION

async function init() {
    $('#main').innerHTML = '<p class="mut">Loading...</p>';

    if (!(await guard(['procurement']))) {
        return;
    }

    $('.who').innerHTML = `
        <b>${esc(ME.department)} Department</b>
        ${esc(ME.username || '')}
    `;

    await load();
    render();
}

init();
