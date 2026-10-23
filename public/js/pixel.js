// Meta Pixel loader (only included when a Pixel ID is configured in admin settings).
(function () {
  'use strict';
  var s = document.currentScript;
  var id = s && s.getAttribute('data-pixel');
  if (!id || !/^\d{6,20}$/.test(id)) return;
  /* eslint-disable */
  !function (f, b, e, v, n, t, x) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
    x = b.getElementsByTagName(e)[0]; x.parentNode.insertBefore(t, x); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
  window.fbq('track', 'PageView');
  var map = { add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', view_cart: null, newsletter: 'Lead', purchase: 'Purchase' };
  window.tpPixel = function (name, data) {
    var ev = map[name];
    if (!ev) return;
    var params = { currency: 'USD' };
    if (data && typeof data.value === 'number') params.value = data.value;
    if (ev === 'Purchase') {
      var t = document.querySelector('.totals .grand dd');
      params.value = t ? Number(t.textContent.replace(/[^0-9.]/g, '')) || 0 : 0;
    }
    window.fbq('track', ev, params);
  };
})();
