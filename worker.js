const PROXY_PREFIX = "/proxy";
// Supported proxy path prefixes - requests matching these are forwarded to the API
const PROXY_AUTH_PREFIX = `${PROXY_PREFIX}/auth/`;
const PROXY_OAUTH_PREFIX = `${PROXY_PREFIX}/oauth/`;

// Environment variable availability helper
const getEnvAvailability = (env) => ({
  VITE_API_URL: !!env.VITE_API_URL,
  VITE_WS_URL: !!env.VITE_WS_URL,
  VITE_APP_ID: !!env.VITE_APP_ID,
  VITE_OAUTH_REDIRECT_URI: !!env.VITE_OAUTH_REDIRECT_URI,
  VITE_PERF_ENABLED: !!env.VITE_PERF_ENABLED,
  VITE_ENVIRONMENT: !!env.VITE_ENVIRONMENT,
  VITE_USE_REFRESH_PROXY: !!env.VITE_USE_REFRESH_PROXY,
  VITE_REFRESH_PROXY_BASE_URL: !!env.VITE_REFRESH_PROXY_BASE_URL,
  VITE_REFRESH_PROXY_COOKIE_MAX_AGE: !!env.VITE_REFRESH_PROXY_COOKIE_MAX_AGE,
});

const toOrigin = (value) => {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    try {
      const parsed = new URL(value, "https://placeholder.example");
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }
};

const ensureSingleLeadingSlash = (value) => {
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/")) {
    return ensureSingleLeadingSlash(`/${value}`);
  }
  while (value.startsWith("//")) {
    value = value.slice(1);
  }
  return value === "" ? "/" : value;
};

const parseCookies = (header) => {
  if (!header) return {};
  return header.split(/;\s*/).reduce((acc, item) => {
    const [name, ...rest] = item.split("=");
    if (!name) return acc;
    acc[name.trim()] = rest.join("=");
    return acc;
  }, {});
};

const getSetCookies = (headers) => {
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("Set-Cookie");
  return value ? [value] : [];
};

const findCookieValue = (cookies, name) => {
  if (!cookies || !name) return null;
  const prefix = `${name}=`;
  for (const cookie of cookies) {
    if (!cookie) continue;
    const segments = cookie.split(";");
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.startsWith(prefix)) {
        return trimmed.substring(prefix.length);
      }
    }
  }
  return null;
};

const appendVary = (existing, value) => {
  if (!value) return existing || undefined;
  if (!existing) return value;
  const parts = existing.split(",").map((p) => p.trim().toLowerCase());
  if (parts.includes(value.toLowerCase())) {
    return existing;
  }
  return `${existing}, ${value}`;
};

const serializeCookie = ({
  name,
  value,
  maxAge,
  path,
  sameSite = "Lax",
  secure = true,
}) => {
  const parts = [`${name}=${value}`];
  parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (path) parts.push(`Path=${path}`);
  if (typeof maxAge === "number") {
    parts.push(`Max-Age=${maxAge}`);
    if (maxAge === 0) {
      parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    }
  }
  return parts.join("; ");
};

const getProxyConfig = (env) => {
  const apiOrigin = toOrigin(env.API_ORIGIN || env.VITE_API_URL);
  const appId = env.APP_ID || env.VITE_APP_ID;
  const cookieName = appId ? `rt-${appId}` : null;
  const rawMaxAge = env.REFRESH_PROXY_COOKIE_MAX_AGE;
  const parsedMaxAge =
    typeof rawMaxAge === "string" ? Number.parseInt(rawMaxAge, 10) : NaN;
  const cookieMaxAge =
    Number.isFinite(parsedMaxAge) && parsedMaxAge > 0 ? parsedMaxAge : 604800; // 7 days default
  const cookiePath = ensureSingleLeadingSlash(
    env.REFRESH_PROXY_COOKIE_PATH || PROXY_PREFIX
  );

  return {
    apiOrigin,
    appId,
    cookieName,
    cookiePath,
    cookieMaxAge,
  };
};

const resolveCookieMaxAge = (request, defaultMaxAge) => {
  const header = request.headers.get("X-Refresh-Cookie-Max-Age");
  if (!header) return defaultMaxAge;
  const parsed = Number.parseInt(header, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultMaxAge;
  return parsed;
};

const cloneUpstreamHeaders = (upstreamHeaders, omit = []) => {
  const headers = new Headers();
  const omitLower = omit.map((h) => h.toLowerCase());
  for (const [key, value] of upstreamHeaders) {
    if (omitLower.includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  return headers;
};

const buildProxyResponse = async ({
  upstreamResponse,
  cookieName,
  cookiePath,
  cookieMaxAge,
  shouldExpire,
  request,
}) => {
  const body = await upstreamResponse.text();
  const headers = cloneUpstreamHeaders(upstreamResponse.headers, [
    "set-cookie",
  ]);

  const varyHeader = appendVary(upstreamResponse.headers.get("Vary"), "Cookie");
  if (varyHeader) headers.set("Vary", varyHeader);

  const setCookies = getSetCookies(upstreamResponse.headers);
  const refreshCookieValue = cookieName
    ? findCookieValue(setCookies, cookieName)
    : null;
  const maxAgeOverride = resolveCookieMaxAge(request, cookieMaxAge);
  const requestIsSecure = new URL(request.url).protocol === "https:";

  if (refreshCookieValue && cookieName) {
    headers.append(
      "Set-Cookie",
      serializeCookie({
        name: cookieName,
        value: refreshCookieValue,
        maxAge: maxAgeOverride,
        path: cookiePath,
        secure: requestIsSecure,
      })
    );
  } else if (cookieName && (shouldExpire || upstreamResponse.status === 401)) {
    headers.append(
      "Set-Cookie",
      serializeCookie({
        name: cookieName,
        value: "",
        maxAge: 0,
        path: cookiePath,
        secure: requestIsSecure,
      })
    );
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (
    !headers.has("Cache-Control") &&
    contentType.includes("application/json")
  ) {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
};

const ensureOriginEndsWithSlash = (value) => {
  if (!value || typeof value !== "string") return "/";
  return value.endsWith("/") ? value : `${value}/`;
};

const buildUpstreamUrl = (origin, appId, path) => {
  const normalizedOrigin = ensureOriginEndsWithSlash(origin || "");
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedOrigin}app/${appId}/api/${normalizedPath}`;
};

const forwardProxyRequest = async ({ request, url, headers }) => {
  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    init.body = request.body;
  }
  console.log("[WORKER][proxy] Forwarding request", {
    url,
    method: request.method,
  });
  const response = await fetch(url, init);
  console.log("[WORKER][proxy] Upstream response", {
    url,
    status: response.status,
  });
  return response;
};

const handleAuthRefresh = async (request, env, config) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { cookieName, cookiePath, cookieMaxAge, apiOrigin, appId } = config;
  if (!apiOrigin || !appId || !cookieName) {
    return new Response("Proxy not configured", { status: 500 });
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const refreshCookieValue = cookies[cookieName] || null;

  const upstreamHeaders = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  if (refreshCookieValue) {
    upstreamHeaders.set("Cookie", `${cookieName}=${refreshCookieValue}`);
  }

  const upstreamUrl = buildUpstreamUrl(apiOrigin, appId, "auth/refresh");
  console.log("[WORKER][refresh] Upstream URL", upstreamUrl);

  try {
    const upstreamResponse = await forwardProxyRequest({
      request,
      url: upstreamUrl,
      headers: upstreamHeaders,
    });

    return buildProxyResponse({
      upstreamResponse,
      cookieName,
      cookiePath,
      cookieMaxAge,
      shouldExpire: false,
      request,
    });
  } catch (error) {
    console.error("[WORKER][refresh] upstream error", error);
    return new Response("Upstream error", { status: 502 });
  }
};

const handleOAuthCallback = async (request, env, config, url) => {
  if (!["GET", "POST"].includes(request.method.toUpperCase())) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { cookieName, cookiePath, cookieMaxAge, apiOrigin, appId } = config;
  if (!apiOrigin || !appId || !cookieName) {
    return new Response("Proxy not configured", { status: 500 });
  }

  const upstreamHeaders = new Headers({
    Accept: "application/json",
  });

  const incomingCookieHeader = request.headers.get("Cookie");
  if (incomingCookieHeader) {
    upstreamHeaders.set("Cookie", incomingCookieHeader);
  }

  const upstreamUrl = new URL(
    buildUpstreamUrl(apiOrigin, appId, "oauth/callback")
  );

  // Preserve code/state query params; allow caller override of appId for multi-app scenarios
  upstreamUrl.search = url.search;

  if (!upstreamUrl.searchParams.has("appId")) {
    upstreamUrl.searchParams.set("appId", appId);
  }

  try {
    const upstreamResponse = await forwardProxyRequest({
      request,
      url: upstreamUrl.toString(),
      headers: upstreamHeaders,
    });

    return buildProxyResponse({
      upstreamResponse,
      cookieName,
      cookiePath,
      cookieMaxAge,
      shouldExpire: false,
      request,
    });
  } catch (error) {
    console.error("[WORKER][oauth] upstream error", error);
    return new Response("Upstream error", { status: 502 });
  }
};

const handleAuthLogout = async (request, env, config) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const { cookieName, cookiePath, cookieMaxAge, apiOrigin, appId } = config;
  if (!apiOrigin || !appId || !cookieName) {
    return new Response("Proxy not configured", { status: 500 });
  }

  const upstreamHeaders = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  const incomingCookieHeader = request.headers.get("Cookie");
  if (incomingCookieHeader) {
    upstreamHeaders.set("Cookie", incomingCookieHeader);
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    upstreamHeaders.set("Authorization", authHeader);
  }

  const upstreamUrl = buildUpstreamUrl(apiOrigin, appId, "auth/logout");

  try {
    const upstreamResponse = await forwardProxyRequest({
      request,
      url: upstreamUrl,
      headers: upstreamHeaders,
    });

    // Always expire local cookie regardless of upstream status
    return buildProxyResponse({
      upstreamResponse,
      cookieName,
      cookiePath,
      cookieMaxAge,
      shouldExpire: true,
      request,
    });
  } catch (error) {
    console.error("[WORKER][logout] upstream error", error);
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    const requestIsSecure = new URL(request.url).protocol === "https:";
    if (cookieName) {
      headers.append(
        "Set-Cookie",
        serializeCookie({
          name: cookieName,
          value: "",
          maxAge: 0,
          path: cookiePath,
          secure: requestIsSecure,
        })
      );
    }
    return new Response(JSON.stringify({ error: "Upstream logout failed" }), {
      status: 502,
      headers,
    });
  }
};

/**
 * Generic proxy handler for auth and oauth endpoints.
 * Forwards requests to the upstream API and handles refresh token cookie management.
 */
const handleGenericProxy = async (request, env, config, url) => {
  const { cookieName, cookiePath, cookieMaxAge, apiOrigin, appId } = config;
  if (!apiOrigin || !appId || !cookieName) {
    return new Response("Proxy not configured", { status: 500 });
  }

  // Extract the path suffix after /proxy/
  // e.g., /proxy/auth/magic-link/verify → auth/magic-link/verify
  const proxyPath = url.pathname.substring(PROXY_PREFIX.length + 1);

  // Build upstream URL, preserving query params (critical for OAuth callback code/state)
  const upstreamUrl = new URL(buildUpstreamUrl(apiOrigin, appId, proxyPath));
  upstreamUrl.search = url.search;

  // Forward relevant headers
  const upstreamHeaders = new Headers();
  const forwardHeaders = ["content-type", "accept", "cookie", "authorization"];
  for (const [key, value] of request.headers) {
    if (forwardHeaders.includes(key.toLowerCase())) {
      upstreamHeaders.set(key, value);
    }
  }

  // Ensure we have Accept header for JSON responses
  if (!upstreamHeaders.has("Accept")) {
    upstreamHeaders.set("Accept", "application/json");
  }

  // For POST requests without Content-Type, default to JSON
  if (request.method === "POST" && !upstreamHeaders.has("Content-Type")) {
    upstreamHeaders.set("Content-Type", "application/json");
  }

  // If we have a refresh cookie, ensure it's forwarded
  const cookies = parseCookies(request.headers.get("Cookie"));
  const refreshCookieValue = cookies[cookieName] || null;
  if (refreshCookieValue && !upstreamHeaders.has("Cookie")) {
    upstreamHeaders.set("Cookie", `${cookieName}=${refreshCookieValue}`);
  }

  console.log("[WORKER][generic-proxy] Forwarding request", {
    proxyPath,
    upstreamUrl: upstreamUrl.toString(),
    method: request.method,
  });

  try {
    const upstreamResponse = await forwardProxyRequest({
      request,
      url: upstreamUrl.toString(),
      headers: upstreamHeaders,
    });

    // Determine if this is a logout request (should expire cookie)
    const isLogout = proxyPath.includes("logout");

    return buildProxyResponse({
      upstreamResponse,
      cookieName,
      cookiePath,
      cookieMaxAge,
      shouldExpire: isLogout,
      request,
    });
  } catch (error) {
    console.error("[WORKER][generic-proxy] upstream error", error);
    return new Response("Upstream error", { status: 502 });
  }
};

// =============================================================================
// BILLING / STRIPE INTEGRATION
// =============================================================================
// Subscription management via Stripe. Uses Cloudflare KV for state and the
// Stripe REST API directly (no SDK needed in plain Workers).
//
// Secrets (set via `wrangler secret put`):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Vars (set via deploy script or wrangler.toml):
//   STRIPE_PRICE_ID, APP_URL, TRIAL_DAYS
// KV namespace binding: BILLING_KV
// =============================================================================

const BILLING_PREFIX = "/api/stripe";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_TRIAL_DAYS = 7;

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const getBillingConfig = (env) => ({
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  stripePriceId: env.STRIPE_PRICE_ID,
  appUrl: env.APP_URL || "",
  trialDays: Number.parseInt(env.TRIAL_DAYS || String(DEFAULT_TRIAL_DAYS), 10),
  isConfigured: !!(env.STRIPE_SECRET_KEY && env.BILLING_KV),
});

// Decode the payload section of a JWT without signature verification.
// Safe here because Primitive already validated the token on refresh.
const decodeJwtPayload = (token) => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

// --- KV operations ---

const getSubscriptionRecord = async (env, userId) => {
  if (!env.BILLING_KV) return null;
  try {
    const raw = await env.BILLING_KV.get(`user:${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const putSubscriptionRecord = async (env, userId, record) => {
  if (!env.BILLING_KV) return;
  await env.BILLING_KV.put(`user:${userId}`, JSON.stringify(record));
};

const getStripeCustomerMapping = async (env, stripeCustomerId) => {
  if (!env.BILLING_KV) return null;
  try {
    return await env.BILLING_KV.get(`stripe:${stripeCustomerId}`);
  } catch {
    return null;
  }
};

const putStripeCustomerMapping = async (env, stripeCustomerId, userId) => {
  if (!env.BILLING_KV) return;
  await env.BILLING_KV.put(`stripe:${stripeCustomerId}`, userId);
};

// --- User validation via Primitive API ---
// Validates the JWT by calling Primitive's profile endpoint. This avoids
// needing Primitive's signing keys while confirming the token is genuine.

const validateUserFromJwt = async (request, env) => {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.substring(7);
  const proxyConfig = getProxyConfig(env);
  if (!proxyConfig.apiOrigin || !proxyConfig.appId) return null;

  try {
    const profileUrl = buildUpstreamUrl(
      proxyConfig.apiOrigin,
      proxyConfig.appId,
      "me"
    );
    const res = await fetch(profileUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// --- Subscription status computation ---

const computeSubscriptionStatus = (record, trialDays = DEFAULT_TRIAL_DAYS) => {
  if (!record) return { status: "unknown", hasAccess: false };

  // Active subscription or payment retrying — allow access for both
  if (record.status === "active" || record.status === "past_due") {
    return {
      status: record.status,
      hasAccess: true,
      stripeCustomerId: record.stripeCustomerId || null,
    };
  }

  // Explicitly canceled or expired
  if (record.status === "canceled" || record.status === "expired") {
    return {
      status: "expired",
      hasAccess: false,
      stripeCustomerId: record.stripeCustomerId || null,
    };
  }

  // Trial period
  if (record.status === "trialing" && record.trialStartDate) {
    const trialEnd = new Date(record.trialStartDate);
    trialEnd.setDate(trialEnd.getDate() + trialDays);
    const now = new Date();

    if (now < trialEnd) {
      const daysLeft = Math.ceil(
        (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return { status: "trialing", hasAccess: true, trialDaysLeft: daysLeft };
    }
    return { status: "expired", hasAccess: false, trialExpired: true };
  }

  return { status: "unknown", hasAccess: false };
};

// --- Stripe webhook signature verification (Web Crypto API) ---

const verifyStripeWebhookSignature = async (
  payload,
  signatureHeader,
  secret
) => {
  try {
    const parts = {};
    for (const item of signatureHeader.split(",")) {
      const [key, value] = item.trim().split("=", 2);
      parts[key] = value;
    }

    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    // Reject timestamps older than 5 minutes
    if (
      Math.abs(Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10)) >
      300
    )
      return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`)
    );
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === signature;
  } catch {
    return false;
  }
};

// --- Billing endpoint handlers ---

const handleSubscriptionStatus = async (request, env) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const user = await validateUserFromJwt(request, env);
  if (!user || !user.userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const billing = getBillingConfig(env);
  let record = await getSubscriptionRecord(env, user.userId);

  // Auto-start trial for new users
  if (!record) {
    record = {
      status: "trialing",
      trialStartDate: new Date().toISOString(),
      email: user.email,
    };
    await putSubscriptionRecord(env, user.userId, record);
    console.log("[WORKER][billing] Started trial for user:", user.userId);
  }

  return jsonResponse(computeSubscriptionStatus(record, billing.trialDays));
};

const handleCreateCheckoutSession = async (request, env) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const user = await validateUserFromJwt(request, env);
  if (!user || !user.userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const billing = getBillingConfig(env);
  if (!billing.stripePriceId) {
    return jsonResponse({ error: "Billing not configured" }, 500);
  }

  const record = await getSubscriptionRecord(env, user.userId);

  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": billing.stripePriceId,
    "line_items[0][quantity]": "1",
    success_url: `${billing.appUrl}/?checkout=success`,
    cancel_url: `${billing.appUrl}/?checkout=cancel`,
    client_reference_id: user.userId,
    "metadata[primitiveUserId]": user.userId,
  });

  // Reuse existing Stripe customer if we have one
  if (record?.stripeCustomerId) {
    params.set("customer", record.stripeCustomerId);
  } else if (user.email) {
    params.set("customer_email", user.email);
  }

  try {
    const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${billing.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error("[WORKER][billing] Stripe error:", session.error);
      return jsonResponse(
        { error: session.error?.message || "Failed to create checkout session" },
        500
      );
    }

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("[WORKER][billing] Checkout error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
};

const handleCreatePortalSession = async (request, env) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const user = await validateUserFromJwt(request, env);
  if (!user || !user.userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const record = await getSubscriptionRecord(env, user.userId);
  if (!record?.stripeCustomerId) {
    return jsonResponse({ error: "No billing account found" }, 404);
  }

  const billing = getBillingConfig(env);

  try {
    const res = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${billing.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: record.stripeCustomerId,
        return_url: billing.appUrl || "/",
      }).toString(),
    });

    const session = await res.json();
    if (!res.ok) {
      console.error("[WORKER][billing] Portal error:", session.error);
      return jsonResponse(
        { error: session.error?.message || "Failed to create portal session" },
        500
      );
    }

    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("[WORKER][billing] Portal error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
};

// --- Stripe webhook handler ---

const handleStripeWebhook = async (request, env) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const billing = getBillingConfig(env);
  if (!billing.stripeWebhookSecret) {
    return jsonResponse({ error: "Webhook not configured" }, 500);
  }

  const signature = request.headers.get("Stripe-Signature");
  if (!signature) {
    return jsonResponse({ error: "Missing signature" }, 400);
  }

  const body = await request.text();
  const valid = await verifyStripeWebhookSignature(
    body,
    signature,
    billing.stripeWebhookSecret
  );
  if (!valid) {
    console.error("[WORKER][billing] Invalid webhook signature");
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  const event = JSON.parse(body);
  console.log("[WORKER][billing] Webhook received - event type:", event.type, "event id:", event.id);

  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(env, event.data.object);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(env, event.data.object);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(env, event.data.object);
      break;
    default:
      console.log("[WORKER][billing] Unhandled event:", event.type);
  }

  return jsonResponse({ received: true });
};

// --- Webhook event processors ---

const onCheckoutCompleted = async (env, session) => {
  console.log("[WORKER][billing] onCheckoutCompleted session:", JSON.stringify({
    client_reference_id: session.client_reference_id,
    metadata: session.metadata,
    customer: session.customer,
    subscription: session.subscription,
  }));
  const userId =
    session.client_reference_id || session.metadata?.primitiveUserId;
  if (!userId) {
    console.error("[WORKER][billing] No primitiveUserId in checkout session");
    return;
  }

  const customerId = session.customer;
  const subscriptionId = session.subscription;

  const existing = (await getSubscriptionRecord(env, userId)) || {};
  await putSubscriptionRecord(env, userId, {
    ...existing,
    stripeCustomerId: customerId,
    subscriptionId,
    status: "active",
    email: session.customer_email || existing.email,
  });

  if (customerId) {
    await putStripeCustomerMapping(env, customerId, userId);
  }
  console.log("[WORKER][billing] Checkout completed for user:", userId);
};

const onSubscriptionUpdated = async (env, subscription) => {
  const customerId = subscription.customer;
  const userId = await getStripeCustomerMapping(env, customerId);
  if (!userId) {
    console.error(
      "[WORKER][billing] No user mapping for customer:",
      customerId
    );
    return;
  }

  const existing = (await getSubscriptionRecord(env, userId)) || {};
  await putSubscriptionRecord(env, userId, {
    ...existing,
    subscriptionId: subscription.id,
    status: subscription.status,
  });
  console.log(
    "[WORKER][billing] Subscription updated:",
    userId,
    subscription.status
  );
};

const onSubscriptionDeleted = async (env, subscription) => {
  console.log("[WORKER][billing] onSubscriptionDeleted:", JSON.stringify({
    customer: subscription.customer,
    id: subscription.id,
    status: subscription.status,
  }));
  const customerId = subscription.customer;
  const userId = await getStripeCustomerMapping(env, customerId);
  console.log("[WORKER][billing] Customer mapping lookup:", customerId, "->", userId);
  if (!userId) {
    console.error(
      "[WORKER][billing] No user mapping for customer:",
      customerId
    );
    return;
  }

  const existing = (await getSubscriptionRecord(env, userId)) || {};
  await putSubscriptionRecord(env, userId, {
    ...existing,
    subscriptionId: null,
    status: "canceled",
  });
  console.log("[WORKER][billing] Subscription deleted for user:", userId);
};

// --- Auth refresh: inject subscription status header ---
// After a successful token refresh, attach X-Subscription-Status so the
// client gets updated billing state without a separate API call.

const injectSubscriptionStatusHeader = async (response, env) => {
  try {
    const body = await response.text();
    let userId = null;

    try {
      const data = JSON.parse(body);
      userId = data.userId || data.user?.userId;

      // Fallback: decode the JWT from the refresh response
      if (!userId) {
        const token = data.token || data.accessToken;
        if (token) {
          const payload = decodeJwtPayload(token);
          userId = payload?.userId || payload?.sub;
        }
      }
    } catch {
      // Not JSON — return the response unchanged
    }

    if (userId && env.BILLING_KV) {
      const record = await getSubscriptionRecord(env, userId);
      const billing = getBillingConfig(env);
      const status = computeSubscriptionStatus(record, billing.trialDays);

      const headers = new Headers(response.headers);
      headers.set("X-Subscription-Status", JSON.stringify(status));

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error(
      "[WORKER][billing] Error injecting subscription status:",
      error
    );
    return response;
  }
};

export default {
  async fetch(request, env, ctx) {
    console.log("[WORKER] Worker started, request:", request.url);
    console.log(
      "[WORKER] Headers:",
      Object.fromEntries(request.headers.entries())
    );

    const url = new URL(request.url);
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      const config = getProxyConfig(env);
      console.log("[WORKER] Proxy request detected", {
        pathname: url.pathname,
        configAppId: config.appId,
        apiOrigin: config.apiOrigin,
      });

      // Check if request matches allowed proxy prefixes
      const isAuthRoute = url.pathname.startsWith(PROXY_AUTH_PREFIX);
      const isOAuthRoute = url.pathname.startsWith(PROXY_OAUTH_PREFIX);

      if (isAuthRoute || isOAuthRoute) {
        const proxyResponse = await handleGenericProxy(request, env, config, url);

        // Inject subscription status into auth refresh responses so the
        // client gets billing state without a separate API call
        if (
          url.pathname === `${PROXY_AUTH_PREFIX}refresh` &&
          proxyResponse.ok &&
          env.BILLING_KV
        ) {
          return injectSubscriptionStatusHeader(proxyResponse, env);
        }

        return proxyResponse;
      }

      return new Response("Not Found", { status: 404 });
    }

    // Test endpoint to verify worker is working
    if (url.pathname === "/worker-test") {
      return new Response(
        JSON.stringify({
          message: "Worker is working!",
          env_vars: getEnvAvailability(env),
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Test HTML injection endpoint
    if (url.pathname === "/html-test") {
      const testHtml = `<!DOCTYPE html>
<html>
<head>
    <title>Test</title>
</head>
<body>
    <h1>Test HTML</h1>
</body>
</html>`;

      return new Response(testHtml, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Handle API routes
    if (url.pathname.startsWith("/api/")) {
      // Billing / Stripe endpoints
      if (url.pathname.startsWith(BILLING_PREFIX + "/")) {
        if (!getBillingConfig(env).isConfigured) {
          return jsonResponse({ error: "Billing not configured" }, 503);
        }
        const billingPath = url.pathname.substring(BILLING_PREFIX.length);
        if (billingPath === "/subscription-status")
          return handleSubscriptionStatus(request, env);
        if (billingPath === "/create-checkout-session")
          return handleCreateCheckoutSession(request, env);
        if (billingPath === "/create-portal-session")
          return handleCreatePortalSession(request, env);
        if (billingPath === "/webhooks")
          return handleStripeWebhook(request, env);
        return jsonResponse({ error: "Not found" }, 404);
      }

      if (url.pathname === "/api/version") {
        let meta = {
          version: env.BUILD_VERSION || "",
          commit: env.BUILD_COMMIT || "",
          time: env.BUILD_TIME || "",
        };
        try {
          if (!meta.version || !meta.commit) {
            const assetReq = new Request(new URL("/version.json", url.origin), {
              headers: { "cache-control": "no-store" },
            });
            const assetRes = await env.ASSETS.fetch(assetReq);
            if (assetRes.ok) {
              meta = await assetRes.json();
            }
          }
        } catch {}
        return new Response(JSON.stringify(meta), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }
      return new Response("API endpoint", { status: 200 });
    }

    // Get the response from Assets
    const response = await env.ASSETS.fetch(request);
    console.log(
      "[WORKER] Got response from ASSETS:",
      response.status,
      response.headers.get("content-type")
    );
    console.log(
      "[WORKER] Response headers:",
      Object.fromEntries(response.headers.entries())
    );

    return response;
  },
};
