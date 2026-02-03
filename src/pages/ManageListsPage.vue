<script setup lang="ts">
import { useRouter } from "vue-router";
import { ArrowLeft } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import PrimitiveDocumentList from "@/components/documents/PrimitiveDocumentList.vue";
import { TodoList } from "@/models";

const router = useRouter();

function handleBack(): void {
  router.back();
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
      <Button variant="ghost" size="icon" @click="handleBack">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <h1 class="text-xl font-semibold">Manage Lists</h1>
    </div>

    <!-- Document List -->
    <PrimitiveDocumentList
      document-name="List"
      :filter-tags="['todolist']"
      :current-document-id="null"
      @document-click="handleDocumentClick"
      @invitation-accepted="handleInvitationAccepted"
    />
  </div>
</template>
