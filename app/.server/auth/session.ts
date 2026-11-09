import { type RouterContextProvider, redirect } from "react-router";
import { runtimeContext } from "~/context";

export type SessionUser = { id: string; name: string; email: string };

export async function getUser(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<SessionUser | null> {
  const { auth } = context.get(runtimeContext);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const { id, name, email } = session.user;
  return { id, name, email };
}

/** Returns the signed-in user or redirects to /login (keeping the current path). */
export async function requireUser(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<SessionUser> {
  const user = await getUser(context, request);
  if (!user) {
    const url = new URL(request.url);
    const params = new URLSearchParams({ redirectTo: url.pathname + url.search });
    throw redirect(`/login?${params}`);
  }
  return user;
}

/** Only allow same-site relative redirects. */
export function safeRedirect(to: FormDataEntryValue | string | null, fallback = "/"): string {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//")) return fallback;
  return to;
}

/**
 * Turns a Better Auth `asResponse: true` result into either a redirect that carries its
 * session cookies, or a user-facing error message.
 */
export async function authResult(
  response: Response,
  redirectTo: string,
): Promise<{ redirect: Response } | { error: string }> {
  if (response.ok) {
    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    return { redirect: redirect(redirectTo, { headers }) };
  }
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return { error: body?.message ?? "Something went wrong. Please try again." };
}
