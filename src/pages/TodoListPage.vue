<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Share2, Eye, EyeOff, Trash2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@vueuse/core";
import { jsBaoClientService } from "primitive-app";
import PrimitiveLoadingGate from "@/components/shared/PrimitiveLoadingGate.vue";
import PrimitiveShareDocumentDialog from "@/components/documents/PrimitiveShareDocumentDialog.vue";
import TodoInput from "@/components/todos/TodoInput.vue";
import TodoList from "@/components/todos/TodoList.vue";
import { useJsBaoDataLoader } from "@/composables/useJsBaoDataLoader";
import { useTodoStore } from "@/stores/todoStore";
import { TodoList as TodoListModel, TodoItem } from "@/models";

interface LoadedData {
  list: InstanceType<typeof TodoListModel> | null;
  items: InstanceType<typeof TodoItem>[];
  documentId: string | null;
}

const route = useRoute();
const router = useRouter();
const todoStore = useTodoStore();
const isMobile = useMediaQuery("(max-width: 640px)");

const showShareDialog = ref(false);
const showDeleteSheet = ref(false);
const isDeleting = ref(false);
const pauseUpdates = ref(false);

// URL template for share invitations - links to manage lists page where user can accept
const inviteUrlTemplate = `${window.location.origin}/lists`;

const listId = computed(() => route.params.listId as string);
const documentReady = computed(() => todoStore.isCollectionReady);

const { data, initialDataLoaded, reload } = useJsBaoDataLoader<
  LoadedData,
  { listId: string }
>({
  subscribeTo: [TodoListModel, TodoItem],
  queryParams: computed(() => ({
    listId: listId.value,
  })),
  documentReady,
  pauseUpdates,
  async loadData({ queryParams }) {
    if (!queryParams?.listId) {
      return { list: null, items: [], documentId: null };
    }

    const listResult = await TodoListModel.query({ id: queryParams.listId });
    const list = listResult.data[0] ?? null;

    if (!list) {
      return { list: null, items: [], documentId: null };
    }

    const documentId = list.getDocumentId();
    const showCompleted = list.showCompleted;

    const itemQuery = showCompleted
      ? { listId: queryParams.listId }
      : { listId: queryParams.listId, completed: false };

    const itemsResult = await TodoItem.query(itemQuery, { sort: { order: 1 } });

    return {
      list,
      items: itemsResult.data,
      documentId,
    };
  },
});

const currentList = computed(() => data.value?.list ?? null);
const currentItems = computed(() => data.value?.items ?? []);
const currentDocumentId = computed(() => data.value?.documentId ?? null);
const showCompleted = computed(() => currentList.value?.showCompleted ?? false);

const isReadOnly = computed(() => {
  if (!currentDocumentId.value) return true;
  const doc = todoStore.todoListDocuments.find(
    (d) => d.documentId === currentDocumentId.value
  );
  return doc?.permission === "reader";
});

const isOwner = computed(() => {
  if (!currentDocumentId.value) return false;
  const doc = todoStore.todoListDocuments.find(
    (d) => d.documentId === currentDocumentId.value
  );
  return doc?.permission === "owner";
});

// Redirect if list not found after loading
watch(
  [initialDataLoaded, currentList],
  ([loaded, list]) => {
    if (loaded && !list) {
      router.replace({ name: "home" });
    }
  },
  { immediate: true }
);

// Update todoStore current list
watch(
  listId,
  (id) => {
    todoStore.setCurrentList(id);
  },
  { immediate: true }
);

// Save as last used list when we have the document ID
watch(
  [initialDataLoaded, currentDocumentId, listId],
  ([loaded, docId, id]) => {
    if (loaded && docId && id) {
      todoStore.setLastUsedListId(id, docId);
    }
  }
);

async function handleAddTodo(text: string): Promise<void> {
  if (!currentList.value || !currentDocumentId.value) return;
  await todoStore.addTodo(currentList.value.id, text, currentDocumentId.value);
}

async function handleToggleComplete(itemId: string): Promise<void> {
  await todoStore.toggleTodoComplete(itemId);
}

async function handleDeleteTodo(itemId: string): Promise<void> {
  await todoStore.deleteTodo(itemId);
}

async function handleUpdateText(itemId: string, text: string): Promise<void> {
  await todoStore.updateTodoText(itemId, text);
}

async function handleReorder(itemIds: string[]): Promise<void> {
  pauseUpdates.value = true;
  try {
    await todoStore.reorderTodos(itemIds);
  } finally {
    pauseUpdates.value = false;
    reload();
  }
}

async function handleToggleShowCompleted(): Promise<void> {
  if (!currentList.value) return;
  await todoStore.toggleShowCompleted(currentList.value.id);
}

function isItemCompleting(itemId: string): boolean {
  return todoStore.isItemCompleting(itemId);
}

async function handleDeleteList(): Promise<void> {
  if (!currentDocumentId.value || isDeleting.value) return;

  isDeleting.value = true;
  try {
    const client = await jsBaoClientService.getClientAsync();
    const docId = currentDocumentId.value;
    // Close the document first, then delete it
    await client.documents.close(docId);
    await client.documents.delete(docId);
    showDeleteSheet.value = false;
    router.replace({ name: "home" });
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-2 pb-4 border-b">
      <div class="flex-1">
        <PrimitiveLoadingGate :is-ready="initialDataLoaded">
          <template #loading>
            <Skeleton class="h-6 w-48" />
          </template>

          <h1 class="text-xl font-semibold truncate">
            {{ currentList?.title ?? "Loading..." }}
          </h1>
        </PrimitiveLoadingGate>
      </div>

      <div class="flex items-center gap-1">
        <Button
          v-if="!isReadOnly"
          variant="ghost"
          size="icon"
          title="Share list"
          @click="showShareDialog = true"
        >
          <Share2 class="h-4 w-4" />
        </Button>

        <Button
          v-if="isOwner"
          variant="ghost"
          size="icon"
          class="text-destructive hover:text-destructive"
          title="Delete list"
          @click="showDeleteSheet = true"
        >
          <Trash2 class="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          :title="showCompleted ? 'Hide completed' : 'Show completed'"
          @click="handleToggleShowCompleted"
        >
          <component :is="showCompleted ? EyeOff : Eye" class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden py-4">
      <PrimitiveLoadingGate :is-ready="initialDataLoaded">
        <template #loading>
          <div class="space-y-3">
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
          </div>
        </template>

        <div class="flex flex-col h-full gap-4">
          <!-- Add Todo Input -->
          <TodoInput v-if="!isReadOnly" @add="handleAddTodo" />

          <!-- Todo List -->
          <TodoList
            :items="currentItems"
            :is-read-only="isReadOnly"
            :is-item-completing="isItemCompleting"
            :show-completed-section="showCompleted"
            @toggle-complete="handleToggleComplete"
            @delete="handleDeleteTodo"
            @reorder="handleReorder"
            @update-text="handleUpdateText"
          />
        </div>
      </PrimitiveLoadingGate>
    </div>

    <!-- Share Dialog -->
    <PrimitiveShareDocumentDialog
      :is-open="showShareDialog"
      :document-id="currentDocumentId"
      :document-label="currentList?.title ?? 'List'"
      :invite-url-template="inviteUrlTemplate"
      @close="showShareDialog = false"
    />

    <!-- Delete Confirmation Dialog (desktop) -->
    <Dialog
      v-if="!isMobile"
      :open="showDeleteSheet"
      @update:open="(val) => !val && !isDeleting && (showDeleteSheet = false)"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete List</DialogTitle>
        </DialogHeader>
        <div class="space-y-2">
          <p>Are you sure you want to delete "{{ currentList?.title }}"?</p>
          <p class="text-sm text-destructive">
            Warning: This will permanently delete the list and all its items.
            This action cannot be undone.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="isDeleting"
            @click="!isDeleting && (showDeleteSheet = false)"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            :disabled="isDeleting"
            @click="handleDeleteList"
          >
            {{ isDeleting ? "Deleting..." : "Delete List" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirmation Sheet (mobile) -->
    <Sheet
      v-if="isMobile"
      :open="showDeleteSheet"
      @update:open="(val) => !val && !isDeleting && (showDeleteSheet = false)"
    >
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Delete List</SheetTitle>
        </SheetHeader>
        <div class="px-4 py-4 space-y-2">
          <p>Are you sure you want to delete "{{ currentList?.title }}"?</p>
          <p class="text-sm text-destructive">
            Warning: This will permanently delete the list and all its items.
            This action cannot be undone.
          </p>
        </div>
        <SheetFooter class="flex-col gap-2 sm:flex-col px-4">
          <Button
            variant="destructive"
            class="w-full"
            :disabled="isDeleting"
            @click="handleDeleteList"
          >
            {{ isDeleting ? "Deleting..." : "Delete List" }}
          </Button>
          <Button
            variant="outline"
            class="w-full"
            :disabled="isDeleting"
            @click="showDeleteSheet = false"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
