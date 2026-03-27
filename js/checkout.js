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
    updateTotals(data.subtotal, data.shippingCost, data.taxAmount, data.total);

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

    // Show the form before mounting so Stripe iframes render into a visible container
    loadingEl.style.display = 'none';
    document.getElementById('payment-form').style.display = 'block';

    // Payment element (card details only)
    const paymentElement = elementsInstance.create('payment');
    paymentElement.on('loaderror', ev => {
      const errEl = document.getElementById('co-init-error');
      errEl.textContent = 'Card form failed to load: ' + (ev.error && ev.error.message ? ev.error.message : JSON.stringify(ev));
      errEl.style.display = 'block';
    });
    paymentElement.mount('#payment-element');

  } catch (err) {
    loadingEl.style.display  = 'none';
    initErrEl.textContent    = err.message;
    initErrEl.style.display  = 'block';
  }
}

// ─── Shipping radio buttons ────────────────────────────────────────────────────

document.querySelectorAll('input[name="shipping"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const newShipping = radio.value;
    if (newShipping !== currentShipping) {
      currentShipping = newShipping;
      refreshTotals(newShipping);
    }
  });
});

// ─── Refresh totals (shipping + tax) ──────────────────────────────────────────

function getCurrentAddress() {
  return {
    state:   document.getElementById('ship-state').value.trim(),
    zip:     document.getElementById('ship-zip').value.trim(),
    country: document.getElementById('ship-country').value.trim(),
  };
}

async function refreshTotals(shipping = currentShipping) {
  if (!paymentIntentId) return;
  try {
    const address = getCurrentAddress();
    const body    = { items, shipping };
    if (address.country) body.address = address;

    const res  = await fetch(`/api/payment-intent/${paymentIntentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) updateTotals(data.subtotal, data.shippingCost, data.taxAmount, data.total);
  } catch (e) {
    console.error('Totals update failed:', e);
  }
}

// Re-calculate tax whenever a key address field is filled in
['ship-state', 'ship-zip', 'ship-country'].forEach(id => {
  document.getElementById(id).addEventListener('blur', () => {
    if (document.getElementById('ship-country').value.trim()) refreshTotals();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateTotals(subtotal, shippingCost, taxAmount, total) {
  document.getElementById('co-subtotal').textContent = fmt(subtotal);
  document.getElementById('co-shipping').textContent = fmt(shippingCost);
  document.getElementById('co-tax').textContent      = taxAmount > 0 ? fmt(taxAmount) : '—';
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

  // Collect shipping address from HTML fields
  const name    = document.getElementById('ship-name').value.trim();
  const line1   = document.getElementById('ship-line1').value.trim();
  const line2   = document.getElementById('ship-line2').value.trim();
  const city    = document.getElementById('ship-city').value.trim();
  const state   = document.getElementById('ship-state').value.trim();
  const zip     = document.getElementById('ship-zip').value.trim();
  const country = document.getElementById('ship-country').value.trim();

  if (!name || !line1 || !city || !zip || !country) {
    errorEl.textContent   = 'Please fill in all required shipping fields.';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Processing…';
  errorEl.style.display = 'none';

  const { error } = await stripeInstance.confirmPayment({
    elements: elementsInstance,
    confirmParams: {
      return_url: `${window.location.origin}/success.html`,
      shipping: {
        name,
        address: {
          line1,
          line2:       line2 || undefined,
          city,
          state:       state || undefined,
          postal_code: zip,
          country:     country.length === 2 ? country.toUpperCase() : undefined,
        },
      },
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
