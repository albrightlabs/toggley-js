import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { evaluate, evaluateAll, typed } from './engine/evaluator.js';
import { nativeRandom } from './engine/bucketer.js';
import { isPlainObject } from './engine/context.js';
import { Summarizer } from './summarizer.js';

export const SDK_NAME = 'toggley-node';
export const SDK_VERSION = '0.1.0';
export const DEFAULT_BASE_URL = 'https://my.toggleyapp.com';

const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class ToggleyError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.name = 'ToggleyError';
    this.code = code;
  }
}

const notReady = (defaultValue) => ({
  value: defaultValue,
  variation: null,
  reason: { kind: 'ERROR', errorKind: 'CLIENT_NOT_READY' },
  assignment: null,
  flagVersion: null,
});

export function isConfigDocument(document) {
  return isPlainObject(document) && document.schemaVersion === 1 && isPlainObject(document.flags);
}

/**
 * ToggleyClient downloads an environment's config with a server key, keeps it up
 * to date by polling (ETag, so unchanged configs cost almost nothing) and
 * evaluates flags in-process. It serves the last good config if Toggley can't be
 * reached, then a bootstrap file, then the defaults you pass.
 *
 * Events: "update" (new config), "error" (ToggleyError; only emitted when listened to).
 */
export class ToggleyClient extends EventEmitter {
  constructor(options = {}) {
    super();

    const key = options.serverKey;
    if (typeof key === 'string' && key.startsWith('tgly_cli_')) {
      throw new ToggleyError('This is a client key. Server SDKs need the server key (tgly_srv_...) from the environment page.', 'wrong_key_type');
    }
    if (!options.offline && (typeof key !== 'string' || !key.startsWith('tgly_srv_'))) {
      throw new ToggleyError('A server key (tgly_srv_...) is required. Pass offline: true to run from a bootstrap file only.', 'missing_key');
    }

    this.options = {
      serverKey: key,
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      pollInterval: options.pollInterval ?? 30000,
      timeout: options.timeout ?? 5000,
      offline: Boolean(options.offline),
      events: options.events ?? true,
      flushInterval: options.flushInterval ?? 60000,
      onError: options.onError ?? null,
      logger: options.logger === undefined ? console : options.logger,
      fetch: options.fetch ?? globalThis.fetch,
      timers: options.timers ?? { setTimeout, clearTimeout },
      now: options.now ?? Date.now,
      random: options.random ?? nativeRandom,
      jitter: options.jitter ?? Math.random,
    };

    this._document = null;
    this._etag = null;
    this._attempt = 0;
    this._closed = false;
    this._pollingStopped = this.options.offline;
    this._pollTimer = null;
    this._flushTimer = null;
    this._lastLogged = null;
    this._summarizer = new Summarizer(this.options.now);
    this._readyResolved = false;
    this._ready = new Promise((resolve) => { this._resolveReady = resolve; });

    if (options.bootstrap !== undefined) {
      this._loadBootstrap(options.bootstrap);
    }

    if (this.options.offline) {
      this._markReady(this._document !== null);
    }

    if (options.autoStart !== false) {
      this.start();
    }
  }

  start() {
    if (!this.options.offline) {
      this._schedulePoll(0);
      if (this.options.events) {
        this._scheduleFlush();
      }
    }
    return this;
  }

  /** waitForInitialization resolves true once a config is available, false on timeout or a rejected key. It never throws. */
  waitForInitialization(timeoutMs = 5000) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    });

    return Promise.race([this._ready, timeout]).finally(() => clearTimeout(timer));
  }

  get initialized() {
    return this._document !== null;
  }

  variationDetail(flagKey, context, defaultValue = null) {
    const result = this._document === null
      ? notReady(defaultValue)
      : evaluate(this._document, flagKey, context, defaultValue, this.options.random);

    this._record(flagKey, result);

    return result;
  }

  variation(flagKey, context, defaultValue = null) {
    return this.variationDetail(flagKey, context, defaultValue).value;
  }

  boolVariationDetail(flagKey, context, defaultValue) {
    return typed(this.variationDetail(flagKey, context, defaultValue), 'boolean', defaultValue);
  }

  boolVariation(flagKey, context, defaultValue = false) {
    return this.boolVariationDetail(flagKey, context, defaultValue).value;
  }

  stringVariationDetail(flagKey, context, defaultValue) {
    return typed(this.variationDetail(flagKey, context, defaultValue), 'string', defaultValue);
  }

  stringVariation(flagKey, context, defaultValue) {
    return this.stringVariationDetail(flagKey, context, defaultValue).value;
  }

  numberVariationDetail(flagKey, context, defaultValue) {
    return typed(this.variationDetail(flagKey, context, defaultValue), 'number', defaultValue);
  }

  numberVariation(flagKey, context, defaultValue) {
    return this.numberVariationDetail(flagKey, context, defaultValue).value;
  }

  jsonVariationDetail(flagKey, context, defaultValue) {
    return typed(this.variationDetail(flagKey, context, defaultValue), 'json', defaultValue);
  }

  jsonVariation(flagKey, context, defaultValue) {
    return this.jsonVariationDetail(flagKey, context, defaultValue).value;
  }

  /** allFlags returns every flag's value for a context (not counted as evaluations). */
  allFlags(context) {
    if (this._document === null) {
      return {};
    }

    const values = {};
    for (const [key, result] of Object.entries(evaluateAll(this._document, context, this.options.random))) {
      values[key] = result.value;
    }
    return values;
  }

  /** flush sends evaluation counts now. Failures are reported, not retried. */
  async flush() {
    const payload = this._summarizer.snapshot({ name: SDK_NAME, version: SDK_VERSION });
    if (payload === null || this.options.offline) {
      return;
    }

    try {
      const response = await this._fetch(`${this.options.baseUrl}/api/v2/sdk/events`, {
        method: 'POST',
        headers: {
          ...this._headers(),
          'content-type': 'application/json',
          'x-toggley-payload-id': randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401 || response.status === 403) {
        this.options.events = false;
      }
      if (!response.ok) {
        this._report(new ToggleyError(`Toggley didn't accept evaluation counts (HTTP ${response.status}).`, 'events_rejected'));
      }
    } catch (error) {
      this._report(new ToggleyError(`Couldn't send evaluation counts: ${error.message}`, 'network_error'));
    }
  }

  /** close stops polling and sends remaining evaluation counts. */
  async close() {
    this._closed = true;
    this._pollingStopped = true;
    this.options.timers.clearTimeout(this._pollTimer);
    this.options.timers.clearTimeout(this._flushTimer);
    await this.flush();
  }

  async _poll() {
    if (this._closed || this._pollingStopped) {
      return;
    }

    let delay = this.options.pollInterval;

    try {
      const headers = this._headers();
      if (this._etag) {
        headers['if-none-match'] = this._etag;
      }

      const response = await this._fetch(`${this.options.baseUrl}/api/v2/sdk/config`, { headers });

      if (response.status === 304) {
        this._attempt = 0;
        this._markReady(true);
      } else if (response.status === 200) {
        const document = await response.json().catch(() => null);
        if (!isConfigDocument(document)) {
          throw new ToggleyError('Toggley sent a config this SDK version cannot read. Keeping the last good config.', 'invalid_config');
        }
        this._setDocument(document);
        this._etag = response.headers.get('etag');
        this._attempt = 0;
        this._markReady(true);

        const suggested = Number(response.headers.get('x-toggley-poll-interval'));
        if (suggested > 0) {
          delay = Math.max(delay, suggested * 1000);
        }
      } else if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => null);
        this._pollingStopped = true;
        this._report(new ToggleyError(body?.error?.message ?? `Toggley rejected the server key (HTTP ${response.status}). Polling stopped.`, body?.error?.code ?? 'invalid_key'));
        this._markReady(this._document !== null);
        return;
      } else if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        delay = Math.max(delay, (retryAfter > 0 ? retryAfter : 60) * 1000);
        this._report(new ToggleyError('Toggley is rate limiting config requests for this key.', 'rate_limited'));
      } else {
        throw new ToggleyError(`Toggley returned HTTP ${response.status} for the config.`, 'http_error');
      }
    } catch (error) {
      this._attempt++;
      delay = this._backoffDelay();
      this._report(error instanceof ToggleyError ? error : new ToggleyError(`Couldn't reach Toggley: ${error.message}`, 'network_error'));
      if (this._document !== null) {
        this._markReady(true);
      }
    }

    this._schedulePoll(delay);
  }

  _backoffDelay() {
    const base = Math.min(1000 * 2 ** (this._attempt - 1), MAX_BACKOFF_MS);
    return Math.round(base * (0.8 + this.options.jitter() * 0.4));
  }

  _schedulePoll(delay) {
    if (this._closed || this._pollingStopped) {
      return;
    }
    this.options.timers.clearTimeout(this._pollTimer);
    this._pollTimer = this.options.timers.setTimeout(() => this._poll(), delay);
    this._pollTimer?.unref?.();
    this.nextPollDelay = delay;
  }

  _scheduleFlush() {
    if (this._closed) {
      return;
    }
    this._flushTimer = this.options.timers.setTimeout(async () => {
      await this.flush();
      this._scheduleFlush();
    }, this.options.flushInterval);
    this._flushTimer?.unref?.();
  }

  _headers() {
    return {
      authorization: `Bearer ${this.options.serverKey}`,
      'user-agent': `${SDK_NAME}/${SDK_VERSION}`,
    };
  }

  _fetch(url, init) {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(this.options.timeout) : undefined;
    return this.options.fetch(url, { ...init, signal });
  }

  _setDocument(document) {
    const changed = this._document === null || this._document.environmentVersion !== document.environmentVersion;
    this._document = document;
    if (changed) {
      this.emit('update', { environmentVersion: document.environmentVersion });
    }
  }

  _loadBootstrap(bootstrap) {
    try {
      const document = typeof bootstrap === 'string' ? JSON.parse(readFileSync(bootstrap, 'utf8')) : bootstrap;
      if (!isConfigDocument(document)) {
        throw new Error('not a Toggley config document');
      }
      this._document = document;
    } catch (error) {
      this._report(new ToggleyError(`Couldn't load the bootstrap config: ${error.message}`, 'invalid_bootstrap'));
    }
  }

  _markReady(ok) {
    if (!this._readyResolved) {
      this._readyResolved = true;
      this._resolveReady(ok);
    }
  }

  _record(flagKey, result) {
    if (this.options.events && !this.options.offline && !this._closed) {
      this._summarizer.record(flagKey, result);
    }
  }

  _report(error) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
    this.options.onError?.(error);
    if (this.options.logger && error.message !== this._lastLogged) {
      this._lastLogged = error.message;
      this.options.logger.warn?.(`[toggley] ${error.message}`);
    }
  }
}

export function init(options) {
  return new ToggleyClient(options);
}
