import { redirect } from "react-router";
import { authResult } from "~/.server/auth/session";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/logout";

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = context.get(runtimeContext);
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
  const result = await authResult(response, "/login");
  return "redirect" in result ? result.redirect : redirect("/login");
}

export function loader() {
  throw redirect("/");
}
