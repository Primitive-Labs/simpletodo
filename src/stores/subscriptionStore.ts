/**
 * @module subscriptionStore
 *
 * Pinia store for managing subscription billing state.
 *
 * Communicates with the billing endpoints in worker.js to check subscription
 * status, create Stripe Checkout sessions, and open the Stripe Customer Portal.
 *
 * When billing is disabled (VITE_BILLING_ENABLED !== "true"), all checks are
 * skipped and hasAccess is always true.
 */
import { config } from "@/config/envConfig";
import { appBaseLogger } from "@/lib/logger";
import { jsBaoClientService } from "primitive-app";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type SubscriptionStatus =
  | "loading"
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "unknown";

export interface SubscriptionStatusResponse {
  status: string;
  hasAccess: boolean;
  trialDaysLeft?: number;
  trialExpired?: boolean;
  stripeCustomerId?: string | null;
}

export const useSubscriptionStore = defineStore("subscription", () => {
  const logger = appBaseLogger.forScope("subscriptionStore");

  const status = ref<SubscriptionStatus>("loading");
  const trialDaysLeft = ref<number | null>(null);
  const isReady = ref(false);

  // --- Getters ---

  /** Whether the user currently has access (trialing, active, or past_due grace period) */
  const hasAccess = computed(() => {
    if (!config.billingEnabled) return true;
    return (
      status.value === "trialing" ||
      status.value === "active" ||
      status.value === "past_due"
    );
  });

  /** Whether to show the trial countdown banner */
  const shouldShowTrialBanner = computed(
    () => config.billingEnabled && status.value === "trialing"
  );

  /** Whether to show the paywall (trial expired, no active subscription) */
  const shouldShowPaywall = computed(
    () => config.billingEnabled && isReady.value && !hasAccess.value
  );

  // --- Internal helpers ---

  async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const client = await jsBaoClientService.getClientAsync();
      const token = client.getToken();
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    } catch {
      logger.warn("Could not get auth token for billing request");
    }
    return {};
  }

  async function billingFetch<T>(
    path: string,
    method: "GET" | "POST" = "GET"
  ): Promise<T> {
    const authHeaders = await getAuthHeaders();
    const res = await fetch(`/api/stripe${path}`, {
      method,
      headers: {
        ...authHeaders,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ||
          `Billing API error: ${res.status}`
      );
    }

    return res.json() as Promise<T>;
  }

  // --- Actions ---

  /**
   * Check subscription status from the billing API.
   * Automatically starts a trial for new users on the server side.
   */
  async function checkStatus(): Promise<void> {
    if (!config.billingEnabled) {
      status.value = "active";
      isReady.value = true;
      return;
    }

    try {
      const data =
        await billingFetch<SubscriptionStatusResponse>("/subscription-status");

      status.value = (data.status as SubscriptionStatus) || "unknown";
      trialDaysLeft.value = data.trialDaysLeft ?? null;
      logger.debug("Subscription status:", data.status, {
        hasAccess: data.hasAccess,
        trialDaysLeft: data.trialDaysLeft,
      });
    } catch (error) {
      logger.error("Failed to check subscription status:", error);
      // On error, grant access to avoid locking out users due to billing API issues
      status.value = "unknown";
    } finally {
      isReady.value = true;
    }
  }

  /**
   * Update status from the X-Subscription-Status header that the worker
   * injects into auth refresh responses.
   */
  function updateFromHeader(headerValue: string): void {
    try {
      const data = JSON.parse(headerValue) as SubscriptionStatusResponse;
      status.value = (data.status as SubscriptionStatus) || "unknown";
      trialDaysLeft.value = data.trialDaysLeft ?? null;
      if (!isReady.value) isReady.value = true;
      logger.debug("Subscription status updated from header:", data.status);
    } catch {
      logger.warn("Failed to parse X-Subscription-Status header");
    }
  }

  /**
   * Redirect the user to Stripe Checkout to start a subscription.
   */
  async function redirectToCheckout(): Promise<void> {
    try {
      const data = await billingFetch<{ url: string }>(
        "/create-checkout-session",
        "POST"
      );
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      logger.error("Failed to create checkout session:", error);
      throw error;
    }
  }

  /**
   * Redirect the user to the Stripe Customer Portal to manage their subscription.
   */
  async function redirectToPortal(): Promise<void> {
    try {
      const data = await billingFetch<{ url: string }>(
        "/create-portal-session",
        "POST"
      );
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      logger.error("Failed to create portal session:", error);
      throw error;
    }
  }

  /** Reset store state (e.g. on logout) */
  function reset(): void {
    status.value = "loading";
    trialDaysLeft.value = null;
    isReady.value = false;
  }

  return {
    // State
    status,
    trialDaysLeft,
    isReady,

    // Getters
    hasAccess,
    shouldShowTrialBanner,
    shouldShowPaywall,

    // Actions
    checkStatus,
    updateFromHeader,
    redirectToCheckout,
    redirectToPortal,
    reset,
  };
});
