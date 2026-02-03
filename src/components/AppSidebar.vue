<script setup lang="ts">
/**
 * Application sidebar component with collapsible support.
 *
 * Features:
 * - App name/icon header at the top
 * - Navigation items
 * - User menu at the bottom with dropdown
 * - Collapsible rail for desktop
 *
 * Apps can customize navigation items, menu actions, and styling.
 */
import primitiveLogoIcon from "@/assets/primitive-logo.png";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Bug, Home, Key, LogOut, Pencil } from "lucide-vue-next";
import PrimitiveUserMenu, {
  type UserMenuItem,
} from "@/components/shared/PrimitiveUserMenu.vue";
import { useUserStore } from "@/stores/userStore";
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";

interface Props {
  /**
   * Whether this sidebar is rendered in mobile mode (inside a sheet).
   * When true, disables collapsible behavior.
   */
  mobile?: boolean;
}

interface Emits {
  (e: "navigate"): void;
  (e: "open-edit-profile"): void;
  (e: "open-passkey-management"): void;
}

const props = withDefaults(defineProps<Props>(), {
  mobile: false,
});
const emit = defineEmits<Emits>();

const userStore = useUserStore();
const route = useRoute();
const { isMobile } = useSidebar();

// Navigation items - customize this for your app
const navItems = [{ name: "home", label: "Home", icon: Home, path: "/" }];

// Secondary navigation items (shown at bottom, desktop only, admin only)
const secondaryNavItems = [
  {
    name: "debug",
    label: "Debug Suite (Admin only)",
    icon: Bug,
    path: "/debug",
  },
];

// User menu items - customize this for your app
const userMenuItems = computed<UserMenuItem[]>(() => [
  { id: "edit-profile", label: "Edit Profile", icon: Pencil },
  { id: "manage-passkeys", label: "Manage Passkeys", icon: Key },
  { id: "logout", label: "Log out", icon: LogOut, to: "/logout" },
]);

function handleNavClick(): void {
  emit("navigate");
}

function handleUserMenuItemClick(itemId: string): void {
  if (itemId === "edit-profile") {
    emit("open-edit-profile");
  } else if (itemId === "manage-passkeys") {
    emit("open-passkey-management");
  }
}
</script>

<template>
  <!-- Sidebar component for both mobile and desktop -->
  <Sidebar :collapsible="props.mobile ? 'none' : 'icon'">
    <!-- App header -->
    <SidebarHeader>
      <div class="pt-1 px-1">
        <div class="flex w-full items-center gap-2 rounded-md p-2">
          <img
            :src="primitiveLogoIcon"
            alt="App Icon"
            class="size-5 shrink-0"
          />
          <span
            class="flex-1 text-left text-base font-medium leading-tight truncate"
          >
            Template App
          </span>
        </div>
      </div>
    </SidebarHeader>

    <!-- Navigation -->
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in navItems" :key="item.name">
              <SidebarMenuButton as-child :is-active="route.path === item.path">
                <RouterLink :to="item.path" @click="handleNavClick">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Spacer to push secondary nav to bottom -->
      <div class="flex-1" />

      <!-- Secondary navigation (desktop only, admin only) -->
      <SidebarGroup v-if="!props.mobile && userStore.isAdmin">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in secondaryNavItems" :key="item.name">
              <SidebarMenuButton as-child :is-active="route.path === item.path">
                <RouterLink :to="item.path" @click="handleNavClick">
                  <component :is="item.icon" />
                  <span>{{ item.label }}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <!-- User menu at bottom -->
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <PrimitiveUserMenu
            v-if="userStore.currentUser"
            :user="{
              name: userStore.currentUser.name,
              email: userStore.currentUser.email,
              avatarUrl: userStore.currentUser.avatarUrl,
            }"
            :is-online="userStore.isOnline"
            :menu-items="userMenuItems"
            :menu-side="isMobile ? 'bottom' : 'right'"
            @menu-item-click="handleUserMenuItemClick"
          />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <!-- Rail for collapse/expand toggle (desktop only) -->
    <SidebarRail v-if="!props.mobile" />
  </Sidebar>
</template>
