'use strict';
const db = require('../db');

async function categories() {
  return db.many(`SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS n
                    FROM categories c ORDER BY sort_order, name`);
}

async function listProducts({ category = null, q = null, featured = null, limit = 100 } = {}) {
  const params = [];
  const where = [`p.status = 'active'`];
  if (category) { params.push(category); where.push(`c.slug = $${params.length}`); }
  if (featured) where.push('p.featured = true');
  if (q) { params.push('%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%'); where.push(`(p.name ILIKE $${params.length} OR p.tagline ILIKE $${params.length})`); }
  params.push(limit);
  return db.many(
    `SELECT p.id, p.slug, p.name, p.tagline, p.featured, c.slug AS category_slug, c.name AS category_name,
            (SELECT min(price_cents) FROM variants v WHERE v.product_id = p.id AND v.active) AS min_price,
            (SELECT max(price_cents) FROM variants v WHERE v.product_id = p.id AND v.active) AS max_price,
            (SELECT max(compare_at_cents) FROM variants v WHERE v.product_id = p.id AND v.active) AS compare_at,
            (SELECT COALESCE(sum(inventory),0)::int FROM variants v WHERE v.product_id = p.id AND v.active) AS stock,
            (SELECT i.id FROM images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_id,
            (SELECT i.id FROM images i WHERE i.product_id = p.id ORDER BY i.sort_order, i.id OFFSET 1 LIMIT 1) AS image2_id
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.featured DESC, p.sort_order, p.id
      LIMIT $${params.length}`,
    params
  );
}

async function getProduct(slug, { includeDraft = false } = {}) {
  const p = await db.one(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = $1 ${includeDraft ? '' : `AND p.status = 'active'`}`,
    [slug]
  );
  if (!p) return null;
  p.variants = await db.many(
    `SELECT id, option1, option2, price_cents, compare_at_cents, inventory, image_id
       FROM variants WHERE product_id = $1 AND active ORDER BY sort_order, id`, [p.id]);
  p.images = await db.many(
    `SELECT id, alt, width, height FROM images WHERE product_id = $1 ORDER BY sort_order, id`, [p.id]);
  return p;
}

async function related(productId, categorySlug, limit = 4) {
  const all = await listProducts({ limit: 50 });
  const others = all.filter((x) => x.id !== productId);
  const same = others.filter((x) => x.category_slug === categorySlug);
  const rest = others.filter((x) => x.category_slug !== categorySlug);
  return [...same, ...rest].slice(0, limit);
}

module.exports = { categories, listProducts, getProduct, related };
