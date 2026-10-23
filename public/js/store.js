(function () {
  'use strict';
  var KEY = 'tp_cart_v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = function (c) { return '$' + (Number(c || 0) / 100).toFixed(2); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ---------- storage (falls back to memory if blocked) ----------
  var mem = null;
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return mem || []; }
  }
  function save(lines) {
    lines = lines.filter(function (l) { return l && l.variantId > 0 && l.qty > 0; }).slice(0, 30);
    mem = lines;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* private mode */ }
    updateCount();
  }
  function count() { return load().reduce(function (s, l) { return s + l.qty; }, 0); }
  function updateCount() {
    var n = count();
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
  }
  function add(variantId, qty) {
    var lines = load();
    var found = lines.find(function (l) { return l.variantId === variantId; });
    if (found) found.qty = Math.min(50, found.qty + qty); else lines.push({ variantId: variantId, qty: Math.min(50, qty) });
    save(lines);
  }
  function setQty(variantId, qty) {
    var lines = load().map(function (l) { return l.variantId === variantId ? { variantId: l.variantId, qty: Math.max(0, Math.min(50, qty)) } : l; });
    save(lines);
  }

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function track(e, d) {
    try { post('/api/t', { e: e, d: d || null }); } catch (x) { /* ignore */ }
    if (window.tpPixel) window.tpPixel(e, d);
  }

  var toastTimer;
  function toast(msg) {
    var t = $('[data-toast]'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- cart rendering (drawer + page) ----------
  function lineHtml(l) {
    var img = l.image ? '/img/' + l.image + '/thumb.webp' : '/static/img/placeholder.svg';
    if (l.unavailable && !l.name) return '';
    return '<div class="line' + (l.unavailable ? ' unavailable' : '') + '" data-line="' + l.variantId + '">' +
      '<img src="' + img + '" alt="" width="72" height="72" loading="lazy">' +
      '<div><a href="/products/' + esc(l.slug) + '">' + esc(l.name) + '</a>' +
      (l.variant ? '<div class="meta">' + esc(l.variant) + '</div>' : '') +
      '<div class="meta">' + money(l.price) + ' each</div>' +
      (l.unavailable ? '<div class="meta err-msg">Sold out — please remove</div>' : '') +
      '<div class="controls"><div class="qty"><button type="button" data-l-minus aria-label="Decrease">−</button><input type="number" min="1" max="50" value="' + l.qty + '" data-l-qty aria-label="Quantity"><button type="button" data-l-plus aria-label="Increase">+</button></div>' +
      '<button class="rm" type="button" data-l-remove>Remove</button></div></div>' +
      '<div class="lp">' + money(l.price * l.qty) + '</div></div>';
  }

  var lastPriced = null;
  function refreshCart() {
    var lines = load();
    var targets = $$('[data-cart-lines], [data-cart-page]');
    if (!targets.length) return Promise.resolve();
    if (!lines.length) { renderCart({ lines: [], subtotal: 0 }); return Promise.resolve(); }
    return post('/api/cart', { lines: lines }).then(function (data) {
      if (!data || !Array.isArray(data.lines)) throw new Error('bad');
      // drop lines that no longer exist at all
      var known = data.lines.filter(function (l) { return l.name; }).map(function (l) { return l.variantId; });
      var cleaned = lines.filter(function (l) { return known.indexOf(l.variantId) >= 0; });
      if (cleaned.length !== lines.length) save(cleaned);
      lastPriced = data;
      renderCart(data);
    }).catch(function () {
      targets.forEach(function (t) { t.innerHTML = '<p class="err-msg">Could not load your cart. Please refresh the page.</p>'; });
    });
  }

  function summaryHtml(data) {
    var ok = data.lines.filter(function (l) { return !l.unavailable; });
    return '<div class="sum-row"><span>Subtotal</span><span>' + money(data.subtotal) + '</span></div>' +
      '<div class="sum-row"><span>Shipping</span><span class="free-ship">FREE</span></div>' +
      '<div class="sum-row total"><span>Total</span><span>' + money(data.subtotal) + '</span></div>' +
      '<button class="btn btn-block" type="button" data-checkout ' + (ok.length ? '' : 'disabled') + '>Secure checkout</button>' +
      '<p class="err-msg" data-checkout-err role="alert"></p>' +
      '<p class="checkout-note">Card, Apple Pay &amp; Google Pay · processed securely by Stripe</p>';
  }

  function renderCart(data) {
    var empty = '<div class="empty-cart"><p>Your cart is empty.</p><a class="btn btn-ghost" href="/shop">Start shopping</a></div>';
    var drawerLines = $('[data-cart-lines]');
    var drawerFoot = $('[data-cart-foot]');
    var page = $('[data-cart-page]');
    var linesHtml = data.lines.map(lineHtml).join('');
    if (drawerLines) drawerLines.innerHTML = data.lines.length ? linesHtml : empty;
    if (drawerFoot) { drawerFoot.innerHTML = data.lines.length ? summaryHtml(data) : ''; drawerFoot.hidden = !data.lines.length; }
    if (page) page.innerHTML = data.lines.length ? linesHtml + '<div class="cart-summary">' + summaryHtml(data) + '</div>' : empty;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var line = t.closest && t.closest('[data-line]');
    if (line) {
      var id = Number(line.getAttribute('data-line'));
      var cur = load().find(function (l) { return l.variantId === id; });
      if (t.closest('[data-l-minus]') && cur) { setQty(id, cur.qty - 1); refreshCart(); }
      else if (t.closest('[data-l-plus]') && cur) { setQty(id, cur.qty + 1); refreshCart(); }
      else if (t.closest('[data-l-remove]')) { setQty(id, 0); refreshCart(); }
    }
    if (t.closest && t.closest('[data-checkout]')) checkout(t.closest('[data-checkout]'));
    if (t.closest && t.closest('[data-open-cart]')) openCart();
    if (t.closest && (t.closest('[data-close-cart]') || t.closest('[data-cart-backdrop]'))) closeCart();
  });
  document.addEventListener('change', function (e) {
    var input = e.target.closest && e.target.closest('[data-l-qty]');
    if (!input) return;
    var id = Number(input.closest('[data-line]').getAttribute('data-line'));
    var v = Math.floor(Number(input.value));
    setQty(id, isFinite(v) && v > 0 ? v : 1); refreshCart();
  });

  var lastFocus = null;
  function openCart() {
    var d = $('[data-cart-drawer]'); if (!d) return;
    lastFocus = document.activeElement;
    $('[data-cart-backdrop]').hidden = false;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    refreshCart().then(function () { d.focus(); });
    track('view_cart');
  }
  function closeCart() {
    var d = $('[data-cart-drawer]'); if (!d) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    $('[data-cart-backdrop]').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCart(); });

  function checkout(btn) {
    var lines = load();
    if (!lines.length) return;
    var err = btn.parentNode.querySelector('[data-checkout-err]');
    btn.disabled = true; var label = btn.textContent; btn.textContent = 'Opening secure checkout…';
    if (err) err.textContent = '';
    track('begin_checkout', { value: lastPriced ? lastPriced.subtotal / 100 : undefined, items: lines.length });
    post('/api/checkout', { lines: lines }).then(function (r) {
      if (r && r.url && /^https:\/\/checkout\.stripe\.com\//.test(r.url)) { window.location.href = r.url; return; }
      throw new Error((r && r.error) || 'Checkout is unavailable right now. Please try again.');
    }).catch(function (e) {
      var text = e.message || 'Something went wrong.';
      btn.disabled = false; btn.textContent = label;
      var show = function () { $$('[data-checkout-err]').forEach(function (el) { el.textContent = text; }); var sm = $('[data-stock-msg]'); if (sm && !$('[data-cart-drawer].open')) sm.textContent = text; };
      show();
      refreshCart().then(show);
    });
  }

  // ---------- product page ----------
  function initProduct() {
    var dataEl = document.getElementById('product-data');
    var form = $('[data-buy-form]');
    if (!dataEl || !form) return;
    var P = JSON.parse(dataEl.textContent);
    var mainImg = $('[data-main-img]');
    var priceEl = $('[data-price]'); var compareEl = $('[data-compare]');
    var msg = $('[data-stock-msg]'); var addBtn = $('[data-add]'); var buyNow = $('[data-buy-now]');
    var qtyInput = form.querySelector('input[name=qty]');
    var sticky = $('[data-sticky-buy]');

    function selected() {
      var o1 = form.querySelector('input[name=o1]:checked'); var o2 = form.querySelector('input[name=o2]:checked');
      return P.variants.find(function (v) {
        return (!P.option1 || (o1 && v.o1 === o1.value)) && (!P.option2 || (o2 && v.o2 === o2.value));
      }) || (!P.option1 ? P.variants[0] : null);
    }
    function setImage(id) {
      if (!id || !mainImg) return;
      mainImg.src = '/img/' + id + '/full.webp';
      $$('[data-thumb]').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-thumb')) === id); });
    }
    function update(fromOption) {
      var v = selected();
      var l1 = $('[data-o1-label]'); var l2 = $('[data-o2-label]');
      var o1 = form.querySelector('input[name=o1]:checked'); var o2 = form.querySelector('input[name=o2]:checked');
      if (l1 && o1) l1.textContent = o1.value; if (l2 && o2) l2.textContent = o2.value;
      // mark option-2 values unavailable for current option-1
      if (P.option2 && o1) {
        $$('input[name=o2]', form).forEach(function (inp) {
          var m = P.variants.find(function (x) { return x.o1 === o1.value && x.o2 === inp.value; });
          inp.closest('.opt-val').classList.toggle('unavailable', !m || m.stock <= 0);
        });
      }
      if (!v) { msg.textContent = 'This combination is not available.'; addBtn.disabled = true; buyNow.disabled = true; return; }
      priceEl.textContent = money(v.price);
      var st = $('[data-sticky-price]'); if (st) st.textContent = money(v.price);
      if (compareEl) { compareEl.hidden = !(v.compare && v.compare > v.price); compareEl.textContent = v.compare ? money(v.compare) : ''; }
      var out = v.stock <= 0;
      addBtn.disabled = out; buyNow.disabled = out;
      addBtn.textContent = out ? 'Sold out' : 'Add to cart';
      msg.textContent = out ? 'This option is sold out.' : (v.stock < 10 ? 'Only ' + v.stock + ' left!' : '');
      if (fromOption && v.img) setImage(v.img);
    }
    form.addEventListener('change', function (e) { if (e.target.name === 'o1' || e.target.name === 'o2') update(true); });
    $$('[data-thumb]').forEach(function (b) { b.addEventListener('click', function () { setImage(Number(b.getAttribute('data-thumb'))); }); });
    function q() { var n = Math.floor(Number(qtyInput.value)); return isFinite(n) && n > 0 ? Math.min(n, 50) : 1; }
    $('[data-qty-minus]').addEventListener('click', function () { qtyInput.value = Math.max(1, q() - 1); });
    $('[data-qty-plus]').addEventListener('click', function () { qtyInput.value = Math.min(50, q() + 1); });
    function doAdd() {
      var v = selected(); if (!v || v.stock <= 0) return null;
      var n = Math.min(q(), v.stock);
      add(v.id, n);
      track('add_to_cart', { id: v.id, value: (v.price * n) / 100, name: P.name });
      return v;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (doAdd()) { toast('Added to your cart'); openCart(); }
    });
    buyNow.addEventListener('click', function () {
      if (!doAdd()) return;
      checkout(buyNow);
    });
    if (sticky) {
      var stickyBtn = $('[data-sticky-add]');
      stickyBtn.addEventListener('click', function () { if (doAdd()) { toast('Added to your cart'); openCart(); } });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) { sticky.hidden = entries[0].isIntersecting || window.innerWidth > 820; }).observe(addBtn);
      }
    }
    update(false);
  }

  // ---------- newsletter ----------
  function initNewsletter() {
    var f = $('[data-newsletter]'); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = $('[data-nl-msg]'); var email = f.querySelector('input[name=email]').value;
      post('/subscribe', { email: email }).then(function (r) {
        m.textContent = r && r.ok ? "You're on the list — thank you!" : (r && r.error) || 'Please try again.';
        if (r && r.ok) f.reset();
      });
    });
  }

  // ---------- order page ----------
  function initOrder() {
    if ($('[data-order-pending]')) setTimeout(function () { location.reload(); }, 5000);
    if (document.body.classList.contains('order-complete')) {
      save([]);
      var seenKey = 'tp_px_' + location.pathname.slice(-12);
      var seen = false;
      try { seen = localStorage.getItem(seenKey) === '1'; localStorage.setItem(seenKey, '1'); } catch (e) { /* ignore */ }
      if (!seen && window.tpPixel) window.tpPixel('purchase');
    }
  }

  updateCount();
  initProduct();
  initNewsletter();
  initOrder();
  if ($('[data-cart-page]')) refreshCart();
})();
