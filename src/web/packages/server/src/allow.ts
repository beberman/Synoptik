// The operations the proxy forwards (DES-0057 D6). Anything not named here is
// refused, so an operation added to the service later is unreachable from a
// browser until it is added here on purpose.

/** Read-tier operations. Forwarded as GET. */
export const READS = [
  "check", "check-document", "committed-document", "context", "describe", "documents", "drift", "find",
  "impact", "read-document", "rules", "server-status", "similar", "sites",
  "status", "structure", "suggest-fixes", "survey",
] as const;

/** Write-tier operations. Forwarded as POST and always need the token when one is set. */
export const WRITES = [
  "write-document", "create-document", "set-status", "complete",
  "watch", "pause", "unwatch", "reindex",
] as const;

// Deliberately absent: the repl tier, and `init`, `embed`, `architecture`,
// `remove` and `context-used`, which a person at a terminal or an agent runs.

export type Operation = (typeof READS)[number] | (typeof WRITES)[number];

export const isRead = (name: string) => (READS as readonly string[]).includes(name);
export const isWrite = (name: string) => (WRITES as readonly string[]).includes(name);
export const isAllowed = (name: string) => isRead(name) || isWrite(name);
