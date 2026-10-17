// The Client type and a fetch client (DES-0057 D5). Components receive a Client
// and never build a URL. Every path is relative to the proxy's `/api/` root.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Method = "GET" | "POST" | "PUT";
export type Client = (method: Method, path: string, body?: Json) => Promise<Json>;

/** The service refused the request. `body` is the service's `{name, message}`. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { name?: string; message?: string } & Record<string, Json>) {
    super(body.message ?? `HTTP ${status}`);
    this.name = body.name ?? "ApiError";
  }
}

/** A write made from a version that is no longer the stored one (HTTP 409). Nothing was written. */
export class ConflictError extends ApiError {
  readonly current: { text: string; version: string };
  constructor(body: ApiError["body"]) {
    super(409, body);
    const current = (body.current ?? {}) as { text?: string; version?: string };
    this.current = { text: current.text ?? "", version: current.version ?? "" };
  }
}

export interface FetchClientOptions {
  /** Where the proxy is. Empty means the page's own origin. */
  baseUrl?: string;
  /** Sent as a bearer token. */
  token?: string;
  fetch?: typeof fetch;
}

export function fetchClient(options: FetchClientOptions = {}): Client {
  const doFetch = options.fetch ?? fetch;
  return async (method, path, body) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await doFetch(`${options.baseUrl ?? ""}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: Json = null;
    if (text) {
      try { parsed = JSON.parse(text) as Json; } catch { parsed = { message: text }; }
    }
    if (response.ok) return parsed;
    const failure = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { message: String(parsed) }) as ApiError["body"];
    throw response.status === 409 ? new ConflictError(failure) : new ApiError(response.status, failure);
  };
}

// ---- The operations the UI uses, typed against what `/v1/` answers. -------------

export interface DocumentRow {
  id: string;
  type: string;
  category: string | null;
  title: string | null;
  status: string | null;
  priority: string | null;
  severity: string | null;
  date: string | null;
  tags: string[] | null;
  refines: string[] | null;
  affects: string[] | null;
  path: string | null;
}
export interface RepositoryDocuments { repository: string; documents: DocumentRow[] }
export interface DocumentText { repository: string; "doc-id": string; address: string; text: string; version: string }
export interface WriteResult { address: string; changed: boolean; version: string; check: CheckResult }
export interface CheckReference { field: string; name: string; status: "resolved" | "unresolved" | "ambiguous" | "self"; target?: string; type?: string; candidates?: string[] }
export interface CheckResult { path: string; document?: string; type?: string; error?: string; references?: CheckReference[] }
export interface CreatedDocument { repository: string; "doc-id": string; address: string; text: string; version: string }

const q = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const operations = (client: Client) => ({
  documents: async (repository?: string): Promise<RepositoryDocuments[]> => {
    const answer = (await client("GET", `/api/v1/documents${q({ repository })}`)) as any;
    return answer.repositories ?? [answer];
  },
  readDocument: (repository: string, document: string) =>
    client("GET", `/api/v1/read-document${q({ repository, document })}`) as Promise<unknown> as Promise<DocumentText>,
  writeDocument: (repository: string, document: string, text: string, version: string) =>
    client("POST", "/api/v1/write-document", { repository, document, text, version }) as Promise<unknown> as Promise<WriteResult>,
  createDocument: (repository: string, category: "req" | "bug", title: string, refines: string[] = []) =>
    client("POST", "/api/v1/create-document", { repository, category, title, refines }) as Promise<unknown> as Promise<CreatedDocument>,
  checkDocument: (repository: string, path: string) =>
    client("GET", `/api/v1/check-document${q({ repository, path })}`) as Promise<unknown> as Promise<CheckResult>,
  setStatus: (repository: string, document: string, status: string) =>
    client("POST", "/api/v1/set-status", { repository, document, status }),
});
