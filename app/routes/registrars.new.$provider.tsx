import { data, Form, Link, redirect, useNavigation } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { env } from "~/.server/env";
import { getProvider } from "~/.server/registrars";
import { connectRegistrar } from "~/.server/registrars/service";
import { Button, FormField, inputClass } from "~/components/ui";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/registrars.new.$provider";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `Connect ${loaderData?.provider.name ?? "registrar"} · Domain Brain` },
];

function load(id: string) {
  const provider = getProvider(id);
  if (!provider) throw data("Unknown registrar", { status: 404 });
  return provider;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  await requireUser(context, request);
  const p = load(params.provider);
  return { provider: { id: p.id, name: p.displayName, help: p.setupHelp, fields: p.fields } };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const provider = load(params.provider);
  const { db } = context.get(runtimeContext);
  const form = await request.formData();

  const credentials: Record<string, string> = {};
  for (const f of provider.fields) credentials[f.name] = String(form.get(f.name) ?? "");
  const label = String(form.get("label") ?? "");

  const result = await connectRegistrar(
    db,
    user.id,
    { provider: provider.id, label, credentials },
    { secret: env().APP_SECRET },
  );
  if (!result.ok) {
    // Never echo secrets back into the form.
    const values: Record<string, string> = { label };
    for (const f of provider.fields) if (!f.secret) values[f.name] = credentials[f.name] ?? "";
    return { errors: result.errors, values };
  }
  return redirect("/registrars");
}

export default function ConnectRegistrar({ loaderData, actionData }: Route.ComponentProps) {
  const { provider } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values: Record<string, string> = actionData?.values ?? {};
  const pending = useNavigation().state === "submitting";

  return (
    <section className="max-w-xl">
      <Link to="/registrars" className="text-sm text-gray-500 hover:underline">
        ← Registrars
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Connect {provider.name}</h1>
      <p className="mt-2 text-sm text-gray-500">{provider.help}</p>

      <Form method="post" className="mt-6 space-y-5" autoComplete="off" noValidate>
        {errors.form && (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {errors.form}
          </p>
        )}
        <FormField label="Name" htmlFor="label" hint="Optional, e.g. Personal or Client X">
          <input
            id="label"
            name="label"
            className={inputClass}
            defaultValue={values.label}
            placeholder={provider.name}
          />
        </FormField>
        {provider.fields.map((f) => (
          <FormField
            key={f.name}
            label={f.label}
            htmlFor={f.name}
            error={errors[f.name]}
            hint={f.hint}
          >
            <input
              id={f.name}
              name={f.name}
              type={f.secret ? "password" : "text"}
              className={`${inputClass} font-mono`}
              defaultValue={f.secret ? undefined : values[f.name]}
              required={f.required}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete={f.secret ? "new-password" : "off"}
              aria-invalid={errors[f.name] ? true : undefined}
              aria-describedby={errors[f.name] ? `${f.name}-error` : undefined}
            />
          </FormField>
        ))}
        <p className="text-xs text-gray-500">
          Credentials are encrypted before they're stored and are only used to read your domain
          list.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Connecting and importing…" : "Connect and import domains"}
        </Button>
      </Form>
    </section>
  );
}
