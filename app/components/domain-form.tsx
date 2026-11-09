import { Form, useNavigation } from "react-router";
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

/**
 * Add/edit form. `registrarManaged` locks the fields a registrar sync owns.
 * Remount with a `key` when `values` should reset.
 */
export function DomainForm({
  mode,
  values,
  errors = {},
  registrarManaged = false,
}: {
  mode: "create" | "edit";
  values: DomainFormValues;
  errors?: DomainFormErrors;
  registrarManaged?: boolean;
}) {
  const navigation = useNavigation();
  const pending =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "save";
  const locked = registrarManaged ? "Managed by your registrar connection." : undefined;
  const describe = (field: string) =>
    errors[field as keyof DomainFormErrors] ? `${field}-error` : undefined;

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
          <input
            id="name"
            name="name"
            className={inputClass}
            defaultValue={values.name}
            placeholder="example.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describe("name")}
          />
        </FormField>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Registrar"
          htmlFor="registrarName"
          error={errors.registrarName}
          hint={locked}
        >
          <input
            id="registrarName"
            name="registrarName"
            className={inputClass}
            defaultValue={values.registrarName}
            placeholder="e.g. Porkbun"
            disabled={registrarManaged}
            aria-describedby={describe("registrarName")}
          />
        </FormField>
        <FormField label="Auto-renew" htmlFor="autoRenew" hint={locked}>
          <select
            id="autoRenew"
            name="autoRenew"
            className={inputClass}
            defaultValue={values.autoRenew ?? ""}
            disabled={registrarManaged}
          >
            <option value="">Unknown</option>
            <option value="yes">On</option>
            <option value="no">Off</option>
          </select>
        </FormField>
        <FormField label="Expires" htmlFor="expiresAt" error={errors.expiresAt} hint={locked}>
          <input
            id="expiresAt"
            name="expiresAt"
            type="date"
            className={inputClass}
            defaultValue={values.expiresAt}
            disabled={registrarManaged}
            aria-describedby={describe("expiresAt")}
          />
        </FormField>
        <FormField
          label="Registered"
          htmlFor="registeredAt"
          error={errors.registeredAt}
          hint={locked}
        >
          <input
            id="registeredAt"
            name="registeredAt"
            type="date"
            className={inputClass}
            defaultValue={values.registeredAt}
            disabled={registrarManaged}
            aria-describedby={describe("registeredAt")}
          />
        </FormField>
        <FormField label="Renewal price" htmlFor="price" error={errors.price}>
          <input
            id="price"
            name="price"
            inputMode="decimal"
            className={inputClass}
            defaultValue={values.price}
            placeholder="12.99"
            aria-describedby={describe("price")}
          />
        </FormField>
        <FormField label="Currency" htmlFor="currency" error={errors.currency}>
          <input
            id="currency"
            name="currency"
            className={inputClass}
            defaultValue={values.currency || "USD"}
            maxLength={3}
            autoCapitalize="characters"
            aria-describedby={describe("currency")}
          />
        </FormField>
      </div>

      <FormField
        label="Tags"
        htmlFor="tags"
        error={errors.tags}
        hint="Comma-separated, e.g. personal, client-x"
      >
        <input id="tags" name="tags" className={inputClass} defaultValue={values.tags} />
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={errors.notes}>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          className={inputClass}
          defaultValue={values.notes}
          aria-describedby={describe("notes")}
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
