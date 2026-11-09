import { domainToASCII, domainToUnicode } from "node:url";

export class InvalidDomainError extends Error {}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalizes user input to the stored form: lowercase ASCII (punycode), no trailing dot.
 * Accepts pasted URLs ("https://Example.com/path" → "example.com").
 * Throws InvalidDomainError with a user-facing message.
 */
export function normalizeDomainName(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  value = value.replace(/[/?#].*$/, ""); // path, query, fragment
  value = value.replace(/:\d+$/, ""); // port
  value = value.replace(/\.$/, ""); // trailing dot

  if (!value) throw new InvalidDomainError("Enter a domain name.");
  const ascii = domainToASCII(value);
  if (!ascii) throw new InvalidDomainError(`"${input.trim()}" is not a valid domain name.`);

  const labels = ascii.split(".");
  if (labels.length < 2) throw new InvalidDomainError("Include the extension, e.g. example.com.");
  if (ascii.length > 253 || !labels.every((l) => LABEL.test(l))) {
    throw new InvalidDomainError(`"${input.trim()}" is not a valid domain name.`);
  }
  if (/^\d+$/.test(labels.at(-1) ?? "")) {
    throw new InvalidDomainError("IP addresses are not domain names.");
  }
  return ascii;
}

/** Stored (punycode) name → human-readable Unicode. */
export function displayDomainName(ascii: string): string {
  return domainToUnicode(ascii) || ascii;
}

export function tldOf(ascii: string): string {
  return ascii.slice(ascii.lastIndexOf(".") + 1);
}
