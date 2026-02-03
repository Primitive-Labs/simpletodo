<script setup lang="ts">
import { computed, ref } from "vue";
import { CheckCircle2 } from "lucide-vue-next";
import TodoItem from "./TodoItem.vue";
import type { TodoItem as TodoItemModel } from "@/models";

const props = defineProps<{
  items: InstanceType<typeof TodoItemModel>[];
  isReadOnly: boolean;
  isItemCompleting: (id: string) => boolean;
  showCompletedSection?: boolean;
}>();

const emit = defineEmits<{
  toggleComplete: [id: string];
  delete: [id: string];
  reorder: [ids: string[]];
  updateText: [id: string, text: string];
}>();

const draggedId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

const sortedItems = computed(() => {
  return [...props.items].sort((a, b) => a.order - b.order);
});

const pendingItems = computed(() => {
  return sortedItems.value.filter((item) => !item.completed);
});

const completedItems = computed(() => {
  return sortedItems.value.filter((item) => item.completed);
});

function handleDragStart(event: DragEvent, id: string): void {
  if (props.isReadOnly) return;
  draggedId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}

function handleDragOver(event: DragEvent, id: string): void {
  if (props.isReadOnly || !draggedId.value) return;
  event.preventDefault();
  dragOverId.value = id;
}

function handleDragEnd(): void {
  if (
    draggedId.value &&
    dragOverId.value &&
    draggedId.value !== dragOverId.value
  ) {
    const currentIds = sortedItems.value
      .map((item) => item.id)
      .filter((id): id is string => !!id);
    const fromIndex = currentIds.indexOf(draggedId.value);
    const toIndex = currentIds.indexOf(dragOverId.value);

    if (fromIndex !== -1 && toIndex !== -1) {
      // Reorder the array
      const newIds = [...currentIds];
      const removed = newIds.splice(fromIndex, 1)[0];
      if (removed) {
        newIds.splice(toIndex, 0, removed);
        emit("reorder", newIds);
      }
    }
  }

  draggedId.value = null;
  dragOverId.value = null;
}

function handleDragLeave(): void {
  dragOverId.value = null;
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <!-- Empty State -->
    <div
      v-if="
        pendingItems.length === 0 &&
        (!showCompletedSection || completedItems.length === 0)
      "
      class="text-center py-12"
    >
      <CheckCircle2 class="mx-auto h-12 w-12 text-muted-foreground/50" />
      <h3 class="mt-4 text-lg font-medium">All done!</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        {{
          isReadOnly ? "No todos in this list" : "Add a new todo to get started"
        }}
      </p>
    </div>

    <template v-else>
      <!-- Pending Items -->
      <div v-if="pendingItems.length > 0">
        <div
          v-for="item in pendingItems"
          :key="item.id"
          :draggable="!isReadOnly"
          class="transition-transform"
          :class="{
            'scale-105 z-10': draggedId === item.id,
            'border-t-2 border-primary':
              dragOverId === item.id && draggedId !== item.id,
          }"
          @dragstart="handleDragStart($event, item.id)"
          @dragover="handleDragOver($event, item.id)"
          @dragend="handleDragEnd"
          @dragleave="handleDragLeave"
        >
          <TodoItem
            :id="item.id"
            :text="item.text"
            :completed="item.completed ?? false"
            :is-completing="isItemCompleting(item.id)"
            :is-read-only="isReadOnly"
            :is-dragging="draggedId === item.id"
            @toggle-complete="emit('toggleComplete', $event)"
            @delete="emit('delete', $event)"
            @update-text="(id, text) => emit('updateText', id, text)"
          />
        </div>
      </div>

      <!-- Completed Section -->
      <div
        v-if="showCompletedSection && completedItems.length > 0"
        class="mt-6"
      >
        <h3
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1"
        >
          Completed ({{ completedItems.length }})
        </h3>
        <div class="opacity-60">
          <div v-for="item in completedItems" :key="item.id">
            <TodoItem
              :id="item.id"
              :text="item.text"
              :completed="item.completed ?? false"
              :is-completing="isItemCompleting(item.id)"
              :is-read-only="isReadOnly"
              :is-dragging="false"
              @toggle-complete="emit('toggleComplete', $event)"
              @delete="emit('delete', $event)"
              @update-text="(id, text) => emit('updateText', id, text)"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
