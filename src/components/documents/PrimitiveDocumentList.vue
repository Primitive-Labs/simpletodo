<script setup lang="ts">
/**
 * Document management page content for listing, creating, renaming, sharing, and deleting documents.
 */
import LoadingGate from "@/components/shared/PrimitiveLoadingGate.vue";
import Badge from "@/components/ui/badge/Badge.vue";
import Button from "@/components/ui/button/Button.vue";
import Card from "@/components/ui/card/Card.vue";
import CardContent from "@/components/ui/card/CardContent.vue";
import Dialog from "@/components/ui/dialog/Dialog.vue";
import DialogContent from "@/components/ui/dialog/DialogContent.vue";
import DialogFooter from "@/components/ui/dialog/DialogFooter.vue";
import DialogHeader from "@/components/ui/dialog/DialogHeader.vue";
import DialogTitle from "@/components/ui/dialog/DialogTitle.vue";
import DropdownMenu from "@/components/ui/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "@/components/ui/dropdown-menu/DropdownMenuContent.vue";
import DropdownMenuItem from "@/components/ui/dropdown-menu/DropdownMenuItem.vue";
import DropdownMenuTrigger from "@/components/ui/dropdown-menu/DropdownMenuTrigger.vue";
import Input from "@/components/ui/input/Input.vue";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import Skeleton from "@/components/ui/skeleton/Skeleton.vue";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appBaseLogger } from "@/lib/logger";
import { useMediaQuery } from "@vueuse/core";
import type {
  DocumentInfo,
  DocumentMetadataChangedEvent,
} from "js-bao-wss-client";
import {
  Check,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash,
  Trash2,
  Users,
  X,
} from "lucide-vue-next";
import { jsBaoClientService } from "primitive-app";
import { computed, onMounted, onUnmounted, ref } from "vue";
import PrimitiveShareDocumentDialog from "./PrimitiveShareDocumentDialog.vue";

const logger = appBaseLogger.forScope("PrimitiveDocumentList");

const isMobile = useMediaQuery("(max-width: 640px)");

/**
 * Document metadata tracked locally.
 */
interface TrackedDocument {
  documentId: string;
  permission: DocumentInfo["permission"];
  tags: string[];
  title: string;
}

/**
 * Pending invitation with document metadata.
 */
interface PendingInvitation {
  invitationId: string;
  documentId: string;
  email: string;
  permission: "owner" | "read-write" | "reader";
  invitedBy: string;
  invitedAt: string;
  title?: string;
}

interface Props {
  /**
   * Singular display name for a document (e.g., "Project", "Workspace").
   * @default "Document"
   */
  documentName?: string;
  /**
   * Optional list of tags to filter documents by.
   * When provided, only documents with at least one matching tag are shown.
   */
  filterTags?: string[];
  /**
   * URL template for invitation links. Use `{documentId}` as a placeholder that will
   * be replaced with the actual document ID. If not provided, no documentUrl will be
   * included in the invitation.
   * @example "https://example.com/documents/{documentId}"
   */
  inviteUrlTemplate?: string;
  /**
   * Optional ID of the currently active document.
   * When provided, a "Current" badge is shown next to the matching document.
   */
  currentDocumentId?: string | null;
}

interface Emits {
  /**
   * Emitted when user clicks on a document row.
   */
  (e: "document-click", documentId: string, title: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  documentName: "Document",
  filterTags: () => [],
  currentDocumentId: null,
});
const emit = defineEmits<Emits>();

// Local state for documents and invitations
const documents = ref<TrackedDocument[]>([]);
const pendingInvitations = ref<PendingInvitation[]>([]);
const documentListLoaded = ref(false);

const inlineEditDocId = ref<string | null>(null);
const inlineEditTitle = ref("");
const shareDocId = ref<string | null>(null);
const deleteDocId = ref<string | null>(null);
const acceptingInvitation = ref<string | null>(null);
const isRefreshing = ref(false);
const isClearingCache = ref(false);
const isDeleting = ref(false);
const isRenaming = ref(false);

/**
 * Convert a DocumentInfo from js-bao to our TrackedDocument type.
 */
const toTrackedDocument = (doc: DocumentInfo): TrackedDocument => {
  const docWithAltFields = doc as DocumentInfo & {
    tags?: string[];
    lastKnownPermission?: DocumentInfo["permission"];
  };
  return {
    documentId: doc.documentId,
    permission:
      doc.permission ?? docWithAltFields.lastKnownPermission ?? "reader",
    tags: docWithAltFields.tags ?? [],
    title: doc.title ?? "",
  };
};

/**
 * Load the document list from the js-bao client.
 */
const loadDocuments = async (): Promise<void> => {
  try {
    logger.debug("Loading document list...");
    const client = await jsBaoClientService.getClientAsync();
    const list: DocumentInfo[] = await client.documents.list();
    documents.value = list.map((doc) => toTrackedDocument(doc));
    documentListLoaded.value = true;
    logger.debug("Document list loaded", { count: documents.value.length });
  } catch (error) {
    logger.error("Failed to load document list", { error });
    documentListLoaded.value = true; // Mark as loaded even on error to stop skeleton
  }
};

/**
 * Load pending invitations from the js-bao client.
 */
const loadInvitations = async (): Promise<void> => {
  try {
    logger.debug("Loading pending invitations...");
    const client = await jsBaoClientService.getClientAsync();
    const invitations = await client.me.pendingDocumentInvitations();
    pendingInvitations.value = invitations as PendingInvitation[];
    logger.debug("Pending invitations loaded", { count: invitations.length });
  } catch (error) {
    logger.error("Failed to load invitations", { error });
  }
};

// Track event listener cleanup
let metadataChangeUnsubscribe: (() => void) | null = null;

// Load data on mount and set up event listeners
onMounted(async () => {
  await Promise.all([loadDocuments(), loadInvitations()]);

  // Listen for document metadata changes to auto-refresh the list
  const client = await jsBaoClientService.getClientAsync();
  const handler = (event: DocumentMetadataChangedEvent) => {
    const action = event.action;
    // Refresh list when documents are created, updated, or deleted
    if (action === "created" || action === "updated" || action === "deleted") {
      logger.debug("Document metadata changed, refreshing list", {
        documentId: event.documentId,
        action,
      });
      loadDocuments();
    }
  };
  client.on("documentMetadataChanged", handler);
  metadataChangeUnsubscribe = () =>
    client.off("documentMetadataChanged", handler);
});

// Clean up event listeners on unmount
onUnmounted(() => {
  if (metadataChangeUnsubscribe) {
    metadataChangeUnsubscribe();
    metadataChangeUnsubscribe = null;
  }
});

const sortedDocuments = computed(() => {
  return [...documents.value]
    .filter((doc) => doc && doc.title)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
});

/**
 * Get the title of the document currently being shared.
 */
const shareDocTitle = computed(() => {
  if (!shareDocId.value) return props.documentName;
  const doc = documents.value.find((d) => d.documentId === shareDocId.value);
  return doc?.title || props.documentName;
});

/**
 * Check if a document matches the tag filter.
 * Returns true if no filter is set, or if the document has at least one matching tag.
 */
const matchesTagFilter = (tags: string[]): boolean => {
  if (!props.filterTags || props.filterTags.length === 0) {
    return true;
  }
  return tags.some((tag) => props.filterTags!.includes(tag));
};

/**
 * Filtered and sorted document items.
 */
const documentItems = computed(() => {
  return sortedDocuments.value
    .filter((doc) => matchesTagFilter(doc.tags))
    .map((doc) => ({
      type: "document" as const,
      documentId: doc.documentId,
      title: doc.title || "",
      permission: doc.permission,
      tags: doc.tags,
    }));
});

/**
 * Filtered and sorted invitation items.
 */
const invitationItems = computed(() => {
  return (pendingInvitations.value || [])
    .filter((inv): inv is PendingInvitation & { documentId: string } => {
      return Boolean(inv && inv.documentId);
    })
    .filter((inv) => {
      // Invitations may not have tags, so include them if no filter is set
      if (!props.filterTags || props.filterTags.length === 0) {
        return true;
      }
      // If the invitation has document metadata with tags, filter by those
      return false; // Invitations without tag info are excluded when filtering
    })
    .map((inv) => {
      return {
        type: "invitation" as const,
        documentId: inv.documentId,
        title: inv.title || `Untitled ${props.documentName}`,
        permission: inv.permission,
        invitedBy: inv.invitedBy,
        invitedAt: inv.invitedAt,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
});

const startInlineEdit = (docId: string, title: string) => {
  inlineEditDocId.value = docId;
  inlineEditTitle.value = title;
};

const cancelInlineEdit = () => {
  inlineEditDocId.value = null;
  inlineEditTitle.value = "";
};

const handleInlineRename = async () => {
  if (!inlineEditDocId.value || !inlineEditTitle.value.trim()) return;
  isRenaming.value = true;
  const docId = inlineEditDocId.value;
  const newTitle = inlineEditTitle.value.trim();
  try {
    logger.debug("Renaming document", { documentId: docId, newTitle });
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.update(docId, { title: newTitle });
    // Update local state immediately
    documents.value = documents.value.map((doc) =>
      doc.documentId === docId ? { ...doc, title: newTitle } : doc
    );
    inlineEditDocId.value = null;
    inlineEditTitle.value = "";
    logger.debug("Rename complete");
  } catch (error) {
    logger.error("Failed to rename document", { error });
  } finally {
    isRenaming.value = false;
  }
};

const handleDelete = async (docId: string) => {
  isDeleting.value = true;
  try {
    logger.debug("Deleting document", { documentId: docId });
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.delete(docId);
    // Remove from local list
    documents.value = documents.value.filter((doc) => doc.documentId !== docId);
    deleteDocId.value = null;
    logger.debug("Document deleted", { documentId: docId });
  } catch (error) {
    logger.error("Failed to delete document", { error });
  } finally {
    isDeleting.value = false;
  }
};

const handleAcceptInvitation = async (documentId: string) => {
  acceptingInvitation.value = documentId;
  try {
    logger.debug("Accepting invitation", { documentId });
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.acceptInvitation(documentId);
    // Refresh both lists after accepting
    await Promise.all([loadDocuments(), loadInvitations()]);
  } catch (error) {
    logger.error("Failed to accept invitation", { error });
  } finally {
    acceptingInvitation.value = null;
  }
};

const handleDocumentClick = (documentId: string, title: string) => {
  emit("document-click", documentId, title);
};

const handleRefresh = async () => {
  isRefreshing.value = true;
  try {
    logger.debug("Refreshing documents and invitations");
    await Promise.all([loadDocuments(), loadInvitations()]);
    logger.debug("Refresh complete");
  } catch (error) {
    logger.error("Failed to refresh documents or invitations", { error });
  } finally {
    isRefreshing.value = false;
  }
};

const handleClearLocalCache = async () => {
  isClearingCache.value = true;
  try {
    logger.debug("Clearing local document cache");
    const client = await jsBaoClientService.getClientAsync();
    await client.documents.evictAll({ onlySynced: true });
    // Reset local state and reload
    documents.value = [];
    pendingInvitations.value = [];
    documentListLoaded.value = false;
    await Promise.all([loadDocuments(), loadInvitations()]);
    logger.debug("Local document cache cleared and data reloaded");
  } catch (error) {
    logger.error("Failed to clear local cache", { error });
  } finally {
    isClearingCache.value = false;
  }
};
</script>

<template>
  <div class="space-y-4">
    <!-- Desktop table view -->
    <Card class="hidden sm:block">
      <CardContent class="p-0">
        <Table>
          <!-- Column headers at the top -->
          <TableHeader>
            <TableRow>
              <TableHead class="pl-4">Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead class="text-right pr-4">
                <div class="flex items-center justify-end gap-2">
                  <span>Actions</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" class="h-7 w-7">
                        <MoreHorizontal class="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        @click="handleRefresh"
                        :disabled="isRefreshing"
                      >
                        <RefreshCw
                          class="h-4 w-4 mr-2"
                          :class="{ 'animate-spin': isRefreshing }"
                        />
                        {{ isRefreshing ? "Refreshing..." : "Refresh" }}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        @click="handleClearLocalCache"
                        :disabled="isClearingCache"
                      >
                        <Trash class="h-4 w-4 mr-2" />
                        {{
                          isClearingCache
                            ? "Clearing Cache..."
                            : "Clear Local Cache"
                        }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <LoadingGate :is-ready="documentListLoaded">
              <template #loading>
                <template v-for="index in 3" :key="`skeleton-${index}`">
                  <TableRow>
                    <TableCell class="pl-4">
                      <Skeleton class="h-4 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton class="h-5 w-20" />
                    </TableCell>
                    <TableCell class="pr-4">
                      <div class="flex justify-end gap-2">
                        <Skeleton class="h-8 w-8" />
                        <Skeleton class="h-8 w-8" />
                        <Skeleton class="h-8 w-8" />
                      </div>
                    </TableCell>
                  </TableRow>
                </template>
              </template>

              <!-- Pending Invitations Section (only shown when invitations exist) -->
              <template v-if="invitationItems.length > 0">
                <!-- Section header row -->
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableCell colspan="3" class="pl-4 py-2">
                    <span class="text-sm font-medium text-muted-foreground">
                      Pending Invitations ({{ invitationItems.length }})
                    </span>
                  </TableCell>
                </TableRow>
                <!-- Invitation rows -->
                <template
                  v-for="item in invitationItems"
                  :key="`invitation-${item.documentId}`"
                >
                  <TableRow>
                    <TableCell class="pl-4 font-medium">
                      <div class="flex items-center gap-2">
                        <span>{{ item.title }}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        v-if="item.permission === 'read-write'"
                        variant="secondary"
                      >
                        Read-Write
                      </Badge>
                      <Badge
                        v-else-if="item.permission === 'reader'"
                        variant="secondary"
                      >
                        View Only
                      </Badge>
                    </TableCell>
                    <TableCell class="pr-4">
                      <div class="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="h-8 px-3 text-green-600 hover:text-green-700 hover:bg-green-50"
                          title="Accept Invitation"
                          aria-label="Accept Invitation"
                          :disabled="acceptingInvitation === item.documentId"
                          @click.stop="handleAcceptInvitation(item.documentId)"
                        >
                          <div
                            v-if="acceptingInvitation === item.documentId"
                            class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"
                          />
                          <template v-else>
                            <Check class="h-4 w-4 mr-1" />
                            Accept
                          </template>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                </template>
                <!-- Documents section header (only when invitations exist) -->
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableCell colspan="3" class="pl-4 py-2">
                    <span class="text-sm font-medium text-muted-foreground">
                      Documents ({{ documentItems.length }})
                    </span>
                  </TableCell>
                </TableRow>
              </template>

              <!-- Document rows -->
              <template
                v-for="item in documentItems"
                :key="`document-${item.documentId}`"
              >
                <TableRow>
                  <TableCell class="pl-4 font-medium">
                    <!-- Inline edit mode -->
                    <div
                      v-if="inlineEditDocId === item.documentId"
                      class="flex items-center gap-1"
                    >
                      <Input
                        v-model="inlineEditTitle"
                        class="h-8 w-64"
                        @keyup.enter="handleInlineRename"
                        @keyup.escape="cancelInlineEdit"
                        autofocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                        title="Save"
                        aria-label="Save"
                        :disabled="!inlineEditTitle.trim() || isRenaming"
                        @click="handleInlineRename"
                      >
                        <div
                          v-if="isRenaming"
                          class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"
                        />
                        <Check v-else class="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 text-destructive hover:text-destructive hover:bg-red-50"
                        title="Cancel"
                        aria-label="Cancel"
                        :disabled="isRenaming"
                        @click="cancelInlineEdit"
                      >
                        <X class="h-4 w-4" />
                      </Button>
                    </div>
                    <!-- Normal display mode -->
                    <div v-else class="flex items-center gap-2">
                      <Button
                        variant="link"
                        size="sm"
                        class="p-0 h-auto text-foreground hover:text-foreground hover:underline"
                        :title="`Open ${item.title}`"
                        :aria-label="`Open ${item.title}`"
                        @click="
                          handleDocumentClick(item.documentId, item.title)
                        "
                      >
                        {{ item.title }}
                      </Button>
                      <Badge
                        v-if="props.currentDocumentId === item.documentId"
                        variant="outline"
                        class="text-xs"
                      >
                        Current
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      v-if="item.permission === 'owner'"
                      variant="secondary"
                    >
                      Owner
                    </Badge>
                    <Badge
                      v-else-if="item.permission === 'read-write'"
                      variant="secondary"
                    >
                      Read-Write
                    </Badge>
                    <Badge
                      v-else-if="item.permission === 'reader'"
                      variant="secondary"
                    >
                      View Only
                    </Badge>
                  </TableCell>
                  <TableCell class="pr-4">
                    <div class="flex justify-end gap-1">
                      <Button
                        v-if="
                          item.permission === 'owner' ||
                          item.permission === 'read-write'
                        "
                        variant="ghost"
                        size="icon"
                        title="Rename"
                        aria-label="Rename"
                        @click.stop="
                          startInlineEdit(item.documentId, item.title)
                        "
                      >
                        <Pencil class="h-4 w-4" />
                      </Button>
                      <Button
                        v-if="
                          item.permission === 'owner' ||
                          item.permission === 'read-write'
                        "
                        variant="ghost"
                        size="icon"
                        title="Share"
                        aria-label="Share"
                        @click.stop="shareDocId = item.documentId"
                      >
                        <Users class="h-4 w-4" />
                      </Button>
                      <Button
                        v-if="
                          item.permission === 'owner' &&
                          props.currentDocumentId !== item.documentId
                        "
                        variant="ghost"
                        size="icon"
                        class="text-destructive hover:text-destructive"
                        title="Delete"
                        aria-label="Delete"
                        @click.stop="deleteDocId = item.documentId"
                      >
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
            </LoadingGate>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <!-- Mobile list view -->
    <Card class="sm:hidden">
      <CardContent class="p-0">
        <LoadingGate :is-ready="documentListLoaded">
          <template #skeleton>
            <div class="divide-y">
              <template v-for="index in 3" :key="`mobile-skeleton-${index}`">
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex-1 min-w-0">
                    <Skeleton class="h-4 w-32 mb-1" />
                    <Skeleton class="h-3 w-16" />
                  </div>
                  <div class="flex gap-1">
                    <Skeleton class="h-8 w-8" />
                    <Skeleton class="h-8 w-8" />
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- Mobile header with menu -->
          <div
            class="flex items-center justify-between px-4 py-2 border-b bg-muted/50"
          >
            <span class="text-sm font-medium text-muted-foreground">
              {{ invitationItems.length + documentItems.length }}
              {{
                invitationItems.length + documentItems.length === 1
                  ? "item"
                  : "items"
              }}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon" class="h-7 w-7">
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  @click="handleRefresh"
                  :disabled="isRefreshing"
                >
                  <RefreshCw
                    class="h-4 w-4 mr-2"
                    :class="{ 'animate-spin': isRefreshing }"
                  />
                  {{ isRefreshing ? "Refreshing..." : "Refresh" }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  @click="handleClearLocalCache"
                  :disabled="isClearingCache"
                >
                  <Trash class="h-4 w-4 mr-2" />
                  {{
                    isClearingCache ? "Clearing Cache..." : "Clear Local Cache"
                  }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <!-- Pending Invitations Section (Mobile, only when invitations exist) -->
          <template v-if="invitationItems.length > 0">
            <!-- Section header -->
            <div class="px-4 py-2 bg-muted/50 border-b">
              <span class="text-sm font-medium text-muted-foreground">
                Pending Invitations ({{ invitationItems.length }})
              </span>
            </div>
            <!-- Invitation rows -->
            <div class="divide-y">
              <template
                v-for="item in invitationItems"
                :key="`mobile-invitation-${item.documentId}`"
              >
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="flex-1 min-w-0 mr-2">
                    <div class="flex items-center gap-2">
                      <span class="font-medium truncate">{{ item.title }}</span>
                    </div>
                    <div class="text-xs text-muted-foreground mt-0.5">
                      {{
                        item.permission === "read-write"
                          ? "Read-Write"
                          : "View Only"
                      }}
                    </div>
                  </div>
                  <div class="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                      title="Accept Invitation"
                      aria-label="Accept Invitation"
                      :disabled="acceptingInvitation === item.documentId"
                      @click.stop="handleAcceptInvitation(item.documentId)"
                    >
                      <div
                        v-if="acceptingInvitation === item.documentId"
                        class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"
                      />
                      <template v-else>
                        <Check class="h-4 w-4" />
                      </template>
                    </Button>
                  </div>
                </div>
              </template>
            </div>
            <!-- Documents section header (only when invitations exist) -->
            <div class="px-4 py-2 bg-muted/50 border-b">
              <span class="text-sm font-medium text-muted-foreground">
                Documents ({{ documentItems.length }})
              </span>
            </div>
          </template>

          <!-- Document rows -->
          <div class="divide-y">
            <template
              v-for="item in documentItems"
              :key="`mobile-document-${item.documentId}`"
            >
              <!-- Inline edit mode for mobile -->
              <div
                v-if="inlineEditDocId === item.documentId"
                class="flex items-center gap-1 px-4 py-3"
              >
                <Input
                  v-model="inlineEditTitle"
                  class="flex-1 h-9"
                  @keyup.enter="handleInlineRename"
                  @keyup.escape="cancelInlineEdit"
                  autofocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-9 w-9 text-green-600 hover:text-green-700 hover:bg-green-50"
                  title="Save"
                  aria-label="Save"
                  :disabled="!inlineEditTitle.trim() || isRenaming"
                  @click="handleInlineRename"
                >
                  <div
                    v-if="isRenaming"
                    class="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"
                  />
                  <Check v-else class="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-9 w-9 text-destructive hover:text-destructive hover:bg-red-50"
                  title="Cancel"
                  aria-label="Cancel"
                  :disabled="isRenaming"
                  @click="cancelInlineEdit"
                >
                  <X class="h-4 w-4" />
                </Button>
              </div>
              <!-- Normal display mode -->
              <div
                v-else
                class="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer"
                @click="handleDocumentClick(item.documentId, item.title)"
              >
                <!-- Left: title -->
                <div class="flex-1 min-w-0 mr-2">
                  <div class="flex items-center gap-2">
                    <span class="font-medium truncate">{{ item.title }}</span>
                    <Badge
                      v-if="props.currentDocumentId === item.documentId"
                      variant="outline"
                      class="text-xs shrink-0"
                    >
                      Current
                    </Badge>
                  </div>
                  <div class="text-xs text-muted-foreground mt-0.5">
                    {{
                      item.permission === "owner"
                        ? "Owner"
                        : item.permission === "read-write"
                          ? "Read-Write"
                          : "View Only"
                    }}
                  </div>
                </div>

                <!-- Right: actions -->
                <div class="flex items-center gap-0.5 shrink-0">
                  <Button
                    v-if="
                      item.permission === 'owner' ||
                      item.permission === 'read-write'
                    "
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    title="Rename"
                    aria-label="Rename"
                    @click.stop="startInlineEdit(item.documentId, item.title)"
                  >
                    <Pencil class="h-4 w-4" />
                  </Button>
                  <Button
                    v-if="
                      item.permission === 'owner' ||
                      item.permission === 'read-write'
                    "
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    title="Share"
                    aria-label="Share"
                    @click.stop="shareDocId = item.documentId"
                  >
                    <Users class="h-4 w-4" />
                  </Button>
                  <Button
                    v-if="
                      item.permission === 'owner' &&
                      props.currentDocumentId !== item.documentId
                    "
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-destructive hover:text-destructive"
                    title="Delete"
                    aria-label="Delete"
                    @click.stop="deleteDocId = item.documentId"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </template>
          </div>
        </LoadingGate>
      </CardContent>
    </Card>

    <!-- Delete confirmation dialog (desktop) -->
    <Dialog
      v-if="!isMobile"
      :open="!!deleteDocId"
      @update:open="(val) => !val && !isDeleting && (deleteDocId = null)"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Delete {{ props.documentName }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-2">
          <p>
            Are you sure you want to delete this
            {{ props.documentName.toLowerCase() }}?
          </p>
          <p class="text-sm text-destructive">
            Warning: This will permanently delete the
            {{ props.documentName.toLowerCase() }}. This action cannot be
            undone.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="isDeleting"
            @click="!isDeleting && (deleteDocId = null)"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            :disabled="isDeleting"
            @click="deleteDocId && handleDelete(deleteDocId)"
          >
            {{ isDeleting ? "Deleting..." : `Delete ${props.documentName}` }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete confirmation sheet (mobile) -->
    <Sheet
      v-if="isMobile"
      :open="!!deleteDocId"
      @update:open="(val) => !val && !isDeleting && (deleteDocId = null)"
    >
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Confirm Delete {{ props.documentName }}</SheetTitle>
        </SheetHeader>
        <div class="space-y-2 px-4 py-4">
          <p>
            Are you sure you want to delete this
            {{ props.documentName.toLowerCase() }}?
          </p>
          <p class="text-sm text-destructive">
            Warning: This will permanently delete the
            {{ props.documentName.toLowerCase() }}. This action cannot be
            undone.
          </p>
        </div>
        <SheetFooter class="flex-col gap-2 sm:flex-col">
          <Button
            variant="destructive"
            class="w-full"
            :disabled="isDeleting"
            @click="deleteDocId && handleDelete(deleteDocId)"
          >
            {{ isDeleting ? "Deleting..." : `Delete ${props.documentName}` }}
          </Button>
          <Button
            variant="outline"
            class="w-full"
            :disabled="isDeleting"
            @click="!isDeleting && (deleteDocId = null)"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    <!-- Share dialog -->
    <PrimitiveShareDocumentDialog
      :is-open="!!shareDocId"
      :document-id="shareDocId"
      :document-label="shareDocTitle"
      :invite-url-template="props.inviteUrlTemplate"
      @close="shareDocId = null"
    />
  </div>
</template>
