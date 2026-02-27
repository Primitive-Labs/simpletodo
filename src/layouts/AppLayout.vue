<script setup lang="ts">
/**
 * Main application layout with collapsible sidebar navigation.
 *
 * Features:
 * - Desktop: Collapsible sidebar that can minimize to icons
 * - Mobile: Bottom tab bar navigation
 * - Service worker disconnect banner
 *
 * This layout demonstrates a simple responsive pattern that apps can customize.
 */
import AppSidebar from "@/components/AppSidebar.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMediaQuery } from "@vueuse/core";
import {
  Key,
  User,
  Search,
  ListTodo,
  CheckSquare,
  LogOut,
} from "lucide-vue-next";
import EditProfile from "@/components/auth/EditProfile.vue";
import PasskeyManagement from "@/components/auth/PasskeyManagement.vue";
import PrimitiveMobileTabBar, {
  type TabBarItem,
} from "@/components/shared/PrimitiveMobileTabBar.vue";
import PrimitiveUserTabItem, {
  type UserTabMenuItem,
  type UserTabUserInfo,
} from "@/components/shared/PrimitiveUserTabItem.vue";
import { useJsBaoDocumentsStore } from "@/stores/jsBaoDocumentsStore";
import { useUserStore } from "@/stores/userStore";
import { useMultiDocumentStore } from "@/stores/multiDocumentStore";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ scope: "AppLayout" });
const COLLECTION_NAME = "todolists";
const COLLECTION_TAG = "todolist";

const isMobile = useMediaQuery("(max-width: 768px)");

// Stores
const documentsStore = useJsBaoDocumentsStore();
const userStore = useUserStore();
const multiDocStore = useMultiDocumentStore();

// Mobile nav items
const mobileNavItems = computed<TabBarItem[]>(() => {
  const items: TabBarItem[] = [];

  items.push({
    name: "home",
    label: "Home",
    icon: ListTodo,
    path: "/",
  });
  items.push({
    name: "search",
    label: "Search",
    icon: Search,
    path: "/search",
  });
  items.push({
    name: "lists",
    label: "Lists",
    icon: CheckSquare,
    path: "/lists",
    badge: documentsStore.pendingInvitationCount,
  });

  return items;
});

// Initialize multiDocStore and register collection when authenticated
watch(
  () => userStore.isAuthenticated,
  async (isAuthenticated) => {
    if (isAuthenticated) {
      logger.debug("User authenticated, initializing todolist collection");
      await multiDocStore.initialize();
      if (!multiDocStore.isCollectionRegistered(COLLECTION_NAME)) {
        await multiDocStore.registerCollection({
          name: COLLECTION_NAME,
          tag: COLLECTION_TAG,
          autoOpen: true,
          autoAcceptInvites: false,
        });
        logger.debug("Todolist collection registered");
      }
    }
  },
  { immediate: true }
);

const mobileUserInfo = computed<UserTabUserInfo>(() => ({
  name: userStore.currentUser?.name ?? "User",
  email: userStore.currentUser?.email ?? "",
  avatarUrl: userStore.currentUser?.avatarUrl ?? undefined,
}));

const mobileMenuItems: UserTabMenuItem[] = [
  { id: "edit-profile", label: "Edit Profile", icon: User },
  { id: "passkey-management", label: "Manage Passkeys", icon: Key },
  { id: "logout", label: "Log Out", icon: LogOut },
];

function handleMobileMenuItemClick(itemId: string): void {
  if (itemId === "edit-profile") {
    handleOpenEditProfile();
  } else if (itemId === "passkey-management") {
    handleOpenPasskeyManagement();
  } else if (itemId === "logout") {
    userStore.logout();
  }
}

// Dialog state for desktop sidebar user menu
const editProfileOpen = ref(false);
const passkeyDialogOpen = ref(false);

function handleOpenEditProfile(): void {
  editProfileOpen.value = true;
}

function handleOpenPasskeyManagement(): void {
  passkeyDialogOpen.value = true;
}

// Service worker disconnect detection
const swDisconnected = ref(false);
let removeListener: (() => void) | null = null;

function handleRefresh(): void {
  try {
    window.location.reload();
  } catch {}
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Enter" || e.key === " ") handleRefresh();
}

onMounted(() => {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      swDisconnected.value = false;
      return;
    }
    swDisconnected.value = !navigator.serviceWorker.controller;
    const onControllerChange = () => {
      try {
        swDisconnected.value = !navigator.serviceWorker.controller;
      } catch {}
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );
    removeListener = () =>
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
  } catch {}
});

onBeforeUnmount(() => {
  try {
    if (removeListener) {
      removeListener();
    }
  } catch {}
});
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Service worker disconnect banner -->
    <div
      v-if="swDisconnected"
      class="fixed top-0 left-0 right-0 z-50 w-full bg-red-600 text-white border-b border-red-700 px-4 py-2 cursor-pointer flex items-center justify-center text-center"
      role="button"
      tabindex="0"
      @click="handleRefresh"
      @keydown="onKeyDown"
    >
      Update required: Click to refresh
    </div>

    <div :class="{ 'pt-10': swDisconnected }">
      <!-- Desktop: Collapsible sidebar with SidebarProvider -->
      <SidebarProvider v-if="!isMobile">
        <AppSidebar
          :class="{ 'pt-10': swDisconnected }"
          @open-edit-profile="handleOpenEditProfile"
          @open-passkey-management="handleOpenPasskeyManagement"
        />
        <SidebarInset>
          <!-- Main content area -->
          <div class="flex flex-1 flex-col gap-4 p-4">
            <slot>
              <router-view />
            </slot>
          </div>
        </SidebarInset>
      </SidebarProvider>

      <!-- Mobile: Bottom tab bar navigation -->
      <template v-else>
        <!-- Main content area for mobile (with bottom padding for tab bar) -->
        <main class="flex-1 p-4 pb-20">
          <slot>
            <router-view />
          </slot>
        </main>

        <PrimitiveMobileTabBar :items="mobileNavItems">
          <template #trailing>
            <PrimitiveUserTabItem
              :user="mobileUserInfo"
              :is-online="userStore.isOnline"
              :menu-items="mobileMenuItems"
              @menu-item-click="handleMobileMenuItemClick"
            />
          </template>
        </PrimitiveMobileTabBar>
      </template>
    </div>

    <!-- Dialogs rendered outside the navigation sheet to avoid focus trap conflicts -->
    <EditProfile v-model:open="editProfileOpen" />
    <PasskeyManagement v-model:open="passkeyDialogOpen" />
  </div>
</template>
