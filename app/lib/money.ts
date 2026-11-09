// Money is stored as integer minor units + ISO-4217 currency (see CLAUDE.md).

export function isCurrency(code: string): boolean {
  return Intl.supportedValuesOf("currency").includes(code);
}

/** Number of decimal places for a currency (USD → 2, JPY → 0). */
export function currencyExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** "10.99" + USD → 1099. Returns null when the amount is not a valid non-negative number. */
export function toMinorUnits(amount: string, currency: string): number | null {
  const exponent = currencyExponent(currency);
  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  const trimmed = amount.trim().replace(",", ".");
  if (!pattern.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
}

/** 1099 + USD → "10.99" (for form inputs). */
export function fromMinorUnits(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return exponent === 0 ? String(minor) : (minor / 10 ** exponent).toFixed(exponent);
}

/** 1099 + USD → "$10.99" */
export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    minor / 10 ** currencyExponent(currency),
  );
}
