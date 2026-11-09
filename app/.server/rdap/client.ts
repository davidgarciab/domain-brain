import { z } from "zod";
import { tldOf } from "../domains/names";

// RDAP lookups (docs/architecture.md → Integrations → RDAP).
// The IANA bootstrap file maps TLDs to RDAP servers; we cache it in memory for 24h.

export const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

export type RdapResult = {
  registeredAt: string | null;
  expiresAt: string | null;
  registrarName: string | null;
  nameservers: string[];
  statuses: string[];
};

/** A lookup failed in a way the user should see (stored in `domain.rdap_error`). */
export class RdapError extends Error {}

/** The server asked us to slow down; callers should stop the current batch. */
export class RdapRateLimitedError extends RdapError {}

const bootstrapSchema = z.object({
  services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
});

const vcardSchema = z.tuple([z.literal("vcard"), z.array(z.array(z.unknown()))]);

type Entity = {
  roles?: string[] | undefined;
  vcardArray?: unknown;
  entities?: Entity[] | undefined;
};
const entitySchema: z.ZodType<Entity> = z.lazy(() =>
  z.object({
    roles: z.array(z.string()).optional(),
    vcardArray: z.unknown().optional(),
    entities: z.array(entitySchema).optional(),
  }),
);

const domainSchema = z.object({
  status: z.array(z.string()).optional(),
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).optional(),
  entities: z.array(entitySchema).optional(),
  nameservers: z.array(z.object({ ldhName: z.string().optional() })).optional(),
});

function vcardName(vcard: unknown): string | null {
  const parsed = vcardSchema.safeParse(vcard);
  if (!parsed.success) return null;
  for (const prop of parsed.data[1]) {
    if (prop[0] === "fn" && typeof prop[3] === "string" && prop[3].trim()) return prop[3].trim();
  }
  return null;
}

function toDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Extracts what we store from an RDAP domain response. Ignores anything unexpected. */
export function parseRdapDomain(json: unknown): RdapResult {
  const parsed = domainSchema.safeParse(json);
  if (!parsed.success) throw new RdapError("The registry returned an unexpected response.");
  const d = parsed.data;
  const event = (action: string) => d.events?.find((e) => e.eventAction === action)?.eventDate;
  const registrar = d.entities?.find((e) => e.roles?.includes("registrar"));
  return {
    registeredAt: toDate(event("registration")),
    expiresAt: toDate(event("expiration")),
    registrarName: registrar ? vcardName(registrar.vcardArray) : null,
    nameservers: (d.nameservers ?? [])
      .map((n) => n.ldhName?.toLowerCase().replace(/\.$/, ""))
      .filter((n): n is string => Boolean(n))
      .sort(),
    statuses: d.status ?? [],
  };
}

type Fetch = typeof globalThis.fetch;

export type RdapClient = {
  lookup: (asciiName: string) => Promise<RdapResult>;
  /** Whether the TLD has a public RDAP server; null if the directory can't be loaded. */
  supportsTld?: (tld: string) => Promise<boolean | null>;
};

export function createRdapClient({
  fetch = globalThis.fetch,
  now = () => Date.now(),
}: {
  fetch?: Fetch;
  now?: () => number;
} = {}): RdapClient {
  let bootstrap: { loadedAt: number; servers: Map<string, string> } | null = null;

  async function serverFor(tld: string): Promise<string | null> {
    if (!bootstrap || now() - bootstrap.loadedAt > BOOTSTRAP_TTL_MS) {
      const res = await fetch(BOOTSTRAP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new RdapError(`Could not load the RDAP directory (HTTP ${res.status}).`);
      const data = bootstrapSchema.parse(await res.json());
      const servers = new Map<string, string>();
      for (const [tlds, urls] of data.services) {
        const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
        if (url) for (const t of tlds) servers.set(t.toLowerCase(), url);
      }
      bootstrap = { loadedAt: now(), servers };
    }
    return bootstrap.servers.get(tld) ?? null;
  }

  return {
    async supportsTld(tld) {
      try {
        return (await serverFor(tld.toLowerCase())) !== null;
      } catch {
        return null;
      }
    },
    async lookup(asciiName) {
      const tld = tldOf(asciiName);
      const base = await serverFor(tld);
      if (!base) {
        throw new RdapError(`.${tld} has no public RDAP service. Enter the details manually.`);
      }
      const url = new URL(`domain/${asciiName}`, base.endsWith("/") ? base : `${base}/`);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { accept: "application/rdap+json, application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new RdapError("The registry did not respond in time.");
        }
        throw new RdapError("Could not reach the registry.");
      }
      if (res.status === 404) throw new RdapError("Not found in the registry. Is it registered?");
      if (res.status === 429) throw new RdapRateLimitedError("The registry is rate limiting us.");
      if (!res.ok) throw new RdapError(`The registry returned HTTP ${res.status}.`);
      return parseRdapDomain(await res.json().catch(() => null));
    },
  };
}

let defaultClient: RdapClient | undefined;

export function rdapClient(): RdapClient {
  defaultClient ??= createRdapClient();
  return defaultClient;
}
