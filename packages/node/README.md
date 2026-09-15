# @toggley/node

Feature flags for Node.js servers. The SDK downloads your environment's flag config from [Toggley](https://toggleyapp.com), checks for changes every 30 seconds, and evaluates flags in your process: no network call per flag check, and your users' data never leaves your server.

```sh
npm install @toggley/node
```

```js
import { init } from '@toggley/node';

const toggley = init({ serverKey: process.env.TOGGLEY_SERVER_KEY });
await toggley.waitForInitialization(5000);

const context = { key: user.id, email: user.email, plan: user.plan };

if (toggley.boolVariation('new-checkout', context, false)) {
  // on for this user
}

const theme = toggley.stringVariation('theme', context, 'light');
```

Get the server key from the environment page in Toggley. Keep it secret; browsers use `@toggley/browser` with the client key instead.

## Contexts

A context is who you're evaluating for: an object with a `key` (used for individual targets and sticky percentage splits) and any attributes your rules use. Values can be strings, numbers, booleans or arrays of those. Without a `key`, percentage splits assign randomly.

## Reading flags

| Method | Returns |
|---|---|
| `boolVariation(key, context, default)` | `true`/`false` |
| `stringVariation`, `numberVariation`, `jsonVariation` | the variation's value |
| `*VariationDetail(...)` | `{ value, variation, reason, assignment, flagVersion }` |
| `allFlags(context)` | `{ flagKey: value }` |

When the flag is missing, the context is invalid, the value has the wrong type, or no config has loaded yet, you get your default and `reason.kind` is `"ERROR"` with an `errorKind` (`FLAG_NOT_FOUND`, `CONTEXT_INVALID`, `MALFORMED_FLAG`, `WRONG_TYPE`, `CLIENT_NOT_READY`).

## Options

| Option | Default | |
|---|---|---|
| `serverKey` | | `tgly_srv_...` |
| `baseUrl` | `https://my.toggleyapp.com` | |
| `pollInterval` | `30000` | ms between config checks (conditional requests) |
| `timeout` | `5000` | ms per request |
| `bootstrap` | | a config object, or a path to a file from `toggley-pull` |
| `offline` | `false` | never contact Toggley; serve `bootstrap` only (tests, CI) |
| `events` | `true` | send evaluation counts every minute (counts only, no contexts) |
| `onError`, `logger` | `console` | |

If Toggley can't be reached the SDK keeps serving the last config it received, retrying with backoff (1s, 2s, 4s… up to 5 minutes). A rejected key stops polling.

## Bootstrap file

```sh
TOGGLEY_SERVER_KEY=tgly_srv_... npx toggley-pull --out toggley-config.json
```

```js
const toggley = init({ serverKey: process.env.TOGGLEY_SERVER_KEY, bootstrap: './toggley-config.json' });
```

## Shutting down

`await toggley.close()` stops polling and sends the remaining evaluation counts.
