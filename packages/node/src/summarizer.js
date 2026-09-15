/**
 * Summarizer counts evaluations per flag, variation and flag version between
 * flushes. Contexts are never stored or sent.
 */
export const MAX_COUNTERS = 1000;
export const MAX_COUNTERS_PER_FLAG = 50;

export class Summarizer {
  constructor(now = Date.now) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.features = new Map();
    this.counterCount = 0;
    this.dropped = 0;
    this.startDate = null;
  }

  get isEmpty() {
    return this.features.size === 0;
  }

  record(flagKey, result) {
    if (this.startDate === null) {
      this.startDate = this.now();
    }

    const id = `${result.variation ?? ''}|${result.flagVersion ?? ''}`;
    let feature = this.features.get(flagKey);

    if (feature?.has(id)) {
      feature.get(id).count++;
      return;
    }

    if (this.counterCount >= MAX_COUNTERS || (feature && feature.size >= MAX_COUNTERS_PER_FLAG)) {
      this.dropped++;
      return;
    }

    if (!feature) {
      feature = new Map();
      this.features.set(flagKey, feature);
    }

    const counter = { variation: result.variation, count: 1 };
    if (result.flagVersion !== null && result.flagVersion !== undefined) {
      counter.version = result.flagVersion;
    }
    if (result.variation === null) {
      counter.unknown = true;
    }

    feature.set(id, counter);
    this.counterCount++;
  }

  /** snapshot returns the payload for POST /api/v2/sdk/events and starts a new period, or null when empty. */
  snapshot(sdk) {
    if (this.isEmpty) {
      return null;
    }

    const features = {};
    for (const [key, counters] of this.features) {
      features[key] = { counters: [...counters.values()] };
    }

    const payload = { kind: 'summary', startDate: this.startDate, endDate: Math.max(this.now(), this.startDate), sdk, features };
    this.reset();

    return payload;
  }
}
