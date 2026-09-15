# @toggley/browser

Feature flags in the browser. Toggley evaluates flags for the current user and sends back their values; only flags marked **Available to client-side SDKs** are included, so unreleased flags don't leak into page source.

```sh
npm install @toggley/browser
```

```js
import { createClient } from '@toggley/browser';

const toggley = createClient({
  clientKey: 'tgly_cli_...',
  context: { key: userId, plan: 'pro' },
});

await toggley.ready();

if (toggley.variation('new-checkout', false)) {
  showNewCheckout();
}

toggley.on('change', (changes) => {
  // { flagKey: { previous, current } }
});

// After sign-in:
await toggley.identify({ key: newUserId });
```

Use the environment's **client key** (`tgly_cli_...`), which is safe to publish. The SDK refuses server keys.

- Values are cached in `localStorage` per user, so repeat visits start with the last values before Toggley answers.
- Values refresh every 5 minutes while the tab is visible and right away when it becomes visible again after that.
- `bootstrap: { flagKey: value }` supplies values for the first render (e.g. from your server).
- `variationDetail(key, default)` also returns the variation and, with `withReasons: true`, why.

The package has no dependencies and is under 4 KB gzipped.
