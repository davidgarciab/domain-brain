import { isRouteErrorResponse, Link } from "react-router";

/** Shared body for error boundaries: a short message and a way back. */
export function ErrorPage({ error }: { error: unknown }) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred. Please try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      details =
        typeof error.data === "string" && error.data
          ? `${error.data}.`
          : "This page doesn't exist.";
    } else {
      title = `Error ${error.status}`;
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-gray-500">{details}</p>
      <Link to="/domains" className="mt-6 inline-block text-sm underline">
        Go to your domains
      </Link>
      {stack && (
        <pre className="mt-8 overflow-x-auto text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </div>
  );
}
