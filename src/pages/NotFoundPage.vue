<script setup lang="ts">
/**
 * 404 page shown when no route matches the current location.
 *
 * Displays a friendly message and a link back to the specified home route.
 */
import Card from "@/components/ui/card/Card.vue";
import CardContent from "@/components/ui/card/CardContent.vue";
import type { Component } from "vue";
import { computed } from "vue";
import { RouterLink, useRouter } from "vue-router";

interface Props {
  /**
   * Named route to navigate to when clicking "Back to Safety".
   * @default "home"
   */
  homeRouteName?: string;
  /**
   * Optional icon component to display on the 404 page.
   */
  appIcon?: Component;
}

const props = withDefaults(defineProps<Props>(), {
  homeRouteName: "home",
});

const router = useRouter();

const homeHref = computed(() => {
  try {
    return router.resolve({ name: props.homeRouteName }).href;
  } catch {
    return "/";
  }
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-white">
    <div class="max-w-6xl w-full mx-auto px-4">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        <!-- Left Panel - Text and Call to Action -->
        <div class="space-y-6">
          <div class="space-y-4">
            <h1
              class="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight"
            >
              Oops! Page not found.
            </h1>
            <p class="text-lg text-gray-600 leading-relaxed">
              The page you're looking for doesn't exist or has been moved. Let's
              get you back on track.
            </p>
          </div>
          <RouterLink
            :to="homeHref"
            class="inline-block bg-gray-800 hover:bg-gray-900 text-white px-8 py-3 text-lg rounded-lg transition-colors"
          >
            Back to Safety
          </RouterLink>
        </div>

        <!-- Right Panel - Visual with Logo -->
        <div class="flex justify-center lg:justify-end">
          <Card class="w-full max-w-md bg-gray-50 border-0 shadow-none">
            <CardContent
              class="p-8 flex flex-col items-center justify-center min-h-[400px]"
            >
              <component
                v-if="props.appIcon"
                :is="props.appIcon"
                class="w-32 h-32"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  </div>
</template>
