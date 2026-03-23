// Shared cart store — included on every page
// Cart item: { id, title, price, cover_image, quantity }

const CartStore = (() => {
  const KEY = 'zine_cart';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }

  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: { items } }));
  }

  function getItems() { return load(); }

  function totalQty() {
    return load().reduce((s, i) => s + i.quantity, 0);
  }

  function add(zine) {
    const items = load();
    const idx = items.findIndex(i => i.id === zine.id);
    if (idx > -1) {
      items[idx].quantity += 1;
    } else {
      items.push({ id: zine.id, title: zine.title, price: zine.price, cover_image: zine.cover_image, quantity: 1 });
    }
    save(items);
  }

  function setQty(id, qty) {
    let items = load();
    if (qty <= 0) {
      items = items.filter(i => i.id !== id);
    } else {
      const idx = items.findIndex(i => i.id === id);
      if (idx > -1) items[idx].quantity = qty;
    }
    save(items);
  }

  function remove(id) {
    save(load().filter(i => i.id !== id));
  }

  function clear() { save([]); }

  function subtotal() {
    return load().reduce((s, i) => s + i.price * i.quantity, 0);
  }

  return { getItems, totalQty, add, setQty, remove, clear, subtotal };
})();

// ─── Shared utilities ─────────────────────────────────────────────────────────

function fmt(n) {
  return '$' + Number(n).toFixed(2);
}

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function updateCartBadge() {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = CartStore.totalQty();
}

// Update badge on load and on cart changes
updateCartBadge();
window.addEventListener('cart:updated', updateCartBadge);

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();
