
/* ==========================================
   PYNX LOGISTICS DASHBOARD
   SUPABASE INTEGRATION
========================================== */

const $ = selector => document.querySelector(selector);
const sb = window.supabaseClient;
const LOGIN_URL = '../Log_in/login.html';

let ME = null;

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
    date ? new Date(date + 'T00:00:00').toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }) : '';

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
        alert('Supabase configuration was not loaded.');
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
        alert('Unable to verify your department.');
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
    if (!confirm('Are you sure you want to log out?')) return;

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
    reqs: [],
    products: []
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
    const [
        deliveries,
        discrepancies,
        requisitions,
        products
    ] = await Promise.all([
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
        ),

        get(
            'inventory_products',
            '*',
            'name'
        )
    ]);

    if (
        deliveries === null ||
        discrepancies === null ||
        requisitions === null ||
        products === null
    ) {
        toast('Some data could not load. Check the browser console.');
    }
    // Automatically mark overdue, unreceived deliveries as Delayed
const today = new Date();
const todayIso =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

const { data: delayedRows, error: delayedError } = await sb
    .from('deliveries')
    .update({ status: 'Delayed' })
    .eq('status', 'Pending')
    .is('received_date', null)
    .lt('expected_date', todayIso)
    .select('id');

if (delayedError) {
    console.error('Automatic delayed update failed:', delayedError);
} else if (delayedRows?.length) {
    const delayedIds = new Set(delayedRows.map(row => row.id));

    (deliveries || []).forEach(row => {
        if (delayedIds.has(row.id)) {
            row.status = 'Delayed';
        }
    });

    console.log('Overdue deliveries marked as Delayed:', delayedRows);
}

   D.dels = (deliveries || []).map(row => ({
    id: row.code,
    _id: row.id,
       purchase_order_id: row.purchase_order_id,
    po: row.purchase_orders?.code || '',
    supplier: row.suppliers?.name || '',
    date: fmt(row.expected_date),
    items: row.items || '',
    qty: Number(row.qty) || 0,
    actualReceived: row.actual_received_qty,
    accepted: row.accepted_qty,
    damaged: row.damaged_qty,
    missing: row.missing_qty,
    inspectionNotes: row.inspection_notes || '',
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
        purpose: row.purpose || '',
        needed: row.needed_by || '',
        reason: row.reason || '',
        status: row.status
    }));

    // Products from the real inventory table
    D.products = (products || [])
        .filter(product =>
            !product.archived &&
            Number(product.qty) > 0
        )
        .map(product => ({
            sku: product.sku,
            name: product.name,
            unit: product.unit || '',
            stock: Number(product.qty) || 0
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
    if (newTab) tab = newTab;
    q = '';
    render();
}

/* ==========================================
   MODAL HELPERS
========================================== */

function modal(content) {
    $('#layer').innerHTML = `
        <div class="modal" onclick="if(event.target === this) closeM()">
            <div class="card">${content}</div>
        </div>
    `;
}

function closeM() {
    $('#layer').innerHTML = '';
}

const cancel = `<button onclick="closeM()">Cancel</button>`;

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
                    <span><b>Receive Delivery</b><br>
                    <span class="mut">Record an arrived delivery</span></span>
                    <button class="pri sm"
                        onclick="go('delivery','Incoming Deliveries')">
                        Receive
                    </button>
                </div>

                <div class="row">
                    <span><b>Start Inspection</b><br>
                    <span class="mut">Check received items</span></span>
                    <button class="sm"
                        onclick="go('delivery','Inspection')">
                        Inspect
                    </button>
                </div>

                <div class="row">
                    <span><b>Report Discrepancy</b><br>
                    <span class="mut">Missing or damaged items</span></span>
                    <button class="sm" onclick="reportD()">Report</button>
                </div>
            </div>

            <div class="card">
                <h2>Delivery Alerts</h2>

                <div class="row">
                    <span>${open.length} deliveries have discrepancies.</span>
                    <button class="sm"
                        onclick="go('delivery','Discrepancies')">View</button>
                </div>

                <div class="row">
                    <span>${by(['Delayed']).length} deliveries are delayed.</span>
                    <button class="sm"
                        onclick="go('delivery','Incoming Deliveries')">View</button>
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
   REQUISITION LIST
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
                ['ID', 'Purpose', 'Item', 'Qty', 'Needed by', 'Status'],
                D.reqs.filter(has).map(request => `
                    <tr>
                        <td>${esc(request.id)}</td>
                        <td>${esc(request.purpose)}</td>
                        <td>${esc(request.item)}</td>
                        <td>${request.qty}</td>
                        <td>${esc(request.needed)}</td>
                        <td>${pill(request.status)}</td>
                    </tr>
                `)
            )}
        </div>
    `;
}

/* ==========================================
   PRODUCT DROPDOWN ROWS
========================================== */

let requisitionRowCount = 0;

function productOptions() {
    if (!D.products.length) {
        return `<option value="">No available products</option>`;
    }

    return `
        <option value="">Select a product</option>
        ${D.products.map(product => `
            <option value="${esc(product.sku)}">
                ${esc(product.name)} (${product.stock} ${esc(product.unit)})
            </option>
        `).join('')}
    `;
}

function addMaterialRow() {
    const container = $('#materialRows');
    if (!container) return;

    const rowId = ++requisitionRowCount;

    const row = document.createElement('div');
    row.className = 'material-row';
    row.dataset.row = rowId;

    row.style.cssText =
        'display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:10px;align-items:end;margin-bottom:12px;';

    row.innerHTML = `
        <div>
            <label>Product</label>
            <select class="material-product"
                onchange="updateMaterialStock(${rowId})">
                ${productOptions()}
            </select>
            <small class="mut stock-info" id="stock-${rowId}">
                Select a product to see available stock.
            </small>
        </div>

        <div>
            <label>Quantity</label>
            <input class="material-qty"
                type="number" min="1" step="1" value="1">
        </div>

        <button type="button" class="sm"
            onclick="removeMaterialRow(${rowId})">
            Remove
        </button>
    `;

    container.appendChild(row);
}

function updateMaterialStock(rowId) {
    const row = document.querySelector(
        `.material-row[data-row="${rowId}"]`
    );

    if (!row) return;

    const sku = row.querySelector('.material-product').value;
    const product = D.products.find(item => item.sku === sku);
    const stockLabel = $(`#stock-${rowId}`);

    if (!product) {
        stockLabel.textContent =
            'Select a product to see available stock.';
        return;
    }

    stockLabel.textContent =
        `Available stock: ${product.stock} ${product.unit}`;
}

function removeMaterialRow(rowId) {
    const row = document.querySelector(
        `.material-row[data-row="${rowId}"]`
    );

    if (row) row.remove();
}

/* ==========================================
   NEW REQUISITION FORM
========================================== */

function newReq() {
    if (!D.products.length) {
        toast('No available inventory products. Check Inventory first.');
        return;
    }

    requisitionRowCount = 0;

    modal(`
        <h2>New Requisition</h2>

        <label for="reqPurpose">Project / Purpose</label>
        <input id="reqPurpose"
            placeholder="Enter project or purpose">

        <label for="reqNeededBy">Needed by</label>
        <input id="reqNeededBy" type="date"
            min="${new Date().toISOString().slice(0, 10)}">

        <label for="reqReason">Reason for request</label>
        <textarea id="reqReason"
            rows="3"
            style="width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:12px;"
            placeholder="Explain why these materials are needed"></textarea>

        <div style="margin-top:18px;">
            <h2>Materials needed</h2>
            <div id="materialRows"></div>
            <button type="button" onclick="addMaterialRow()">
                + Add material
            </button>
        </div>

        ${btns(
            cancel,
            '<button class="pri" onclick="saveReq()">Submit to Admin</button>'
        )}
    `);

    addMaterialRow();
}

/* ==========================================
   SAVE MULTI-ITEM REQUISITION
========================================== */

async function saveReq() {
    const purpose = $('#reqPurpose').value.trim();
    const neededBy = $('#reqNeededBy').value;
    const reason = $('#reqReason').value.trim();

    const rows = [
        ...document.querySelectorAll('.material-row')
    ];

    if (!purpose || !neededBy || !reason) {
        toast('Complete the purpose, needed-by date, and reason.');
        return;
    }

    if (!rows.length) {
        toast('Add at least one material.');
        return;
    }

    const materials = [];

    for (const row of rows) {
        const sku = row.querySelector('.material-product').value;
        const qty = Number(row.querySelector('.material-qty').value);

        const product = D.products.find(item => item.sku === sku);

        if (!product) {
            toast('Please select a valid product for every row.');
            return;
        }

        if (!Number.isInteger(qty) || qty < 1) {
            toast(`Enter a valid quantity for ${product.name}.`);
            return;
        }

        if (qty > product.stock) {
            toast(`Requested quantity exceeds available stock for ${product.name}.`);
            return;
        }

        materials.push({
            item: product.name,
            qty
        });
    }

    const firstMaterial = materials[0];
    const requisitionCode = generateCode('LR');

    // Parent record: retain legacy item and qty columns
    const parentRecord = {
        code: requisitionCode,
        purpose,
        needed_by: neededBy,
        reason,
        item: firstMaterial.item,
        qty: firstMaterial.qty,
        status: 'Pending',
        created_by: ME.id
    };

    const { data: parent, error: parentError } = await sb
        .from('logistics_requisitions')
        .insert(parentRecord)
        .select('id')
        .single();

    if (parentError) {
        console.error('Requisition error:', parentError);
        toast('Could not submit requisition: ' + parentError.message);
        return;
    }

    // Child records: all selected materials
    const itemRecords = materials.map(material => ({
        requisition_id: parent.id,
        item: material.item,
        qty: material.qty
    }));

    const { error: itemsError } = await sb
        .from('logistics_requisition_items')
        .insert(itemRecords);

    if (itemsError) {
        console.error('Requisition items error:', itemsError);
        toast(
            'Requisition created, but materials could not be saved: ' +
            itemsError.message
        );
        return;
    }

    closeM();
    await load();
    render();

    toast('Requisition submitted to Admin successfully.');
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

    const ordered = Number(delivery.qty) || 0;

    modal(`
        <h2>Inspect ${esc(delivery.id)}</h2>

        <p class="mut">
            ${esc(delivery.items)} from ${esc(delivery.supplier)}
        </p>

        <div class="card" style="margin:12px 0;padding:12px">
            <div class="mut">Ordered Quantity</div>
            <h2>${ordered} pcs</h2>
        </div>

        <label for="i-received">Actually Received</label>
        <input
            id="i-received"
            type="number"
            min="0"
            max="${ordered}"
            step="1"
            value="${ordered}"
        >

        <label for="i-damaged">Damaged Quantity</label>
        <input
            id="i-damaged"
            type="number"
            min="0"
            max="${ordered}"
            step="1"
            value="0"
        >

        <label for="i-notes">Inspection Notes</label>
        <textarea
            id="i-notes"
            placeholder="Describe missing or damaged items, if any"
        ></textarea>

        <div class="card" style="margin-top:12px;padding:12px">
            <div class="mut">Accepted quantity will be calculated automatically.</div>
            <p id="inspection-preview" style="margin-bottom:0">
                Accepted: ${ordered} pcs
            </p>
        </div>

        ${btns(
            cancel,
            `<button class="pri" onclick="saveInspect('${esc(id)}')">
                Save inspection
            </button>`
        )}
    `);

    const updatePreview = () => {
        const received = Number($('#i-received').value) || 0;
        const damaged = Number($('#i-damaged').value) || 0;
        const accepted = received - damaged;
        const missing = ordered - received;

        $('#inspection-preview').textContent =
            `Accepted: ${accepted} pcs · Damaged: ${damaged} pcs · Missing: ${missing} pcs`;
    };

    $('#i-received').addEventListener('input', updatePreview);
    $('#i-damaged').addEventListener('input', updatePreview);
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

    if (!delivery.purchase_order_id) {
        toast('Purchase Order ID is missing for this delivery.');
        console.error('Delivery record:', delivery);
        return;
    }

    const ordered = Number(delivery.qty) || 0;
    const actual = Number($('#i-received').value);
    const damaged = Number($('#i-damaged').value);
    const notes = $('#i-notes').value.trim();

    if (
        !Number.isInteger(actual) ||
        !Number.isInteger(damaged) ||
        actual < 0 ||
        damaged < 0 ||
        actual > ordered ||
        damaged > actual
    ) {
        toast('Please enter valid inspection quantities.');
        return;
    }

    const accepted = actual - damaged;
    const missing = ordered - actual;
    const hasIssues = damaged > 0 || missing > 0;

    if (hasIssues && !notes) {
        toast('Please provide inspection notes for missing or damaged items.');
        return;
    }

    
const saveButton = document.querySelector('#layer .pri');
if (saveButton) saveButton.disabled = true;

// 1. Save the inspection to Logistics
const { error } = await sb
    .from('deliveries')
    .update({
        actual_received_qty: actual,
        accepted_qty: accepted,
        damaged_qty: damaged,
        missing_qty: missing,
        inspection_notes: notes || null,
        inspected_by: ME.id,
        inspected_at: new Date().toISOString(),
        status: hasIssues ? 'With Issues' : 'Completed'
    })
    .eq('id', delivery._id);

if (error) {
    console.error('Inspection error:', error);
    if (saveButton) saveButton.disabled = false;
    toast('Could not save inspection: ' + error.message);
    return;
}

// 2. Determine Purchase Order status
const poStatus = hasIssues
    ? 'Received with Issues'
    : 'Received';

// 3. Update the related Purchase Order
const { data: updatedPO, error: poError } = await sb
    .from('purchase_orders')
    .update({ status: poStatus })
    .eq('id', delivery.purchase_order_id)
    .select('id, code, status');

if (poError) {
    console.error('Purchase Order status error:', poError);
    if (saveButton) saveButton.disabled = false;
    toast('Inspection saved, but PO update failed: ' + poError.message);
    return;
}

if (!updatedPO || updatedPO.length === 0) {
    console.error('No Purchase Order row was updated.');
    if (saveButton) saveButton.disabled = false;
    toast('Inspection saved, but PO was not updated.');
    return;
}

console.log('Purchase Order successfully updated:', updatedPO[0]);

// 4. Create discrepancy record if necessary
if (hasIssues) {
    const issue = [
        missing > 0 ? `${missing} missing` : '',
        damaged > 0 ? `${damaged} damaged` : '',
        notes
    ].filter(Boolean).join(' — ');

    const issueError = await addIssue(delivery, issue);

    if (issueError) {
        console.error('Discrepancy error:', issueError);
        toast('Inspection saved, but discrepancy report failed: ' + issueError.message);
    }
}

// 5. Finish
closeM();
await load();
go('delivery', hasIssues ? 'Discrepancies' : 'Reports');

toast(
    hasIssues
        ? `Inspection saved. ${accepted} pcs accepted; discrepancy reported.`
        : `Inspection completed. ${accepted} pcs accepted.`
);
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

