import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";
import { requireUser } from "~/.server/auth/session";
import { logger } from "~/.server/logger";
import { mailer } from "~/.server/notifications/mailer";
import {
  getNotificationSettings,
  parseSettingsForm,
  saveNotificationSettings,
} from "~/.server/notifications/settings";
import { Button, FormField, inputClass } from "~/components/ui";
import { runtimeContext } from "~/context";
import type { Route } from "./+types/settings";

export const meta: Route.MetaFunction = () => [{ title: "Settings · Domain Brain" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const zones = Intl.supportedValuesOf("timeZone");
  return {
    email: user.email,
    settings: await getNotificationSettings(db, user.id),
    emailConfigured: mailer() !== null,
    timeZones: zones.includes("UTC") ? zones : ["UTC", ...zones],
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const user = await requireUser(context, request);
  const { db } = context.get(runtimeContext);
  const form = await request.formData();

  if (form.get("intent") === "test") {
    const m = mailer();
    if (!m) return { testError: "Email is not configured on this server." };
    try {
      await m.send({
        to: user.email,
        subject: "Domain Brain test email",
        text: "Email delivery works. You'll get expiry reminders at this address.\n",
        html: "<p>Email delivery works. You'll get expiry reminders at this address.</p>",
      });
      return { testSent: true };
    } catch (error) {
      logger().warn({ err: error }, "test email failed");
      return { testError: `Sending failed: ${error instanceof Error ? error.message : error}` };
    }
  }

  const parsed = parseSettingsForm(form);
  if (!parsed.ok) return { errors: parsed.errors };
  await saveNotificationSettings(db, user.id, parsed.data);
  return { saved: true };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, emailConfigured, email, timeZones } = loaderData;
  const navigation = useNavigation();
  const busy = (intent: string) =>
    navigation.state !== "idle" && navigation.formData?.get("intent") === intent;
  const errors = (actionData && "errors" in actionData ? actionData.errors : undefined) ?? {};

  const [timezone, setTimezone] = useState(settings.timezone);
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && timeZones.includes(zone)) setBrowserZone(zone);
  }, [timeZones]);

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <h2 className="mt-8 font-medium">Expiry reminders</h2>
      {!emailConfigured && (
        <p
          role="note"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Email isn't configured on this server, so no reminders will be sent. The administrator can
          set <code>SMTP_URL</code> to turn it on.
        </p>
      )}

      <Form method="post" className="mt-4 space-y-5">
        <input type="hidden" name="intent" value="save" />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="emailEnabled"
            defaultChecked={settings.emailEnabled}
            className="mt-0.5"
          />
          <span>
            Email me at <strong>{email}</strong> before my domains expire
          </span>
        </label>

        <FormField
          label="Remind me this many days before"
          htmlFor="daysBefore"
          error={errors.daysBefore}
          hint="Comma-separated, up to 5. You also get one alert if a domain expires."
        >
          <input
            id="daysBefore"
            name="daysBefore"
            className={inputClass}
            defaultValue={settings.daysBefore.join(", ")}
            inputMode="numeric"
          />
        </FormField>

        <FormField
          label="Timezone"
          htmlFor="timezone"
          error={errors.timezone}
          hint="Reminders go out after 08:00 in this timezone."
        >
          <select
            id="timezone"
            name="timezone"
            className={inputClass}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timeZones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {browserZone && browserZone !== timezone && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={() => setTimezone(browserZone)}
            >
              Use my timezone ({browserZone})
            </button>
          )}
        </FormField>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy("save")}>
            {busy("save") ? "Saving…" : "Save"}
          </Button>
          {actionData && "saved" in actionData && (
            <span role="status" className="text-sm text-green-700 dark:text-green-400">
              Saved.
            </span>
          )}
        </div>
      </Form>

      {emailConfigured && (
        <Form method="post" className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-800">
          <input type="hidden" name="intent" value="test" />
          <p className="text-sm text-gray-500">Check that emails reach you.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" disabled={busy("test")}>
              {busy("test") ? "Sending…" : "Send test email"}
            </Button>
            {actionData && "testSent" in actionData && (
              <span role="status" className="text-sm text-green-700 dark:text-green-400">
                Sent to {email}.
              </span>
            )}
            {actionData && "testError" in actionData && (
              <span role="alert" className="text-sm text-red-600 dark:text-red-400">
                {actionData.testError}
              </span>
            )}
          </div>
        </Form>
      )}
    </section>
  );
}
