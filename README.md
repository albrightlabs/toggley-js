# Toggley JavaScript SDKs

| Package | For | Evaluates |
|---|---|---|
| [`@toggley/node`](packages/node) | Node.js 18+ servers | locally, from a polled config (server key) |
| [`@toggley/browser`](packages/browser) | browsers | on Toggley, for one user (client key) |

## Development

```sh
npm test                 # unit tests and the shared evaluation vectors
npm run vectors:check    # spec/ still matches spec/SOURCE
npm run sync-vectors     # copy new vectors from the Toggley plugin
npm run e2e              # against a local Toggley (see e2e/README.md)
```

`spec/evaluation-vectors.json` and `spec/bucketing-vectors.json` come from the Toggley plugin (`tests/fixtures`). Every SDK (JavaScript, PHP, Python) must pass them unchanged, which keeps percentage splits and targeting identical across languages.

The Node engine in `packages/node/src/engine` is a port of the plugin's `classes/engine`. Change the plugin first, regenerate the vectors, then port.
