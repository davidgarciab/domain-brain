import { Form, Link, Outlet, useRouteLoaderData } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { ErrorPage } from "~/components/error-page";
import type { Route } from "./+types/app-layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { user: await requireUser(context, request) };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <Shell email={loaderData.user.email}>
      <Outlet />
    </Shell>
  );
}

/** Errors in signed-in pages (e.g. an unknown domain) keep the header and navigation. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = useRouteLoaderData<typeof loader>("routes/app-layout");
  return (
    <Shell email={data?.user.email}>
      <ErrorPage error={error} />
    </Shell>
  );
}

function Shell({ email, children }: { email: string | undefined; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/domains" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-5 dark:invert" />
            Domain Brain
          </Link>
          {email && (
            <div className="flex items-center gap-3 text-sm sm:gap-4">
              <span className="hidden text-gray-500 sm:inline">{email}</span>
              <Link to="/registrars" className="underline">
                Registrars
              </Link>
              <Link to="/settings" className="underline">
                Settings
              </Link>
              <Form method="post" action="/logout">
                <button type="submit" className="underline">
                  Sign out
                </button>
              </Form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
