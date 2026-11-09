import { Form, Link, Outlet } from "react-router";
import { requireUser } from "~/.server/auth/session";
import type { Route } from "./+types/app-layout";

export async function loader({ context, request }: Route.LoaderArgs) {
  return { user: await requireUser(context, request) };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/domains" className="font-semibold">
            Domain Brain
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">{loaderData.user.email}</span>
            <Form method="post" action="/logout">
              <button type="submit" className="underline">
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
