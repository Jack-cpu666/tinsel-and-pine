'use strict';
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python|headless|lighthouse|render|uptime|go-http|axios|node-fetch/i;

function visitorId(req) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${config.appSecret}|${day}|${req.ip}|${req.get('user-agent') || ''}`).digest('hex').slice(0, 24);
}

function device(ua) {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

function isBot(req) {
  const ua = req.get('user-agent') || '';
  return !ua || BOT.test(ua) || req.get('purpose') === 'prefetch' || req.get('sec-purpose') === 'prefetch';
}

function recordView(req) {
  if (isBot(req)) return;
  let ref = req.get('referer') || null;
  try {
    if (ref && new URL(ref).host === req.get('host')) ref = null;
    else if (ref) ref = new URL(ref).hostname;
  } catch { ref = null; }
  const q = req.query || {};
  const fbclid = typeof q.fbclid === 'string';
  db.query(
    `INSERT INTO page_views(path, visitor, referrer, utm_source, utm_campaign, device) VALUES ($1,$2,$3,$4,$5,$6)`,
    [req.path.slice(0, 200), visitorId(req), ref ? ref.slice(0, 200) : null,
     (typeof q.utm_source === 'string' ? q.utm_source : fbclid ? 'facebook' : null)?.slice(0, 100) || null,
     typeof q.utm_campaign === 'string' ? q.utm_campaign.slice(0, 100) : null,
     device(req.get('user-agent') || '')]
  ).catch((e) => console.warn('[analytics]', e.message));
}

const EVENTS = new Set(['add_to_cart', 'view_cart', 'begin_checkout', 'newsletter']);
function recordEvent(req, name, data) {
  if (!EVENTS.has(name) || isBot(req)) return false;
  db.query('INSERT INTO events(name, visitor, data) VALUES ($1,$2,$3)', [name, visitorId(req), data ? JSON.stringify(data).slice(0, 500) : null]).catch(() => {});
  return true;
}

async function summary(days = 30) {
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  const [totals, daily, pages, refs, devices, funnel, sales, campaigns] = await Promise.all([
    db.one(`SELECT count(*)::int AS views, count(DISTINCT visitor || day)::int AS visitors FROM page_views WHERE day > CURRENT_DATE - $1::int`, [d]),
    db.many(`SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
                    COALESCE(v.views,0)::int AS views, COALESCE(v.visitors,0)::int AS visitors,
                    COALESCE(o.orders,0)::int AS orders, COALESCE(o.revenue,0)::int AS revenue
               FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') AS g(day)
               LEFT JOIN (SELECT day, count(*) AS views, count(DISTINCT visitor) AS visitors FROM page_views GROUP BY day) v ON v.day = g.day::date
               LEFT JOIN (SELECT paid_at::date AS day, count(*) AS orders, sum(total_cents) AS revenue FROM orders
                           WHERE status IN ('paid','processing','shipped','delivered') GROUP BY 1) o ON o.day = g.day::date
              ORDER BY g.day`, [d]),
    db.many(`SELECT path, count(*)::int AS views, count(DISTINCT visitor)::int AS visitors FROM page_views WHERE day > CURRENT_DATE - $1::int GROUP BY path ORDER BY views DESC LIMIT 12`, [d]),
    db.many(`SELECT COALESCE(utm_source, referrer, 'Direct / none') AS source, count(DISTINCT visitor || day)::int AS visitors FROM page_views WHERE day > CURRENT_DATE - $1::int GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [d]),
    db.many(`SELECT device, count(DISTINCT visitor || day)::int AS visitors FROM page_views WHERE day > CURRENT_DATE - $1::int GROUP BY 1 ORDER BY 2 DESC`, [d]),
    db.many(`SELECT name, count(DISTINCT visitor || day)::int AS visitors FROM events WHERE day > CURRENT_DATE - $1::int GROUP BY 1`, [d]),
    db.one(`SELECT count(*)::int AS orders, COALESCE(sum(total_cents),0)::int AS revenue,
                   COALESCE(sum((SELECT sum(COALESCE(cost_cents,0) * quantity) FROM order_items i WHERE i.order_id = o.id)),0)::int AS cost
              FROM orders o WHERE status IN ('paid','processing','shipped','delivered') AND paid_at > now() - ($1::int || ' days')::interval`, [d]),
    db.many(`SELECT COALESCE(utm_campaign,'(none)') AS campaign, count(DISTINCT visitor || day)::int AS visitors FROM page_views
              WHERE day > CURRENT_DATE - $1::int AND utm_campaign IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [d]),
  ]);
  const f = Object.fromEntries(funnel.map((r) => [r.name, r.visitors]));
  return { days: d, totals, daily, pages, refs, devices, funnel: f, sales, campaigns };
}

module.exports = { recordView, recordEvent, summary, isBot, visitorId };
