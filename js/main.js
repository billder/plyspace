// index.html — product grid

const grid = document.getElementById('products-grid');

function placeholderSvg() {
  return `
    <div class="card-image-placeholder">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
      <span>No cover</span>
    </div>`;
}

function renderCard(zine) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.dataset.id = zine.id;

  const imgHtml = zine.cover_image
    ? `<img src="${zine.cover_image}" alt="${escHtml(zine.title)} cover" loading="lazy">`
    : placeholderSvg();

  card.innerHTML = `
    <div class="card-image">${imgHtml}</div>
    <div class="card-body">
      <div class="card-title">${escHtml(zine.title)}</div>
      ${zine.description ? `<div class="card-desc">${escHtml(zine.description)}</div>` : ''}
    </div>
    <div class="card-footer">
      <div class="card-price">${fmt(zine.price)}</div>
      <button class="btn-add" data-id="${zine.id}">Add to cart</button>
    </div>`;

  card.querySelector('.btn-add').addEventListener('click', () => addToCart(zine, card));
  return card;
}

function addToCart(zine, card) {
  CartStore.add(zine);
  const btn = card.querySelector('.btn-add');
  btn.textContent = 'Added!';
  btn.classList.add('added');
  setTimeout(() => {
    btn.textContent = 'Add to cart';
    btn.classList.remove('added');
  }, 1200);
  showToast(`"${zine.title}" added to cart`, 'success');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadProducts() {
  try {
    const res = await fetch('/api/zines');
    if (!res.ok) throw new Error('Failed to load');
    const zines = await res.json();

    grid.innerHTML = '';

    if (zines.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          <h2>No zines yet</h2>
          <p>Check back soon — more coming!</p>
        </div>`;
      return;
    }

    zines.forEach(z => grid.appendChild(renderCard(z)));
  } catch (err) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h2>Couldn't load zines</h2>
        <p>Please refresh the page.</p>
      </div>`;
    console.error(err);
  }
}

loadProducts();
