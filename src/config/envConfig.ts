// Environment and js-bao configuration for the template app
import { allModels } from "@/models";
import type { JsBaoClientOptions } from "js-bao-wss-client";
import type { LogLevel } from "@/lib/logger";

// Raw environment-derived config shared between router, js-bao, and logging
export const config = {
  appId: import.meta.env.VITE_APP_ID,
  apiUrl: import.meta.env.VITE_API_URL,
  wsUrl: import.meta.env.VITE_WS_URL,
  oauthRedirectUri: import.meta.env.VITE_OAUTH_REDIRECT_URI,
  enableAuthProxy: import.meta.env.VITE_ENABLE_AUTH_PROXY === "true",
  logLevel: import.meta.env.VITE_LOG_LEVEL,
  baseUrl: import.meta.env.VITE_BASE_URL,
};

function getRefreshProxyBaseUrl(): string {
  return typeof window !== "undefined"
    ? `${window.location.origin}/proxy`
    : "/proxy";
}

export function getJsBaoConfig(): JsBaoClientOptions {
  const auth = {
    persistJwtInStorage: true,
    ...(config.enableAuthProxy
      ? {
          refreshProxy: {
            baseUrl: getRefreshProxyBaseUrl(),
          },
        }
      : {}),
  };

  return {
    appId: config.appId,
    apiUrl: config.apiUrl,
    wsUrl: config.wsUrl,
    oauthRedirectUri: config.oauthRedirectUri,
    auth,
    models: allModels,
  } as JsBaoClientOptions;
}

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "none"];

/**
 * Returns the desired log level for the template app.
 *
 * This is the only place the template reads VITE_LOG_LEVEL. Consumers should
 * call `getLogLevel` and pass the function into
 * `createPrimitiveApp({ getLogLevel })` and any app-created loggers.
 *
 * This factory is called once during bootstrap and is not reactive.
 */
export function getLogLevel(): LogLevel {
  const raw = config.logLevel;
  if (!raw || typeof raw !== "string") return "warn";

  const normalized = raw.toLowerCase().trim() as LogLevel;
  return VALID_LOG_LEVELS.includes(normalized) ? normalized : "warn";
}

// Validate required configuration (dev aid)
const requiredVars = ["appId", "apiUrl", "wsUrl", "oauthRedirectUri"] as const;
const missingVars = requiredVars.filter(
  (key) => !config[key as (typeof requiredVars)[number]]
);

if (missingVars.length > 0) {
  console.error("Missing required environment variables:", missingVars);

  console.error(
    "Please check your .env file and ensure all VITE_ prefixed variables are set"
  );
}
