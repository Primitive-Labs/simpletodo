#!/usr/bin/env node
/**
 * Deploy script that reads configuration from environment-specific .env files,
 * builds the project, and deploys to Cloudflare Workers.
 *
 * Usage: pnpm cf-deploy <environment> [-- other wrangler options...]
 *
 * Examples:
 *   pnpm cf-deploy test              -> reads .env.test, deploys to test worker
 *   pnpm cf-deploy production        -> reads .env.production, deploys to prod worker
 *   pnpm cf-deploy production -- --dry-run  -> with extra wrangler flags
 *
 * This script:
 * 1. Reads configuration from .env.{environment} (the source of truth)
 * 2. Runs the production build with the appropriate env file
 * 3. Deploys using wrangler, passing APP_ID and API_ORIGIN as --var flags
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Parse a .env file into an object
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const vars = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      let value = match[2];

      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      vars[match[1]] = value;
    }
  }

  return vars;
}

/**
 * Mapping from .env vars to wrangler --var names
 * These are the vars the worker needs at runtime
 */
const ENV_TO_WRANGLER_VARS = {
  VITE_APP_ID: "APP_ID",
  VITE_API_URL: "API_ORIGIN",
};

/**
 * Parse command line arguments to extract the environment name
 * Supports: pnpm cf-deploy <env> [-- extra wrangler args]
 */
function parseArgs(args) {
  let env = null;
  const wranglerArgs = [];

  // First non-flag argument is the environment
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!env && !arg.startsWith("-")) {
      // First positional argument is the environment
      env = arg;
    } else {
      // Everything else goes to wrangler
      wranglerArgs.push(arg);
    }
  }

  return { env, wranglerArgs };
}

/**
 * Run a command and return a promise
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      cwd: ROOT_DIR,
      ...options,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const { env, wranglerArgs } = parseArgs(args);

  if (!env) {
    console.error("[deploy] Error: environment argument is required");
    console.error("[deploy] Usage: pnpm cf-deploy <environment>");
    console.error("[deploy] Examples:");
    console.error("[deploy]   pnpm cf-deploy test");
    console.error("[deploy]   pnpm cf-deploy production");
    console.error("[deploy]   pnpm cf-deploy production -- --dry-run");
    process.exit(1);
  }

  // Determine which .env file to use
  const envFileName = `.env.${env}`;
  const envFilePath = path.join(ROOT_DIR, envFileName);

  console.log(`[deploy] Environment: ${env}`);
  console.log(`[deploy] Config file: ${envFileName}`);

  // Read the environment-specific .env file
  const envVars = parseEnvFile(envFilePath);

  if (!envVars) {
    console.error(`[deploy] Error: ${envFileName} not found`);
    console.error(
      `[deploy] Please create ${envFileName} with your ${env} configuration`
    );
    console.error(`[deploy] You can copy .env.production as a starting point:`);
    console.error(`[deploy]   cp .env.production ${envFileName}`);
    process.exit(1);
  }

  console.log(`\n[deploy] Configuration from ${envFileName}:`);
  for (const [key, value] of Object.entries(envVars)) {
    // Mask sensitive values and truncate long ones
    const displayValue =
      key.includes("SECRET") || key.includes("KEY")
        ? "***"
        : value.length > 40
          ? value.substring(0, 40) + "..."
          : value;
    console.log(`  ${key}=${displayValue}`);
  }

  // Validate required vars
  if (!envVars.VITE_APP_ID || envVars.VITE_APP_ID === "YOUR_APP_ID_GOES_HERE") {
    console.error(`\n[deploy] Error: VITE_APP_ID is not set in ${envFileName}`);
    console.error(
      "[deploy] Please set your Primitive App ID from the admin console"
    );
    process.exit(1);
  }

  // Run build with the appropriate mode
  // Vite uses --mode to determine which .env file to load
  // --mode production loads .env.production, --mode test loads .env.test, etc.
  console.log(`\n[deploy] Building for ${env}...`);
  try {
    await runCommand("pnpm", ["build-only", "--mode", env]);
  } catch (error) {
    console.error("[deploy] Build failed:", error.message);
    process.exit(1);
  }

  // Build wrangler --var flags from .env file
  const varFlags = [];
  for (const [envKey, wranglerKey] of Object.entries(ENV_TO_WRANGLER_VARS)) {
    if (envVars[envKey]) {
      varFlags.push("--var", `${wranglerKey}:${envVars[envKey]}`);
    }
  }

  // Deploy with wrangler
  console.log("\n[deploy] Deploying to Cloudflare Workers...");
  console.log(
    "[deploy] Passing vars to worker:",
    Object.values(ENV_TO_WRANGLER_VARS).join(", ")
  );

  try {
    await runCommand("pnpm", [
      "dlx",
      "wrangler",
      "deploy",
      "--env",
      env,
      ...varFlags,
      ...wranglerArgs,
    ]);
  } catch (error) {
    console.error("[deploy] Deploy failed:", error.message);
    process.exit(1);
  }

  console.log("\n[deploy] Deployment complete!");
}

main().catch((error) => {
  console.error("[deploy] Unexpected error:", error);
  process.exit(1);
});
