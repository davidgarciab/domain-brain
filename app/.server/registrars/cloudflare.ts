import { z } from "zod";
import { registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/list/
// (The older /registrar/domains endpoint reached end of life on 2026-09-27.)

const API = "https://api.cloudflare.com/client/v4";
const PER_PAGE = 50; // API maximum
/** Seen in practice: 9106 (malformed token, HTTP 400), 10000 (unknown token, HTTP 401). */
const AUTH_ERROR_CODES = new Set([6003, 9106, 9109, 10000, 10001]);

const credentials = z.object({
  accountId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, "The account ID is a 32-character hex string."),
  apiToken: z.string().trim().min(1, "Enter an API token."),
});
type Credentials = z.infer<typeof credentials>;

const envelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string() })).default([]),
  result: z
    .array(
      z.object({
        domain_name: z.string(),
        created_at: z.string().nullish(),
        expires_at: z.string().nullish(),
        auto_renew: z.boolean().nullish(),
        status: z.string().nullish(),
      }),
    )
    .nullish(),
  result_info: z.object({ cursor: z.string().nullish() }).nullish(),
});

async function page(fetch: Fetch, creds: Credentials, cursor: string, perPage: number) {
  const url = new URL(`${API}/accounts/${creds.accountId}/registrar/registrations`);
  url.searchParams.set("per_page", String(perPage));
  if (cursor) url.searchParams.set("cursor", cursor);
  const { status, body } = await requestJson(fetch, "Cloudflare", url.toString(), {
    headers: { authorization: `Bearer ${creds.apiToken}`, accept: "application/json" },
  });
  const parsed = envelope.safeParse(body);
  const authFailed =
    parsed.success && parsed.data.errors.some((e) => AUTH_ERROR_CODES.has(e.code ?? 0));
  if (status === 401 || status === 403 || authFailed) {
    throw new RegistrarError(
      "Cloudflare rejected the API token. Check that it has read access to Registrar for this account.",
    );
  }
  if (status === 404) throw new RegistrarError("Cloudflare doesn't know this account ID.");
  if (!parsed.success) throw new RegistrarError("Cloudflare returned an unexpected response.");
  if (!parsed.data.success) {
    const message = parsed.data.errors.map((e) => e.message).join("; ") || `HTTP ${status}`;
    throw new RegistrarError(`Cloudflare returned an error: ${message}`);
  }
  return { items: parsed.data.result ?? [], next: parsed.data.result_info?.cursor ?? "" };
}

export const cloudflare: RegistrarProvider<Credentials> = {
  id: "cloudflare",
  displayName: "Cloudflare",
  setupHelp:
    "Create an API token in the Cloudflare dashboard (My Profile → API Tokens) with read access to Registrar for your account. The account ID is on your account's overview page. Only domains registered at Cloudflare Registrar are imported, not zones that only use Cloudflare DNS.",
  fields: [
    { name: "accountId", label: "Account ID", secret: false, required: true },
    { name: "apiToken", label: "API token", secret: true, required: true },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await page(fetch, creds, "", 1);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    let cursor = "";
    for (let i = 0; i < 1000; i++) {
      const { items, next } = await page(fetch, creds, cursor, PER_PAGE);
      for (const r of items) {
        const name = registrarDomainName("Cloudflare", r.domain_name);
        if (!name) continue;
        out.push({
          name,
          expiresAt: toDateString(r.expires_at),
          registeredAt: toDateString(r.created_at),
          autoRenew: r.auto_renew ?? null,
          nameservers: null, // not reported by this endpoint
          renewalPriceMinor: null,
          currency: null,
        });
      }
      if (!next || items.length === 0) break;
      cursor = next;
    }
    return out;
  },
};
