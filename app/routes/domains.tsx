import type { Route } from "./+types/domains";

export const meta: Route.MetaFunction = () => [{ title: "Domains · Domain Brain" }];

export default function Domains() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Your domains</h1>
      <p className="mt-4 text-gray-500">No domains yet. Domain management is coming next.</p>
    </section>
  );
}
