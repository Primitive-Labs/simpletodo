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
import TrialBanner from "@/components/shared/TrialBanner.vue";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMediaQuery } from "@vueuse/core";
import { Key, User, Search, ListTodo, CheckSquare, LogOut } from "lucide-vue-next";
import EditProfile from "@/components/auth/EditProfile.vue";
import PasskeyManagement from "@/components/auth/PasskeyManagement.vue";
import PrimitiveMobileTabBar, {
  type TabBarItem,
} from "@/components/shared/PrimitiveMobileTabBar.vue";
import PrimitiveUserTabItem, {
  type UserTabMenuItem,
  type UserTabUserInfo,
} from "@/components/shared/PrimitiveUserTabItem.vue";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUserStore } from "@/stores/userStore";
import { useTodoStore } from "@/stores/todoStore";
import { TodoList } from "@/models";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useJsBaoDataLoader } from "@/composables/useJsBaoDataLoader";
import { useRouter, useRoute } from "vue-router";

const isMobile = useMediaQuery("(max-width: 768px)");
const router = useRouter();
const route = useRoute();

// User store for mobile user menu
const userStore = useUserStore();
const todoStore = useTodoStore();
const subscriptionStore = useSubscriptionStore();

// Load recent lists for mobile navigation
const documentReady = computed(() => todoStore.isCollectionReady);
const recentListIds = computed(() => todoStore.getRecentListIds());

interface RecentListData {
  lists: Array<{ id: string; title: string }>;
}

const { data: recentListsData } = useJsBaoDataLoader<
  RecentListData,
  { listIds: string[] }
>({
  subscribeTo: [TodoList],
  queryParams: computed(() => ({
    listIds: recentListIds.value,
  })),
  documentReady,
  async loadData({ queryParams }) {
    const listIds = queryParams?.listIds ?? [];
    if (listIds.length === 0) {
      return { lists: [] };
    }

    const result = await TodoList.query({ id: { $in: listIds } });
    // Preserve order from recentListIds
    const listsById = new Map(result.data.map((l) => [l.id, l]));
    const lists = listIds
      .map((id) => {
        const list = listsById.get(id);
        return list ? { id: list.id, title: list.title } : null;
      })
      .filter((l): l is { id: string; title: string } => l !== null);

    return { lists };
  },
});

// Dynamic mobile nav items with recent lists
const mobileNavItems = computed<TabBarItem[]>(() => {
  const items: TabBarItem[] = [];

  // Add the most recently used list
  const recentLists = recentListsData.value?.lists ?? [];
  for (const list of recentLists.slice(0, 1)) {
    items.push({
      name: `list-${list.id}`,
      label: list.title.length > 10 ? list.title.slice(0, 9) + "…" : list.title,
      icon: CheckSquare,
      path: `/list/${list.id}`,
    });
  }

  // Always show Search and Lists
  items.push({ name: "search", label: "Search", icon: Search, path: "/search" });
  items.push({ name: "lists", label: "Lists", icon: ListTodo, path: "/lists" });

  return items;
});

// Initialize todoStore and check subscription when authenticated
watch(
  () => userStore.isAuthenticated,
  (isAuthenticated) => {
    if (isAuthenticated) {
      todoStore.initialize();
      subscriptionStore.checkStatus();
    } else {
      todoStore.reset();
      subscriptionStore.reset();
    }
  },
  { immediate: true }
);

// Redirect to subscribe page when subscription expires (handles async check completion)
watch(
  () => subscriptionStore.shouldShowPaywall,
  (shouldShowPaywall) => {
    if (shouldShowPaywall && route.name !== "subscribe") {
      router.replace({ name: "subscribe" });
    }
  }
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
  // Handle return from Stripe Checkout: clean URL and re-check subscription
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("checkout")) {
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.toString());

    if (searchParams.get("checkout") === "success") {
      // Give the webhook a moment to process before re-checking
      setTimeout(() => subscriptionStore.checkStatus(), 2000);
    }
  }

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

    <!-- Trial countdown banner -->
    <TrialBanner />

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
