import { data, Form, Link, redirect, useNavigation } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { parseDomainForm } from "~/.server/domains/form";
import { tldOf } from "~/.server/domains/names";
import { type Domain, deleteDomain, getDomain, updateDomain } from "~/.server/domains/service";
import { rdapClient } from "~/.server/rdap/client";
import { refreshDomain } from "~/.server/rdap/refresh";
import { DomainForm, type DomainFormValues } from "~/components/domain-form";
import { ExpiryBadge } from "~/components/expiry";
import { Badge, Button } from "~/components/ui";
import { runtimeContext } from "~/context";
import { formatDate, formatTimestamp, todayUtc } from "~/lib/dates";
import { fromMinorUnits } from "~/lib/money";
import type { Route } from "./+types/domains.$id";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.domain.displayName ?? "Domain"} · Domain Brain` },
];

async function load(context: Route.LoaderArgs["context"], request: Request, id: string) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const domain = await getDomain(db, user.id, id);
  if (!domain) throw data("Domain not found", { status: 404 });
  return { user, db, domain };
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { domain } = await load(context, request, params.id);
  // null = unknown (RDAP directory unreachable); treat it as supported in the UI.
  const rdapSupported = (await rdapClient().supportsTld?.(tldOf(domain.name))) ?? null;
  return { domain, rdapSupported: rdapSupported !== false, today: todayUtc() };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { user, db, domain } = await load(context, request, params.id);
  const form = await request.formData();

  switch (form.get("intent")) {
    case "save": {
      const parsed = parseDomainForm(form, { requireName: false });
      if (!parsed.ok) {
        return { errors: parsed.errors, values: Object.fromEntries(form) as DomainFormValues };
      }
      await updateDomain(db, user.id, domain.id, parsed.data);
      return { saved: true };
    }
    case "refresh":
      await refreshDomain(db, user.id, domain.id, rdapClient());
      return { refreshed: true };
    case "delete":
      await deleteDomain(db, user.id, domain.id);
      return redirect("/domains");
    default:
      throw data("Unknown action", { status: 400 });
  }
}

function toFormValues(d: Domain): DomainFormValues {
  return {
    registrarName: d.registrarName ?? "",
    registeredAt: d.registeredAt ?? "",
    expiresAt: d.expiresAt ?? "",
    autoRenew: d.autoRenew === null ? "" : d.autoRenew ? "yes" : "no",
    price:
      d.renewalPriceMinor !== null && d.currency
        ? fromMinorUnits(d.renewalPriceMinor, d.currency)
        : "",
    currency: d.currency ?? "",
    notes: d.notes ?? "",
    tags: d.tags.join(", "),
  };
}

export default function DomainDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { domain, today, rdapSupported } = loaderData;
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  const errors = actionData && "errors" in actionData ? actionData.errors : undefined;
  const values =
    (actionData && "values" in actionData ? actionData.values : undefined) ?? toFormValues(domain);
  const synced = domain.source === "registrar";
  const tld = domain.name.slice(domain.name.lastIndexOf(".") + 1);

  const summary = [
    domain.expiresAt ? `Expires ${formatDate(domain.expiresAt)}` : "Expiry unknown",
    domain.registrarName,
    domain.autoRenew === null ? null : `Auto-renew ${domain.autoRenew ? "on" : "off"}`,
  ].filter(Boolean);

  return (
    <section>
      <Link to="/domains" className="text-sm text-gray-500 hover:underline">
        ← Domains
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold break-all">{domain.displayName}</h1>
        <ExpiryBadge expiresAt={domain.expiresAt} today={today} />
        {synced && <Badge tone="ok">Synced</Badge>}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {summary.join(" · ")}
        {domain.displayName !== domain.name && (
          <span className="ml-2 font-mono text-xs">({domain.name})</span>
        )}
      </p>

      {domain.registrarMissingSince && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Your registrar stopped listing this domain on{" "}
          {formatDate(domain.registrarMissingSince.slice(0, 10))}. It may have been transferred or
          expired.
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-4 font-medium">Details</h2>
          {actionData && "saved" in actionData && (
            <p role="status" className="mb-4 text-sm text-green-700 dark:text-green-400">
              Saved.
            </p>
          )}
          <DomainForm
            key={domain.updatedAt}
            mode="edit"
            values={values}
            errors={errors}
            registrarManaged={synced ? (domain.registrarName ?? "registrar") : null}
            registryUpdates={rdapSupported}
          />
        </div>

        <aside className="space-y-6 lg:pt-10">
          <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-800">
            <h2 className="font-medium">Registry lookup</h2>
            {rdapSupported ? (
              <>
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="text-gray-500">Last checked</dt>
                    <dd>
                      {domain.rdapCheckedAt ? formatTimestamp(domain.rdapCheckedAt) : "Never"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Nameservers</dt>
                    <dd>
                      {domain.nameservers.length ? (
                        <ul className="font-mono text-xs leading-5">
                          {domain.nameservers.map((ns) => (
                            <li key={ns} className="break-all">
                              {ns}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  {domain.statuses.length > 0 && (
                    <div>
                      <dt className="text-gray-500">Status</dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {domain.statuses.map((s) => (
                          <Badge key={s}>{s}</Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
                {domain.rdapError && (
                  <p className="mt-3 text-amber-700 dark:text-amber-400">
                    Last lookup failed: {domain.rdapError}
                  </p>
                )}
                <Form method="post" className="mt-4">
                  <input type="hidden" name="intent" value="refresh" />
                  <Button type="submit" variant="secondary" disabled={busy("refresh")}>
                    {busy("refresh") ? "Checking…" : "Refresh now"}
                  </Button>
                </Form>
              </>
            ) : (
              <p className="mt-2 text-gray-500">
                The .{tld} registry doesn't offer automatic lookups
                {synced ? "." : ", so keep the dates here up to date yourself."}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-800">
            <h2 className="font-medium">Delete domain</h2>
            <p className="mt-1 text-gray-500">
              Removes it from Domain Brain only. Nothing changes at your registrar.
            </p>
            <Form
              method="post"
              className="mt-3"
              onSubmit={(event) => {
                if (!confirm(`Delete ${domain.displayName}?`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="danger" disabled={busy("delete")}>
                Delete
              </Button>
            </Form>
          </div>
        </aside>
      </div>
    </section>
  );
}
