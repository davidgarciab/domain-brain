import { InvalidDomainError, normalizeDomainName } from "../domains/names";
import { logger } from "../logger";
import { type Fetch, RegistrarError } from "./types";

const TIMEOUT_MS = 20_000;

/** fetch + JSON with a timeout; network failures become RegistrarError. Never logs credentials. */
export async function requestJson(
  fetch: Fetch,
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RegistrarError(`${provider} did not respond in time. Try again later.`);
    }
    throw new RegistrarError(`Could not reach ${provider}. Check the server's internet access.`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 429) {
    throw new RegistrarError(`${provider} is rate limiting requests. Try again in a few minutes.`);
  }
  if (res.status >= 500) {
    throw new RegistrarError(
      `${provider} had a server error (HTTP ${res.status}). Try again later.`,
    );
  }
  return { status: res.status, body };
}

/** Normalizes a registrar-provided name; skips (and logs) anything invalid. */
export function registrarDomainName(provider: string, raw: string): string | null {
  try {
    return normalizeDomainName(raw);
  } catch (error) {
    if (!(error instanceof InvalidDomainError)) throw error;
    logger().warn({ provider, domain: raw }, "skipping invalid domain name from registrar");
    return null;
  }
}

/** "2027-01-15T10:00:00Z" or "2027-01-15 10:00:00" (UTC) → "2027-01-15". */
export function toDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function normalizeNameservers(list: string[] | null | undefined): string[] | null {
  if (!list) return null;
  return list
    .map((ns) => ns.toLowerCase().replace(/\.$/, ""))
    .filter(Boolean)
    .sort();
}
