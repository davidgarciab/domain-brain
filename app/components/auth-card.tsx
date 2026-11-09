import type { ReactNode } from "react";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-sm font-medium text-gray-500">Domain Brain</p>
        <div className="rounded-lg border border-gray-200 p-6 shadow-sm dark:border-gray-800">
          <h1 className="mb-6 text-xl font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        className="w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:focus:border-gray-100"
      />
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
