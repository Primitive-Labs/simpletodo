<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ListTodo, Plus } from "lucide-vue-next";
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
import { useMultiDocumentStore } from "@/stores/multiDocumentStore";
import { createList } from "@/lib/listOperations";

const COLLECTION_NAME = "todolists";

const router = useRouter();
const multiDocStore = useMultiDocumentStore();

const hasLists = computed(
  () => multiDocStore.getCollection(COLLECTION_NAME).length > 0
);

const showCreateDialog = ref(false);
const newListTitle = ref("");
const isCreating = ref(false);

function openCreateDialog(): void {
  newListTitle.value = "";
  showCreateDialog.value = true;
}

async function handleCreateList(): Promise<void> {
  const title = newListTitle.value.trim();
  if (!title || isCreating.value) return;

  isCreating.value = true;
  try {
    const { listId } = await createList(title);
    showCreateDialog.value = false;
    newListTitle.value = "";
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

function handleGoToLists(): void {
  router.push({ name: "manage-lists" });
}
</script>

<template>
  <div
    class="flex flex-col items-center justify-center h-full text-center px-4"
  >
    <div class="mb-8">
      <ListTodo class="h-16 w-16 text-muted-foreground mx-auto mb-4" />
      <h1 class="text-2xl font-semibold mb-2">Welcome to Simpletodo</h1>
      <p class="text-muted-foreground max-w-md">
        A simple, collaborative todo list app. Create a list to get started.
      </p>
    </div>

    <div class="flex flex-col gap-3">
      <Button size="lg" @click="openCreateDialog">
        <Plus class="h-4 w-4 mr-2" />
        Create a List
      </Button>

      <Button v-if="hasLists" variant="outline" @click="handleGoToLists">
        View Your Lists
      </Button>
    </div>
  </div>

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
