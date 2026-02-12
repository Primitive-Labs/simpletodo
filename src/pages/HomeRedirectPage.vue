<script setup lang="ts">
/**
 * Home redirect page that navigates users to their appropriate todo list.
 *
 * On load, this page:
 * 1. Waits for the documents store to be ready (document list loaded)
 * 2. Gets the startup list (opens only the needed document)
 * 3. Redirects to the appropriate list
 *
 * Note: We wait for documentsStore.isReady (document list loaded) rather than
 * todoStore.isCollectionReady (all documents opened) to minimize startup time.
 */
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { Skeleton } from "@/components/ui/skeleton";
import PrimitiveLoadingGate from "@/components/shared/PrimitiveLoadingGate.vue";
import { useJsBaoDocumentsStore } from "@/stores/jsBaoDocumentsStore";
import { useTodoStore } from "@/stores/todoStore";

const router = useRouter();
const documentsStore = useJsBaoDocumentsStore();
const todoStore = useTodoStore();

const isReady = computed(() => documentsStore.isReady);

// When documents store is ready, determine which list to navigate to
watch(
  isReady,
  async (ready) => {
    if (!ready) return;

    try {
      const listId = await todoStore.getStartupListId();
      router.replace({ name: "todo-list", params: { listId } });
    } catch (error) {
      console.error("Failed to get startup list:", error);
      // If all else fails, navigate to manage lists
      router.replace({ name: "manage-lists" });
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="flex items-center justify-center h-full">
    <PrimitiveLoadingGate :is-ready="false">
      <template #loading>
        <div class="space-y-4 w-full max-w-md">
          <Skeleton class="h-8 w-48 mx-auto" />
          <Skeleton class="h-4 w-32 mx-auto" />
        </div>
      </template>
    </PrimitiveLoadingGate>
  </div>
</template>
