<script setup lang="ts">
/**
 * Application sidebar component with collapsible support.
 *
 * Features:
 * - App name/icon header at the top
 * - Todo lists navigation with create button
 * - Search navigation
 * - User menu at the bottom with dropdown
 * - Collapsible rail for desktop
 */
import primitiveLogoIcon from "@/assets/primitive-logo.png";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Bug,
  Key,
  LogOut,
  Pencil,
  Search,
  ListTodo,
  Plus,
  Settings,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PrimitiveUserMenu, {
  type UserMenuItem,
} from "@/components/shared/PrimitiveUserMenu.vue";
import { useUserStore } from "@/stores/userStore";
import { useTodoStore } from "@/stores/todoStore";
import { useJsBaoDataLoader } from "@/composables/useJsBaoDataLoader";
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { TodoList } from "@/models";

interface ListItem {
  id: string;
  title: string;
}

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
const todoStore = useTodoStore();
const route = useRoute();
const router = useRouter();
const { isMobile } = useSidebar();

const showCreateDialog = ref(false);
const newListTitle = ref("");
const isCreating = ref(false);

const documentReady = computed(() => todoStore.isCollectionReady);

// Load todo lists for sidebar navigation
const { data: listsData } = useJsBaoDataLoader<{ lists: ListItem[] }>({
  subscribeTo: [TodoList],
  queryParams: computed(() => ({})),
  documentReady,
  async loadData() {
    const result = await TodoList.query({}, { sort: { createdAt: -1 } });
    return {
      lists: result.data.map((list) => ({
        id: list.id,
        title: list.title,
      })),
    };
  },
});

const todoLists = computed(() => listsData.value?.lists ?? []);

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

function openCreateDialog(): void {
  newListTitle.value = "";
  showCreateDialog.value = true;
}

async function handleCreateList(): Promise<void> {
  const title = newListTitle.value.trim();
  if (!title || isCreating.value) return;

  isCreating.value = true;
  try {
    const listId = await todoStore.createTodoList(title);
    showCreateDialog.value = false;
    newListTitle.value = "";
    emit("navigate");
    router.push({ name: "todo-list", params: { listId } });
  } finally {
    isCreating.value = false;
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    handleCreateList();
  }
}

function isListActive(listId: string): boolean {
  return route.name === "todo-list" && route.params.listId === listId;
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
            Simpletodo
          </span>
        </div>
      </div>
    </SidebarHeader>

    <!-- Navigation -->
    <SidebarContent>
      <!-- Search -->
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton as-child :is-active="route.path === '/search'">
                <RouterLink to="/search" @click="handleNavClick">
                  <Search />
                  <span>Search</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Todo Lists -->
      <SidebarGroup>
        <SidebarGroupLabel class="flex items-center justify-between pr-2">
          <span>Lists</span>
          <Button
            variant="ghost"
            size="icon"
            class="h-5 w-5"
            @click="openCreateDialog"
          >
            <Plus class="h-3.5 w-3.5" />
          </Button>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="list in todoLists" :key="list.id">
              <SidebarMenuButton as-child :is-active="isListActive(list.id)">
                <RouterLink
                  :to="{ name: 'todo-list', params: { listId: list.id } }"
                  @click="handleNavClick"
                >
                  <ListTodo />
                  <span>{{ list.title }}</span>
                </RouterLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="todoLists.length === 0 && documentReady">
              <div class="px-2 py-1.5 text-xs text-muted-foreground">
                No lists yet
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <!-- Manage Lists Link -->
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton as-child :is-active="route.path === '/lists'">
                <RouterLink to="/lists" @click="handleNavClick">
                  <Settings />
                  <span>Manage Lists</span>
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

  <!-- Create List Dialog -->
  <Dialog v-model:open="showCreateDialog">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create New List</DialogTitle>
        <DialogDescription>
          Enter a name for your new todo list.
        </DialogDescription>
      </DialogHeader>
      <div class="py-4">
        <Input
          v-model="newListTitle"
          placeholder="List name..."
          :disabled="isCreating"
          @keydown="handleKeyDown"
        />
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="isCreating"
          @click="showCreateDialog = false"
        >
          Cancel
        </Button>
        <Button
          :disabled="!newListTitle.trim() || isCreating"
          @click="handleCreateList"
        >
          {{ isCreating ? "Creating..." : "Create" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
