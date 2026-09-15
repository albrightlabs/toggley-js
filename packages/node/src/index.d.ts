export type ContextValue = string | number | boolean | Array<string | number | boolean>;

/** Who a flag is evaluated for. Contexts are evaluated in-process and never sent to Toggley. */
export interface Context {
  key?: string;
  [attribute: string]: ContextValue | undefined | null;
}

export type ReasonKind = 'OFF' | 'TARGET_MATCH' | 'RULE_MATCH' | 'FALLTHROUGH' | 'ERROR';
export type ErrorKind = 'FLAG_NOT_FOUND' | 'CONTEXT_INVALID' | 'MALFORMED_FLAG' | 'WRONG_TYPE' | 'CLIENT_NOT_READY';

export interface EvaluationDetail<T> {
  value: T;
  variation: string | null;
  reason: { kind: ReasonKind; ruleIndex?: number; ruleId?: string | null; inExperiment?: boolean; errorKind?: ErrorKind };
  assignment: 'sticky' | 'random' | null;
  flagVersion: number | null;
}

export interface ToggleyOptions {
  /** The environment's server key (tgly_srv_...). Keep it secret. */
  serverKey?: string;
  /** Defaults to https://my.toggleyapp.com */
  baseUrl?: string;
  /** Milliseconds between config checks. Default 30000. */
  pollInterval?: number;
  /** Request timeout in milliseconds. Default 5000. */
  timeout?: number;
  /** A config document, or the path to a file written by toggley-pull. Used until Toggley answers. */
  bootstrap?: object | string;
  /** Never contact Toggley; serve the bootstrap config only. */
  offline?: boolean;
  /** Send evaluation counts. Default true. */
  events?: boolean;
  /** Milliseconds between evaluation count flushes. Default 60000. */
  flushInterval?: number;
  onError?: (error: ToggleyError) => void;
  logger?: { warn?: (message: string) => void } | null;
  fetch?: typeof fetch;
  autoStart?: boolean;
}

export class ToggleyError extends Error {
  code: string;
}

export class ToggleyClient {
  constructor(options: ToggleyOptions);
  readonly initialized: boolean;
  start(): this;
  waitForInitialization(timeoutMs?: number): Promise<boolean>;
  variation(flagKey: string, context: Context | null, defaultValue?: unknown): unknown;
  variationDetail(flagKey: string, context: Context | null, defaultValue?: unknown): EvaluationDetail<unknown>;
  boolVariation(flagKey: string, context: Context | null, defaultValue?: boolean): boolean;
  boolVariationDetail(flagKey: string, context: Context | null, defaultValue: boolean): EvaluationDetail<boolean>;
  stringVariation(flagKey: string, context: Context | null, defaultValue: string): string;
  stringVariationDetail(flagKey: string, context: Context | null, defaultValue: string): EvaluationDetail<string>;
  numberVariation(flagKey: string, context: Context | null, defaultValue: number): number;
  numberVariationDetail(flagKey: string, context: Context | null, defaultValue: number): EvaluationDetail<number>;
  jsonVariation<T = unknown>(flagKey: string, context: Context | null, defaultValue: T): T;
  jsonVariationDetail<T = unknown>(flagKey: string, context: Context | null, defaultValue: T): EvaluationDetail<T>;
  allFlags(context: Context | null): Record<string, unknown>;
  flush(): Promise<void>;
  close(): Promise<void>;
  on(event: 'update', listener: (info: { environmentVersion: number }) => void): this;
  on(event: 'error', listener: (error: ToggleyError) => void): this;
}

export function init(options: ToggleyOptions): ToggleyClient;
export function isConfigDocument(document: unknown): boolean;
export const SDK_NAME: string;
export const SDK_VERSION: string;
export const DEFAULT_BASE_URL: string;
