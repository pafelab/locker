/** Real implementation: talks to api/<resource>.php. Throws ApiError (fallback=true when the API is unusable). */
window.ApiClient = {
  async request(method, resource, { query = {}, body } = {}) {
    if (location.protocol === 'file:') throw new ApiError(0, 'file_protocol', 'Opened from file://', true);
    const url = new URL(`${LG_CONFIG.root}${LG_CONFIG.apiBase}${resource}.php`, location.href);
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LG_CONFIG.timeout);
    let res, json;
    try {
      res = await fetch(url, {
        method, signal: ctl.signal, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      try { json = JSON.parse(text); if (!json || typeof json !== 'object') throw 0; } catch (e) { throw new ApiError(res.status, 'bad_json', 'Response is not JSON', true); }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, 'network', e.name === 'AbortError' ? 'Request timed out' : 'Network error', true);
    } finally { clearTimeout(timer); }

    if (res.status >= 500 || json.error === 'db_unavailable') throw new ApiError(res.status, json.error || 'server_error', json.message || 'Server error', true);
    if (!json.success) throw new ApiError(res.status, json.error, json.message);   // 4xx: show the message, never fall back
    return json.data;
  },
};
