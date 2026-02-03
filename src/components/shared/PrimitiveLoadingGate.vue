<script setup lang="ts">
/**
 * Conditional rendering gate that delays showing a loading indicator until a configurable timeout.
 *
 * This prevents "flash of loading indicator" for fast loads: during the initial delay it
 * renders nothing, then shows the `loading` slot if still loading, otherwise
 * renders the default slot when ready.
 *
 * @slot default Content to render when `isReady` is true.
 * @slot loading Loading indicator content to render after `delayMs` while loading.
 */
import { computed, onUnmounted, ref, watch } from "vue";

interface Slots {
  /**
   * Content to render when `isReady` is true.
   */
  default?: () => unknown;
  /**
   * Loading indicator content to render after `delayMs` while loading.
   * Can be a skeleton, spinner, or any other loading state visualization.
   */
  loading?: () => unknown;
}

defineSlots<Slots>();

interface Props {
  /**
   * When true, renders the default slot. When false, begins the loading/gate flow.
   */
  isReady: boolean;
  /**
   * Milliseconds to wait before rendering the `loading` slot.
   * @default 50
   */
  delayMs?: number;
}

const props = withDefaults(defineProps<Props>(), {
  delayMs: 50,
});

const isLoading = computed(() => !props.isReady);
const loadingDelayExceeded = ref(false);
let timer: number | null = null;

const clearTimer = () => {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
};

watch(
  isLoading,
  (loading) => {
    if (loading) {
      clearTimer();
      timer = window.setTimeout(() => {
        loadingDelayExceeded.value = true;
      }, props.delayMs);
    } else {
      clearTimer();
      loadingDelayExceeded.value = false;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  clearTimer();
});

const isPendingDelay = computed(
  () => isLoading.value && !loadingDelayExceeded.value
);
const shouldRenderLoading = computed(
  () => isLoading.value && loadingDelayExceeded.value
);
</script>

<template>
  <template v-if="isPendingDelay">
    <!-- intentionally render nothing during delay -->
  </template>
  <template v-else-if="shouldRenderLoading">
    <slot name="loading" />
  </template>
  <template v-else>
    <slot />
  </template>
</template>
