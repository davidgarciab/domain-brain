import type { ComponentProps } from "react";
import { Form, useNavigation } from "react-router";
import { formatDate } from "~/lib/dates";
import { Button, FormField, inputClass } from "./ui";

export type DomainFormValues = {
  name?: string;
  registrarName?: string;
  registeredAt?: string;
  expiresAt?: string;
  autoRenew?: "" | "yes" | "no";
  price?: string;
  currency?: string;
  notes?: string;
  tags?: string;
};

export type DomainFormErrors = Partial<Record<keyof DomainFormValues | "form", string>>;

type Field = keyof DomainFormValues;

/**
 * Add/edit form. `registrarManaged` shows the fields a registrar sync owns as read-only text.
 * `registryUpdates` notes that registry lookups may replace the dates.
 * Remount with a `key` when `values` should reset.
 */
export function DomainForm({
  mode,
  values,
  errors = {},
  registrarManaged = null,
  registryUpdates = false,
}: {
  mode: "create" | "edit";
  values: DomainFormValues;
  errors?: DomainFormErrors;
  /** Registrar display name when the domain is registrar-synced, else null. */
  registrarManaged?: string | null;
  registryUpdates?: boolean;
}) {
  const navigation = useNavigation();
  const pending =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "save";

  const input = (name: Field, props: ComponentProps<"input"> = {}) => (
    <input
      id={name}
      name={name}
      className={inputClass}
      defaultValue={values[name]}
      aria-invalid={errors[name] ? true : undefined}
      aria-describedby={errors[name] ? `${name}-error` : undefined}
      {...props}
    />
  );
  const registryHint = registryUpdates ? "Updated from the registry when it changes." : undefined;

  return (
    <Form method="post" className="space-y-5" noValidate>
      <input type="hidden" name="intent" value="save" />
      {errors.form && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {errors.form}
        </p>
      )}

      {mode === "create" && (
        <FormField
          label="Domain"
          htmlFor="name"
          error={errors.name}
          hint="We'll look up the expiry date and registrar automatically when we can."
        >
          {input("name", {
            placeholder: "example.com",
            autoComplete: "off",
            autoCapitalize: "none",
            spellCheck: false,
            required: true,
          })}
        </FormField>
      )}

      {registrarManaged ? (
        <div className="rounded-md bg-gray-50 p-4 text-sm dark:bg-gray-900">
          <p className="text-gray-500">Managed by your {registrarManaged} connection</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <ReadOnly label="Registrar" value={values.registrarName} />
            <ReadOnly
              label="Auto-renew"
              value={values.autoRenew === "yes" ? "On" : values.autoRenew === "no" ? "Off" : ""}
            />
            <ReadOnly
              label="Expires"
              value={values.expiresAt ? formatDate(values.expiresAt) : ""}
            />
            <ReadOnly
              label="Registered"
              value={values.registeredAt ? formatDate(values.registeredAt) : ""}
            />
          </dl>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Registrar" htmlFor="registrarName" error={errors.registrarName}>
            {input("registrarName", { placeholder: "e.g. Porkbun" })}
          </FormField>
          <FormField label="Auto-renew" htmlFor="autoRenew">
            <select
              id="autoRenew"
              name="autoRenew"
              className={inputClass}
              defaultValue={values.autoRenew ?? ""}
            >
              <option value="">Unknown</option>
              <option value="yes">On</option>
              <option value="no">Off</option>
            </select>
          </FormField>
          <FormField
            label="Expires"
            htmlFor="expiresAt"
            error={errors.expiresAt}
            hint={registryHint}
          >
            {input("expiresAt", { type: "date" })}
          </FormField>
          <FormField
            label="Registered"
            htmlFor="registeredAt"
            error={errors.registeredAt}
            hint={registryHint}
          >
            {input("registeredAt", { type: "date" })}
          </FormField>
        </div>
      )}

      <div className="grid grid-cols-[1fr_7rem] gap-5">
        <FormField label="Renewal price" htmlFor="price" error={errors.price}>
          {input("price", { inputMode: "decimal", placeholder: "e.g. 12.99" })}
        </FormField>
        <FormField label="Currency" htmlFor="currency" error={errors.currency}>
          {input("currency", {
            defaultValue: values.currency || "USD",
            maxLength: 3,
            autoCapitalize: "characters",
          })}
        </FormField>
      </div>

      <FormField
        label="Tags"
        htmlFor="tags"
        error={errors.tags}
        hint="Comma-separated, e.g. personal, client-x"
      >
        {input("tags")}
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={errors.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          className={inputClass}
          defaultValue={values.notes}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? "notes-error" : undefined}
        />
      </FormField>

      <Button type="submit" disabled={pending}>
        {pending
          ? mode === "create"
            ? "Adding… (looking up registry data)"
            : "Saving…"
          : mode === "create"
            ? "Add domain"
            : "Save changes"}
      </Button>
    </Form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}
