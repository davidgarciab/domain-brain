import { Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { authResult, getUser } from "~/.server/auth/session";
import { env } from "~/.server/env";
import { AuthCard, Field, FormError, SubmitButton } from "~/components/auth-card";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/signup";

export const meta: Route.MetaFunction = () => [{ title: "Create account · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  if (await getUser(context, request)) throw redirect("/domains");
  return { registrationEnabled: env().REGISTRATION_ENABLED };
}

const input = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function action({ context, request }: Route.ActionArgs) {
  if (!env().REGISTRATION_ENABLED) return { error: "Registration is disabled on this server." };

  const parsed = input.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { auth } = context.get(runtimeContext);
  const response = await auth.api.signUpEmail({
    body: parsed.data,
    headers: request.headers,
    asResponse: true,
  });
  const result = await authResult(response, "/domains");
  if ("redirect" in result) return result.redirect;
  return { error: result.error };
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state === "submitting";
  if (!loaderData.registrationEnabled) {
    return (
      <AuthCard title="Registration disabled">
        <p className="text-sm text-gray-500">
          New accounts can't be created on this server.{" "}
          <Link to="/login" className="font-medium underline">
            Sign in
          </Link>
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create your account">
      <Form method="post">
        <FormError message={actionData?.error} />
        <Field label="Name" name="name" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </Form>
      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link to="/login" className="font-medium underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
