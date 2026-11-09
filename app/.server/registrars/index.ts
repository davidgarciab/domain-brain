import { cloudflare } from "./cloudflare";
import { gandi } from "./gandi";
import { godaddy } from "./godaddy";
import { namecheap } from "./namecheap";
import { namecom } from "./namecom";
import { namesilo } from "./namesilo";
import { ovh } from "./ovh";
import { porkbun } from "./porkbun";
import { spaceship } from "./spaceship";
import type { ProviderId, RegistrarProvider } from "./types";

// Each provider has its own credentials type; callers only pass credentials that the
// provider's own schema produced, so widening to the default is safe.
// Shown in this order on the Registrars page (alphabetical).
export const providers: Record<ProviderId, RegistrarProvider> = {
  cloudflare: cloudflare as unknown as RegistrarProvider,
  gandi: gandi as unknown as RegistrarProvider,
  godaddy: godaddy as unknown as RegistrarProvider,
  namecheap: namecheap as unknown as RegistrarProvider,
  namecom: namecom as unknown as RegistrarProvider,
  namesilo: namesilo as unknown as RegistrarProvider,
  ovh: ovh as unknown as RegistrarProvider,
  porkbun: porkbun as unknown as RegistrarProvider,
  spaceship: spaceship as unknown as RegistrarProvider,
};

export function getProvider(id: string): RegistrarProvider | null {
  return Object.hasOwn(providers, id) ? providers[id as ProviderId] : null;
}
