import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { z } from "zod";
import { authResult, getUser, safeRedirect } from "~/.server/auth/session";
import { env } from "~/.server/env";
import { AuthCard, Field, FormError, SubmitButton } from "~/components/auth-card";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/login";

export const meta: Route.MetaFunction = () => [{ title: "Sign in · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  if (await getUser(context, request)) throw redirect("/domains");
  return { registrationEnabled: env().REGISTRATION_ENABLED };
}

const input = z.object({ email: z.email(), password: z.string().min(1) });

export async function action({ context, request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your email and password." };

  const { auth } = context.get(runtimeContext);
  const response = await auth.api.signInEmail({
    body: parsed.data,
    headers: request.headers,
    asResponse: true,
  });
  const result = await authResult(response, safeRedirect(form.get("redirectTo"), "/domains"));
  if ("redirect" in result) return result.redirect;
  return { error: result.error };
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const pending = useNavigation().state === "submitting";
  return (
    <AuthCard title="Sign in">
      <Form method="post">
        <input type="hidden" name="redirectTo" value={params.get("redirectTo") ?? ""} />
        <FormError message={actionData?.error} />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </Form>
      {loaderData.registrationEnabled && (
        <p className="mt-4 text-center text-sm text-gray-500">
          No account?{" "}
          <Link to="/signup" className="font-medium underline">
            Create one
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
