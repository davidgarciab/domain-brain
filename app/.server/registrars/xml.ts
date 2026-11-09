// A deliberately small XML reader for the flat, attribute-based responses of registrar APIs
// (Namecheap, NameSilo). It is not a general XML parser: no CDATA, comments or nesting of
// the same tag. Good enough here, and it avoids a dependency (see CLAUDE.md).

export type XmlElement = { attrs: Record<string, string>; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const [, name, dq, sq] = m;
    if (name) attrs[name] = decodeXml(dq ?? sq ?? "");
  }
  return attrs;
}

/** All `<tag …/>` and `<tag …>text</tag>` elements (case-sensitive tag name). */
export function xmlElements(xml: string, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*?)?\\s*(/>|>([\\s\\S]*?)</${tag}\\s*>)`, "g");
  for (const m of xml.matchAll(re)) {
    out.push({ attrs: parseAttrs(m[1] ?? ""), text: decodeXml((m[3] ?? "").trim()) });
  }
  return out;
}

/** Text of the first `<tag>`, or null. */
export function xmlText(xml: string, tag: string): string | null {
  return xmlElements(xml, tag)[0]?.text ?? null;
}
