<script setup lang="ts">
/**
 * Paywall page shown when the user's trial has expired and they don't
 * have an active subscription. Offers a button to start a Stripe Checkout
 * session and, if the user already has a Stripe customer record, a link
 * to the Customer Portal for updating payment details.
 */
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { CheckCircle } from "lucide-vue-next";
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

const subscriptionStore = useSubscriptionStore();
const router = useRouter();

// Check subscription status on mount and redirect if user has access
onMounted(() => {
  subscriptionStore.checkStatus();
});

watch(
  () => subscriptionStore.hasAccess,
  (hasAccess) => {
    if (hasAccess) {
      router.replace({ name: "home" });
    }
  }
);

const isLoading = ref(false);
const error = ref<string | null>(null);

async function handleSubscribe(): Promise<void> {
  isLoading.value = true;
  error.value = null;
  try {
    await subscriptionStore.redirectToCheckout();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Something went wrong. Please try again.";
    isLoading.value = false;
  }
}

async function handleManageSubscription(): Promise<void> {
  isLoading.value = true;
  error.value = null;
  try {
    await subscriptionStore.redirectToPortal();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "Something went wrong. Please try again.";
    isLoading.value = false;
  }
}

const features = [
  "Unlimited todo lists",
  "Real-time collaboration & sharing",
  "Cross-device sync",
  "Offline support",
];
</script>

<template>
  <div class="flex min-h-[80vh] items-center justify-center px-4">
    <div class="w-full max-w-md space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold tracking-tight">
          Your free trial has ended
        </h1>
        <p class="text-muted-foreground">
          Subscribe to continue using SimpleTodo with all features.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle class="text-2xl">SimpleTodo Pro</CardTitle>
          <CardDescription>Everything you need to stay organized</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <div class="flex items-baseline gap-1">
            <span class="text-4xl font-bold">$5</span>
            <span class="text-muted-foreground">/month</span>
          </div>

          <ul class="space-y-2">
            <li
              v-for="feature in features"
              :key="feature"
              class="flex items-center gap-2 text-sm"
            >
              <CheckCircle class="h-4 w-4 text-green-500 shrink-0" />
              <span>{{ feature }}</span>
            </li>
          </ul>
        </CardContent>

        <CardFooter class="flex flex-col gap-3">
          <Button
            class="w-full"
            size="lg"
            :disabled="isLoading"
            @click="handleSubscribe"
          >
            {{ isLoading ? "Redirecting…" : "Subscribe Now" }}
          </Button>

          <!-- Show portal link if user had a previous subscription (past_due, etc.) -->
          <Button
            v-if="subscriptionStore.status === 'past_due' || subscriptionStore.status === 'expired'"
            variant="outline"
            class="w-full"
            :disabled="isLoading"
            @click="handleManageSubscription"
          >
            Update Payment Method
          </Button>

          <p v-if="error" class="text-sm text-destructive text-center">
            {{ error }}
          </p>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
