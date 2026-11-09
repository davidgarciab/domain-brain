import { describe, expect, it, vi } from "vitest";
import { namecheap, namecheapDate } from "~/.server/registrars/namecheap";
import { namesilo } from "~/.server/registrars/namesilo";
import { ovh, ovhSignature } from "~/.server/registrars/ovh";

// Namecheap, NameSilo and OVHcloud. Response shapes come from the official Namecheap Go SDK,
// the nrdcg/namesilo fixtures, OVH's API schema, and real error responses (2026-11).

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) =>
    handler(new URL(String(input instanceof Request ? input.url : input)), init),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const xmlResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/xml" } });

describe("namecheap", () => {
  const creds = { apiUser: "ada", apiKey: "key123", clientIp: "203.0.113.5" };
  const domainXml = (name: string, extra = "") =>
    `<Domain ID="677625" Name="${name}" User="ada" Created="06/02/2021" Expires="6/2/2027" IsExpired="false" IsLocked="false" AutoRenew="true" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="false" ${extra}/>`;
  const page = (domains: string[], total: number) => `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors />
  <Warnings />
  <RequestedCommand>namecheap.domains.getList</RequestedCommand>
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      ${domains.join("\n")}
    </DomainGetListResult>
    <Paging><TotalItems>${total}</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>
  </CommandResponse>
  <Server>PHX01APIEXT01</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.011</ExecutionTime>
</ApiResponse>`;

  it("parses month-first dates", () => {
    expect(namecheapDate("06/02/2021")).toBe("2021-06-02");
    expect(namecheapDate("6/2/2021")).toBe("2021-06-02");
    expect(namecheapDate("2021-06-02")).toBeNull();
  });

  it("posts the global parameters and pages through getList", async () => {
    const fetch = fakeFetch(async (url, init) => {
      expect(url.toString()).toBe("https://api.namecheap.com/xml.response");
      expect(init.method).toBe("POST");
      const body = new URLSearchParams(String(init.body));
      expect(Object.fromEntries(body)).toMatchObject({
        ApiUser: "ada",
        UserName: "ada",
        ApiKey: "key123",
        ClientIp: "203.0.113.5",
        Command: "namecheap.domains.getList",
        PageSize: "100",
      });
      if (body.get("Page") === "1") {
        return xmlResponse(
          page(
            Array.from({ length: 100 }, (_, i) => domainXml(`n${i}.com`)),
            101,
          ),
        );
      }
      return xmlResponse(
        page([domainXml("last.io", "").replace('AutoRenew="true"', 'AutoRenew="false"')], 101),
      );
    });
    const list = await namecheap.listDomains(creds, fetch);
    expect(list).toHaveLength(101);
    expect(list[0]).toEqual({
      name: "n0.com",
      expiresAt: "2027-06-02",
      registeredAt: "2021-06-02",
      autoRenew: true,
      nameservers: null,
      renewalPriceMinor: null,
      currency: null,
    });
    expect(list.at(-1)).toMatchObject({ name: "last.io", autoRenew: false });
  });

  it("explains errors, with a whitelist hint for IP problems", async () => {
    const error = (number: string, message: string) =>
      fakeFetch(() =>
        xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
  <Errors>
    <Error Number="${number}">${message}</Error>
  </Errors>
  <Warnings />
  <RequestedCommand />
</ApiResponse>`),
      );
    // Real response for an invalid key (captured 2026-11):
    await expect(
      namecheap.verify(
        creds,
        error("1011102", "API Key is invalid or API access has not been enabled"),
      ),
    ).rejects.toThrow(
      /Namecheap: API Key is invalid or API access has not been enabled\. Check the key/,
    );
    await expect(namecheap.verify(creds, error("1011150", "Invalid request IP"))).rejects.toThrow(
      /Add 203\.0\.113\.5 to the API whitelist/,
    );
  });

  it("requires an IPv4 client address", () => {
    expect(
      namecheap.credentialsSchema.safeParse({ ...creds, clientIp: "2001:db8::1" }).success,
    ).toBe(false);
  });

  it("suggests the server's public IP, and tolerates the lookup failing", async () => {
    expect(
      await namecheap.formDefaults?.(fakeFetch(() => Response.json({ ip: "198.51.100.7" }))),
    ).toEqual({ clientIp: "198.51.100.7" });
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await namecheap.formDefaults?.(down)).toEqual({});
  });
});

describe("namesilo", () => {
  const creds = { apiKey: "silo-key" };
  const listXml = (domains: string[], total?: number) => `<namesilo>
    <request><operation>listDomains</operation><ip>55.555.55.55</ip></request>
    <reply>
        <code>300</code>
        <detail>success</detail>
        <domains>${domains.join("")}</domains>
        ${total === undefined ? "" : `<pager><total>${total}</total><pageSize>500</pageSize><page>1</page></pager>`}
    </reply>
</namesilo>`;
  const info = (autoRenew: string) => `<namesilo>
    <request><operation>getDomainInfo</operation><ip>55.555.55.55</ip></request>
    <reply>
        <code>300</code><detail>success</detail>
        <created>2009-01-11</created><expires>2027-01-11</expires><status>Active</status>
        <locked>Yes</locked><private>Yes</private><auto_renew>${autoRenew}</auto_renew>
        <nameservers>
            <nameserver position="1">NS1.NAMESILO.COM</nameserver>
            <nameserver position="2">NS2.NAMESILO.COM</nameserver>
        </nameservers>
    </reply>
</namesilo>`;

  it("lists domains with dates, then adds auto-renew and nameservers per domain", async () => {
    const fetch = fakeFetch((url) => {
      expect(url.searchParams.get("key")).toBe("silo-key");
      expect(url.searchParams.get("type")).toBe("xml");
      if (url.pathname === "/api/listDomains") {
        return xmlResponse(
          listXml(
            [
              '<domain created="1998-02-03" expires="2027-02-03" maxBid="50">namesilo.com</domain>',
              '<domain created="2000-02-03" expires="2027-03-04">namesilo.net</domain>',
              '<domain created="2000-02-03" expires="2027-03-05">broken.org</domain>',
            ],
            3,
          ),
        );
      }
      const domain = url.searchParams.get("domain");
      if (domain === "broken.org") {
        return xmlResponse(
          "<namesilo><reply><code>200</code><detail>Domain is not active, or does not belong to this user</detail></reply></namesilo>",
        );
      }
      return xmlResponse(info(domain === "namesilo.com" ? "Yes" : "No"));
    });
    expect(await namesilo.listDomains(creds, fetch)).toEqual([
      {
        name: "namesilo.com",
        expiresAt: "2027-02-03",
        registeredAt: "1998-02-03",
        autoRenew: true,
        nameservers: ["ns1.namesilo.com", "ns2.namesilo.com"],
        renewalPriceMinor: null,
        currency: null,
      },
      expect.objectContaining({ name: "namesilo.net", autoRenew: false }),
      // getDomainInfo failed: the domain is kept with its dates
      expect.objectContaining({
        name: "broken.org",
        expiresAt: "2027-03-05",
        autoRenew: null,
        nameservers: null,
      }),
    ]);
  });

  it("handles responses without a pager (single page)", async () => {
    const fetch = fakeFetch((url) =>
      url.pathname === "/api/listDomains"
        ? xmlResponse(
            listXml(['<domain created="2000-02-03" expires="2027-02-03">one.com</domain>']),
          )
        : xmlResponse(info("Yes")),
    );
    expect((await namesilo.listDomains(creds, fetch)).map((d) => d.name)).toEqual(["one.com"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("explains an invalid key (real response)", async () => {
    const fetch = fakeFetch(() =>
      xmlResponse(
        '<?xml version="1.0" encoding="utf-8"?>\n<namesilo><request><operation>listDomains</operation><ip>79.116.225.5</ip></request><reply><code>110</code><detail>Invalid API Key (Permission denied)</detail></reply></namesilo>',
      ),
    );
    await expect(namesilo.verify(creds, fetch)).rejects.toThrow(
      /NameSilo: Invalid API Key \(Permission denied\)\. Check the key/,
    );
  });
});

describe("ovh", () => {
  const creds = {
    region: "eu" as const,
    applicationKey: "TDPKJdwZwAQPwKX2",
    applicationSecret: "9ufkBmLaTQ9nz5yMUlg79taH0GNnzDjk",
    consumerKey: "5mBuy6SUQcRw2ZUxg0cG68BoDKpED4KY",
  };

  it("signs exactly like the official go-ovh client (its test vector)", () => {
    expect(ovhSignature(creds, "GET", "https://api.eu.ovhcloud.com/1.0/auth", "", 1457018875)).toBe(
      "$1$52992e595b398f6aba591ee5925b379081614ced",
    );
  });

  it("uses server time, signs every call, and reads serviceInfos per domain", async () => {
    const serverTime = Math.floor(Date.now() / 1000) + 3600; // our clock is an hour behind
    const fetch = fakeFetch((url, init) => {
      const headers = new Headers(init.headers);
      if (url.pathname === "/1.0/auth/time") return Response.json(serverTime);
      expect(url.host).toBe("api.eu.ovhcloud.com");
      expect(headers.get("x-ovh-application")).toBe(creds.applicationKey);
      expect(headers.get("x-ovh-consumer")).toBe(creds.consumerKey);
      const ts = Number(headers.get("x-ovh-timestamp"));
      expect(Math.abs(ts - serverTime)).toBeLessThan(5);
      expect(headers.get("x-ovh-signature")).toBe(
        ovhSignature(creds, "GET", url.toString(), "", ts),
      );
      if (url.pathname === "/1.0/domain") return Response.json(["example.fr", "mon-site.eu"]);
      const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      return Response.json({
        domain: name,
        creation: "2018-04-01",
        expiration: name === "example.fr" ? "2027-04-01" : "2026-12-24",
        renew: {
          automatic: name === "example.fr",
          deleteAtExpiration: false,
          forced: false,
          manualPayment: false,
          period: 1,
        },
        status: "ok",
        serviceId: 1,
      });
    });
    expect(await ovh.listDomains(creds, fetch)).toEqual([
      {
        name: "example.fr",
        expiresAt: "2027-04-01",
        registeredAt: "2018-04-01",
        autoRenew: true,
        nameservers: null,
        renewalPriceMinor: null,
        currency: null,
      },
      expect.objectContaining({ name: "mon-site.eu", expiresAt: "2026-12-24", autoRenew: false }),
    ]);
    // auth/time once, /domain once, serviceInfos per domain
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses the region's endpoint and explains invalid keys (real response)", async () => {
    const fetch = fakeFetch((url) => {
      expect(url.host).toBe("api.ca.ovhcloud.com");
      if (url.pathname.endsWith("/auth/time")) return Response.json(Math.floor(Date.now() / 1000));
      return Response.json(
        { class: "Client::Forbidden", message: "This application key is invalid" },
        { status: 403 },
      );
    });
    await expect(ovh.verify({ ...creds, region: "ca" }, fetch)).rejects.toThrow(
      /OVHcloud rejected the keys \(This application key is invalid\)/,
    );
  });
});
