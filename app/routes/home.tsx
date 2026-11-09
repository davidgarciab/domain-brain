import { redirect } from "react-router";
import { getUser } from "~/.server/auth/session";
import type { Route } from "./+types/home";

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = await getUser(context, request);
  throw redirect(user ? "/domains" : "/login");
}
