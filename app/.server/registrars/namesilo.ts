import { z } from "zod";
import { mapConcurrent, normalizeNameservers, registrarDomainName, requestText } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";
import { xmlElements, xmlText } from "./xml";

// Docs: https://www.namesilo.com/api-reference (listDomains, getDomainInfo)
// Response shapes cross-checked with the nrdcg/namesilo client's fixtures.
// listDomains has names and dates; auto-renew and nameservers need one getDomainInfo per domain.

const API = "https://www.namesilo.com/api";
const PAGE_SIZE = 500;
const INFO_CONCURRENCY = 3;

const credentials = z.object({
  apiKey: z.string().trim().min(1, "Enter the API key."),
});
type Credentials = z.infer<typeof credentials>;

async function call(
  fetch: Fetch,
  creds: Credentials,
  operation: string,
  params: Record<string, string> = {},
) {
  const url = new URL(`${API}/${operation}`);
  url.search = new URLSearchParams({
    version: "1",
    type: "xml",
    key: creds.apiKey,
    ...params,
  }).toString();
  const { status, body } = await requestText(fetch, "NameSilo", url.toString());
  const code = xmlText(body, "code");
  if (!code) throw new RegistrarError(`NameSilo returned an unexpected response (HTTP ${status}).`);
  if (code !== "300" && code !== "301" && code !== "302") {
    const detail = xmlText(body, "detail") ?? `code ${code}`;
    const hint =
      code === "110" || code === "112" || code === "113"
        ? " Check the key, and if it's restricted to certain IP addresses, add this server's IP in NameSilo's API Manager."
        : "";
    throw new RegistrarError(`NameSilo: ${detail}.${hint}`);
  }
  return body;
}

const yesNo = (v: string | null) => (v === "Yes" ? true : v === "No" ? false : null);

export const namesilo: RegistrarProvider<Credentials> = {
  id: "namesilo",
  displayName: "NameSilo",
  setupHelp:
    "Generate an API key in NameSilo's API Manager (Account → API Manager). If you restrict the key to IP addresses, include this server's IP. Large accounts take a while to sync: NameSilo needs one request per domain for the auto-renew setting.",
  fields: [{ name: "apiKey", label: "API key", secret: true, required: true }],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await call(fetch, creds, "listDomains", { page: "1", pageSize: "1" });
  },

  async listDomains(creds, fetch) {
    const listed: { name: string; created: string | null; expires: string | null }[] = [];
    const seen = new Set<string>();
    for (let p = 1; p <= 1000; p++) {
      const xml = await call(fetch, creds, "listDomains", {
        page: String(p),
        pageSize: String(PAGE_SIZE),
      });
      let added = 0;
      for (const d of xmlElements(xml, "domain")) {
        const name = registrarDomainName("NameSilo", d.text);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        added++;
        listed.push({ name, created: d.attrs.created ?? null, expires: d.attrs.expires ?? null });
      }
      const total = Number(xmlText(xml, "total") ?? 0);
      // Older responses have no pager: everything comes in one page.
      if (added === 0 || !total || listed.length >= total) break;
    }

    return mapConcurrent(listed, INFO_CONCURRENCY, async (d): Promise<RegistrarDomain> => {
      let autoRenew: boolean | null = null;
      let nameservers: string[] | null = null;
      try {
        const info = await call(fetch, creds, "getDomainInfo", { domain: d.name });
        autoRenew = yesNo(xmlText(info, "auto_renew"));
        const ns = xmlElements(info, "nameserver").map((n) => n.text);
        nameservers = ns.length ? normalizeNameservers(ns) : null;
      } catch (error) {
        // Details are optional: keep the domain with its dates rather than failing the sync.
        if (!(error instanceof RegistrarError)) throw error;
      }
      return {
        name: d.name,
        expiresAt: d.expires,
        registeredAt: d.created,
        autoRenew,
        nameservers,
        renewalPriceMinor: null,
        currency: null,
      };
    });
  },
};
