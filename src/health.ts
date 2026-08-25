import * as fs from 'fs';
import * as path from 'path';

export type FailureKind = 'quota' | 'auth' | 'server' | 'network' | 'model_dead' | 'client_config' | 'aborted';

export type FailureClass =
  | { kind: 'quota'; retryAfterMs?: number }
  | { kind: 'auth' }
  | { kind: 'server' }
  | { kind: 'network' }
  | { kind: 'model_dead'; model?: string }
  | { kind: 'client_config' }
  | { kind: 'aborted' };

export interface ProviderHealth {
  state: 'closed' | 'open';
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openUntil: number;
  retryAfterUntil: number | null;
  backoffMs: number;
  halfOpenProbeActive: boolean;
  lastErrorKind: FailureKind | null;
  lastErrorMessage: string;
}

interface HealthFile {
  version: 1;
  savedAt: number;
  providers: Record<string, ProviderHealth>;
}

const HEALTH_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.config', 'octapus', 'health.json'
);

const DEFAULTS = {
  failureThreshold: 3,
  openDurationMs: 45_000,
  maxOpenDurationMs: 3_600_000,
  authOpenDurationMs: 6 * 3_600_000,
  quotaMinMs: 60_000,
  quotaMaxMs: 24 * 3_600_000
};

function freshProvider(): ProviderHealth {
  return {
    state: 'closed', consecutiveFailures: 0, lastFailureAt: null,
    openUntil: 0, retryAfterUntil: null, backoffMs: DEFAULTS.openDurationMs,
    halfOpenProbeActive: false, lastErrorKind: null, lastErrorMessage: ''
  };
}

/** Classify an error into a failure kind — order matters, first match wins */
export function classifyFailure(err: unknown): FailureClass {
  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/API error \((\d{3})\)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  if (err instanceof Error && err.name === 'AbortError') return { kind: 'aborted' };
  if (status === 429) return { kind: 'quota' };
  if (status === 401 || status === 403) return { kind: 'auth' };
  if (status === 404 && /model/i.test(msg)) return { kind: 'model_dead' };
  if (status >= 500 && status <= 599) return { kind: 'server' };
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|UND_ERR|TimeoutError|terminated/i.test(msg)) {
    return { kind: 'network' };
  }
  if (status === 400) return { kind: 'client_config' };
  return { kind: 'server' }; // fail-safe
}

/**
 * Per-provider circuit breaker with JSON persistence.
 * Half-open is DERIVED (no timers): once openUntil passes, the next attempt
 * is the probe — success closes the breaker, failure re-trips with doubled backoff.
 */
export class HealthRegistry {
  private providers: Record<string, ProviderHealth> = {};
  private loaded = false;

  constructor(
    private filePath: string = HEALTH_FILE,
    private now: () => number = () => Date.now()
  ) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as HealthFile;
      if (!data.providers) return;
      const now = this.now();
      for (const [name, h] of Object.entries(data.providers)) {
        // Prune expired entries on load
        if (h.state === 'open' && now >= Math.max(h.openUntil, h.retryAfterUntil ?? 0)) continue;
        this.providers[name] = h;
      }
    } catch {
      // corrupt file → start empty, never crash
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: HealthFile = { version: 1, savedAt: this.now(), providers: this.providers };
      // Atomic write: tmp file + rename prevents concurrent-process clobbering
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch {
      // best-effort persistence
    }
  }

  private entry(name: string): ProviderHealth {
    this.load();
    if (!this.providers[name]) this.providers[name] = freshProvider();
    return this.providers[name];
  }

  /** Pure inspection — NEVER mutates state (safe for ranking/filtering) */
  peekState(name: string): { usable: boolean; probing: boolean; reason?: string; waitMsLeft?: number } {
    const h = this.entry(name);
    if (h.state !== 'open') return { usable: true, probing: false };
    const now = this.now();
    const deadline = Math.max(h.openUntil, h.retryAfterUntil ?? 0);
    if (now < deadline) {
      return {
        usable: false,
        probing: false,
        reason: `${h.lastErrorKind || 'failure'} — ${h.lastErrorMessage}`,
        waitMsLeft: deadline - now
      };
    }
    // Expired open → eligible for probe
    return { usable: true, probing: true };
  }

  /**
   * Claim-and-go: called ONLY at the actual dispatch site in the router loop.
   * Marks an expired-open provider as probing so parallel callers don't double-probe.
   */
  beginProbe(name: string): { usable: boolean; reason?: string } {
    const h = this.entry(name);
    if (h.state !== 'open') return { usable: true };
    const now = this.now();
    const deadline = Math.max(h.openUntil, h.retryAfterUntil ?? 0);
    if (now < deadline) {
      return { usable: false, reason: `${h.lastErrorKind || 'failure'} — ${h.lastErrorMessage}` };
    }
    if (h.halfOpenProbeActive) return { usable: false, reason: 'probe in flight' };
    h.halfOpenProbeActive = true;
    return { usable: true };
  }

  /** Clear a stranded probe flag (e.g. request aborted mid-probe) */
  cancelProbe(name: string): void {
    const h = this.entry(name);
    h.halfOpenProbeActive = false;
  }

  recordSuccess(name: string): void {
    const h = this.entry(name);
    const wasOpen = h.state === 'open';
    Object.assign(h, freshProvider());
    if (wasOpen) this.persist();
  }

  recordFailure(name: string, cls: FailureClass): void {
    const h = this.entry(name);
    h.consecutiveFailures++;
    h.lastFailureAt = this.now();
    h.lastErrorKind = cls.kind;
    h.halfOpenProbeActive = false; // probe consumed by this failure

    switch (cls.kind) {
      case 'aborted':
      case 'client_config':
        // request-scoped — never trips the provider breaker
        return;
      case 'model_dead':
        return; // handled via markModelDead
      case 'quota': {
        const wait = cls.retryAfterMs
          ? Math.min(Math.max(cls.retryAfterMs, DEFAULTS.quotaMinMs), DEFAULTS.quotaMaxMs)
          : Math.min(h.backoffMs, DEFAULTS.quotaMaxMs);
        h.state = 'open';
        h.openUntil = this.now() + wait;
        h.retryAfterUntil = cls.retryAfterMs ? this.now() + cls.retryAfterMs : null;
        break;
      }
      case 'auth':
        h.state = 'open';
        h.openUntil = this.now() + DEFAULTS.authOpenDurationMs;
        h.retryAfterUntil = null;
        break;
      case 'server':
      case 'network':
        if (h.consecutiveFailures >= DEFAULTS.failureThreshold) {
          h.state = 'open';
          h.backoffMs = Math.min(h.backoffMs * 2, DEFAULTS.maxOpenDurationMs);
          h.openUntil = this.now() + h.backoffMs;
          h.retryAfterUntil = null;
        }
        break;
    }
    this.persist();
  }

  private deadModels: Record<string, Map<string, number>> = {};

  markModelDead(providerName: string, model: string, ttlMs = 30 * 60_000): void {
    if (!this.deadModels[providerName]) this.deadModels[providerName] = new Map();
    this.deadModels[providerName].set(model, this.now() + ttlMs);
  }

  isModelDead(providerName: string, model: string): boolean {
    const m = this.deadModels[providerName]?.get(model);
    if (!m) return false;
    if (this.now() > m) {
      this.deadModels[providerName].delete(model);
      return false;
    }
    return true;
  }

  snapshot(): Record<string, ProviderHealth> {
    this.load();
    return JSON.parse(JSON.stringify(this.providers));
  }
}
