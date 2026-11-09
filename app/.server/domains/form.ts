import { z } from "zod";
import { isDateString } from "~/lib/dates";
import { isCurrency, toMinorUnits } from "~/lib/money";
import { InvalidDomainError, normalizeDomainName } from "./names";
import type { DomainInput } from "./service";

export type FieldErrors = Partial<Record<keyof DomainInput | "price" | "form", string>>;

export type DomainFormResult = { ok: true; data: DomainInput } | { ok: false; errors: FieldErrors };

const text = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => v?.trim() || null)
    .pipe(z.string().max(max, `Keep it under ${max} characters.`).nullable());

const date = z
  .string()
  .optional()
  .transform((v) => v?.trim() || null)
  .refine((v) => v === null || isDateString(v), "Use a valid date.");

const schema = z.object({
  name: z.string().optional().default(""),
  registrarName: text(100),
  registeredAt: date,
  expiresAt: date,
  autoRenew: z
    .enum(["", "yes", "no"])
    .optional()
    .transform((v) => (v === "yes" ? true : v === "no" ? false : null)),
  price: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null),
  currency: z
    .string()
    .optional()
    .transform((v) => v?.trim().toUpperCase() || null),
  notes: text(5000),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",") : [])),
});

/**
 * Parses the add/edit domain form. With `requireName: false` (edit), the name is ignored.
 */
export function parseDomainForm(form: FormData, { requireName = true } = {}): DomainFormResult {
  const raw = Object.fromEntries(
    [...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  const parsed = schema.safeParse(raw);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;

  let name = "";
  if (requireName) {
    try {
      name = normalizeDomainName(v.name);
    } catch (error) {
      if (!(error instanceof InvalidDomainError)) throw error;
      errors.name = error.message;
    }
  }

  let renewalPriceMinor: number | null = null;
  let currency: string | null = null;
  if (v.price !== null) {
    currency = v.currency ?? "USD";
    if (!isCurrency(currency)) {
      errors.currency = "Use a 3-letter currency code, e.g. USD or EUR.";
    } else {
      renewalPriceMinor = toMinorUnits(v.price, currency);
      if (renewalPriceMinor === null) errors.price = "Enter a price like 12.99.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      name,
      registrarName: v.registrarName,
      registeredAt: v.registeredAt,
      expiresAt: v.expiresAt,
      autoRenew: v.autoRenew,
      renewalPriceMinor,
      currency,
      notes: v.notes,
      tags: v.tags,
    },
  };
}
