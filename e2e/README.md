# End-to-end tests

Run against a local Toggley (the app checkout next to this repo, served on `http://127.0.0.1:8001`; `.test` hostnames can take seconds to resolve on macOS):

```sh
TOGGLEY_E2E_ORG=1 npm run e2e
```

The runner seeds `seed.json` into a throwaway environment with `php artisan featureflag:import-config` (flag keys prefixed `e2e-js-`), checks the Node SDK against the server's own evaluation for 50 contexts, the v1 API, ETag revalidation, evaluation counts and serving while Toggley is down, then deletes what it created.

Options: `TOGGLEY_APP_DIR` (default `../toggleyapp.com`), `TOGGLEY_BASE_URL`, `TOGGLEY_E2E_ORG`.
