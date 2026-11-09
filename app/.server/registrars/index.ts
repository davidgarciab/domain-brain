import { cloudflare } from "./cloudflare";
import { godaddy } from "./godaddy";
import { porkbun } from "./porkbun";
import type { ProviderId, RegistrarProvider } from "./types";

// Each provider has its own credentials type; callers only pass credentials that the
// provider's own schema produced, so widening to the default is safe.
export const providers: Record<ProviderId, RegistrarProvider> = {
  cloudflare: cloudflare as unknown as RegistrarProvider,
  porkbun: porkbun as unknown as RegistrarProvider,
  godaddy: godaddy as unknown as RegistrarProvider,
};

export function getProvider(id: string): RegistrarProvider | null {
  return Object.hasOwn(providers, id) ? providers[id as ProviderId] : null;
}
