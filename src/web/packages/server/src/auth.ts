import { createHash, timingSafeEqual } from "node:crypto";

/** True when the request carries `Authorization: Bearer <token>`. Compared in constant time. */
export function bearerMatches(header: string | null, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  // Hash both sides so the comparison is of equal length whatever was sent.
  const a = createHash("sha256").update(match[1]!).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export const isLoopback = (host: string) => LOOPBACK.has(host) || host.startsWith("127.");

/**
 * The proxy forwards with a loopback Host, so it is the authentication boundary
 * (DEC-0012, DES-0057 D6). Binding anything but loopback without a token would
 * give every caller on that network the write tier.
 */
export function assertBindable(host: string, token: string | undefined): void {
  if (!isLoopback(host) && !token) {
    throw new Error(`Refusing to listen on ${host} without a token. Set SYNOPTIK_UI_TOKEN, or bind 127.0.0.1.`);
  }
}
