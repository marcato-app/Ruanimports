import {
  hashPassword, verifyPassword, createSession, getSessionAdmin, deleteSession,
  getCookie, sessionCookie, clearCookie,
} from './auth.js';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });
}

function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

function unauthorized() {
  return json({ error: 'Não autenticado' }, { status: 401 });
}

function notFound() {
  return json({ error: 'Não encontrado' }, { status: 404 });
}

function genId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function rowToProduct(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    category: row.category_slug,
    name: row.name,
    brand: row.brand,
    price: row.price,
    tag: row.tag,
    rating: row.rating,
    reviews: row.reviews,
    sizes: JSON.parse(row.sizes || '[]'),
    colors: JSON.parse(row.colors || '[]'),
    icon: row.icon,
    active: !!row.active,
    sortOrder: row.sort_order,
    description: row.description || '',
    stock: row.stock === null || row.stock === undefined ? null : row.stock,
    imageKey: row.image_key || null,
  };
}

async function requireAdmin(request, env) {
  const token = getCookie(request, 'rpi_admin_session');
  const admin = await getSessionAdmin(env.DB, token);
  return admin;
}

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (parts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) {
        params[parts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (parts[i] !== pathParts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

/* ===================== PUBLIC ROUTES ===================== */

route('GET', '/api/images/:key', async (request, env, params) => {
  const row = await env.DB.prepare('SELECT content_type, data FROM product_images WHERE key = ?')
    .bind(params.key).first();
  if (!row) return notFound();
  // D1 hands BLOBs back as a plain array of byte values.
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return new Response(bytes, {
    headers: {
      'Content-Type': row.content_type || 'application/octet-stream',
      // Keys are unique per upload, so a photo at a given key never changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

route('GET', '/api/categories', async (request, env) => {
  const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  return json(results.map(r => ({ id: r.id, slug: r.slug, name: r.name, sortOrder: r.sort_order })));
});

route('GET', '/api/products', async (request, env) => {
  const { results } = await env.DB.prepare(
    `SELECT p.*, c.slug as category_slug FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.active = 1
     ORDER BY p.sort_order`
  ).all();
  return json(results.map(rowToProduct));
});

route('GET', '/api/banners', async (request, env) => {
  const { results } = await env.DB.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY position').all();
  return json(results.map(r => ({
    id: r.id, position: r.position, theme: r.theme, eyebrow: r.eyebrow, title: r.title,
    description: r.description, ctaLabel: r.cta_label, ctaAction: r.cta_action,
  })));
});

route('GET', '/api/coupons', async (request, env) => {
  const { results } = await env.DB.prepare('SELECT code, label FROM coupons WHERE active = 1 ORDER BY rowid').all();
  return json(results);
});

route('POST', '/api/coupons/validate', async (request, env) => {
  const body = await request.json().catch(() => ({}));
  const code = (body.code || '').trim().toUpperCase();
  if (!code) return badRequest('Informe um código de cupom');
  const row = await env.DB.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').bind(code).first();
  if (!row) return json({ valid: false });
  return json({ valid: true, code: row.code, label: row.label, rate: row.rate });
});

/* ===================== ADMIN AUTH ===================== */

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

route('POST', '/api/admin/login', async (request, env) => {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) return badRequest('Informe usuário e senha');

  const attempt = await env.DB.prepare('SELECT * FROM login_attempts WHERE username = ?').bind(username).first();
  if (attempt && attempt.locked_until && new Date(attempt.locked_until) > new Date()) {
    return json({ error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }, { status: 429 });
  }

  const admin = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  const ok = admin && (await verifyPassword(password, admin.password_hash));
  if (!ok) {
    const failCount = (attempt ? attempt.fail_count : 0) + 1;
    const lockedUntil = failCount >= LOGIN_MAX_ATTEMPTS
      ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString()
      : null;
    await env.DB.prepare(
      `INSERT INTO login_attempts (username, fail_count, locked_until) VALUES (?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until`
    ).bind(username, failCount, lockedUntil).run();
    return json({ error: 'Usuário ou senha inválidos' }, { status: 401 });
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username).run();
  const { token, expiresAt } = await createSession(env.DB, admin.id);
  return json({ ok: true, username: admin.username }, {
    headers: { 'Set-Cookie': sessionCookie(token, expiresAt) },
  });
});

route('POST', '/api/admin/logout', async (request, env) => {
  const token = getCookie(request, 'rpi_admin_session');
  await deleteSession(env.DB, token);
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
});

route('GET', '/api/admin/me', async (request, env) => {
  const admin = await requireAdmin(request, env);
  if (!admin) return unauthorized();
  return json({ username: admin.username });
});

/* ===================== ADMIN: CATEGORIES ===================== */

route('GET', '/api/admin/categories', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  return json(results);
});

route('POST', '/api/admin/categories', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!b.name || !b.slug) return badRequest('Informe nome e slug');
  const id = genId('cat');
  await env.DB.prepare('INSERT INTO categories (id, slug, name, sort_order) VALUES (?, ?, ?, ?)')
    .bind(id, b.slug, b.name, b.sortOrder || 0).run();
  return json({ id, slug: b.slug, name: b.name });
});

route('PUT', '/api/admin/categories/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare('UPDATE categories SET name = ?, slug = ?, sort_order = ? WHERE id = ?')
    .bind(b.name, b.slug, b.sortOrder || 0, params.id).run();
  return json({ ok: true });
});

route('DELETE', '/api/admin/categories/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const inUse = await env.DB.prepare('SELECT COUNT(*) as n FROM products WHERE category_id = ?').bind(params.id).first();
  if (inUse.n > 0) return badRequest('Existem produtos nessa categoria. Remova ou mova os produtos antes.');
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

/* ===================== ADMIN: PRODUCTS ===================== */

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Images are stored as D1 blobs, and the admin shrinks them in the browser
// before uploading, so anything above this is a sign something went wrong.
const MAX_IMAGE_BYTES = 1500 * 1024;

route('POST', '/api/admin/upload', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.includes(contentType)) return badRequest('Envie uma imagem JPG, PNG, WEBP ou GIF.');
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return badRequest('Arquivo vazio.');
  if (buf.byteLength > MAX_IMAGE_BYTES) return badRequest('Imagem muito grande. Tente uma foto menor.');
  const ext = contentType.split('/')[1];
  const key = `${genId('img')}.${ext}`;
  await env.DB.prepare('INSERT INTO product_images (key, content_type, data) VALUES (?, ?, ?)')
    .bind(key, contentType, [...new Uint8Array(buf)]).run();
  return json({ key });
});

route('GET', '/api/admin/products', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare(
    `SELECT p.*, c.slug as category_slug FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.sort_order`
  ).all();
  return json(results.map(rowToProduct));
});

route('POST', '/api/admin/products', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!b.name || !b.categoryId || b.price == null) return badRequest('Informe nome, categoria e preço');
  const id = genId('prd');
  await env.DB.prepare(
    `INSERT INTO products (id, category_id, name, brand, price, tag, rating, reviews, sizes, colors, icon, active, sort_order, description, stock, image_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, b.categoryId, b.name, b.brand || '', b.price, b.tag || '',
    b.rating ?? 4.5, b.reviews ?? 0, JSON.stringify(b.sizes || []), JSON.stringify(b.colors || []),
    b.icon || 'tenis', b.active === false ? 0 : 1, b.sortOrder || 0,
    b.description || '', b.stock === '' || b.stock == null ? null : b.stock, b.imageKey || null
  ).run();
  return json({ id });
});

route('PUT', '/api/admin/products/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE products SET category_id=?, name=?, brand=?, price=?, tag=?, rating=?, reviews=?, sizes=?, colors=?, icon=?, active=?, sort_order=?, description=?, stock=?, image_key=?, updated_at=datetime('now')
     WHERE id = ?`
  ).bind(
    b.categoryId, b.name, b.brand || '', b.price, b.tag || '',
    b.rating ?? 4.5, b.reviews ?? 0, JSON.stringify(b.sizes || []), JSON.stringify(b.colors || []),
    b.icon || 'tenis', b.active === false ? 0 : 1, b.sortOrder || 0,
    b.description || '', b.stock === '' || b.stock == null ? null : b.stock, b.imageKey || null, params.id
  ).run();
  return json({ ok: true });
});

route('DELETE', '/api/admin/products/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

/* ===================== ADMIN: COUPONS ===================== */

route('GET', '/api/admin/coupons', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare('SELECT * FROM coupons ORDER BY rowid').all();
  return json(results);
});

route('POST', '/api/admin/coupons', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!b.code || !b.label) return badRequest('Informe código e descrição');
  const id = genId('cp');
  await env.DB.prepare('INSERT INTO coupons (id, code, label, rate, active) VALUES (?, ?, ?, ?, ?)')
    .bind(id, b.code.toUpperCase(), b.label, b.rate || 0, b.active === false ? 0 : 1).run();
  return json({ id });
});

route('PUT', '/api/admin/coupons/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare('UPDATE coupons SET code=?, label=?, rate=?, active=? WHERE id=?')
    .bind(b.code.toUpperCase(), b.label, b.rate || 0, b.active === false ? 0 : 1, params.id).run();
  return json({ ok: true });
});

route('DELETE', '/api/admin/coupons/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

/* ===================== ADMIN: BANNERS ===================== */

route('GET', '/api/admin/banners', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare('SELECT * FROM banners ORDER BY position').all();
  return json(results);
});

route('POST', '/api/admin/banners', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!b.title) return badRequest('Informe o título do banner');
  const id = genId('bn');
  await env.DB.prepare(
    `INSERT INTO banners (id, position, theme, eyebrow, title, description, cta_label, cta_action, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, b.position || 0, b.theme || 'dark', b.eyebrow || '', b.title, b.description || '',
    b.ctaLabel || '', b.ctaAction || '', b.active === false ? 0 : 1
  ).run();
  return json({ id });
});

route('PUT', '/api/admin/banners/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  await env.DB.prepare(
    `UPDATE banners SET position=?, theme=?, eyebrow=?, title=?, description=?, cta_label=?, cta_action=?, active=? WHERE id=?`
  ).bind(
    b.position || 0, b.theme || 'dark', b.eyebrow || '', b.title, b.description || '',
    b.ctaLabel || '', b.ctaAction || '', b.active === false ? 0 : 1, params.id
  ).run();
  return json({ ok: true });
});

route('DELETE', '/api/admin/banners/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  await env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

/* ===================== ORDERS (public create/lookup) ===================== */

function rowToOrder(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    items: JSON.parse(row.items || '[]'),
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    couponCode: row.coupon_code,
    status: row.status,
    createdAt: row.created_at,
  };
}

route('POST', '/api/orders', async (request, env) => {
  const b = await request.json().catch(() => ({}));
  if (!Array.isArray(b.items) || !b.items.length) return badRequest('Carrinho vazio');
  const id = genId('ord');
  await env.DB.prepare(
    `INSERT INTO orders (id, customer_name, customer_phone, customer_email, items, subtotal, discount, total, coupon_code, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo')`
  ).bind(
    id, b.customerName || '', b.customerPhone || '', b.customerEmail || '',
    JSON.stringify(b.items), b.subtotal || 0, b.discount || 0, b.total || 0, b.couponCode || ''
  ).run();

  for (const item of b.items) {
    if (!item.id || !item.qty) continue;
    const product = await env.DB.prepare('SELECT stock FROM products WHERE id = ?').bind(item.id).first();
    if (product && product.stock !== null) {
      const newStock = Math.max(0, product.stock - item.qty);
      await env.DB.prepare('UPDATE products SET stock = ? WHERE id = ?').bind(newStock, item.id).run();
    }
  }

  return json({ id });
});

route('GET', '/api/orders', async (request, env) => {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return json([]);
  const { results } = await env.DB.prepare(
    'SELECT * FROM orders WHERE lower(customer_email) = ? ORDER BY created_at DESC'
  ).bind(email).all();
  return json(results.map(rowToOrder));
});

/* ===================== ADMIN: ORDERS ===================== */

route('GET', '/api/admin/orders', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  return json(results.map(rowToOrder));
});

route('PUT', '/api/admin/orders/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  const allowed = ['novo', 'em_andamento', 'concluido', 'cancelado'];
  if (!allowed.includes(b.status)) return badRequest('Status inválido');
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, params.id).run();
  return json({ ok: true });
});

route('PUT', '/api/admin/orders/:id/items', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const b = await request.json().catch(() => ({}));
  if (!Array.isArray(b.items)) return badRequest('Itens inválidos');
  const order = await env.DB.prepare('SELECT subtotal, discount FROM orders WHERE id = ?').bind(params.id).first();
  if (!order) return notFound();
  const rate = order.subtotal > 0 ? order.discount / order.subtotal : 0;
  const subtotal = b.items
    .filter(i => !i.unavailable)
    .reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const discount = subtotal * rate;
  const total = subtotal - discount;
  await env.DB.prepare(
    'UPDATE orders SET items = ?, subtotal = ?, discount = ?, total = ? WHERE id = ?'
  ).bind(JSON.stringify(b.items), subtotal, discount, total, params.id).run();
  return json({ ok: true });
});

/* ===================== NEWSLETTER ===================== */

route('POST', '/api/newsletter', async (request, env) => {
  const b = await request.json().catch(() => ({}));
  const email = (b.email || '').trim().toLowerCase();
  if (!email) return badRequest('Informe um e-mail');
  if (!b.consent) return badRequest('É preciso aceitar receber e-mails para se inscrever.');
  const id = genId('nws');
  try {
    await env.DB.prepare('INSERT INTO newsletter_subscribers (id, name, email, consent) VALUES (?, ?, ?, 1)')
      .bind(id, b.name || '', email).run();
  } catch (err) {
    // já cadastrado — trata como sucesso idempotente
  }
  return json({ ok: true });
});

route('GET', '/api/admin/newsletter', async (request, env) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const { results } = await env.DB.prepare('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC').all();
  return json(results);
});

route('DELETE', '/api/admin/newsletter/:id', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  await env.DB.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});

route('POST', '/api/admin/orders/:id/anonymize', async (request, env, params) => {
  if (!(await requireAdmin(request, env))) return unauthorized();
  const order = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(params.id).first();
  if (!order) return notFound();
  await env.DB.prepare(
    `UPDATE orders SET customer_name = ?, customer_phone = '', customer_email = '' WHERE id = ?`
  ).bind('[dados removidos a pedido do cliente]', params.id).run();
  return json({ ok: true });
});

/* ===================== ENTRY ===================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    const match = matchRoute(request.method, url.pathname);
    if (!match) return notFound();
    try {
      return await match.handler(request, env, match.params, ctx);
    } catch (err) {
      return json({ error: 'Erro interno', detail: String(err && err.message || err) }, { status: 500 });
    }
  },
};
