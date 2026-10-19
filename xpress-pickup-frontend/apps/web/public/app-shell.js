// Picks which installable app this page belongs to before anything renders:
// the merchant app (shop, gate, admin) or the customer app. Android reads the
// manifest link; iOS uses the apple-touch-icon and title when added to the Home
// Screen. A static file because the CSP allows no inline scripts. The React app
// keeps these in sync on navigation (src/lib/appKind.ts mirrors this rule).
/* global location, matchMedia, sessionStorage, document */
(function () {
  var merchant = /^\/(merchant|shop|gate|admin)(\/|$)/.test(location.pathname);
  try {
    // An installed merchant app stays the merchant app on every page it opens.
    if (
      matchMedia('(display-mode: standalone)').matches &&
      sessionStorage.getItem('dx.app') === 'merchant'
    )
      merchant = true;
    if (merchant) sessionStorage.setItem('dx.app', 'merchant');
  } catch {
    // storage unavailable
  }
  var app = merchant ? 'merchant' : 'customer';
  var set = function (sel, attr, value) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute(attr, value);
  };
  set('link[rel="manifest"]', 'href', merchant ? '/merchant.webmanifest' : '/manifest.webmanifest');
  set('link[rel="apple-touch-icon"]', 'href', '/icons/' + app + '-apple-180.png');
  set(
    'meta[name="apple-mobile-web-app-title"]',
    'content',
    merchant ? 'DX Merchant' : 'Diwali Express',
  );
  set('meta[name="theme-color"]', 'content', merchant ? '#082623' : '#140c24');
  document.documentElement.setAttribute('data-app', app);
})();
