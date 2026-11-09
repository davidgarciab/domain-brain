import { z } from "zod";
import { normalizeNameservers, registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://docs.name.com/docs/api-reference/domains/list-domains (Core API, GET /core/v1/domains)

const API = "https://api.name.com/core/v1";
const PER_PAGE = 1000; // API maximum

const credentials = z.object({
  username: z.string().trim().min(1, "Enter your Name.com username."),
  token: z.string().trim().min(1, "Enter an API token."),
});
type Credentials = z.infer<typeof credentials>;

const listBody = z.object({
  domains: z
    .array(
      z.object({
        domainName: z.string(),
        createDate: z.string().nullish(),
        expireDate: z.string().nullish(),
        autorenewEnabled: z.boolean().nullish(),
        nameservers: z.array(z.string()).nullish(),
        renewalPrice: z.number().nullish(),
      }),
    )
    .nullish(),
  nextPage: z.number().nullish(),
});
const errorBody = z.object({ message: z.string(), details: z.string().nullish() });

async function page(fetch: Fetch, creds: Credentials, pageNo: number, perPage: number) {
  const url = new URL(`${API}/domains`);
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set("perPage", String(perPage));
  const basic = Buffer.from(`${creds.username}:${creds.token}`).toString("base64");
  const { status, body } = await requestJson(fetch, "Name.com", url.toString(), {
    headers: { authorization: `Basic ${basic}`, accept: "application/json" },
  });
  if (status === 401) {
    throw new RegistrarError(
      "Name.com rejected the username or API token. Use a production token (not a sandbox one).",
    );
  }
  if (status >= 400) {
    const err = errorBody.safeParse(body);
    const detail = err.success ? (err.data.details ?? err.data.message) : `HTTP ${status}`;
    throw new RegistrarError(`Name.com returned an error: ${detail}.`);
  }
  const parsed = listBody.safeParse(body);
  if (!parsed.success) throw new RegistrarError("Name.com returned an unexpected response.");
  return parsed.data;
}

export const namecom: RegistrarProvider<Credentials> = {
  id: "namecom",
  displayName: "Name.com",
  setupHelp:
    "Create a production API token at name.com/account/settings/api and use it with your Name.com username. If two-step verification blocks API access, allow API access in the same settings page.",
  fields: [
    { name: "username", label: "Username", secret: false, required: true },
    { name: "token", label: "API token", secret: true, required: true },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await page(fetch, creds, 1, 1);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    let pageNo: number | null | undefined = 1;
    for (let i = 0; pageNo && i < 1000; i++) {
      const data = await page(fetch, creds, pageNo, PER_PAGE);
      for (const d of data.domains ?? []) {
        const name = registrarDomainName("Name.com", d.domainName);
        if (!name) continue;
        const price = d.renewalPrice;
        out.push({
          name,
          expiresAt: toDateString(d.expireDate),
          registeredAt: toDateString(d.createDate),
          autoRenew: d.autorenewEnabled ?? null,
          nameservers: d.nameservers?.length ? normalizeNameservers(d.nameservers) : null,
          // Name.com prices are in US dollars.
          renewalPriceMinor: typeof price === "number" ? Math.round(price * 100) : null,
          currency: typeof price === "number" ? "USD" : null,
        });
      }
      pageNo = data.nextPage;
    }
    return out;
  },
};
