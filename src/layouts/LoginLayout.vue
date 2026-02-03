<script setup lang="ts">
/**
 * Minimal centered layout for login/auth routes.
 *
 * Centers content vertically and horizontally with basic background styling.
 */
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="flex min-h-screen w-full items-center justify-center p-4">
      <slot>
        <router-view />
      </slot>
    </div>
  </div>
</template>
