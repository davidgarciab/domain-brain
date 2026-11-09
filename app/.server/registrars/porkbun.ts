import { z } from "zod";
import { registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://porkbun.com/api/json/v3/documentation (OpenAPI: /api/json/v3/spec)

const API = "https://api.porkbun.com/api/json/v3";
const PAGE_SIZE = 1000; // fixed by the API

const credentials = z.object({
  apiKey: z.string().trim().min(1, "Enter the API key."),
  secretApiKey: z.string().trim().min(1, "Enter the secret API key."),
});
type Credentials = z.infer<typeof credentials>;

const errorBody = z.object({ status: z.literal("ERROR"), message: z.string() });
const listBody = z.object({
  status: z.literal("SUCCESS"),
  domains: z.array(
    z.object({
      domain: z.string(),
      status: z.string().nullish(),
      createDate: z.string().nullish(),
      expireDate: z.string().nullish(),
      // Documented as integers; older responses sent "1" as a string.
      autoRenew: z.union([z.number(), z.string()]).nullish(),
    }),
  ),
});

async function post(fetch: Fetch, path: string, creds: Credentials, body: object = {}) {
  const { status, body: json } = await requestJson(fetch, "Porkbun", `${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ apikey: creds.apiKey, secretapikey: creds.secretApiKey, ...body }),
  });
  const error = errorBody.safeParse(json);
  if (error.success) throw new RegistrarError(`Porkbun: ${error.data.message}`);
  if (status >= 400) throw new RegistrarError(`Porkbun returned HTTP ${status}.`);
  return json;
}

export const porkbun: RegistrarProvider<Credentials> = {
  id: "porkbun",
  displayName: "Porkbun",
  setupHelp:
    'Create an API key at porkbun.com/account/api (read-only is enough). Porkbun only returns domains with API access turned on: enable it per domain, or use "Opt In All Domains".',
  fields: [
    { name: "apiKey", label: "API key", secret: false, required: true, hint: "Starts with pk1_" },
    {
      name: "secretApiKey",
      label: "Secret API key",
      secret: true,
      required: true,
      hint: "Starts with sk1_",
    },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await post(fetch, "/ping", creds);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    for (let start = 0; start < 1_000_000; start += PAGE_SIZE) {
      const parsed = listBody.safeParse(await post(fetch, "/domain/listAll", creds, { start }));
      if (!parsed.success) throw new RegistrarError("Porkbun returned an unexpected response.");
      for (const d of parsed.data.domains) {
        const name = registrarDomainName("Porkbun", d.domain);
        if (!name) continue;
        out.push({
          name,
          expiresAt: toDateString(d.expireDate),
          registeredAt: toDateString(d.createDate),
          autoRenew: d.autoRenew == null ? null : Number(d.autoRenew) === 1,
          nameservers: null,
          renewalPriceMinor: null,
          currency: null,
        });
      }
      if (parsed.data.domains.length < PAGE_SIZE) break;
    }
    return out;
  },
};
