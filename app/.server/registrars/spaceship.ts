import { z } from "zod";
import { normalizeNameservers, registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://docs.spaceship.dev/ (GET /api/v1/domains, scope domains:read)

const API = "https://spaceship.dev/api/v1";
const TAKE = 100; // API maximum

const credentials = z.object({
  apiKey: z.string().trim().min(1, "Enter the API key."),
  apiSecret: z.string().trim().min(1, "Enter the API secret."),
});
type Credentials = z.infer<typeof credentials>;

const listBody = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      autoRenew: z.boolean().nullish(),
      registrationDate: z.string().nullish(),
      expirationDate: z.string().nullish(),
      nameservers: z.object({ hosts: z.array(z.string()).nullish() }).nullish(),
    }),
  ),
  total: z.number(),
});
const problem = z.object({ detail: z.string() });

async function page(fetch: Fetch, creds: Credentials, skip: number, take: number) {
  const url = new URL(`${API}/domains`);
  url.searchParams.set("take", String(take));
  url.searchParams.set("skip", String(skip));
  const { status, body } = await requestJson(fetch, "Spaceship", url.toString(), {
    headers: {
      "x-api-key": creds.apiKey,
      "x-api-secret": creds.apiSecret,
      accept: "application/json",
    },
  });
  if (status === 401) throw new RegistrarError("Spaceship rejected the API key or secret.");
  if (status === 403) {
    throw new RegistrarError("Spaceship denied access. Give the API key the domains:read scope.");
  }
  if (status >= 400) {
    const err = problem.safeParse(body);
    throw new RegistrarError(
      `Spaceship returned an error${err.success ? `: ${err.data.detail}` : ` (HTTP ${status})`}`,
    );
  }
  const parsed = listBody.safeParse(body);
  if (!parsed.success) throw new RegistrarError("Spaceship returned an unexpected response.");
  return parsed.data;
}

export const spaceship: RegistrarProvider<Credentials> = {
  id: "spaceship",
  displayName: "Spaceship",
  setupHelp:
    "In Spaceship, open the API Manager, create an API key with the domains:read scope, and copy the key and secret.",
  fields: [
    { name: "apiKey", label: "API key", secret: false, required: true },
    { name: "apiSecret", label: "API secret", secret: true, required: true },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await page(fetch, creds, 0, 1);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    for (let skip = 0; skip < 1_000_000; skip += TAKE) {
      const data = await page(fetch, creds, skip, TAKE);
      for (const d of data.items) {
        const name = registrarDomainName("Spaceship", d.name);
        if (!name) continue;
        out.push({
          name,
          expiresAt: toDateString(d.expirationDate),
          registeredAt: toDateString(d.registrationDate),
          autoRenew: d.autoRenew ?? null,
          nameservers: d.nameservers?.hosts?.length
            ? normalizeNameservers(d.nameservers.hosts)
            : null,
          renewalPriceMinor: null,
          currency: null,
        });
      }
      if (data.items.length < TAKE || skip + TAKE >= data.total) break;
    }
    return out;
  },
};
