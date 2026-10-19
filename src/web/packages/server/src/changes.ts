// The documents the service has read since, as a stream (DES-0057 D19).
//
// One long poll against the service's `changes` operation, shared by every
// browser connected to `/api/events`. The loop runs while someone listens and
// stops when the last one goes.

export interface ChangeEvent {
  type: "document" | "reset";
  repository?: string;
  address?: string;
  kind?: string;
  sequence: number;
}

interface ChangesAnswer {
  epoch: number;
  sequence: number;
  reset: boolean;
  changes: { sequence: number; repository: string; address: string; kind: string }[];
}

export interface ChangeFeedOptions {
  /** The service, as `http://127.0.0.1:4780`. */
  serviceUrl: string;
  /** Seconds the service holds a request open waiting for a change. */
  wait?: number;
  /** Milliseconds before asking again after a failure. */
  retryMs?: number;
  /** Milliseconds before asking again after an empty answer. 0 in service; tests raise it. */
  idleMs?: number;
  fetch?: typeof fetch;
}

export class ChangeFeed {
  private listeners = new Set<(event: ChangeEvent) => void>();
  private abort: AbortController | null = null;
  private after: number | undefined;
  private epoch: number | undefined;

  constructor(private options: ChangeFeedOptions) {}

  /** Call LISTENER for every change from now on. Returns the function that stops it. */
  subscribe(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.run();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) { this.abort?.abort(); this.abort = null; }
    };
  }

  private emit(event: ChangeEvent) { for (const l of [...this.listeners]) l(event); }

  private async run() {
    const abort = new AbortController();
    this.abort = abort;
    // A new run starts from the present: what happened while nobody listened is
    // not replayed, and a browser that connects reads everything once itself.
    this.after = undefined;
    this.epoch = undefined;
    const doFetch = this.options.fetch ?? fetch;
    const retry = this.options.retryMs ?? 2000;
    while (!abort.signal.aborted) {
      try {
        const query = new URLSearchParams({ wait: String(this.options.wait ?? 20) });
        if (this.after !== undefined && this.epoch !== undefined) { query.set("after", String(this.after)); query.set("epoch", String(this.epoch)); }
        const response = await doFetch(`${this.options.serviceUrl}/v1/changes?${query}`, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const answer = (await response.json()) as ChangesAnswer;
        const first = this.after === undefined;
        this.after = answer.sequence;
        this.epoch = answer.epoch;
        if (answer.reset && !first) this.emit({ type: "reset", sequence: answer.sequence });
        for (const c of answer.changes ?? []) {
          this.emit({ type: "document", repository: c.repository, address: c.address, kind: c.kind, sequence: c.sequence });
        }
        if (!answer.reset && (answer.changes ?? []).length === 0 && this.options.idleMs) await sleep(this.options.idleMs, abort.signal);
      } catch (error: any) {
        if (abort.signal.aborted) return;
        await sleep(retry, abort.signal);
      }
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
