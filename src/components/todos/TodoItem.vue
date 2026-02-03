<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { GripVertical, Trash2 } from "lucide-vue-next";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const props = defineProps<{
  id: string;
  text: string;
  completed: boolean;
  isCompleting: boolean;
  isReadOnly: boolean;
  isDragging?: boolean;
}>();

const emit = defineEmits<{
  toggleComplete: [id: string];
  delete: [id: string];
  updateText: [id: string, text: string];
}>();

const isHovered = ref(false);
const isEditing = ref(false);
const editText = ref("");
const inputRef = ref<InstanceType<typeof Input> | null>(null);

const showStrikethrough = computed(() => props.completed || props.isCompleting);

function handleToggle(): void {
  if (props.isReadOnly) return;
  emit("toggleComplete", props.id);
}

function handleDelete(): void {
  if (props.isReadOnly) return;
  emit("delete", props.id);
}

function startEditing(): void {
  if (props.isReadOnly || props.completed) return;
  isEditing.value = true;
  editText.value = props.text;
  nextTick(() => {
    const input = inputRef.value?.$el?.querySelector(
      "input"
    ) as HTMLInputElement;
    input?.focus();
    input?.select();
  });
}

function saveEdit(): void {
  const trimmed = editText.value.trim();
  if (trimmed && trimmed !== props.text) {
    emit("updateText", props.id, trimmed);
  }
  isEditing.value = false;
}

function cancelEdit(): void {
  isEditing.value = false;
  editText.value = props.text;
}

function handleEditKeyDown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    saveEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit();
  }
}
</script>

<template>
  <div
    class="flex items-center gap-2 py-1.5 px-1 transition-all border-b border-border/40"
    :class="{
      'opacity-50': isDragging,
      'hover:bg-muted/30': !isDragging,
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Drag Handle -->
    <div
      v-if="!isReadOnly"
      class="drag-handle cursor-grab active:cursor-grabbing touch-none"
      :class="{
        'opacity-0': !isHovered && !isDragging,
        'opacity-100': isHovered || isDragging,
      }"
    >
      <GripVertical class="h-4 w-4 text-muted-foreground" />
    </div>

    <!-- Checkbox -->
    <Checkbox
      :model-value="completed || isCompleting"
      :disabled="isReadOnly || isCompleting"
      class="shrink-0"
      @update:model-value="handleToggle"
    />

    <!-- Text (editable) -->
    <Input
      v-if="isEditing"
      ref="inputRef"
      v-model="editText"
      class="flex-1 h-7 text-sm"
      @blur="saveEdit"
      @keydown="handleEditKeyDown"
    />
    <span
      v-else
      class="flex-1 text-sm transition-all duration-300"
      :class="{
        'line-through text-muted-foreground': showStrikethrough,
        'opacity-60': isCompleting,
        'cursor-text': !isReadOnly && !completed,
      }"
      @click="startEditing"
    >
      {{ text }}
    </span>

    <!-- Delete Button -->
    <Button
      v-if="!isReadOnly"
      variant="ghost"
      size="icon"
      class="h-6 w-6 shrink-0 transition-opacity"
      :class="{ 'opacity-0': !isHovered, 'opacity-100': isHovered }"
      @click="handleDelete"
    >
      <Trash2
        class="h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
      />
    </Button>
  </div>
</template>

<style scoped>
/* Ensure smooth transitions */
.drag-handle {
  transition: opacity 0.15s ease-in-out;
}
</style>
