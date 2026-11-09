import { isIP } from "node:net";
import { z } from "zod";
import { registrarDomainName, requestJson, requestText } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";
import { xmlElements, xmlText } from "./xml";

// Docs: https://www.namecheap.com/support/api/methods/domains/get-list/
// Response shapes cross-checked with Namecheap's official Go SDK (namecheap/go-namecheap-sdk).
// The API only accepts calls from allow-listed IPv4 addresses, passed as ClientIp.

const API = "https://api.namecheap.com/xml.response";
const PAGE_SIZE = 100; // API maximum

const credentials = z.object({
  apiUser: z.string().trim().min(1, "Enter your Namecheap username."),
  apiKey: z.string().trim().min(1, "Enter the API key."),
  clientIp: z
    .string()
    .trim()
    .refine((ip) => isIP(ip) === 4, "Enter this server's public IPv4 address."),
});
type Credentials = z.infer<typeof credentials>;

/** "6/2/2021" or "06/02/2021" (month first) → "2021-06-02". */
export function namecheapDate(value: string | undefined): string | null {
  const m = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, month, day, year] = m;
  return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
}

async function call(fetch: Fetch, creds: Credentials, params: Record<string, string>) {
  const body = new URLSearchParams({
    ApiUser: creds.apiUser,
    UserName: creds.apiUser,
    ApiKey: creds.apiKey,
    ClientIp: creds.clientIp,
    ...params,
  });
  const { status, body: xml } = await requestText(fetch, "Namecheap", API, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const envelope = xmlElements(xml, "ApiResponse")[0];
  if (!envelope)
    throw new RegistrarError(`Namecheap returned an unexpected response (HTTP ${status}).`);
  if (envelope.attrs.Status !== "OK") {
    const error = xmlElements(xml, "Error")[0];
    const message = error?.text || "Unknown error";
    const hint = /IP/i.test(message)
      ? ` Add ${creds.clientIp} to the API whitelist in Namecheap (Profile → Tools → API Access).`
      : /API Key is invalid|API access/i.test(message)
        ? " Check the key, and that API access is enabled for your account."
        : "";
    const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
    throw new RegistrarError(`Namecheap: ${sentence}${hint}`);
  }
  return xml;
}

async function page(fetch: Fetch, creds: Credentials, pageNo: number, pageSize: number) {
  const xml = await call(fetch, creds, {
    Command: "namecheap.domains.getList",
    ListType: "ALL",
    Page: String(pageNo),
    PageSize: String(pageSize),
  });
  return { domains: xmlElements(xml, "Domain"), total: Number(xmlText(xml, "TotalItems") ?? 0) };
}

export const namecheap: RegistrarProvider<Credentials> = {
  id: "namecheap",
  displayName: "Namecheap",
  setupHelp:
    "Enable API access in Namecheap (Profile → Tools → API Access; Namecheap requires an account with at least 20 domains, a $50 balance, or $50 spent in the last 2 years). Then add this server's public IPv4 address to the API whitelist there.",
  fields: [
    { name: "apiUser", label: "Username", secret: false, required: true },
    { name: "apiKey", label: "API key", secret: true, required: true },
    {
      name: "clientIp",
      label: "This server's public IPv4 address",
      secret: false,
      required: true,
      hint: "Must be on Namecheap's API whitelist. Detected automatically when possible; check it.",
    },
  ],
  credentialsSchema: credentials,

  async formDefaults(fetch): Promise<Record<string, string>> {
    // Ask a public "what is my IP" service, since Namecheap requires the caller's IPv4.
    try {
      const { body } = await requestJson(fetch, "ipify", "https://api.ipify.org?format=json");
      const ip = z.object({ ip: z.string() }).safeParse(body);
      return ip.success && isIP(ip.data.ip) === 4 ? { clientIp: ip.data.ip } : {};
    } catch {
      return {};
    }
  },

  async verify(creds, fetch) {
    await page(fetch, creds, 1, 10);
  },

  async listDomains(creds, fetch) {
    const out: RegistrarDomain[] = [];
    for (let p = 1; p <= 1000; p++) {
      const { domains, total } = await page(fetch, creds, p, PAGE_SIZE);
      for (const { attrs } of domains) {
        const name = attrs.Name ? registrarDomainName("Namecheap", attrs.Name) : null;
        if (!name) continue;
        out.push({
          name,
          expiresAt: namecheapDate(attrs.Expires),
          registeredAt: namecheapDate(attrs.Created),
          autoRenew: attrs.AutoRenew === undefined ? null : attrs.AutoRenew === "true",
          nameservers: null,
          renewalPriceMinor: null,
          currency: null,
        });
      }
      if (domains.length < PAGE_SIZE || p * PAGE_SIZE >= total) break;
    }
    return out;
  },
};
