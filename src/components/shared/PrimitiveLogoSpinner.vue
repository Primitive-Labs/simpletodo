<script setup lang="ts">
import logoUrl from "@/assets/primitive-logo-large.png";

/**
 * Full-screen loading overlay that shows a spinning Primitive logo.
 *
 * Commonly used as the fallback UI while auth flows or boot-time async work runs.
 */

interface Props {
  /**
   * Optional extra class(es) applied to the full-screen overlay container.
   */
  className?: string;
  /**
   * Size of the logo image in pixels.
   * @default 128
   */
  size?: number;
}

const props = withDefaults(defineProps<Props>(), {
  size: 128,
});
</script>

<template>
  <div
    :class="[
      'fixed inset-0 z-50 flex items-center justify-center bg-white',
      props.className,
    ]"
  >
    <img
      :src="logoUrl"
      alt="Primitive Logo"
      :width="props.size"
      :height="props.size"
      class="animate-spin"
      style="transform-origin: center center"
    />
  </div>
</template>
