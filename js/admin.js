// admin.html

const loginView    = document.getElementById('login-view');
const adminView    = document.getElementById('admin-view');
const loginForm    = document.getElementById('login-form');
const loginError   = document.getElementById('login-error');
const logoutBtn    = document.getElementById('logout-btn');
const zineForm     = document.getElementById('zine-form');
const formTitle    = document.getElementById('form-title');
const submitBtn    = document.getElementById('submit-btn');
const cancelBtn    = document.getElementById('cancel-edit-btn');
const formStatus   = document.getElementById('form-status');
const zinesTable   = document.getElementById('zines-table');
const zinesTbody   = document.getElementById('zines-tbody');
const noZines      = document.getElementById('no-zines');
const tableLoading = document.getElementById('table-loading');
const imagePreview = document.getElementById('image-preview');
const imageInput   = document.getElementById('zine-image');

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Password toggle ──────────────────────────────────────────────────────────

const EYE_OPEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_SHUT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

document.getElementById('toggle-pw').addEventListener('click', () => {
  const input = document.getElementById('password');
  const btn   = document.getElementById('toggle-pw');
  const show  = input.type === 'password';
  input.type    = show ? 'text' : 'password';
  btn.innerHTML = show ? EYE_SHUT : EYE_OPEN;
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuth() {
  const res  = await fetch('/api/admin/status');
  const data = await res.json();
  if (data.isAdmin) showAdmin();
}

function showAdmin() {
  loginView.style.display  = 'none';
  adminView.style.display  = 'block';
  logoutBtn.style.display  = 'inline-block';
  loadZines();
  loadMetrics();
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.style.display = 'none';
  const password = document.getElementById('password').value;

  const res  = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();

  if (res.ok) {
    showAdmin();
  } else {
    loginError.textContent   = data.error || 'Login failed';
    loginError.style.display = 'block';
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  loginView.style.display  = 'block';
  adminView.style.display  = 'none';
  logoutBtn.style.display  = 'none';
});

// ─── Image preview ────────────────────────────────────────────────────────────

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (file) {
    const url = URL.createObjectURL(file);
    imagePreview.src = url;
    imagePreview.style.display = 'block';
  } else {
    imagePreview.style.display = 'none';
  }
});

// ─── Load zines ───────────────────────────────────────────────────────────────

async function loadZines() {
  tableLoading.style.display = 'block';
  zinesTable.style.display   = 'none';
  noZines.style.display      = 'none';

  try {
    const res   = await fetch('/api/admin/zines');
    const zines = await res.json();

    tableLoading.style.display = 'none';

    if (!zines.length) {
      noZines.style.display = 'block';
      return;
    }

    zinesTable.style.display = 'table';
    zinesTbody.innerHTML = '';
    zines.forEach(z => zinesTbody.appendChild(buildRow(z)));
  } catch {
    tableLoading.textContent = 'Failed to load zines.';
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildRow(z) {
  const tr = document.createElement('tr');
  const imgHtml = z.cover_image
    ? `<img class="thumb" src="${z.cover_image}" alt="">`
    : `<div style="width:40px;height:54px;background:var(--bg);border-radius:3px;border:1px solid var(--border)"></div>`;

  const stock = z.stock === -1 ? '∞' : z.stock;
  tr.innerHTML = `
    <td>${imgHtml}</td>
    <td><strong>${escHtml(z.title)}</strong></td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(z.description)}</td>
    <td>$${Number(z.price).toFixed(2)}</td>
    <td>${stock}</td>
    <td><span class="badge ${z.active ? 'active' : 'inactive'}">${z.active ? 'Active' : 'Hidden'}</span></td>
    <td>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-secondary" style="padding:5px 10px;font-size:.78rem" data-action="edit">Edit</button>
        ${z.active
          ? `<button class="btn-danger" data-action="hide">Hide</button>`
          : `<button class="btn-secondary" style="padding:5px 10px;font-size:.78rem" data-action="show">Show</button>`
        }
        <button class="btn-danger" data-action="delete">Delete</button>
      </div>
    </td>`;

  tr.querySelector('[data-action="edit"]').addEventListener('click', () => beginEdit(z));
  tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteZine(z.id));
  const hideBtn = tr.querySelector('[data-action="hide"]');
  if (hideBtn) hideBtn.addEventListener('click', () => toggleActive(z.id, 0));
  const showBtn = tr.querySelector('[data-action="show"]');
  if (showBtn) showBtn.addEventListener('click', () => toggleActive(z.id, 1));

  return tr;
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────

let editingId = null;

function resetForm() {
  editingId = null;
  zineForm.reset();
  imagePreview.style.display = 'none';
  formTitle.textContent    = 'Add New Zine';
  submitBtn.textContent    = 'Add Zine';
  cancelBtn.style.display  = 'none';
  formStatus.textContent   = '';
  document.getElementById('edit-id').value = '';
}

function beginEdit(z) {
  editingId = z.id;
  document.getElementById('edit-id').value     = z.id;
  document.getElementById('zine-title').value   = z.title;
  document.getElementById('zine-desc').value    = z.description;
  document.getElementById('zine-details').value = z.details ?? '';
  document.getElementById('zine-price').value  = z.price;
  document.getElementById('zine-stock').value  = z.stock;
  if (z.cover_image) {
    imagePreview.src = z.cover_image;
    imagePreview.style.display = 'block';
  }
  formTitle.textContent   = 'Edit Zine';
  submitBtn.textContent   = 'Save Changes';
  cancelBtn.style.display = 'inline-block';
  formStatus.textContent  = '';
  zineForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

cancelBtn.addEventListener('click', resetForm);

zineForm.addEventListener('submit', async e => {
  e.preventDefault();
  submitBtn.disabled    = true;
  formStatus.textContent = editingId ? 'Saving…' : 'Adding…';

  const body = new FormData();
  body.append('title',       document.getElementById('zine-title').value.trim());
  body.append('description', document.getElementById('zine-desc').value.trim());
  body.append('details',     document.getElementById('zine-details').value.trim());
  body.append('price',       document.getElementById('zine-price').value);
  body.append('stock',       document.getElementById('zine-stock').value);
  const file = document.getElementById('zine-image').files[0];
  if (file) body.append('cover_image', file);

  const url    = editingId ? `/api/admin/zines/${editingId}` : '/api/admin/zines';
  const method = editingId ? 'PUT' : 'POST';

  try {
    const res  = await fetch(url, { method, body });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Save failed');

    showToast(editingId ? 'Zine updated.' : 'Zine added!', 'success');
    resetForm();
    loadZines();
  } catch (err) {
    formStatus.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// ─── Actions ──────────────────────────────────────────────────────────────────

async function deleteZine(id) {
  if (!confirm('Permanently delete this zine?')) return;
  const res = await fetch(`/api/admin/zines/${id}`, { method: 'DELETE' });
  if (res.ok) { showToast('Zine deleted.'); loadZines(); }
  else showToast('Delete failed.', 'error');
}

async function toggleActive(id, active) {
  const body = new FormData();
  body.append('active', active);
  const res = await fetch(`/api/admin/zines/${id}`, { method: 'PUT', body });
  if (res.ok) { showToast(active ? 'Zine is now visible.' : 'Zine hidden.', 'success'); loadZines(); }
  else showToast('Update failed.', 'error');
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

async function loadMetrics() {
  const loadingEl = document.getElementById('metrics-loading');
  const contentEl = document.getElementById('metrics-content');

  try {
    const res  = await fetch('/api/admin/metrics');
    const rows = await res.json();

    // Build a lookup: { 'event/page': count }
    const counts = {};
    rows.forEach(r => { counts[`${r.event}/${r.page}`] = r.count; });

    const get = key => counts[key] || 0;
    const base = get('pageview/index') || 1; // avoid division by zero
    const pct  = n => base ? Math.round((n / base) * 100) + '%' : '—';

    // Funnel steps
    const funnel = [
      { label: 'Browse (index)',    count: get('pageview/index') },
      { label: 'Add to cart',       count: get('add_to_cart/index') },
      { label: 'Cart',              count: get('pageview/cart') },
      { label: 'Checkout started',  count: get('checkout_start/cart') },
      { label: 'Checkout page',     count: get('pageview/checkout') },
      { label: 'Purchased',         count: get('purchase_complete/success') },
    ];

    const funnelTbody = document.getElementById('funnel-tbody');
    funnelTbody.innerHTML = funnel.map(f => `
      <tr>
        <td>${f.label}</td>
        <td style="text-align:right">${f.count.toLocaleString()}</td>
        <td style="text-align:right;color:var(--text-muted)">${pct(f.count)}</td>
      </tr>
    `).join('');

    // All other events (raw)
    const eventsTbody = document.getElementById('events-tbody');
    eventsTbody.innerHTML = rows.length
      ? rows.map(r => `
          <tr>
            <td>${r.event}</td>
            <td>${r.page}</td>
            <td style="text-align:right">${r.count.toLocaleString()}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" style="color:var(--text-muted)">No events yet.</td></tr>';

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
  } catch {
    loadingEl.textContent = 'Failed to load metrics.';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

checkAuth();
