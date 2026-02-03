<script setup lang="ts">
/**
 * Generic "confirm delete" dialog with optional copy customization and loading state.
 *
 * This component is typically used as a controlled dialog: the parent owns `isOpen`
 * and listens for confirm/cancel events.
 *
 * @event confirm Emitted when the user confirms the destructive action.
 * @event cancel Emitted when the user cancels or dismisses the dialog.
 * @event update:isOpen Emitted when the open state changes (payload: `value: boolean`).
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { computed } from "vue";

interface Props {
  /**
   * Whether the dialog is open.
   */
  isOpen: boolean;
  /**
   * Dialog title text.
   * @default "Confirm Delete"
   */
  title?: string;
  /**
   * Primary question copy shown to the user.
   * @default "Are you sure you want to delete this item?"
   */
  question?: string;
  /**
   * Optional warning copy shown below the question (often in destructive styling).
   * @default "This action cannot be undone."
   */
  warning?: string;
  /**
   * Label for the destructive confirm button.
   * @default "Delete"
   */
  confirmLabel?: string;
  /**
   * Label for the cancel button.
   * @default "Cancel"
   */
  cancelLabel?: string;
  /**
   * When true, disables actions and shows a loading state for the confirm button.
   * @default false
   */
  isDeleting?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: "Confirm Delete",
  question: "Are you sure you want to delete this item?",
  warning: "This action cannot be undone.",
  confirmLabel: "Delete",
  cancelLabel: "Cancel",
  isDeleting: false,
});

interface Emits {
  /**
   * Emitted when the user confirms the destructive action.
   */
  (e: "confirm"): void;
  /**
   * Emitted when the user cancels or dismisses the dialog.
   */
  (e: "cancel"): void;
  /**
   * Emitted when the open state changes.
   */
  (e: "update:isOpen", value: boolean): void;
}

const emit = defineEmits<Emits>();

const dialogOpen = computed({
  get: () => props.isOpen,
  set: (value: boolean) => {
    emit("update:isOpen", value);
    if (!value) {
      emit("cancel");
    }
  },
});

const handleConfirm = () => {
  emit("confirm");
};

const handleCancel = () => {
  if (!props.isDeleting) {
    emit("cancel");
  }
};
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          <div class="space-y-2">
            <p>{{ question }}</p>
            <p v-if="warning" class="text-sm text-destructive">{{ warning }}</p>
          </div>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="isDeleting" @click="handleCancel">
          {{ cancelLabel }}
        </Button>
        <Button
          variant="destructive"
          :disabled="isDeleting"
          @click="handleConfirm"
        >
          <template v-if="isDeleting">Deleting...</template>
          <template v-else>{{ confirmLabel }}</template>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
