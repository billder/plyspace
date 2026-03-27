// checkout.html
// Note: fmt() is provided by cart-store.js

const items = CartStore.getItems();
if (!items.length) window.location.href = '/cart.html';

let paymentIntentId  = null;
let stripeInstance   = null;
let elementsInstance = null;
let currentShipping  = 'us';

// Render items immediately — don't wait for the API
renderOrderItems();

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl  = document.getElementById('co-loading');
  const initErrEl  = document.getElementById('co-init-error');

  try {
    // Fetch publishable key
    const { publishableKey } = await fetch('/api/config').then(r => r.json());
    if (!publishableKey) throw new Error('Stripe is not configured.');
    stripeInstance = Stripe(publishableKey);

    // Create payment intent (default: US shipping)
    const res  = await fetch('/api/payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, shipping: 'us' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not start checkout.');

    paymentIntentId = data.paymentIntentId;
    updateTotals(data.subtotal, data.shippingCost, data.total);

    // Stripe Elements appearance (matches site palette)
    elementsInstance = stripeInstance.elements({
      clientSecret: data.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary:     '#C1440E',
          colorBackground:  '#FFFFFF',
          colorText:        '#1A1A1A',
          colorDanger:      '#C1440E',
          fontFamily:       '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSizeBase:     '15px',
          borderRadius:     '6px',
          spacingUnit:      '4px',
        },
        rules: {
          '.Input': { border: '1px solid #E3E2DD', boxShadow: 'none' },
          '.Input:focus': { borderColor: '#C1440E', boxShadow: 'none' },
          '.Label': { fontWeight: '600', fontSize: '13px' },
        },
      },
    });

    // Address element — detects country to set shipping rate
    const addressElement = elementsInstance.create('address', { mode: 'shipping' });
    addressElement.mount('#address-element');

    let shippingTimer = null;
    addressElement.on('change', event => {
      const country = event.value?.address?.country;
      if (!country) return;
      const newShipping = country === 'US' ? 'us' : 'intl';
      if (newShipping !== currentShipping) {
        currentShipping = newShipping;
        clearTimeout(shippingTimer);
        shippingTimer = setTimeout(() => refreshShipping(newShipping), 500);
      }
    });

    // Payment element (card details)
    const paymentElement = elementsInstance.create('payment', {
      fields: { billingDetails: { address: 'never' } },
    });
    paymentElement.mount('#payment-element');

    loadingEl.style.display = 'none';
    document.getElementById('payment-form').style.display = 'block';

  } catch (err) {
    loadingEl.style.display  = 'none';
    initErrEl.textContent    = err.message;
    initErrEl.style.display  = 'block';
  }
}

// ─── Update shipping cost on country change ────────────────────────────────────

async function refreshShipping(shipping) {
  try {
    const res  = await fetch(`/api/payment-intent/${paymentIntentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, shipping }),
    });
    const data = await res.json();
    if (res.ok) updateTotals(data.subtotal, data.shippingCost, data.total);
  } catch (e) {
    console.error('Shipping update failed:', e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateTotals(subtotal, shippingCost, total) {
  document.getElementById('co-subtotal').textContent = fmt(subtotal);
  document.getElementById('co-shipping').textContent = fmt(shippingCost);
  document.getElementById('co-total').textContent    = fmt(total);
  document.getElementById('pay-amount').textContent  = fmt(total);
}

function renderOrderItems() {
  document.getElementById('order-items').innerHTML = items.map(item => `
    <div class="co-item">
      ${item.cover_image
        ? `<img class="co-item-img" src="${item.cover_image}" alt="">`
        : `<div class="co-item-img co-item-no-img"></div>`}
      <div class="co-item-info">
        <div class="co-item-title">${item.title}</div>
        <div class="co-item-meta">Qty ${item.quantity} &nbsp;·&nbsp; ${fmt(item.price)} each</div>
      </div>
      <div class="co-item-subtotal">${fmt(item.price * item.quantity)}</div>
    </div>
  `).join('');
}

// ─── Submit payment ───────────────────────────────────────────────────────────

document.getElementById('payment-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn     = document.getElementById('pay-btn');
  const errorEl = document.getElementById('payment-error');

  btn.disabled    = true;
  btn.textContent = 'Processing…';
  errorEl.style.display = 'none';

  const { error } = await stripeInstance.confirmPayment({
    elements: elementsInstance,
    confirmParams: {
      return_url: `${window.location.origin}/success.html`,
    },
  });

  // Only reached if there's an error (success redirects automatically)
  if (error) {
    errorEl.textContent    = error.message;
    errorEl.style.display  = 'block';
    btn.disabled           = false;
    btn.innerHTML          = `Pay <span id="pay-amount">${document.getElementById('co-total').textContent}</span>`;
  }
});

init();
