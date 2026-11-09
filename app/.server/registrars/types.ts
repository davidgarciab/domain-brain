import type { z } from "zod";

export const PROVIDER_IDS = [
  "cloudflare",
  "gandi",
  "godaddy",
  "namecheap",
  "namecom",
  "namesilo",
  "ovh",
  "porkbun",
  "spaceship",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** A domain as reported by a registrar, already normalized (see domains/names.ts). */
export type RegistrarDomain = {
  /** lowercase punycode */
  name: string;
  /** YYYY-MM-DD */
  expiresAt: string | null;
  /** YYYY-MM-DD */
  registeredAt: string | null;
  autoRenew: boolean | null;
  /** null = the API doesn't report nameservers */
  nameservers: string[] | null;
  renewalPriceMinor: number | null;
  currency: string | null;
};

export type CredentialField = {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  hint?: string;
  /** Renders a select instead of a text input. */
  options?: { value: string; label: string }[];
};

export type Fetch = typeof globalThis.fetch;

export interface RegistrarProvider<C = Record<string, string>> {
  id: ProviderId;
  displayName: string;
  /** Short setup instructions shown on the connect form. */
  setupHelp: string;
  fields: CredentialField[];
  credentialsSchema: z.ZodType<C>;
  /** Throws RegistrarError with a user-facing message if the credentials don't work. */
  verify: (credentials: C, fetch: Fetch) => Promise<void>;
  listDomains: (credentials: C, fetch: Fetch) => Promise<RegistrarDomain[]>;
  /** Optional pre-filled values for the connect form (e.g. the server's public IP). */
  formDefaults?: (fetch: Fetch) => Promise<Record<string, string>>;
}

/** A failure the user should see (stored in registrar_connection.last_sync_error). */
export class RegistrarError extends Error {}
