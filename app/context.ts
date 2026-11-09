import { createContext } from "react-router";
import type { Runtime } from "~/.server/runtime";

/** Set once per request in server/app.ts; read in loaders/actions via `context.get(runtimeContext)`. */
export const runtimeContext = createContext<Runtime>();
