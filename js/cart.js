// cart.html

const itemsList    = document.getElementById('cart-items-list');
const emptyState   = document.getElementById('empty-state');
const cartLayout   = document.getElementById('cart-layout');
const itemCountEl  = document.getElementById('item-count');
const subtotalEl   = document.getElementById('subtotal');
const totalEl      = document.getElementById('total');
const checkoutBtn  = document.getElementById('checkout-btn');
const successBanner = document.getElementById('success-banner');

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderItems() {
  const items = CartStore.getItems();
  itemsList.innerHTML = '';

  if (items.length === 0) {
    emptyState.style.display   = 'block';
    cartLayout.style.display   = 'none';
    checkoutBtn.disabled = true;
    return;
  }

  emptyState.style.display  = 'none';
  cartLayout.style.display  = 'grid';
  checkoutBtn.disabled = false;

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    el.dataset.id = item.id;

    const imgHtml = item.cover_image
      ? `<img class="cart-item-img" src="${item.cover_image}" alt="${escHtml(item.title)}">`
      : `<div class="cart-item-img-placeholder">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
             <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
           </svg>
         </div>`;

    el.innerHTML = `
      ${imgHtml}
      <div class="cart-item-info">
        <div class="cart-item-title">${escHtml(item.title)}</div>
        <div class="cart-item-price">${fmt(item.price)} each</div>
        <div class="cart-item-controls">
          <button class="qty-btn" data-action="dec" aria-label="Decrease quantity">−</button>
          <span class="qty-display">${item.quantity}</span>
          <button class="qty-btn" data-action="inc" aria-label="Increase quantity">+</button>
          <button class="remove-btn" data-action="remove">Remove</button>
        </div>
      </div>`;

    el.querySelector('[data-action="dec"]').addEventListener('click', () => {
      CartStore.setQty(item.id, item.quantity - 1);
      renderItems();
      updateSummary();
    });
    el.querySelector('[data-action="inc"]').addEventListener('click', () => {
      CartStore.setQty(item.id, item.quantity + 1);
      renderItems();
      updateSummary();
    });
    el.querySelector('[data-action="remove"]').addEventListener('click', () => {
      CartStore.remove(item.id);
      renderItems();
      updateSummary();
    });

    itemsList.appendChild(el);
  });

  updateSummary();
}

function updateSummary() {
  const items = CartStore.getItems();
  const qty   = CartStore.totalQty();
  const sub   = CartStore.subtotal();

  itemCountEl.textContent = qty;
  subtotalEl.textContent  = fmt(sub);
  totalEl.textContent     = fmt(sub);
  checkoutBtn.disabled    = items.length === 0;
}

// Check for success param
if (new URLSearchParams(window.location.search).get('success') === 'true') {
  successBanner.style.display = 'flex';
  CartStore.clear();
  // Clean URL
  history.replaceState(null, '', '/cart.html');
}

// Checkout
checkoutBtn.addEventListener('click', () => {
  if (!CartStore.getItems().length) return;
  if (typeof track === 'function') track('checkout_start', 'cart');
  window.location.href = '/checkout.html';
});

// Listen for cart changes from other tabs
window.addEventListener('cart:updated', () => {
  renderItems();
});

renderItems();
