import { z } from "zod";
import { normalizeNameservers, registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://developer.godaddy.com/docs/references/rest/domains/v1
// (OpenAPI: https://developer.godaddy.com/openapi/domains-v1.json)

const API = "https://api.godaddy.com";
const PAGE_SIZE = 1000; // API maximum

/** Statuses meaning the domain is no longer in this account; they count as "not listed". */
const GONE = /^(CANCELLED|TRANSFERRED|UPDATED|CONFISCATED|FAILED|REVERTED)/;

const credentials = z
  .object({
    token: z.string().trim().optional().default(""),
    apiKey: z.string().trim().optional().default(""),
    apiSecret: z.string().trim().optional().default(""),
  })
  .refine((c) => c.token || (c.apiKey && c.apiSecret), {
    message: "Enter a personal access token, or an API key and secret.",
    path: ["token"],
  });
type Credentials = z.infer<typeof credentials>;

const domainList = z.array(
  z.object({
    domain: z.string(),
    status: z.string().nullish(),
    expires: z.string().nullish(),
    createdAt: z.string().nullish(),
    renewAuto: z.boolean().nullish(),
    nameServers: z.array(z.string()).nullish(),
  }),
);
const errorBody = z.object({ code: z.string().optional(), message: z.string().optional() });

function authHeader(c: Credentials): string {
  return c.token ? `Bearer ${c.token}` : `sso-key ${c.apiKey}:${c.apiSecret}`;
}

async function page(fetch: Fetch, creds: Credentials, marker: string, limit: number) {
  const url = new URL(`${API}/v1/domains`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("includes", "nameServers");
  if (marker) url.searchParams.set("marker", marker);
  const { status, body } = await requestJson(fetch, "GoDaddy", url.toString(), {
    headers: { authorization: authHeader(creds), accept: "application/json" },
  });
  if (status === 401) throw new RegistrarError("GoDaddy rejected the credentials.");
  if (status === 403) {
    throw new RegistrarError(
      "GoDaddy denied access. Its API is only available to accounts that meet GoDaddy's requirements, and tokens need the domains read scope.",
    );
  }
  if (status >= 400) {
    const err = errorBody.safeParse(body);
    const detail = err.success ? (err.data.message ?? err.data.code) : undefined;
    throw new RegistrarError(
      `GoDaddy returned an error${detail ? `: ${detail}` : ` (HTTP ${status})`}.`,
    );
  }
  const parsed = domainList.safeParse(body);
  if (!parsed.success) throw new RegistrarError("GoDaddy returned an unexpected response.");
  return parsed.data;
}

export const godaddy: RegistrarProvider<Credentials> = {
  id: "godaddy",
  displayName: "GoDaddy",
  setupHelp:
    "Create a personal access token with the domains read scope in the GoDaddy developer portal, or use a legacy production API key and secret. GoDaddy limits API access to accounts that meet its requirements (for example, a minimum number of domains).",
  fields: [
    {
      name: "token",
      label: "Personal access token",
      secret: true,
      required: false,
      hint: "Or leave empty and use a legacy API key and secret below.",
    },
    { name: "apiKey", label: "API key (legacy)", secret: false, required: false },
    { name: "apiSecret", label: "API secret (legacy)", secret: true, required: false },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await page(fetch, creds, "", 1);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    let marker = "";
    for (let i = 0; i < 1000; i++) {
      const items = await page(fetch, creds, marker, PAGE_SIZE);
      for (const d of items) {
        if (d.status && GONE.test(d.status)) continue;
        const name = registrarDomainName("GoDaddy", d.domain);
        if (!name) continue;
        out.push({
          name,
          expiresAt: toDateString(d.expires),
          registeredAt: toDateString(d.createdAt),
          autoRenew: d.renewAuto ?? null,
          nameservers: normalizeNameservers(d.nameServers),
          renewalPriceMinor: null,
          currency: null,
        });
      }
      const last = items.at(-1);
      if (items.length < PAGE_SIZE || !last) break;
      marker = last.domain;
    }
    return out;
  },
};
