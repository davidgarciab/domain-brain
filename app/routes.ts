import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  route("api/auth/*", "routes/api.auth.ts"),
  layout("routes/app-layout.tsx", [route("domains", "routes/domains.tsx")]),
] satisfies RouteConfig;
