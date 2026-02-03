<script setup lang="ts">
/**
 * Mobile bottom navigation tab bar.
 *
 * Fixed to the bottom of the viewport, provides icon + label navigation
 * links with active state highlighting.
 */
import type { Component } from "vue";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

/**
 * Navigation item configuration for the tab bar.
 */
export interface TabBarItem {
  /** Unique identifier for the item */
  name: string;
  /** Display label shown below the icon */
  label: string;
  /** Lucide icon component */
  icon: Component;
  /** Route path to navigate to */
  path: string;
}

interface Props {
  /**
   * Navigation items to display in the tab bar.
   */
  items: TabBarItem[];
}

defineProps<Props>();

const route = useRoute();

/**
 * Check if a path matches the current route.
 * Root path requires exact match, others use prefix matching.
 */
const isActiveRoute = computed(() => (path: string) => {
  if (path === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(path);
});
</script>

<template>
  <nav
    class="fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-sidebar-border"
  >
    <div class="flex items-center justify-around h-16 px-2">
      <RouterLink
        v-for="item in items"
        :key="item.name"
        :to="item.path"
        class="flex flex-col items-center justify-center flex-1 h-full py-2 transition-colors"
        :class="
          isActiveRoute(item.path)
            ? 'text-sidebar-primary'
            : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
        "
      >
        <component :is="item.icon" class="h-5 w-5" />
        <span class="text-xs mt-1">{{ item.label }}</span>
      </RouterLink>

      <!-- Optional trailing slot for custom content (e.g., user menu tab) -->
      <slot name="trailing" />
    </div>
  </nav>
</template>
