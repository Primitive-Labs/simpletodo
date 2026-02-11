<script setup lang="ts">
/**
 * Dismissible banner shown at the top of the app during the trial period.
 * Displays remaining days and a CTA to subscribe.
 */
import { Button } from "@/components/ui/button";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { X } from "lucide-vue-next";
import { ref } from "vue";

const subscriptionStore = useSubscriptionStore();

const dismissed = ref(false);
const isLoading = ref(false);

async function handleSubscribe(): Promise<void> {
  isLoading.value = true;
  try {
    await subscriptionStore.redirectToCheckout();
  } catch {
    isLoading.value = false;
  }
}
</script>

<template>
  <div
    v-if="subscriptionStore.shouldShowTrialBanner && !dismissed"
    class="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-center gap-3 text-sm"
  >
    <span class="text-foreground">
      <template v-if="subscriptionStore.trialDaysLeft === 1">
        Your free trial ends <strong>tomorrow</strong>.
      </template>
      <template v-else>
        <strong>{{ subscriptionStore.trialDaysLeft }} days</strong> left in your
        free trial.
      </template>
    </span>

    <Button
      size="sm"
      variant="default"
      :disabled="isLoading"
      @click="handleSubscribe"
    >
      {{ isLoading ? "…" : "Subscribe" }}
    </Button>

    <button
      class="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Dismiss trial banner"
      @click="dismissed = true"
    >
      <X class="h-4 w-4" />
    </button>
  </div>
</template>
