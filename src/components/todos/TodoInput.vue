<script setup lang="ts">
import { ref } from "vue";
import { Plus } from "lucide-vue-next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const emit = defineEmits<{
  add: [text: string];
}>();

const text = ref("");

function handleSubmit(): void {
  const trimmed = text.value.trim();
  if (!trimmed) return;

  emit("add", trimmed);
  text.value = "";
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    handleSubmit();
  }
}
</script>

<template>
  <div class="flex items-center gap-2 py-1.5 px-1">
    <!-- Spacer to align with drag handle -->
    <div class="w-4" />

    <!-- Plus icon aligned with checkbox -->
    <Button
      variant="ghost"
      size="icon"
      class="h-4 w-4 p-0 shrink-0"
      :disabled="!text.trim()"
      @click="handleSubmit"
    >
      <Plus class="h-4 w-4 text-muted-foreground" />
    </Button>

    <!-- Input aligned with todo text -->
    <Input
      v-model="text"
      placeholder="Add a new todo..."
      class="flex-1 h-7 text-sm border-0 shadow-none focus-visible:ring-0 px-0"
      @keydown="handleKeyDown"
    />
  </div>
</template>
