export type ContextValue = string | number | boolean | Array<string | number | boolean>;

export interface Context {
  key?: string;
  [attribute: string]: ContextValue | undefined | null;
}

export interface BrowserOptions {
  /** The environment's client key (tgly_cli_...). Safe to ship in web pages. */
  clientKey: string;
  context?: Context;
  /** Defaults to https://my.toggleyapp.com */
  baseUrl?: string;
  /** Milliseconds between refreshes while the page is visible. Default 300000. */
  pollInterval?: number;
  timeout?: number;
  /** Values to use before Toggley answers: { flagKey: value } or { flagKey: { value, variation } }. */
  bootstrap?: Record<string, unknown>;
  /** Defaults to localStorage; pass null to disable the cache. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  withReasons?: boolean;
  fetch?: typeof fetch;
  autoStart?: boolean;
}

export interface Detail<T> {
  value: T;
  variation: string | null;
  reason: { kind: string; errorKind?: string; [key: string]: unknown } | null;
}

export type Changes = Record<string, { previous: unknown; current: unknown }>;

export class ToggleyBrowserClient {
  constructor(options: BrowserOptions);
  ready(): Promise<void>;
  variation<T = unknown>(flagKey: string, defaultValue?: T): T;
  variationDetail<T = unknown>(flagKey: string, defaultValue?: T): Detail<T>;
  allFlags(): Record<string, unknown>;
  identify(context: Context): Promise<void>;
  refresh(): Promise<void>;
  on(event: 'change', listener: (changes: Changes) => void): () => void;
  on(event: 'error', listener: (error: Error) => void): () => void;
  close(): void;
}

export function createClient(options: BrowserOptions): ToggleyBrowserClient;
