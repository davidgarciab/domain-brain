import { createHash } from "node:crypto";
import { z } from "zod";
import { mapConcurrent, registrarDomainName, requestJson, toDateString } from "./http";
import { type Fetch, type RegistrarDomain, RegistrarError, type RegistrarProvider } from "./types";

// Docs: https://docs.ovhcloud.com/en/guides/manage-and-operate/api/first-steps
// Signing and endpoints follow the official go-ovh client. GET /domain lists names; expiry
// and auto-renew come from GET /domain/{name}/serviceInfos (one request per domain).

const ENDPOINTS = {
  eu: "https://api.eu.ovhcloud.com/1.0",
  ca: "https://api.ca.ovhcloud.com/1.0",
  us: "https://api.us.ovhcloud.com/1.0",
} as const;
const INFO_CONCURRENCY = 4;

const credentials = z.object({
  region: z.enum(["eu", "ca", "us"], { error: "Choose your OVHcloud region." }),
  applicationKey: z.string().trim().min(1, "Enter the application key."),
  applicationSecret: z.string().trim().min(1, "Enter the application secret."),
  consumerKey: z.string().trim().min(1, "Enter the consumer key."),
});
type Credentials = z.infer<typeof credentials>;

const serviceInfos = z.object({
  creation: z.string().nullish(),
  expiration: z.string().nullish(),
  renew: z.object({ automatic: z.boolean().nullish() }).nullish(),
});
const errorBody = z.object({ message: z.string() });

/** OVH signature: "$1$" + sha1(AS+CK+METHOD+URL+BODY+TIMESTAMP), joined with "+". */
export function ovhSignature(
  creds: Pick<Credentials, "applicationSecret" | "consumerKey">,
  method: string,
  url: string,
  body: string,
  timestamp: number,
): string {
  const payload = [creds.applicationSecret, creds.consumerKey, method, url, body, timestamp].join(
    "+",
  );
  return `$1$${createHash("sha1").update(payload).digest("hex")}`;
}

function client(fetch: Fetch, creds: Credentials) {
  const base = ENDPOINTS[creds.region];
  let delta: number | null = null; // server time - local time, in seconds

  return async function get(path: string): Promise<unknown> {
    if (delta === null) {
      const { body } = await requestJson(fetch, "OVHcloud", `${base}/auth/time`);
      const serverTime = z.number().safeParse(body);
      delta = serverTime.success ? serverTime.data - Math.floor(Date.now() / 1000) : 0;
    }
    const url = `${base}${path}`;
    const timestamp = Math.floor(Date.now() / 1000) + delta;
    const { status, body } = await requestJson(fetch, "OVHcloud", url, {
      headers: {
        accept: "application/json",
        "x-ovh-application": creds.applicationKey,
        "x-ovh-consumer": creds.consumerKey,
        "x-ovh-timestamp": String(timestamp),
        "x-ovh-signature": ovhSignature(creds, "GET", url, "", timestamp),
      },
    });
    if (status >= 400) {
      const message = errorBody.safeParse(body);
      const detail = message.success ? message.data.message : `HTTP ${status}`;
      if (status === 401 || status === 403) {
        throw new RegistrarError(
          `OVHcloud rejected the keys (${detail}). Check the region and that the token allows GET /domain and GET /domain/*.`,
        );
      }
      throw new RegistrarError(`OVHcloud returned an error: ${detail}`);
    }
    return body;
  };
}

export const ovh: RegistrarProvider<Credentials> = {
  id: "ovh",
  displayName: "OVHcloud",
  setupHelp:
    "Create API keys for your region (Europe: api.eu.ovhcloud.com/createToken, Canada: api.ca.ovhcloud.com/createToken, US: api.us.ovhcloud.com/createToken) with the rights GET /domain and GET /domain/*, and an unlimited validity. You get an application key, an application secret and a consumer key.",
  fields: [
    {
      name: "region",
      label: "Region",
      secret: false,
      required: true,
      options: [
        { value: "eu", label: "Europe (ovh.com / ovhcloud.com)" },
        { value: "ca", label: "Canada" },
        { value: "us", label: "United States" },
      ],
    },
    { name: "applicationKey", label: "Application key", secret: false, required: true },
    { name: "applicationSecret", label: "Application secret", secret: true, required: true },
    { name: "consumerKey", label: "Consumer key", secret: true, required: true },
  ],
  credentialsSchema: credentials,

  async verify(creds, fetch) {
    await client(fetch, creds)("/domain");
  },

  async listDomains(creds, fetch) {
    const get = client(fetch, creds);
    const names = z.array(z.string()).safeParse(await get("/domain"));
    if (!names.success) throw new RegistrarError("OVHcloud returned an unexpected response.");

    const valid = names.data
      .map((raw) => registrarDomainName("OVHcloud", raw))
      .filter((n): n is string => n !== null);
    return mapConcurrent(valid, INFO_CONCURRENCY, async (name): Promise<RegistrarDomain> => {
      const info = serviceInfos.safeParse(
        await get(`/domain/${encodeURIComponent(name)}/serviceInfos`),
      );
      const s = info.success ? info.data : null;
      return {
        name,
        expiresAt: toDateString(s?.expiration),
        registeredAt: toDateString(s?.creation),
        autoRenew: s?.renew?.automatic ?? null,
        nameservers: null,
        renewalPriceMinor: null,
        currency: null,
      };
    });
  },
};
