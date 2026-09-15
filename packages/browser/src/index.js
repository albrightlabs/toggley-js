/**
 * Toggley browser SDK. Uses an environment's client key to get flag values for the
 * current context from Toggley (only flags marked "Available to client-side
 * SDKs"). Values are cached in localStorage for a fast start, refreshed every
 * five minutes while the page is visible, and after identify().
 */
const SDK_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'https://my.toggleyapp.com';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class ToggleyBrowserClient {
  constructor(options = {}) {
    const key = options.clientKey;
    if (typeof key === 'string' && key.startsWith('tgly_srv_')) {
      throw new Error('Never put a server key in a browser. Use the environment\'s client key (tgly_cli_...).');
    }
    if (typeof key !== 'string' || !key.startsWith('tgly_cli_')) {
      throw new Error('A client key (tgly_cli_...) is required.');
    }

    this._key = key;
    this._baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this._pollInterval = options.pollInterval ?? 300000;
    this._timeout = options.timeout ?? 5000;
    this._withReasons = Boolean(options.withReasons);
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this._timers = options.timers || { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
    this._now = options.now || Date.now;
    this._document = options.document !== undefined ? options.document : globalThis.document;
    this._storage = options.storage !== undefined ? options.storage : safeLocalStorage();
    this._context = options.context || {};
    this._flags = {};
    this._loaded = false;
    this._stopped = false;
    this._closed = false;
    this._timer = null;
    this._lastFetch = 0;
    this._listeners = { change: new Set(), error: new Set() };
    this._ready = new Promise((resolve) => { this._resolveReady = resolve; });

    if (options.bootstrap) {
      this._flags = normalize(options.bootstrap);
      this._loaded = true;
    } else {
      this._loadCache();
    }

    this._onVisibility = () => this._visibilityChanged();
    this._document?.addEventListener?.('visibilitychange', this._onVisibility);

    if (options.autoStart !== false) {
      this.refresh();
    }
  }

  /** ready resolves after the first request to Toggley finishes, successful or not. */
  ready() {
    return this._ready;
  }

  variation(flagKey, defaultValue = null) {
    return own(this._flags, flagKey) ? this._flags[flagKey].value : defaultValue;
  }

  variationDetail(flagKey, defaultValue = null) {
    if (own(this._flags, flagKey)) {
      const flag = this._flags[flagKey];
      return { value: flag.value, variation: flag.variation ?? null, reason: flag.reason ?? null };
    }
    return { value: defaultValue, variation: null, reason: { kind: 'ERROR', errorKind: this._loaded ? 'FLAG_NOT_FOUND' : 'CLIENT_NOT_READY' } };
  }

  allFlags() {
    const values = {};
    for (const key of Object.keys(this._flags)) {
      values[key] = this._flags[key].value;
    }
    return values;
  }

  /** identify switches to another context, e.g. after sign-in, and fetches its values. */
  identify(context) {
    this._context = context || {};
    this._loadCache();
    return this.refresh();
  }

  on(event, listener) {
    this._listeners[event]?.add(listener);
    return () => this._listeners[event]?.delete(listener);
  }

  async refresh() {
    if (this._closed) {
      return;
    }

    this._timers.clearTimeout(this._timer);
    const context = this._context;

    try {
      const response = await this._fetch(`${this._baseUrl}/api/v2/client/evaluate`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this._key}`, 'content-type': 'application/json', 'x-toggley-sdk': `toggley-browser/${SDK_VERSION}` },
        body: JSON.stringify({ context, withReasons: this._withReasons }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(this._timeout) : undefined,
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this._stopped = true;
        }
        throw new Error(body?.error?.message || `Toggley returned HTTP ${response.status}.`);
      }

      if (context === this._context) {
        this._apply(normalize(body?.flags || {}));
        this._loaded = true;
        this._saveCache();
      }
    } catch (error) {
      this._emit('error', error);
    } finally {
      this._lastFetch = this._now();
      this._resolveReady();
      this._schedule(this._pollInterval);
    }
  }

  close() {
    this._closed = true;
    this._timers.clearTimeout(this._timer);
    this._document?.removeEventListener?.('visibilitychange', this._onVisibility);
  }

  _apply(next) {
    const changes = {};
    for (const key of new Set([...Object.keys(this._flags), ...Object.keys(next)])) {
      const previous = own(this._flags, key) ? this._flags[key].value : undefined;
      const current = own(next, key) ? next[key].value : undefined;
      if (!same(previous, current)) {
        changes[key] = { previous, current };
      }
    }
    this._flags = next;
    if (Object.keys(changes).length) {
      this._emit('change', changes);
    }
  }

  _schedule(delay) {
    if (this._closed || this._stopped || this._document?.hidden) {
      return;
    }
    this._timers.clearTimeout(this._timer);
    this._timer = this._timers.setTimeout(() => this.refresh(), delay);
  }

  _visibilityChanged() {
    if (this._document.hidden) {
      this._timers.clearTimeout(this._timer);
      return;
    }
    const elapsed = this._now() - this._lastFetch;
    if (elapsed >= this._pollInterval) {
      this.refresh();
    } else {
      this._schedule(this._pollInterval - elapsed);
    }
  }

  _cacheKey() {
    const contextKey = typeof this._context.key === 'string' ? this._context.key : '';
    return `toggley:${this._key.slice(-8)}:${contextKey}`;
  }

  _loadCache() {
    try {
      const cached = JSON.parse(this._storage?.getItem(this._cacheKey()) || 'null');
      if (cached && cached.flags) {
        this._apply(normalize(cached.flags));
        this._loaded = true;
      }
    } catch {
      // Storage can be unavailable (private mode) or hold something unreadable.
    }
  }

  _saveCache() {
    try {
      this._storage?.setItem(this._cacheKey(), JSON.stringify({ flags: this._flags, savedAt: this._now() }));
    } catch {
      // Quota or privacy settings; the cache is only an optimization.
    }
  }

  _emit(event, payload) {
    for (const listener of this._listeners[event]) {
      listener(payload);
    }
  }
}

export function createClient(options) {
  return new ToggleyBrowserClient(options);
}

function normalize(flags) {
  const normalized = {};
  for (const key of Object.keys(flags || {})) {
    const flag = flags[key];
    normalized[key] = flag !== null && typeof flag === 'object' && own(flag, 'value') ? flag : { value: flag, variation: null };
  }
  return normalized;
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
