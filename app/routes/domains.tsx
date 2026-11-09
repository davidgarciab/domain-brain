import { Form, Link, useSearchParams } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { countDomains, listDomains, listTags } from "~/.server/domains/service";
import { ExpiryBadge, ExpiryDate } from "~/components/expiry";
import { Badge, inputClass, LinkButton } from "~/components/ui";
import { runtimeContext } from "~/context";
import { todayUtc } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import type { Route } from "./+types/domains";

export const meta: Route.MetaFunction = () => [{ title: "Domains · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";
  const [domains, tags, total] = await Promise.all([
    listDomains(db, user.id, { q, tag }),
    listTags(db, user.id),
    countDomains(db, user.id),
  ]);
  return { domains, tags, total, today: todayUtc() };
}

export default function Domains({ loaderData }: Route.ComponentProps) {
  const { domains, tags, total, today } = loaderData;
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const activeTag = params.get("tag") ?? "";
  const filtered = Boolean(q || activeTag);

  const tagHref = (tag: string) => {
    const next = new URLSearchParams(params);
    if (tag && tag !== activeTag) next.set("tag", tag);
    else next.delete("tag");
    const qs = next.toString();
    return qs ? `?${qs}` : ".";
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your domains</h1>
        <LinkButton to="/domains/new">Add domain</LinkButton>
      </div>

      {total === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
          <p className="font-medium">No domains yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add a domain and we'll fill in its expiry date from the registry, or import all of them
            from your registrar.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <LinkButton to="/domains/new">Add domain</LinkButton>
            <LinkButton to="/registrars" variant="secondary">
              Connect a registrar
            </LinkButton>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Form method="get" className="w-full sm:w-72" role="search">
              {activeTag && <input type="hidden" name="tag" value={activeTag} />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search domains or registrars"
                aria-label="Search domains"
                className={inputClass}
              />
            </Form>
            {tags.length > 0 && (
              <nav aria-label="Filter by tag" className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <Link
                    key={t.name}
                    to={tagHref(t.name)}
                    aria-current={t.name === activeTag ? "true" : undefined}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      t.name === activeTag
                        ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                        : "border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900"
                    }`}
                  >
                    {t.name} <span className="opacity-60">{t.count}</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>

          {filtered && (
            <p className="mt-4 text-sm text-gray-500">
              {domains.length} of {total} domains.{" "}
              <Link to="/domains" className="underline">
                Clear filters
              </Link>
            </p>
          )}

          {domains.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-2 font-medium">Domain</th>
                    <th className="px-4 py-2 font-medium">Expires</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Registrar</th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">Auto-renew</th>
                    <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                  {domains.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="px-4 py-3">
                        <Link to={`/domains/${d.id}`} className="font-medium hover:underline">
                          {d.displayName}
                        </Link>
                        {d.registrarMissingSince && (
                          <span className="ml-2">
                            <Badge tone="warning">Not at registrar</Badge>
                          </span>
                        )}
                        {d.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {d.tags.map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <ExpiryDate expiresAt={d.expiresAt} />
                          <ExpiryBadge expiresAt={d.expiresAt} today={today} />
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">{d.registrarName ?? "—"}</td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {d.autoRenew === null ? "—" : d.autoRenew ? "On" : "Off"}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                        {d.renewalPriceMinor !== null && d.currency
                          ? formatMoney(d.renewalPriceMinor, d.currency)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-8 text-center text-sm text-gray-500">No domains match.</p>
          )}
        </>
      )}
    </section>
  );
}
