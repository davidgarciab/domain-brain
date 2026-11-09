import { Link, redirect } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { parseDomainForm } from "~/.server/domains/form";
import { createDomain, type Domain, DomainExistsError } from "~/.server/domains/service";
import { rdapClient } from "~/.server/rdap/client";
import { refreshDomain } from "~/.server/rdap/refresh";
import { DomainForm, type DomainFormValues } from "~/components/domain-form";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/domains.new";

export const meta: Route.MetaFunction = () => [{ title: "Add domain · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  await requireUser(context, request);
  return null;
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const form = await request.formData();
  const values = Object.fromEntries(form) as DomainFormValues;

  const parsed = parseDomainForm(form);
  if (!parsed.ok) return { errors: parsed.errors, values };

  let domain: Domain;
  try {
    domain = await createDomain(db, user.id, parsed.data);
  } catch (error) {
    if (error instanceof DomainExistsError) return { errors: { name: error.message }, values };
    throw error;
  }
  // Look up registry data right away so the user sees the expiry date immediately.
  await refreshDomain(db, user.id, domain.id, rdapClient());
  return redirect(`/domains/${domain.id}`);
}

export default function NewDomain({ actionData }: Route.ComponentProps) {
  return (
    <section className="max-w-2xl">
      <Link to="/domains" className="text-sm text-gray-500 hover:underline">
        ← Domains
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">Add a domain</h1>
      <DomainForm mode="create" values={actionData?.values ?? {}} errors={actionData?.errors} />
    </section>
  );
}
