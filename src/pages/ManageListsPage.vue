<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Plus } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import PrimitiveDocumentList from "@/components/documents/PrimitiveDocumentList.vue";
import { TodoList } from "@/models";
import { useTodoStore } from "@/stores/todoStore";

const router = useRouter();
const todoStore = useTodoStore();

// Create list state
const showCreateSheet = ref(false);
const newListTitle = ref("");
const isCreating = ref(false);

async function handleCreateList(): Promise<void> {
  const title = newListTitle.value.trim();
  if (!title || isCreating.value) return;

  isCreating.value = true;
  try {
    const listId = await todoStore.createTodoList(title);
    showCreateSheet.value = false;
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

async function handleDocumentClick(documentId: string): Promise<void> {
  // Find the TodoList model in this document and navigate to it
  const result = await TodoList.query({}, { documents: documentId });
  const list = result.data[0];
  if (list) {
    router.push({ name: "todo-list", params: { listId: list.id } });
  }
}

async function handleInvitationAccepted(documentId: string): Promise<void> {
  // After accepting, navigate to the list
  // Wait briefly for the document to be opened and synced
  await new Promise((resolve) => setTimeout(resolve, 500));
  const result = await TodoList.query({}, { documents: documentId });
  const list = result.data[0];
  if (list) {
    router.push({ name: "todo-list", params: { listId: list.id } });
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <h1 class="text-xl font-semibold flex-1">Manage Lists</h1>
      <Button variant="ghost" size="icon" @click="showCreateSheet = true">
        <Plus class="h-4 w-4" />
      </Button>
    </div>

    <!-- Document List -->
    <PrimitiveDocumentList
      document-name="List"
      :filter-tags="['todolist']"
      :current-document-id="null"
      @document-click="handleDocumentClick"
      @invitation-accepted="handleInvitationAccepted"
    />

    <!-- Create List Sheet (mobile-friendly) -->
    <Sheet v-model:open="showCreateSheet">
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Create New List</SheetTitle>
        </SheetHeader>
        <div class="px-4 py-4">
          <Input
            v-model="newListTitle"
            placeholder="List name..."
            :disabled="isCreating"
            @keydown="handleKeyDown"
          />
        </div>
        <SheetFooter class="flex-col gap-2 sm:flex-col px-4">
          <Button
            class="w-full"
            :disabled="!newListTitle.trim() || isCreating"
            @click="handleCreateList"
          >
            {{ isCreating ? "Creating..." : "Create List" }}
          </Button>
          <Button
            variant="outline"
            class="w-full"
            :disabled="isCreating"
            @click="showCreateSheet = false"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </div>
</template>
