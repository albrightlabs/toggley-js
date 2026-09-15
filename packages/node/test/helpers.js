export function manualTimers() {
  return {
    scheduled: [],
    setTimeout(fn, ms) {
      const timer = { fn, ms, cleared: false, unref() {} };
      this.scheduled.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) {
        timer.cleared = true;
      }
    },
    last() {
      return this.scheduled.filter((timer) => !timer.cleared).at(-1);
    },
  };
}

export function fakeFetch(responder) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = await responder({ url, init, calls });
    if (reply instanceof Error) {
      throw reply;
    }
    const { status = 200, body = null, headers = {} } = reply;
    return new Response(status === 304 || body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers });
  };
  fetch.calls = calls;
  return fetch;
}

export function documentWith(flags, environmentVersion = 1) {
  return { schemaVersion: 1, environmentVersion, flags, segments: {} };
}

export function booleanFlag(key, on = true, extra = {}) {
  return {
    key,
    version: 3,
    type: 'boolean',
    salt: `salt-${key}`,
    on,
    variations: [{ id: 'on', value: true }, { id: 'off', value: false }],
    offVariation: 'off',
    targets: [],
    rules: [],
    fallthrough: { variation: 'on' },
    ...extra,
  };
}

export const SERVER_KEY = 'tgly_srv_' + 'a'.repeat(40);
