/**
 * Data layer. Pages call ONLY these functions (never fetch()/localStorage). Every call is async and returns the same shape
 * from the PHP API and from the mock service. Decides api vs mock once per session (see README "Fallback").
 * Events on window: 'lg:mode' {mode:'api'|'mock'|'unavailable', switched?} — main.js shows the demo badge / toast / error page.
 */
window.DS = (() => {
  const cfg = LG_CONFIG, KEY = 'lg_mode';
  let mode = null, probing = null;
  const emit = (detail) => window.dispatchEvent(new CustomEvent('lg:mode', { detail }));
  const stored = () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } };
  const store = (v) => { try { sessionStorage.setItem(KEY, v); } catch (e) { /* ignore */ } };

  async function probe() {
    if (cfg.dataMode === 'mock') mode = 'mock';
    else if (cfg.dataMode === 'auto' && stored()) mode = stored();
    else {
      try { await ApiClient.request('GET', 'health'); mode = 'api'; }
      catch (e) { mode = cfg.dataMode === 'api' ? 'unavailable' : 'mock'; }   // 'api' mode never falls back
      if (cfg.dataMode === 'auto') store(mode);
    }
    emit({ mode });
  }
  /** Resolves the active mode ('api' | 'mock' | 'unavailable'); the health check runs once per session. */
  const init = () => (probing = probing || probe()).then(() => mode);

  async function req(method, resource, opts) {
    const m = await init();
    if (m === 'unavailable') throw new ApiError(503, 'db_unavailable', 'Service unavailable');
    if (m === 'mock') return MockService.handle(method, resource, opts);
    try { return await ApiClient.request(method, resource, opts); }
    catch (e) {
      if (!e.fallback) throw e;                       // 400/401/403/404/409/422: show e.message, no fallback
      if (cfg.dataMode === 'api') { mode = 'unavailable'; emit({ mode }); throw e; }
      mode = 'mock'; store('mock'); emit({ mode, switched: true });   // API died mid-session
      return MockService.handle(method, resource, opts);
    }
  }
  const q = (query) => ({ query });
  const save = (resource, obj, extra = {}) => (obj.id ? req('PUT', resource, { query: { id: obj.id, ...extra }, body: obj }) : req('POST', resource, { query: extra, body: obj }));

  return {
    init, mode: () => mode,

    // --- auth: me() -> user|null; login(...) -> user {id,username,name,email,phone,role,notifyEmail,notifySms} ---
    me: () => req('GET', 'auth', q({ action: 'me' })),
    login: (username, password, admin = false, remember = false) => req('POST', 'auth', { query: { action: 'login' }, body: { username, password, admin, remember } }),
    register: (data) => req('POST', 'auth', { query: { action: 'register' }, body: data }),   // {username,name,email,phone,password}
    logout: () => req('POST', 'auth', q({ action: 'logout' })),
    forgotPassword: (email) => req('POST', 'auth', { query: { action: 'forgot' }, body: { email } }),
    updateProfile: (data) => req('PUT', 'auth', { query: { action: 'profile' }, body: data }),   // {name,phone,notifyEmail,notifySms}
    changePassword: (current, next) => req('PUT', 'auth', { query: { action: 'password' }, body: { current, next } }),

    // --- locations: {id,name,address,zones,openHours,phone,lockerCount,availableCount} ---
    getLocations: () => req('GET', 'locations'),
    saveLocation: (obj) => save('locations', obj),                 // obj.id present -> update
    deleteLocation: (id) => req('DELETE', 'locations', q({ id })),

    // --- lockers: {id,code,locationId,locationName,size,zone,status}; filters {locationId,size,status,q,start,end} ---
    getLockers: (filters = {}) => req('GET', 'lockers', q(filters)),
    getLocker: (id) => req('GET', 'lockers', q({ id })),
    saveLocker: (obj) => save('lockers', obj),
    deleteLocker: (id) => req('DELETE', 'lockers', q({ id })),
    updateLockerStatus: (id, status) => req('PUT', 'lockers', { query: { id }, body: { status } }),
    bulkUpdateLockerStatus: (ids, status) => req('PUT', 'lockers', { query: { action: 'bulk' }, body: { ids, status } }),

    // --- bookings: see mock-service bookingOut(); filters {q,status,from,to,mine} ---
    getBookings: (filters = {}) => req('GET', 'bookings', q(filters)),
    getBooking: (idOrRef) => req('GET', 'bookings', q(/^LG/.test(idOrRef) ? { ref: idOrRef } : { id: idOrRef })),
    createBooking: (data) => req('POST', 'bookings', { body: data }),   // {lockerId,startAt,durationType,quantity,customerName,customerEmail,customerPhone,promoCode,paymentMethod,slip?,userId?} slip = image data URL (required for promptpay)
    updateBookingStatus: (id, status) => req('PUT', 'bookings', { query: { id, action: 'status' }, body: { status } }),
    extendBooking: (id, quantity) => req('PUT', 'bookings', { query: { id, action: 'extend' }, body: { quantity } }),

    // --- customers (admin) ---
    getCustomers: () => req('GET', 'customers'),
    getCustomer: (id) => req('GET', 'customers', q({ id })),         // includes .bookings[]
    updateCustomerStatus: (id, status) => req('PUT', 'customers', { query: { id }, body: { status } }),

    // --- pricing: getPricing() -> {prices:[{size,hour,day,month}], promos:[...] (promos only for admins)} ---
    getPricing: () => req('GET', 'pricing'),
    checkPromo: (code) => req('GET', 'pricing', q({ action: 'promo', code })),   // -> {code,type,value} or 422 invalid_promo
    savePrice: (row) => req('PUT', 'pricing', { query: { type: 'price' }, body: row }),
    savePromo: (obj) => save('pricing', obj, { type: 'promo' }),
    deletePromo: (id) => req('DELETE', 'pricing', q({ type: 'promo', id })),

    // --- payments (admin) ---
    getPayments: (filters = {}) => req('GET', 'payments', q(filters)),
    getPaymentSlip: (id) => req('GET', 'payments', q({ id, action: 'slip' })),   // -> {slip: data URL | null} (admin)
    refundPayment: (id) => req('PUT', 'payments', { query: { id, action: 'refund' } }),

    // --- staff (admin; writes need super_admin) ---
    getStaff: () => req('GET', 'staff'),
    saveStaff: (obj) => save('staff', obj),
    deleteStaff: (id) => req('DELETE', 'staff', q({ id })),

    // --- reports / activity / settings ---
    getReport: (range = {}) => req('GET', 'reports', q(range)),       // {from,to}
    getActivity: (limit) => req('GET', 'activity-log', q({ limit })),
    getSettings: () => req('GET', 'settings'),
    saveSettings: (obj) => req('PUT', 'settings', { body: obj }),
    /** Mock mode only: restore the original demo data. */
    async resetDemo() {
      if ((await init()) !== 'mock') throw new ApiError(400, 'not_supported', 'ใช้ได้เฉพาะโหมดข้อมูลตัวอย่าง');
      return req('POST', 'settings', q({ action: 'reset' }));
    },
  };
})();
