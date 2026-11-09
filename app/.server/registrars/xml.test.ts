import { describe, expect, it } from "vitest";
import { decodeXml, xmlElements, xmlText } from "./xml";

describe("xml helpers", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="1" Name="a.com" Created="06/02/2021" AutoRenew="true" />
      <Domain ID='2' Name="b&amp;c.net" Created="06/02/2021"/>
    </DomainGetListResult>
    <Paging><TotalItems>2</TotalItems><PageSize>100</PageSize></Paging>
  </CommandResponse>
  <domains><domain created="1998-02-03" expires="2023-02-03">namesilo.com</domain></domains>
</ApiResponse>`;

  it("reads self-closing and text elements with attributes", () => {
    expect(xmlElements(xml, "Domain").map((d) => d.attrs)).toEqual([
      { ID: "1", Name: "a.com", Created: "06/02/2021", AutoRenew: "true" },
      { ID: "2", Name: "b&c.net", Created: "06/02/2021" },
    ]);
    expect(xmlElements(xml, "domain")).toEqual([
      { attrs: { created: "1998-02-03", expires: "2023-02-03" }, text: "namesilo.com" },
    ]);
    expect(xmlText(xml, "TotalItems")).toBe("2");
    expect(xmlElements(xml, "ApiResponse")[0]?.attrs.Status).toBe("OK");
    expect(xmlElements(xml, "Errors")).toEqual([{ attrs: {}, text: "" }]);
    expect(xmlText(xml, "Missing")).toBeNull();
  });

  it("does not confuse tags that share a prefix", () => {
    expect(xmlElements("<DomainX a='1'/><Domain b='2'/>", "Domain").map((d) => d.attrs)).toEqual([
      { b: "2" },
    ]);
  });

  it("decodes entities", () => {
    expect(decodeXml("&lt;a&gt; &quot;b&quot; &#39;c&#x27; &amp;")).toBe(`<a> "b" 'c' &`);
  });
});
