import { data, Form, Link, useNavigation } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { env } from "~/.server/env";
import { providers } from "~/.server/registrars";
import { deleteConnection, listConnections, syncConnection } from "~/.server/registrars/service";
import { Badge, Button, LinkButton } from "~/components/ui";
import { runtimeContext } from "~/context";
import { formatTimestamp } from "~/lib/dates";
import type { Route } from "./+types/registrars";

export const meta: Route.MetaFunction = () => [{ title: "Registrars · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  return {
    connections: await listConnections(db, user.id),
    providers: Object.values(providers).map((p) => ({ id: p.id, name: p.displayName })),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const form = await request.formData();
  const id = String(form.get("connectionId") ?? "");

  switch (form.get("intent")) {
    case "sync": {
      const result = await syncConnection(db, user.id, id, { secret: env().APP_SECRET });
      if (!result) throw data("Connection not found", { status: 404 });
      return { syncedId: id, result };
    }
    case "remove":
      if (!(await deleteConnection(db, user.id, id))) {
        throw data("Connection not found", { status: 404 });
      }
      return { removed: true };
    default:
      throw data("Unknown action", { status: 400 });
  }
}

export default function Registrars({ loaderData, actionData }: Route.ComponentProps) {
  const { connections, providers } = loaderData;
  const navigation = useNavigation();
  const busy = (intent: string, id: string) =>
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === intent &&
    navigation.formData?.get("connectionId") === id;

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Registrars</h1>
      <p className="mt-1 text-sm text-gray-500">
        Connect a registrar account to import your domains and keep their expiry dates and
        auto-renew settings in sync. Domain Brain only reads from your registrar.
      </p>

      {connections.length > 0 && (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {connections.map((c) => {
            const justSynced =
              actionData && "syncedId" in actionData && actionData.syncedId === c.id
                ? actionData.result
                : null;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-start justify-between gap-4 p-4 sm:flex-nowrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.label}</span>
                    {c.label !== c.providerName && <Badge>{c.providerName}</Badge>}
                    {c.lastSyncError ? (
                      <Badge tone="danger">Sync failed</Badge>
                    ) : c.lastSyncAt ? (
                      <Badge tone="ok">Connected</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    <Link to="/domains" className="underline">
                      {c.domainCount} {c.domainCount === 1 ? "domain" : "domains"}
                    </Link>
                    {" · "}
                    {c.lastSyncAt
                      ? `${c.lastSyncError ? "Last attempt" : "Last synced"} ${formatTimestamp(c.lastSyncAt)}`
                      : "Never synced"}
                  </p>
                  {c.lastSyncError && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">{c.lastSyncError}</p>
                  )}
                  {justSynced && !("error" in justSynced) && (
                    <p role="status" className="mt-1 text-sm text-green-700 dark:text-green-400">
                      Synced: {justSynced.added} new, {justSynced.updated} updated
                      {justSynced.missing ? `, ${justSynced.missing} no longer listed` : ""}.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="sync" />
                    <input type="hidden" name="connectionId" value={c.id} />
                    <Button type="submit" variant="secondary" disabled={busy("sync", c.id)}>
                      {busy("sync", c.id) ? "Syncing…" : "Sync now"}
                    </Button>
                  </Form>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (
                        !confirm(
                          `Remove ${c.label}? Its domains stay in Domain Brain and become editable.`,
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="connectionId" value={c.id} />
                    <Button type="submit" variant="danger" disabled={busy("remove", c.id)}>
                      Remove
                    </Button>
                  </Form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mt-10 font-medium">
        {connections.length ? "Connect another registrar" : "Connect a registrar"}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {providers.map((p) => (
          <LinkButton key={p.id} to={`/registrars/new/${p.id}`} variant="secondary">
            {p.name}
          </LinkButton>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Domains are synced every 6 hours. Using another registrar? Add its domains by hand on the
        domains page.
      </p>
    </section>
  );
}
