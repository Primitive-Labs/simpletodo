<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { Search, ListTodo, Eye, EyeOff } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import PrimitiveLoadingGate from "@/components/shared/PrimitiveLoadingGate.vue";
import { useJsBaoDataLoader } from "@/composables/useJsBaoDataLoader";
import { useTodoStore } from "@/stores/todoStore";
import { TodoList, TodoItem } from "@/models";

interface SearchResult {
  item: InstanceType<typeof TodoItem>;
  listTitle: string;
  listId: string;
}

const router = useRouter();
const todoStore = useTodoStore();

const searchQuery = ref("");
const showCompleted = ref(false);
const documentReady = computed(() => todoStore.isCollectionReady);

const { data, initialDataLoaded } = useJsBaoDataLoader<
  { results: SearchResult[] },
  { query: string }
>({
  subscribeTo: [TodoList, TodoItem],
  queryParams: computed(() => ({
    query: searchQuery.value,
  })),
  documentReady,
  debounceMs: 300,
  async loadData({ queryParams }) {
    const query = queryParams?.query?.trim() ?? "";

    if (!query || query.length < 2) {
      return { results: [] };
    }

    // Search for items matching the query text
    // Don't filter by completed in the query - some items may have completed: undefined
    // instead of completed: false, so we filter in JavaScript afterward
    const itemsResult = await TodoItem.query({
      text: { $containsText: query },
    });

    // Enrich with list info
    const results: SearchResult[] = [];
    const listCache = new Map<string, InstanceType<typeof TodoList>>();

    for (const item of itemsResult.data) {
      let list = listCache.get(item.listId);
      if (!list) {
        const listResult = await TodoList.query({ id: item.listId });
        list = listResult.data[0];
        if (list) {
          listCache.set(item.listId, list);
        }
      }

      results.push({
        item,
        listTitle: list?.title ?? "Unknown List",
        listId: item.listId,
      });
    }

    return { results };
  },
});

const hasSearched = computed(() => searchQuery.value.trim().length >= 2);
const results = computed(() => data.value?.results ?? []);

const pendingResults = computed(() =>
  results.value.filter((r) => !(r.item.completed ?? false))
);

const completedResults = computed(() =>
  results.value.filter((r) => r.item.completed ?? false)
);

const resultCount = computed(() => {
  if (showCompleted.value) {
    return results.value.length;
  }
  return pendingResults.value.length;
});

function handleResultClick(listId: string): void {
  router.push({ name: "todo-list", params: { listId } });
}

function highlightMatch(text: string, query: string): string {
  if (!query) return text;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  return text.replace(
    regex,
    "<mark class='bg-yellow-200 dark:bg-yellow-800 rounded px-0.5'>$1</mark>"
  );
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <h1 class="text-xl font-semibold flex-1">Search</h1>
      <Button
        variant="ghost"
        size="icon"
        :title="showCompleted ? 'Hide completed' : 'Show completed'"
        @click="showCompleted = !showCompleted"
      >
        <component :is="showCompleted ? EyeOff : Eye" class="h-4 w-4" />
      </Button>
    </div>

    <!-- Search Input -->
    <div class="relative">
      <Search
        class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="searchQuery"
        placeholder="Search todos across all lists..."
        class="pl-10"
        autofocus
      />
    </div>

    <!-- Results -->
    <PrimitiveLoadingGate :is-ready="!hasSearched || initialDataLoaded">
      <template #loading>
        <div class="space-y-2">
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
          <Skeleton class="h-10 w-full" />
        </div>
      </template>

      <!-- Empty State -->
      <div v-if="!hasSearched" class="text-center py-12">
        <Search class="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p class="mt-4 text-sm text-muted-foreground">
          Enter at least 2 characters to search
        </p>
      </div>

      <div v-else-if="resultCount === 0" class="text-center py-12">
        <Search class="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p class="mt-4 text-sm text-muted-foreground">
          No todos found matching "{{ searchQuery }}"
        </p>
      </div>

      <!-- Results List -->
      <div v-else>
        <p class="text-sm text-muted-foreground mb-2">
          {{ resultCount }} result{{ resultCount === 1 ? "" : "s" }} found
        </p>

        <!-- Pending Results -->
        <div v-if="pendingResults.length > 0">
          <div
            v-for="result in pendingResults"
            :key="result.item.id"
            class="flex items-center gap-2 py-1.5 px-1 border-b border-border/40 cursor-pointer transition-colors hover:bg-muted/30"
            @click="handleResultClick(result.listId)"
          >
            <Checkbox :model-value="false" disabled class="shrink-0" />
            <span
              class="flex-1 text-sm min-w-0 truncate"
              v-html="highlightMatch(result.item.text, searchQuery)"
            />
            <Badge variant="outline" class="text-xs shrink-0">
              <ListTodo class="mr-1 h-3 w-3" />
              {{ result.listTitle }}
            </Badge>
          </div>
        </div>

        <!-- Completed Results Section -->
        <div v-if="showCompleted && completedResults.length > 0" class="mt-6">
          <h3
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1"
          >
            Completed ({{ completedResults.length }})
          </h3>
          <div class="opacity-60">
            <div
              v-for="result in completedResults"
              :key="result.item.id"
              class="flex items-center gap-2 py-1.5 px-1 border-b border-border/40 cursor-pointer transition-colors hover:bg-muted/30"
              @click="handleResultClick(result.listId)"
            >
              <Checkbox :model-value="true" disabled class="shrink-0" />
              <span
                class="flex-1 text-sm min-w-0 truncate line-through text-muted-foreground"
                v-html="highlightMatch(result.item.text, searchQuery)"
              />
              <Badge variant="outline" class="text-xs shrink-0">
                <ListTodo class="mr-1 h-3 w-3" />
                {{ result.listTitle }}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </PrimitiveLoadingGate>
  </div>
</template>
