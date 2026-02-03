<script setup lang="ts">
/**
 * Mobile user menu tab for the bottom navigation bar.
 *
 * Displays the user's avatar as a tab item. When clicked, opens a
 * bottom sheet with user info and menu actions.
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Component } from "vue";
import { ref } from "vue";
import { RouterLink } from "vue-router";

/**
 * User information to display.
 */
export interface UserTabUserInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Menu item configuration.
 */
export interface UserTabMenuItem {
  /** Unique identifier for the menu item */
  id: string;
  /** Display label */
  label: string;
  /** Lucide icon component */
  icon: Component;
  /** If provided, renders as a RouterLink to this path */
  to?: string;
}

interface Props {
  /** User information to display */
  user: UserTabUserInfo;
  /** Whether the user is online */
  isOnline?: boolean;
  /** Menu items to display in the sheet */
  menuItems?: UserTabMenuItem[];
}

interface Emits {
  /** Emitted when a menu item is clicked (for items without 'to' prop) */
  (e: "menu-item-click", itemId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  isOnline: true,
  menuItems: () => [],
});

const emit = defineEmits<Emits>();

const sheetOpen = ref(false);

function getUserInitials(name: string | undefined | null): string {
  if (!name) return "U";
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

async function handleMenuItemClick(item: UserTabMenuItem): Promise<void> {
  sheetOpen.value = false;
  if (!item.to) {
    // Wait for the sheet close animation (300ms) to complete before emitting
    // to avoid focus trap conflicts with the next dialog
    await new Promise((resolve) => setTimeout(resolve, 350));
    // Ensure body styles are reset (Reka UI cleanup can be delayed)
    document.body.style.pointerEvents = "";
    document.body.style.overflow = "";
    emit("menu-item-click", item.id);
  }
}

function handleLinkClick(): void {
  sheetOpen.value = false;
}
</script>

<template>
  <!-- Tab button showing avatar -->
  <button
    type="button"
    class="flex flex-col items-center justify-center flex-1 h-full py-2 transition-colors text-sidebar-foreground/60 hover:text-sidebar-foreground"
    @click="sheetOpen = true"
  >
    <Avatar class="h-5 w-5">
      <AvatarImage
        :src="props.user.avatarUrl || ''"
        :alt="props.user.name || 'User'"
      />
      <AvatarFallback class="text-[10px]">
        {{ getUserInitials(props.user.name) }}
      </AvatarFallback>
    </Avatar>
    <span class="text-xs mt-1">Account</span>
  </button>

  <!-- Bottom sheet with user menu -->
  <Sheet v-model:open="sheetOpen">
    <SheetContent side="bottom">
      <SheetHeader class="text-left">
        <SheetTitle class="sr-only">User Menu</SheetTitle>
        <!-- User info header -->
        <div class="flex items-center gap-3 pb-4">
          <Avatar class="h-12 w-12">
            <AvatarImage
              :src="props.user.avatarUrl || ''"
              :alt="props.user.name || 'User'"
            />
            <AvatarFallback>
              {{ getUserInitials(props.user.name) }}
            </AvatarFallback>
          </Avatar>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{
                props.user.name || "User"
              }}</span>
              <span
                :class="
                  props.isOnline
                    ? 'h-2 w-2 rounded-full bg-green-500 shrink-0'
                    : 'h-2 w-2 rounded-full bg-red-500 shrink-0'
                "
                :aria-label="props.isOnline ? 'Online' : 'Offline'"
              />
            </div>
            <span class="text-sm text-muted-foreground truncate block">
              {{ props.user.email || "" }}
            </span>
          </div>
        </div>
      </SheetHeader>

      <!-- Menu items -->
      <div class="flex flex-col gap-1">
        <template v-for="item in props.menuItems" :key="item.id">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-accent transition-colors"
            @click="handleLinkClick"
          >
            <component :is="item.icon" class="h-5 w-5 text-muted-foreground" />
            <span>{{ item.label }}</span>
          </RouterLink>
          <button
            v-else
            type="button"
            class="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-accent transition-colors w-full text-left"
            @click="handleMenuItemClick(item)"
          >
            <component :is="item.icon" class="h-5 w-5 text-muted-foreground" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>
    </SheetContent>
  </Sheet>
</template>
