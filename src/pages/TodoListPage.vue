<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, Share2, Eye, EyeOff } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

const showShareDialog = ref(false);
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

// Update todoStore current list and save as last used
watch(
  listId,
  (id) => {
    todoStore.setCurrentList(id);
    // Save as last used list (fire and forget)
    todoStore.setLastUsedListId(id);
  },
  { immediate: true }
);

function handleBack(): void {
  router.push({ name: "home" });
}

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
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-2 pb-4 border-b">
      <Button variant="ghost" size="icon" @click="handleBack">
        <ArrowLeft class="h-4 w-4" />
      </Button>

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
          @click="showShareDialog = true"
        >
          <Share2 class="h-4 w-4" />
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
  </div>
</template>
