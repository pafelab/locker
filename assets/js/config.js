/**
 * LockerGo front-end configuration.
 *   dataMode: 'auto' (API, fall back to mock data) | 'api' (production: never fall back) | 'mock' (never call the API)
 */
window.LG_CONFIG = {
  dataMode: 'auto',
  apiBase: 'api/',      // relative to the site root (resolved below, so admin/ pages work too)
  timeout: 3000,        // ms before an API request counts as failed
  brand: 'LockerGo',
};

// Site root = folder that holds assets/, derived from this script's URL, so links work from / and /admin/.
LG_CONFIG.root = document.currentScript.src.replace(/assets\/js\/config\.js.*$/, '');

// Apply the saved theme immediately (this script is loaded synchronously in <head>) to avoid a light-mode flash.
try { document.documentElement.setAttribute('data-bs-theme', localStorage.getItem('lg_theme') || 'light'); } catch (e) { /* storage blocked */ }

/**
 * Price quote shared by the booking wizard (live price) and the mock service.
 * unit = price for one hour/day/month of the chosen size; promo = {type:'percent'|'fixed', value} or null.
 * The PHP API recomputes the same formula server-side.
 */
window.quote = (unit, qty, promo) => {
  const gross = unit * qty;
  const discount = !promo ? 0 : promo.type === 'percent' ? Math.round(gross * promo.value / 100) : Math.min(promo.value, gross);
  return { gross, discount, total: gross - discount };
};

/** Error with an HTTP-like status. `fallback` = true means "API unusable, switch to mock data". */
window.ApiError = class ApiError extends Error {
  constructor(status, code, message, fallback = false) {
    super(message); this.status = status; this.code = code; this.fallback = fallback;
  }
};
