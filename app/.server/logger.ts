import pino from "pino";
import { env } from "./env";

let instance: pino.Logger | undefined;

export function logger(): pino.Logger {
  instance ??= pino({
    level: env().LOG_LEVEL,
    transport: env().NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  });
  return instance;
}
