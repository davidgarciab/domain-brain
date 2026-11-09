import { z } from "zod";
import { normalizeNameservers, registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://api.gandi.net/docs/domains/ (GET /v5/domain/domains)

const API = "https://api.gandi.net/v5";
const PER_PAGE = 100;

const credentials = z.object({
  token: z.string().trim().min(1, "Enter a personal access token."),
});
type Credentials = z.infer<typeof credentials>;

const domainList = z.array(
  z.object({
    fqdn: z.string(),
    autorenew: z.boolean().nullish(),
    dates: z
      .object({
        registry_created_at: z.string().nullish(),
        registry_ends_at: z.string().nullish(),
      })
      .nullish(),
    nameserver: z.object({ hosts: z.array(z.string()).nullish() }).nullish(),
  }),
);
const errorBody = z.object({ message: z.string().optional(), cause: z.string().optional() });

async function page(fetch: Fetch, creds: Credentials, pageNo: number, perPage: number) {
  const url = new URL(`${API}/domain/domains`);
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set("per_page", String(perPage));
  const { status, body } = await requestJson(fetch, "Gandi", url.toString(), {
    headers: { authorization: `Bearer ${creds.token}`, accept: "application/json" },
  });
  if (status === 401 || status === 403) {
    throw new RegistrarError(
      'Gandi rejected the token. Check that it\'s valid and has the "See and renew domain names" permission.',
    );
  }
  if (status >= 400) {
    const err = errorBody.safeParse(body);
    throw new RegistrarError(
      `Gandi returned an error${err.success && err.data.message ? `: ${err.data.message}` : ` (HTTP ${status})`}.`,
    );
  }
  const parsed = domainList.safeParse(body);
  if (!parsed.success) throw new RegistrarError("Gandi returned an unexpected response.");
  return parsed.data;
}

export const gandi: RegistrarProvider<Credentials> = {
  id: "gandi",
  displayName: "Gandi",
  setupHelp:
    "Create a personal access token in your Gandi account (Settings → Personal access tokens / Authentication options) with permission to see domain names. Pick the organization that owns your domains.",
  fields: [{ name: "token", label: "Personal access token", secret: true, required: true }],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await page(fetch, creds, 1, 1);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    for (let p = 1; p <= 1000; p++) {
      const items = await page(fetch, creds, p, PER_PAGE);
      for (const d of items) {
        const name = registrarDomainName("Gandi", d.fqdn);
        if (!name) continue;
        out.push({
          name,
          expiresAt: toDateString(d.dates?.registry_ends_at),
          registeredAt: toDateString(d.dates?.registry_created_at),
          autoRenew: d.autorenew ?? null,
          nameservers: d.nameserver?.hosts?.length
            ? normalizeNameservers(d.nameserver.hosts)
            : null,
          renewalPriceMinor: null,
          currency: null,
        });
      }
      if (items.length < PER_PAGE) break;
    }
    return out;
  },
};
