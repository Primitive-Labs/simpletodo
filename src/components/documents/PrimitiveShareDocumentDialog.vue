<script setup lang="ts">
/**
 * Document sharing dialog (invite users and manage existing permissions).
 *
 * When opened, this component loads permissions + invitations for `documentId`
 * and renders a table with controls (subject to the current user's permissions).
 *
 * @event close Emitted when the dialog should be closed.
 */
import Avatar from "@/components/ui/avatar/Avatar.vue";
import AvatarFallback from "@/components/ui/avatar/AvatarFallback.vue";
import AvatarImage from "@/components/ui/avatar/AvatarImage.vue";
import Button from "@/components/ui/button/Button.vue";
import Checkbox from "@/components/ui/checkbox/Checkbox.vue";
import Dialog from "@/components/ui/dialog/Dialog.vue";
import DialogContent from "@/components/ui/dialog/DialogContent.vue";
import DialogFooter from "@/components/ui/dialog/DialogFooter.vue";
import DialogHeader from "@/components/ui/dialog/DialogHeader.vue";
import DialogTitle from "@/components/ui/dialog/DialogTitle.vue";
import Input from "@/components/ui/input/Input.vue";
import Label from "@/components/ui/label/Label.vue";
import Select from "@/components/ui/select/Select.vue";
import SelectContent from "@/components/ui/select/SelectContent.vue";
import SelectItem from "@/components/ui/select/SelectItem.vue";
import SelectTrigger from "@/components/ui/select/SelectTrigger.vue";
import SelectValue from "@/components/ui/select/SelectValue.vue";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import Textarea from "@/components/ui/textarea/Textarea.vue";
import { appBaseLogger } from "@/lib/logger";
import { jsBaoClientService } from "primitive-app";
import { useUserStore } from "@/stores/userStore";
import { useMediaQuery } from "@vueuse/core";
import { ArrowLeft, UserPlus, X } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";

const logger = appBaseLogger.forScope("PrimitiveShareDocumentDialog");

const isMobile = useMediaQuery("(max-width: 640px)");

type Permission = "owner" | "read-write" | "reader" | "admin";

interface PermissionEntry {
  userId: string;
  email: string;
  permission: Permission;
  name?: string;
  avatarUrl?: string;
  isMe?: boolean;
}

interface InvitationEntry {
  invitationId: string;
  email: string;
  permission: "read-write" | "reader";
}

interface Props {
  /**
   * Whether the dialog is open.
   */
  isOpen: boolean;
  /**
   * Document identifier to load permissions for. When `null`, the dialog renders
   * but will not load data.
   */
  documentId: string | null;
  /**
   * Human-readable label used in the dialog title/copy (e.g. "Document", "Workspace").
   * @default "Document"
   */
  documentLabel?: string;
  /**
   * URL template for invitation links. Use `{documentId}` as a placeholder that will
   * be replaced with the actual document ID. If not provided, no documentUrl will be
   * included in the invitation.
   * @example "https://example.com/documents/{documentId}"
   */
  inviteUrlTemplate?: string;
}

const props = withDefaults(defineProps<Props>(), {
  documentLabel: "Document",
});

interface Emits {
  /**
   * Emitted when the dialog should be closed.
   */
  (e: "close"): void;
}

const emit = defineEmits<Emits>();

const userStore = useUserStore();

const permissions = ref<PermissionEntry[]>([]);
const invitations = ref<InvitationEntry[]>([]);
const inviteEmail = ref("");
const invitePermission = ref<"read-write" | "reader">("read-write");
const sendEmailNotification = ref(true);
const inviteMessage = ref("");
const loading = ref(false);
const submitting = ref(false);

interface InviteStatus {
  type: "success" | "error" | "partial";
  message: string;
}
const inviteStatus = ref<InviteStatus | null>(null);
const isAddingPeople = ref(false);

const getPermissionColor = (permission: string) => {
  switch (permission) {
    case "owner":
      return "bg-blue-100 text-blue-800";
    case "admin":
      return "bg-purple-100 text-purple-800";
    case "read-write":
      return "bg-green-100 text-green-800";
    case "reader":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const getInitials = (nameOrEmail: string | null | undefined) => {
  const value: string = nameOrEmail ?? "";
  if (!value) return "U";

  const emailPart = value.split("@")[0] ?? "";
  const parts = emailPart.split(/[ ._+-]/).filter(Boolean);
  const first = parts[0]?.[0];
  const second = parts.length > 1 ? parts[1]?.[0] : value[0];
  return (first || "U").toUpperCase() + (second || "").toUpperCase();
};

const loadData = async () => {
  if (!props.documentId) return;
  loading.value = true;
  try {
    logger.debug("Loading permissions and invitations", {
      documentId: props.documentId,
    });
    const client = await jsBaoClientService.getClientAsync();
    const perms = await client.documents.getPermissions(props.documentId);
    const invs = await client.documents.listInvitations(props.documentId);
    permissions.value = perms as PermissionEntry[];
    invitations.value = invs as InvitationEntry[];
    logger.debug("Loaded permissions and invitations", {
      permissions: permissions.value.length,
      invitations: invitations.value.length,
    });
  } catch (error) {
    logger.error("Failed to load permissions or invitations", { error });
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (props.isOpen) {
    void loadData();
  }
});

watch(
  () => [props.isOpen, props.documentId] as const,
  ([open]) => {
    if (open) {
      void loadData();
      inviteEmail.value = "";
      invitePermission.value = "read-write";
      sendEmailNotification.value = true;
      inviteMessage.value = "";
      inviteStatus.value = null;
      isAddingPeople.value = false;
    }
  },
  { immediate: true }
);

// Clear status when user starts typing a new email (sync flush ensures this runs
// immediately so programmatic email restoration followed by status setting works)
watch(
  inviteEmail,
  () => {
    if (inviteStatus.value) {
      inviteStatus.value = null;
    }
  },
  { flush: "sync" }
);

const combinedRows = computed(() => {
  const inviteRows = invitations.value.map((i) => ({
    kind: "invitation" as const,
    id: i.invitationId,
    email: i.email,
    permission: i.permission,
    name: undefined as string | undefined,
  }));
  const meEmail = userStore.currentUser?.email;

  const permRows = permissions.value.map((p) => ({
    kind: "permission" as const,
    id: p.userId,
    email: p.email,
    permission: p.permission,
    name: p.name,
    avatarUrl: p.avatarUrl,
    isMe: !!(
      meEmail &&
      p.email &&
      meEmail.toLowerCase() === p.email.toLowerCase()
    ),
  }));

  const sortedPermRows = permRows.sort((a, b) => {
    if (a.isMe && !b.isMe) return -1;
    if (!a.isMe && b.isMe) return 1;
    return a.email.localeCompare(b.email);
  });

  const sortedInviteRows = inviteRows.sort((a, b) =>
    a.email.localeCompare(b.email)
  );

  return [...sortedPermRows, ...sortedInviteRows];
});

const currentUserIsOwner = computed(() => {
  const meEmail = userStore.currentUser?.email;
  if (!meEmail) return false;
  return permissions.value.some(
    (p) =>
      p.email.toLowerCase() === meEmail.toLowerCase() &&
      p.permission === "owner"
  );
});

const currentUserCanInvite = computed(() => {
  const meEmail = userStore.currentUser?.email;
  if (!meEmail) return false;
  return permissions.value.some(
    (p) =>
      p.email.toLowerCase() === meEmail.toLowerCase() &&
      (p.permission === "owner" || p.permission === "read-write")
  );
});

/**
 * Parse email input that may contain multiple comma or semicolon separated emails.
 */
const parseEmails = (input: string): string[] => {
  return input
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes("@"));
};

const handleInvite = async () => {
  if (!props.documentId || !inviteEmail.value.trim()) return;

  const emails = parseEmails(inviteEmail.value);
  if (emails.length === 0) {
    inviteStatus.value = {
      type: "error",
      message: "Please enter a valid email address",
    };
    return;
  }

  const permission = invitePermission.value;
  const sendEmail = sendEmailNotification.value;
  const message = inviteMessage.value.trim();

  inviteStatus.value = null;
  submitting.value = true;

  const succeeded: string[] = [];
  const failed: { email: string; error: string }[] = [];

  /**
   * Extract a user-friendly error message from various error types.
   */
  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      // Check for JsBaoError-style details
      const details = (error as { details?: { message?: string } }).details;
      if (details?.message) {
        return details.message;
      }
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    return "Unknown error";
  };

  try {
    const client = await jsBaoClientService.getClientAsync();

    for (const email of emails) {
      try {
        logger.debug("Creating invitation", {
          documentId: props.documentId,
          email,
          permission,
          sendEmail,
          hasMessage: !!message,
        });
        const inviteOptions: {
          sendEmail: boolean;
          documentUrl?: string;
          note?: string;
        } = {
          sendEmail,
          note: message || undefined,
        };
        if (props.inviteUrlTemplate) {
          inviteOptions.documentUrl = props.inviteUrlTemplate.replace(
            "{documentId}",
            props.documentId
          );
        }
        await client.documents.createInvitation(
          props.documentId,
          email,
          permission,
          inviteOptions
        );
        succeeded.push(email);
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error("Failed to create invitation", { email, error, errorMsg });
        failed.push({ email, error: errorMsg });
      }
    }

    // Refresh invitations list
    const invs = await client.documents.listInvitations(props.documentId);
    invitations.value = invs as InvitationEntry[];

    // Restore failed emails for retry FIRST (before setting status, to avoid watch clearing it)
    if (failed.length > 0) {
      inviteEmail.value = failed.map((f) => f.email).join(", ");
    }

    // Set status message based on results
    if (failed.length === 0) {
      inviteStatus.value = {
        type: "success",
        message:
          succeeded.length === 1
            ? `Invitation sent to ${succeeded[0]}`
            : `Invitations sent to ${succeeded.length} people`,
      };
      logger.debug("Set success status", { inviteStatus: inviteStatus.value });
      // Clear form and return to main view on success
      inviteEmail.value = "";
      inviteMessage.value = "";
      isAddingPeople.value = false;
    } else if (succeeded.length === 0) {
      // Show the actual error message from the server
      const firstFailed = failed[0];
      const errorDetail =
        failed.length === 1 && firstFailed
          ? firstFailed.error
          : failed.map((f) => `${f.email}: ${f.error}`).join("; ");
      inviteStatus.value = {
        type: "error",
        message: errorDetail,
      };
      logger.debug("Set error status", { inviteStatus: inviteStatus.value });
    } else {
      // Partial success - show which ones failed and why
      const failedDetail = failed
        .map((f) => `${f.email}: ${f.error}`)
        .join("; ");
      inviteStatus.value = {
        type: "partial",
        message: `Sent ${succeeded.length} invitation(s). Failed: ${failedDetail}`,
      };
      logger.debug("Set partial status", { inviteStatus: inviteStatus.value });
    }
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    logger.error("Unexpected error during invite", { error, errorMsg });
    // Restore emails for retry FIRST
    inviteEmail.value = emails.join(", ");
    inviteStatus.value = {
      type: "error",
      message: errorMsg,
    };
  } finally {
    submitting.value = false;
  }
};

const handleCancelInvitation = async (invitationId: string) => {
  if (!props.documentId) return;

  const original = invitations.value.slice();
  invitations.value = invitations.value.filter(
    (inv) => inv.invitationId !== invitationId
  );

  try {
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.deleteInvitation(props.documentId, invitationId);
  } catch (error) {
    invitations.value = original;
    logger.error("Failed to cancel invitation", { error });
    throw error;
  }
};

const handleUpdatePermission = async (
  userId: string,
  permission: "read-write" | "reader"
) => {
  if (!props.documentId) return;

  const original = permissions.value.slice();
  permissions.value = permissions.value.map((p) =>
    p.userId === userId ? { ...p, permission } : p
  );

  try {
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.updatePermissions(props.documentId, {
      userId,
      permission,
    });
  } catch (error) {
    permissions.value = original;
    logger.error("Failed to update permission", { error });
    throw error;
  }
};

const handleRemovePermission = async (userId: string) => {
  if (!props.documentId) return;

  const original = permissions.value.slice();
  permissions.value = permissions.value.filter((p) => p.userId !== userId);

  try {
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.removePermission(props.documentId, userId);
  } catch (error) {
    permissions.value = original;
    logger.error("Failed to remove permission", { error });
    throw error;
  }
};

const handleCancelAddPeople = () => {
  isAddingPeople.value = false;
  inviteEmail.value = "";
  inviteMessage.value = "";
  inviteStatus.value = null;
};
</script>

<template>
  <!-- Desktop Dialog -->
  <Dialog
    v-if="!isMobile"
    :open="isOpen"
    @update:open="(val: boolean) => !val && emit('close')"
  >
    <DialogContent class="max-w-lg p-0 gap-0 h-[500px] flex flex-col">
      <!-- Header - with optional back button when adding people -->
      <DialogHeader class="px-6 pt-5 pb-4 shrink-0 flex-row items-center gap-2">
        <Button
          v-if="isAddingPeople"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0 -ml-2"
          @click="handleCancelAddPeople"
        >
          <ArrowLeft class="h-5 w-5" />
        </Button>
        <DialogTitle class="text-xl font-normal flex-1">
          Share "{{ documentLabel }}"
        </DialogTitle>
      </DialogHeader>

      <!-- Email input row - SINGLE INPUT, never re-renders -->
      <div v-if="currentUserCanInvite" class="px-6 pb-4 shrink-0">
        <div class="flex gap-2 items-center">
          <Input
            id="invite-email"
            type="email"
            placeholder="Add people by email"
            v-model="inviteEmail"
            class="h-10 text-base border-2 focus-visible:ring-0 focus-visible:border-blue-500 flex-1"
            @input="inviteEmail.trim() && (isAddingPeople = true)"
            @keyup.enter="isAddingPeople && handleInvite()"
          />
          <!-- Permission dropdown appears when adding people -->
          <Select v-if="isAddingPeople" v-model="invitePermission">
            <SelectTrigger class="w-28 h-10 shrink-0">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read-write">Editor</SelectItem>
              <SelectItem value="reader">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <!-- Status message - shown in both modes -->
      <div
        v-if="inviteStatus"
        class="mx-6 mb-4 text-sm px-3 py-2 rounded-md shrink-0"
        :class="{
          'bg-green-50 text-green-800': inviteStatus.type === 'success',
          'bg-red-50 text-red-800': inviteStatus.type === 'error',
          'bg-yellow-50 text-yellow-800': inviteStatus.type === 'partial',
        }"
      >
        {{ inviteStatus.message }}
      </div>

      <!-- Content area - switches based on mode -->
      <template v-if="!isAddingPeople">
        <!-- People with access - scrollable area -->
        <div class="px-6 flex-1 min-h-0 flex flex-col">
          <h3 class="text-sm font-medium text-muted-foreground mb-3 shrink-0">
            People with access
          </h3>
          <div class="flex-1 overflow-y-auto -mx-2">
            <div v-if="loading" class="py-8 text-center text-muted-foreground">
              Loading...
            </div>
            <div v-else class="space-y-1">
              <div
                v-for="row in combinedRows"
                :key="`${row.kind}:${row.id}`"
                class="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-muted/50 gap-3"
              >
                <div class="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar class="h-9 w-9 shrink-0">
                    <AvatarImage
                      v-if="
                        row.kind === 'permission' &&
                        (row.avatarUrl ||
                          (row.isMe && userStore.currentUser?.avatarUrl))
                      "
                      :src="row.avatarUrl || userStore.currentUser?.avatarUrl!"
                      :alt="row.name || row.email"
                    />
                    <AvatarFallback class="text-sm">
                      {{ getInitials(row.name || row.email) }}
                    </AvatarFallback>
                  </Avatar>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium truncate">
                      {{ row.name || row.email }}
                      <span
                        v-if="row.kind === 'permission' && row.isMe"
                        class="text-muted-foreground font-normal"
                      >
                        (you)
                      </span>
                    </div>
                    <div
                      v-if="row.name"
                      class="text-xs text-muted-foreground truncate"
                    >
                      {{ row.email }}
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <template v-if="row.kind === 'invitation'">
                    <span class="text-sm text-muted-foreground mr-1">
                      Pending
                    </span>
                    <button
                      v-if="currentUserIsOwner"
                      class="text-muted-foreground hover:text-destructive text-sm px-2 py-1 rounded hover:bg-muted"
                      @click="handleCancelInvitation(row.id)"
                    >
                      <X class="h-4 w-4" />
                    </button>
                  </template>
                  <template v-else-if="row.permission === 'owner'">
                    <span class="text-sm text-muted-foreground">Owner</span>
                  </template>
                  <template v-else>
                    <Select
                      v-if="currentUserIsOwner"
                      :model-value="row.permission"
                      @update:model-value="
                        (v) =>
                          handleUpdatePermission(
                            row.id,
                            v as 'read-write' | 'reader'
                          )
                      "
                    >
                      <SelectTrigger
                        class="w-auto h-8 border-0 shadow-none hover:bg-muted gap-1 text-sm text-muted-foreground"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read-write">Editor</SelectItem>
                        <SelectItem value="reader">Viewer</SelectItem>
                        <SelectItem
                          v-if="!(row.kind === 'permission' && row.isMe)"
                          value="__remove__"
                          class="text-destructive"
                          @click.prevent="handleRemovePermission(row.id)"
                        >
                          Remove access
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <span v-else class="text-sm text-muted-foreground">
                      {{
                        row.permission === "read-write" ? "Editor" : "Viewer"
                      }}
                    </span>
                    <button
                      v-if="row.kind === 'permission' && row.isMe"
                      class="text-muted-foreground hover:text-destructive text-xs px-2 py-1 rounded hover:bg-muted ml-1"
                      @click="handleRemovePermission(row.id)"
                    >
                      Leave
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer - main view -->
        <DialogFooter class="px-6 py-4 border-t mt-auto shrink-0">
          <Button @click="emit('close')">Done</Button>
        </DialogFooter>
      </template>

      <!-- Add people content -->
      <template v-else>
        <div class="px-6 space-y-4 flex-1 min-h-0 overflow-y-auto">
          <!-- Notify people checkbox -->
          <div class="flex items-center gap-2">
            <Checkbox id="send-email" v-model="sendEmailNotification" />
            <Label for="send-email" class="text-sm font-normal cursor-pointer">
              Notify people
            </Label>
          </div>

          <!-- Message textarea -->
          <div v-if="sendEmailNotification">
            <Textarea
              id="invite-message"
              v-model="inviteMessage"
              placeholder="Message"
              class="resize-none min-h-[100px] text-base"
            />
          </div>
        </div>

        <!-- Footer - add people view -->
        <DialogFooter
          class="px-6 py-4 border-t mt-auto shrink-0 flex-row justify-end gap-2 sm:justify-end"
        >
          <Button variant="ghost" @click="handleCancelAddPeople">
            Cancel
          </Button>
          <Button
            :disabled="submitting || !inviteEmail.trim()"
            @click="handleInvite"
          >
            {{ submitting ? "Sending..." : "Send" }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>

  <!-- Mobile Full-Screen View -->
  <Sheet
    v-if="isMobile"
    :open="isOpen"
    @update:open="(val: boolean) => !val && emit('close')"
  >
    <SheetContent
      side="bottom"
      class="h-[100dvh] flex flex-col p-0 rounded-none [&>button.absolute]:hidden"
    >
      <!-- Header bar -->
      <div class="flex items-center gap-3 px-4 py-3 border-b bg-background">
        <Button
          variant="ghost"
          size="icon"
          class="h-10 w-10 shrink-0"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </Button>
        <h1 class="text-lg font-semibold">Share</h1>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto">
        <!-- Add people section -->
        <div v-if="currentUserCanInvite" class="px-4 py-4 border-b">
          <div class="flex items-center gap-3 mb-4">
            <div
              class="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0"
            >
              <UserPlus class="h-5 w-5 text-muted-foreground" />
            </div>
            <Input
              id="invite-email-mobile"
              type="email"
              placeholder="Add people or groups"
              v-model="inviteEmail"
              class="flex-1 border-0 shadow-none focus-visible:ring-0 px-0 text-base"
            />
          </div>

          <!-- Show invite options when email is entered -->
          <div v-if="inviteEmail.trim()" class="space-y-4 pt-2">
            <div class="flex items-center gap-3">
              <Label class="text-sm text-muted-foreground w-16">Access</Label>
              <Select v-model="invitePermission">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read-write">Editor</SelectItem>
                  <SelectItem value="reader">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="flex items-center gap-2">
              <Checkbox
                id="send-email-mobile"
                v-model="sendEmailNotification"
              />
              <Label
                for="send-email-mobile"
                class="text-sm font-normal cursor-pointer"
              >
                Notify via email
              </Label>
            </div>

            <div v-if="sendEmailNotification">
              <Textarea
                id="invite-message-mobile"
                v-model="inviteMessage"
                placeholder="Message (optional)"
                class="resize-none h-20"
              />
            </div>

            <Button
              class="w-full"
              :disabled="submitting || !inviteEmail.trim()"
              @click="handleInvite"
            >
              {{ submitting ? "Sending..." : "Send invite" }}
            </Button>
          </div>

          <!-- Status message -->
          <div
            v-if="inviteStatus"
            class="text-sm px-3 py-2 rounded-md mt-3"
            :class="{
              'bg-green-50 text-green-800': inviteStatus.type === 'success',
              'bg-red-50 text-red-800': inviteStatus.type === 'error',
              'bg-yellow-50 text-yellow-800': inviteStatus.type === 'partial',
            }"
          >
            {{ inviteStatus.message }}
          </div>
        </div>

        <!-- People with access -->
        <div class="px-4 py-4">
          <h2 class="text-sm font-medium text-muted-foreground mb-3">
            People with access
          </h2>
          <div v-if="loading" class="py-8 text-center text-muted-foreground">
            Loading...
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="row in combinedRows"
              :key="`mobile-${row.kind}:${row.id}`"
              class="flex items-center justify-between py-3 gap-3"
            >
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <Avatar class="h-10 w-10 shrink-0">
                  <AvatarImage
                    v-if="
                      row.kind === 'permission' &&
                      (row.avatarUrl ||
                        (row.isMe && userStore.currentUser?.avatarUrl))
                    "
                    :src="row.avatarUrl || userStore.currentUser?.avatarUrl!"
                    :alt="row.name || row.email"
                  />
                  <AvatarFallback>
                    {{ getInitials(row.name || row.email) }}
                  </AvatarFallback>
                </Avatar>
                <div class="min-w-0 flex-1">
                  <div class="font-medium truncate">
                    {{ row.name || row.email }}
                    <span
                      v-if="row.kind === 'permission' && row.isMe"
                      class="text-muted-foreground font-normal"
                    >
                      (you)
                    </span>
                  </div>
                  <div class="text-sm text-muted-foreground truncate">
                    {{ row.email }}
                  </div>
                  <div class="text-sm text-muted-foreground">
                    {{
                      row.kind === "invitation"
                        ? "Pending invitation"
                        : row.permission === "owner"
                          ? "Owner"
                          : row.permission === "read-write"
                            ? "Editor"
                            : "Viewer"
                    }}
                  </div>
                </div>
              </div>

              <div class="shrink-0">
                <template
                  v-if="row.kind === 'invitation' && currentUserIsOwner"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive"
                    @click="handleCancelInvitation(row.id)"
                  >
                    Cancel
                  </Button>
                </template>
                <template
                  v-else-if="
                    row.kind === 'permission' &&
                    row.permission !== 'owner' &&
                    (currentUserIsOwner || row.isMe)
                  "
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive"
                    @click="handleRemovePermission(row.id)"
                  >
                    {{ row.isMe ? "Leave" : "Remove" }}
                  </Button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
