require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// DATA_DIR points to the persistent volume on Fly.io (/data),
// or falls back to the project root for local development.
const DATA_DIR = process.env.DATA_DIR || __dirname;

// On first boot with a fresh volume, seed the database from the bundled copy.
const volumeDb  = path.join(DATA_DIR, 'zines.db');
const bundledDb = path.join(__dirname, 'zines.db');
if (DATA_DIR !== __dirname && !fs.existsSync(volumeDb) && fs.existsSync(bundledDb)) {
  fs.copyFileSync(bundledDb, volumeDb);
  console.log('Seeded zines.db from bundled copy onto volume.');
}

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(path.join(DATA_DIR, 'zines.db'));
// Add details column to existing databases that pre-date this field
try {
  db.exec(`ALTER TABLE zines ADD COLUMN details TEXT NOT NULL DEFAULT '20 pages, 4×5, nice paper, all color'`);
} catch (_) { /* column already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS zines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    details     TEXT    NOT NULL DEFAULT '20 pages, 4×5, nice paper, all color',
    price       REAL    NOT NULL,
    cover_image TEXT    NOT NULL DEFAULT '',
    stock       INTEGER NOT NULL DEFAULT -1,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event      TEXT    NOT NULL,
    page       TEXT    NOT NULL,
    session_id TEXT,
    ts         INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_intent_id TEXT    NOT NULL UNIQUE,
    items             TEXT    NOT NULL DEFAULT '',
    name              TEXT    NOT NULL DEFAULT '',
    line1             TEXT    NOT NULL DEFAULT '',
    line2             TEXT    NOT NULL DEFAULT '',
    city              TEXT    NOT NULL DEFAULT '',
    state             TEXT    NOT NULL DEFAULT '',
    zip               TEXT    NOT NULL DEFAULT '',
    country           TEXT    NOT NULL DEFAULT '',
    shipped           INTEGER NOT NULL DEFAULT 0,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// ─── Middleware ───────────────────────────────────────────────────────────────

// Stripe webhooks need raw body — mount before express.json()
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.set('trust proxy', 1);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'zine-shop-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: true },
}));

// ─── File uploads ─────────────────────────────────────────────────────────────

const uploadDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/image\/(jpeg|png|gif|webp|avif)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

const requireAdmin = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// ─── Config (public) ──────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

// ─── Public API ───────────────────────────────────────────────────────────────

app.get('/api/zines', (_req, res) => {
  const zines = db.prepare(
    'SELECT * FROM zines WHERE active = 1 ORDER BY created_at DESC'
  ).all();
  res.json(zines);
});

// ─── Track ────────────────────────────────────────────────────────────────────

app.post('/api/track', (req, res) => {
  const { event, page, session_id } = req.body;
  if (!event || !page) return res.sendStatus(400);
  db.prepare('INSERT INTO events (event, page, session_id) VALUES (?, ?, ?)').run(
    String(event).slice(0, 64),
    String(page).slice(0, 64),
    session_id ? String(session_id).slice(0, 64) : null
  );
  res.sendStatus(200);
});

// ─── Checkout ─────────────────────────────────────────────────────────────────

// Stripe's exact supported country list for shipping_address_collection
const ALL_COUNTRIES = [
  'AC','AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AT','AU','AW','AX',
  'AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ',
  'BR','BS','BT','BV','BW','BY','BZ','CA','CD','CF','CG','CH','CI','CK','CL',
  'CM','CN','CO','CR','CV','CW','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC',
  'EE','EG','EH','ER','ES','ET','FI','FJ','FK','FO','FR','GA','GB','GD','GE',
  'GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IS','IT','JE',
  'JM','JO','JP','KE','KG','KH','KI','KM','KN','KR','KW','KY','KZ','LA','LB',
  'LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG',
  'MK','ML','MM','MN','MO','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF',
  'PG','PH','PK','PL','PM','PN','PR','PS','PT','PY','QA','RE','RO','RS','RU',
  'RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO',
  'SR','SS','ST','SV','SX','SZ','TA','TC','TD','TF','TG','TH','TJ','TK','TL',
  'TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ','VA','VC',
  'VE','VG','VN','VU','WF','WS','XK','YE','YT','ZA','ZM','ZW','ZZ',
];

app.post('/api/checkout', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const lineItems = [];
    let totalQty = 0;

    for (const item of items) {
      const zine = db.prepare(
        'SELECT * FROM zines WHERE id = ? AND active = 1'
      ).get(item.id);
      if (!zine) return res.status(400).json({ error: `Zine not found: ${item.id}` });

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      totalQty += qty;

      const imageUrls = zine.cover_image
        ? [`${BASE_URL}${zine.cover_image}`]
        : [];

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: zine.title,
            ...(zine.description && { description: zine.description }),
            ...(imageUrls.length && { images: imageUrls }),
          },
          unit_amount: Math.round(zine.price * 100),
        },
        quantity: qty,
      });
    }

    const usShipping   = totalQty * 200; // $2 per zine
    const intlShipping = totalQty * 300; // $3 per zine

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      shipping_address_collection: { allowed_countries: ALL_COUNTRIES },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: usShipping, currency: 'usd' },
            display_name: 'US Shipping ($2 per zine)',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 10 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: intlShipping, currency: 'usd' },
            display_name: 'International Shipping ($3 per zine)',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 10 },
              maximum: { unit: 'business_day', value: 21 },
            },
          },
        },
      ],
      success_url: `${BASE_URL}/cart.html?success=true`,
      cancel_url:  `${BASE_URL}/cart.html`,
    });

    res.json({ url: checkoutSession.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Embedded checkout: create payment intent ─────────────────────────────────

app.post('/api/payment-intent', async (req, res) => {
  try {
    const { items, shipping = 'us' } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let subtotal = 0, totalQty = 0;
    const lineDescriptions = [];
    for (const item of items) {
      const zine = db.prepare('SELECT * FROM zines WHERE id = ? AND active = 1').get(item.id);
      if (!zine) return res.status(400).json({ error: `Zine not found: ${item.id}` });
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      totalQty += qty;
      subtotal += zine.price * qty;
      lineDescriptions.push(qty > 1 ? `${zine.title} (x${qty})` : zine.title);
    }

    const shippingCost = totalQty * (shipping === 'us' ? 2 : 3);
    const total        = Math.round((subtotal + shippingCost) * 100);
    const description  = lineDescriptions.join(', ');

    const intent = await stripe.paymentIntents.create({
      amount:   total,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description,
      metadata: { shipping, totalQty: String(totalQty) },
    });

    res.json({
      clientSecret:    intent.client_secret,
      paymentIntentId: intent.id,
      subtotal,
      shippingCost,
      taxAmount: 0,
      total: subtotal + shippingCost,
    });
  } catch (err) {
    console.error('Payment intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Embedded checkout: update shipping / tax when address changes ────────────

app.patch('/api/payment-intent/:id', async (req, res) => {
  try {
    const { items, shipping = 'us', address } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    let subtotal = 0, totalQty = 0;
    const lineDescriptions = [];
    const taxLineItems     = [];
    for (const item of items) {
      const zine = db.prepare('SELECT * FROM zines WHERE id = ? AND active = 1').get(item.id);
      if (!zine) return res.status(400).json({ error: `Zine not found: ${item.id}` });
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      totalQty += qty;
      subtotal += zine.price * qty;
      lineDescriptions.push(qty > 1 ? `${zine.title} (x${qty})` : zine.title);
      taxLineItems.push({
        amount:    Math.round(zine.price * qty * 100),
        reference: `zine_${zine.id}`,
        tax_code:  'txcd_35010000', // Books & printed publications
      });
    }

    const shippingCost = totalQty * (shipping === 'us' ? 2 : 3);
    const description  = lineDescriptions.join(', ');

    // Add shipping as a taxable line item (Stripe Tax knows which states tax it)
    taxLineItems.push({
      amount:    Math.round(shippingCost * 100),
      reference: 'shipping',
      tax_code:  'txcd_92010001', // Shipping & handling
    });

    // ── Stripe Tax calculation (only when we have a country) ──────────────────
    let taxAmountCents  = 0;
    let taxCalculationId = null;

    const country = address?.country?.trim();
    if (country) {
      try {
        const calc = await stripe.tax.calculations.create({
          currency: 'usd',
          line_items: taxLineItems,
          customer_details: {
            address: {
              country:     country.length === 2 ? country.toUpperCase() : country,
              ...(address.state && { state: address.state.trim() }),
              ...(address.zip   && { postal_code: address.zip.trim() }),
            },
            address_source: 'shipping',
          },
        });
        taxAmountCents   = calc.tax_amount_exclusive;
        taxCalculationId = calc.id;
      } catch (taxErr) {
        console.error('Stripe Tax calculation error:', taxErr.message);
        // Fall through — charge without tax rather than blocking the purchase
      }
    }

    const finalAmount = Math.round((subtotal + shippingCost) * 100) + taxAmountCents;

    await stripe.paymentIntents.update(req.params.id, {
      amount:      finalAmount,
      description,
      metadata: {
        shipping,
        totalQty: String(totalQty),
        ...(taxCalculationId && { tax_calculation: taxCalculationId }),
      },
    });

    res.json({
      subtotal,
      shippingCost,
      taxAmount: taxAmountCents / 100,
      total:     subtotal + shippingCost + (taxAmountCents / 100),
    });
  } catch (err) {
    console.error('Update payment intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Stripe webhook (optional — extend to handle fulfillment) ─────────────────

app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.sendStatus(200);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Payment complete:', session.id, session.customer_details?.email);
    // TODO: send confirmation email, update stock, etc.
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;

    // Record order
    try {
      const s = intent.shipping;
      db.prepare(`
        INSERT OR IGNORE INTO orders
          (payment_intent_id, items, name, line1, line2, city, state, zip, country)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        intent.id,
        intent.description || '',
        s?.name                  || '',
        s?.address?.line1        || '',
        s?.address?.line2        || '',
        s?.address?.city         || '',
        s?.address?.state        || '',
        s?.address?.postal_code  || '',
        s?.address?.country      || ''
      );
      console.log('Order recorded:', intent.id);
    } catch (err) {
      console.error('Order recording error:', err.message);
    }

    // Record tax transaction
    const taxCalculationId = intent.metadata?.tax_calculation;
    if (taxCalculationId) {
      try {
        await stripe.tax.transactions.createFromCalculation({
          calculation: taxCalculationId,
          reference:   intent.id,
        });
        console.log('Tax transaction recorded for', intent.id);
      } catch (err) {
        console.error('Tax transaction error:', err.message);
      }
    }
  }

  res.sendStatus(200);
});

// ─── Admin API ────────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD not set in .env' });
  }
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

app.get('/api/admin/zines', requireAdmin, (_req, res) => {
  const zines = db.prepare('SELECT * FROM zines ORDER BY created_at DESC').all();
  res.json(zines);
});

app.post('/api/admin/zines', requireAdmin, upload.single('cover_image'), (req, res) => {
  const { title, description, details, price, stock } = req.body;
  if (!title || !price) return res.status(400).json({ error: 'title and price are required' });

  const coverImage = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(`
    INSERT INTO zines (title, description, details, price, cover_image, stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    (description || '').trim(),
    (details !== undefined ? details : '20 pages, 4×5, nice paper, all color').trim(),
    parseFloat(price),
    coverImage,
    stock !== undefined && stock !== '' ? parseInt(stock, 10) : -1
  );

  const zine = db.prepare('SELECT * FROM zines WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(zine);
});

app.put('/api/admin/zines/:id', requireAdmin, upload.single('cover_image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM zines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Zine not found' });

  const { title, description, details, price, stock, active } = req.body;
  const coverImage = req.file ? `/uploads/${req.file.filename}` : existing.cover_image;

  db.prepare(`
    UPDATE zines
    SET title = ?, description = ?, details = ?, price = ?, cover_image = ?, stock = ?, active = ?
    WHERE id = ?
  `).run(
    title        !== undefined ? title.trim()          : existing.title,
    description  !== undefined ? description.trim()    : existing.description,
    details      !== undefined ? details.trim()        : existing.details,
    price        !== undefined ? parseFloat(price)     : existing.price,
    coverImage,
    stock        !== undefined && stock !== '' ? parseInt(stock, 10) : existing.stock,
    active       !== undefined ? parseInt(active, 10)  : existing.active,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM zines WHERE id = ?').get(req.params.id));
});

// Called from success.html — records the order without needing a webhook
app.post('/api/orders/record', async (req, res) => {
  const { payment_intent_id } = req.body;
  if (!payment_intent_id) return res.status(400).json({ error: 'Missing payment_intent_id' });

  try {
    const intent = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not succeeded' });
    }
    const s = intent.shipping;
    db.prepare(`
      INSERT OR IGNORE INTO orders
        (payment_intent_id, items, name, line1, line2, city, state, zip, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      intent.id,
      intent.description            || '',
      s?.name                       || '',
      s?.address?.line1             || '',
      s?.address?.line2             || '',
      s?.address?.city              || '',
      s?.address?.state             || '',
      s?.address?.postal_code       || '',
      s?.address?.country           || ''
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Order record error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const unshippedOnly = req.query.unshipped === '1';
  const dir           = req.query.sort === 'asc' ? 'ASC' : 'DESC';
  const where         = unshippedOnly ? 'WHERE shipped = 0' : '';
  const rows = db.prepare(
    `SELECT * FROM orders ${where} ORDER BY created_at ${dir}`
  ).all();
  res.json(rows);
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  db.prepare('UPDATE orders SET shipped = ? WHERE id = ?').run(
    req.body.shipped ? 1 : 0, req.params.id
  );
  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
});

app.get('/api/admin/metrics', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT event, page, COUNT(*) AS count
    FROM events
    GROUP BY event, page
    ORDER BY count DESC
  `).all();
  res.json(rows);
});

app.delete('/api/admin/zines/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM zines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Zine not found' });
  db.prepare('UPDATE zines SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Zine shop running → http://localhost:${PORT}`);
  console.log(`Admin panel    → http://localhost:${PORT}/admin.html`);
});
