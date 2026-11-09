import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  environments: {
    ssr: {
      build: {
        // The server bundle's entry is our Express app (see server/app.ts), not the bare
        // React Router build, so migrations/jobs/healthz are bundled with path aliases resolved.
        rollupOptions: { input: "./server/app.ts" },
      },
    },
  },
  plugins: [tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
});
