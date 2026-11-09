// Better Auth's HTTP endpoints (/api/auth/*). Our own forms use actions instead,
// but this is needed for flows that hit Better Auth directly (e.g. email links).
import { runtimeContext } from "~/context";
import type { Route } from "./+types/api.auth";

export function loader({ context, request }: Route.LoaderArgs) {
  return context.get(runtimeContext).auth.handler(request);
}

export function action({ context, request }: Route.ActionArgs) {
  return context.get(runtimeContext).auth.handler(request);
}
