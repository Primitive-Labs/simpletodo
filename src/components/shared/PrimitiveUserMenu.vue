<script setup lang="ts">
/**
 * User menu component for sidebar footer.
 * Displays user avatar, name, email with a dropdown menu.
 * All data is passed via props - no store dependencies.
 *
 * Designed to be used in SidebarFooter but flexible enough for other contexts.
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown } from "lucide-vue-next";
import type { Component } from "vue";

export interface UserMenuUserInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface UserMenuItem {
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
  user: UserMenuUserInfo;
  /** Whether the user is online */
  isOnline?: boolean;
  /** Menu items to display in the dropdown */
  menuItems?: UserMenuItem[];
  /** Side to display the dropdown menu (for sidebar context) */
  menuSide?: "top" | "bottom" | "left" | "right";
}

interface Emits {
  /** Emitted when a menu item is clicked (for items without 'to' prop) */
  (e: "menu-item-click", itemId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  isOnline: true,
  menuItems: () => [],
  menuSide: "right",
});

const emit = defineEmits<Emits>();

function handleMenuItemClick(item: UserMenuItem): void {
  if (!item.to) {
    emit("menu-item-click", item.id);
  }
}

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
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        class="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      >
        <Avatar class="h-8 w-8 rounded-lg">
          <AvatarImage
            :src="props.user.avatarUrl || ''"
            :alt="props.user.name || 'User'"
          />
          <AvatarFallback class="rounded-lg">
            {{ getUserInitials(props.user.name) }}
          </AvatarFallback>
        </Avatar>
        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-medium">{{
            props.user.name || "User"
          }}</span>
          <span class="truncate text-xs text-muted-foreground">{{
            props.user.email || ""
          }}</span>
        </div>
        <ChevronsUpDown class="ml-auto size-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
      :side="props.menuSide"
      align="end"
      :side-offset="4"
    >
      <DropdownMenuLabel class="p-0 font-normal">
        <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar class="h-8 w-8 rounded-lg">
            <AvatarImage
              :src="props.user.avatarUrl || ''"
              :alt="props.user.name || 'User'"
            />
            <AvatarFallback class="rounded-lg">
              {{ getUserInitials(props.user.name) }}
            </AvatarFallback>
          </Avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-medium">{{
              props.user.name || "User"
            }}</span>
            <span class="truncate text-xs text-muted-foreground">{{
              props.user.email || ""
            }}</span>
          </div>
          <!-- Online/offline indicator -->
          <span
            :class="
              props.isOnline
                ? 'ml-1 h-2 w-2 rounded-full bg-green-500'
                : 'ml-1 h-2 w-2 rounded-full bg-red-500'
            "
            :aria-label="props.isOnline ? 'Online' : 'Offline'"
          />
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <template v-for="item in props.menuItems" :key="item.id">
        <DropdownMenuItem v-if="item.to" as-child>
          <RouterLink :to="item.to" class="flex items-center">
            <component :is="item.icon" class="mr-2 h-4 w-4" />
            {{ item.label }}
          </RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem v-else @click="handleMenuItemClick(item)">
          <component :is="item.icon" class="mr-2 h-4 w-4" />
          {{ item.label }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
