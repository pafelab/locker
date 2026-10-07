/** Session helpers on top of DS (PHP session in API mode, localStorage session in mock mode). */
window.Auth = {
  _u: undefined,

  /** Current user {id,name,email,phone,role,...} or null. Cached for the lifetime of the page. */
  async current() {
    if (this._u === undefined) this._u = await DS.me().catch(() => null);
    return this._u;
  },
  isStaff: (u) => !!u && u.role !== 'customer',

  async login(email, password, admin = false, remember = false) { return (this._u = await DS.login(email, password, admin, remember)); },
  async register(data) { return (this._u = await DS.register(data)); },
  async logout() { await DS.logout(); this._u = null; },

  /**
   * Guard for protected pages: kind 'customer' (any logged-in user) or 'admin' (staff roles only).
   * Redirects to the matching login page (with ?next=) and never resolves in that case.
   */
  async require(kind = 'customer') {
    const u = await this.current();
    if (DS.mode() === 'unavailable') await new Promise(() => {});   // main.js is showing the "service unavailable" page
    if (u && (kind !== 'admin' || this.isStaff(u))) return u;
    const here = location.pathname.split('/').pop() || 'index.html';
    location.replace(`${LG_CONFIG.root}${kind === 'admin' ? 'admin/' : ''}login.html?next=${encodeURIComponent(here + location.search)}`);
    return new Promise(() => {});
  },

  /** Safe redirect target after login: only a plain file name (+query) from ?next=, otherwise `fallback`. */
  next(fallback) {
    const n = new URLSearchParams(location.search).get('next');
    return n && /^[\w-]+\.html(\?[\w=&%.\-]*)?$/.test(n) ? n : fallback;
  },
};
