/**
 * @module primitiveRouter
 *
 * Provides an opinionated Vue Router factory with built-in authentication guards.
 *
 * The `createPrimitiveRouter` function creates a Vue Router instance that automatically
 * enforces authentication requirements based on route metadata. Routes can declare their
 * auth requirements using the `primitiveRouterMeta` property in route meta.
 *
 * ## Features
 *
 * - **Auth Guards**: Automatically redirects unauthenticated users to login
 * - **Admin Routes**: Support for admin-only routes with automatic redirect
 * - **Login Redirect**: Configurable login route or external URL with continue URL support
 */
import { appBaseLogger } from "@/lib/logger";
import { buildRouteOrUrl } from "@/lib/routeOrUrl";
import { useUserStore } from "@/stores/userStore";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from "vue-router";

/**
 * Authorization level required for a route.
 *
 * - "none": route is public
 * - "member": authenticated user required
 * - "admin": authenticated user with admin privileges required
 */
export type AuthLevel = "member" | "admin" | "none";

/**
 * Shared route metadata used by the app router.
 */
export interface PrimitiveRouterMeta {
  /**
   * Required authorization level for this route.
   * Defaults to "none" when omitted.
   */
  requireAuth: AuthLevel;
}

export interface CreatePrimitiveRouterOptions {
  /**
   * The routes to install into the underlying Vue Router instance.
   */
  routes: RouteRecordRaw[];

  /**
   * Optional custom history implementation. Defaults to
   * `createWebHistory(BASE_URL || "/")` when omitted.
   */
  history?: RouterHistory;
  /**
   * External URL to redirect unauthenticated users to.
   *
   * When provided, unauthenticated users will be redirected to this URL
   * with a `continueURL` query parameter pointing back to the original
   * destination.
   */
  loginUrl?: string;

  /**
   * Named login route to redirect unauthenticated users to.
   *
   * When provided, unauthenticated users will be redirected to this
   * route name with a `continueURL` query parameter in the querystring.
   */
  loginRouteName?: string;

  /**
   * Named home route to redirect non-admin users to when they attempt
   * to access an admin-only route.
   *
   * When omitted, defaults to "home".
   */
  homeRouteName?: string;
}

/**
 * Create a Vue Router instance with opinionated auth guarding behavior
 * based on route metadata.
 *
 * Routes can opt into auth requirements by specifying:
 *
 * ```ts
 * meta: {
 *   primitiveRouterMeta: {
 *     requireAuth: "member" | "admin" | "none",
 *   },
 * }
 * ```
 *
 * For any route where `requireAuth` is "member" or "admin":
 * - The user store **must** be initialized before navigation. If not,
 *   this helper will throw a descriptive error.
 * - Unauthenticated users are redirected to the configured login
 *   route or URL, with a `continueURL` query parameter pointing back
 *   to the original destination.
 * - "admin" additionally requires `user.isAdmin === true`; failures
 *   are redirected to the configured `homeRouteName`.
 */
export function createPrimitiveRouter(
  options: CreatePrimitiveRouterOptions
): Router {
  const logger = appBaseLogger.forScope("PrimitiveRouterGuard");

  const loginTarget = buildRouteOrUrl(options.loginUrl, options.loginRouteName);
  const homeRouteName = options.homeRouteName ?? "home";

  const router = createRouter({
    history:
      options.history ??
      // In Vite-powered apps, BASE_URL is injected at build time. For other
      // consumers (e.g., tests or different tooling), fall back to "/".
      createWebHistory(
        typeof import.meta !== "undefined" &&
          typeof (import.meta as { env?: unknown }).env === "object" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL
          ? (import.meta as { env: { BASE_URL: string } }).env.BASE_URL
          : "/"
      ),
    routes: options.routes,
  });

  router.beforeEach((to) => {
    const meta = to.meta.primitiveRouterMeta;
    const required: AuthLevel = meta?.requireAuth ?? "none";

    const user = useUserStore();

    logger.debug("Evaluating route", {
      to: {
        name: to.name,
        path: to.fullPath,
      },
      requiredAuth: required,
      userState: {
        isInitialized: user.isInitialized,
        isAuthenticated: user.isAuthenticated,
        isAdmin: user.isAdmin,
      },
    });

    // Public route
    if (required === "none") {
      logger.debug("Route is public; allowing navigation");
      return true;
    }

    if (!user.isInitialized) {
      logger.debug(
        "Protected route but userStore is not initialized; throwing error"
      );
      throw new Error(
        "[app] userStore must be initialized before navigating to protected routes. " +
          "Call useUserStore().initialize() and await it before mounting the app or before navigating."
      );
    }

    // Member/admin required: enforce authentication
    if (!user.isAuthenticated) {
      // Allow navigation if we are already on the login route name
      if ("routeName" in loginTarget && to.name === loginTarget.routeName) {
        logger.debug(
          "Unauthenticated user already on login route; allowing navigation"
        );
        return true;
      }

      if ("routeName" in loginTarget) {
        logger.debug("Unauthenticated user; redirecting to login route", {
          targetRouteName: loginTarget.routeName,
          redirectFrom: to.fullPath,
        });
        return {
          name: loginTarget.routeName,
          query: {
            continueURL: to.fullPath,
          },
        };
      }

      if (typeof window !== "undefined" && "url" in loginTarget) {
        const redirectUrl = new URL(loginTarget.url, window.location.origin);
        redirectUrl.searchParams.set("continueURL", to.fullPath);
        logger.debug("Unauthenticated user; redirecting to login URL", {
          targetUrl: redirectUrl.toString(),
          redirectFrom: to.fullPath,
        });
        window.location.href = redirectUrl.toString();
      }

      // Abort current navigation; a full page reload may occur above
      logger.debug("Navigation aborted after issuing login redirect");
      return false;
    }

    // Admin-only route: enforce admin flag
    if (required === "admin" && !user.isAdmin) {
      logger.debug(
        "Admin route requested but user is not admin; redirecting to home",
        {
          homeRouteName,
        }
      );
      return { name: homeRouteName };
    }

    logger.debug("Access granted; continuing navigation");
    return true;
  });

  return router;
}
