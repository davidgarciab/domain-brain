import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

// Small set of shared primitives until we adopt shadcn/ui.

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export const inputClass =
  "w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-gray-900 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-500 dark:border-gray-700 dark:focus:border-gray-100 dark:aria-invalid:border-red-500";

const buttonVariants = {
  primary:
    "bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300",
  secondary: "border border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900",
  danger:
    "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
};

type Variant = keyof typeof buttonVariants;

export function buttonClass(variant: Variant = "primary") {
  return cx(
    "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60",
    buttonVariants[variant],
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonClass(variant), className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonClass(variant), className)} {...props} />;
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ok: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}
