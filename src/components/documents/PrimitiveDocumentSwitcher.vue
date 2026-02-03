<script setup lang="ts">
/**
 * Document switcher dropdown shown at the top of the sidebar.
 *
 * Displays a configurable label and icon, with a dropdown menu for switching
 * between documents and accessing the "Manage Documents" page.
 */
import PrimitiveLoadingGate from "@/components/shared/PrimitiveLoadingGate.vue";
import DropdownMenu from "@/components/ui/dropdown-menu/DropdownMenu.vue";
import DropdownMenuContent from "@/components/ui/dropdown-menu/DropdownMenuContent.vue";
import DropdownMenuItem from "@/components/ui/dropdown-menu/DropdownMenuItem.vue";
import DropdownMenuSeparator from "@/components/ui/dropdown-menu/DropdownMenuSeparator.vue";
import DropdownMenuTrigger from "@/components/ui/dropdown-menu/DropdownMenuTrigger.vue";
import { appBaseLogger } from "@/lib/logger";
import { jsBaoClientService } from "primitive-app";
import type {
  DocumentInfo,
  DocumentMetadataChangedEvent,
} from "js-bao-wss-client";
import { ChevronDown, FolderOpen } from "lucide-vue-next";
import type { Component } from "vue";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

const logger = appBaseLogger.forScope("PrimitiveDocumentSwitcher");

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
   * Label text displayed in the header (e.g., app name or current context).
   */
  label: string;
  /**
   * Icon component to display in the header.
   */
  icon?: Component;
  /**
   * ID of the currently active document (used to highlight in the menu).
   */
  currentDocumentId?: string | null;
  /**
   * Plural name for documents (e.g., "Projects", "Workspaces").
   * Used in "Manage [Documents]" label.
   */
  documentNamePlural?: string;
  /**
   * Route path for the manage documents page.
   * If not provided, the manage link is hidden.
   */
  manageDocumentsPath?: string;
  /**
   * Whether the component is rendered in mobile mode.
   * Affects dropdown menu positioning.
   */
  mobile?: boolean;
}

interface Emits {
  /**
   * Emitted when user selects a different document.
   */
  (e: "switch-document", documentId: string, title: string): void;
  /**
   * Emitted when navigation occurs (e.g., clicking "Manage Documents").
   * Used to close the mobile nav sheet.
   */
  (e: "navigate"): void;
}

const props = withDefaults(defineProps<Props>(), {
  currentDocumentId: null,
  documentNamePlural: "Documents",
  mobile: false,
});
const emit = defineEmits<Emits>();

// Local state for documents and invitations
const documents = ref<TrackedDocument[]>([]);
const pendingInvitations = ref<PendingInvitation[]>([]);
const documentListLoaded = ref(false);

// Track event listener cleanup
let metadataChangeUnsubscribe: (() => void) | null = null;

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
    documentListLoaded.value = true;
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

const sortedDocumentsForMenu = computed(() => {
  if (!documentListLoaded.value) {
    return [];
  }

  return [...documents.value]
    .filter((doc) => doc && doc.title)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
});

function handleSwitchDocument(documentId: string, title: string): void {
  emit("switch-document", documentId, title);
}

async function handleManageDocumentsClick(): Promise<void> {
  emit("navigate");
  await nextTick();
  if (props.manageDocumentsPath) {
    router.push(props.manageDocumentsPath);
  }
}
</script>

<template>
  <div class="pt-1 px-1">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <component
            v-if="props.icon"
            :is="props.icon"
            class="size-5 shrink-0"
          />
          <span
            class="flex-1 text-left text-base font-medium leading-tight truncate"
          >
            {{ props.label }}
          </span>
          <span
            v-if="pendingInvitations.length > 0"
            class="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full shrink-0"
          >
            {{ pendingInvitations.length }}
          </span>
          <ChevronDown class="ml-auto size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        class="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
        :side="props.mobile ? 'bottom' : 'right'"
        align="start"
        :side-offset="4"
      >
        <DropdownMenuItem
          v-if="props.manageDocumentsPath"
          @select="handleManageDocumentsClick"
        >
          <FolderOpen class="mr-2 h-4 w-4" />
          <span>
            Manage
            {{ props.documentNamePlural }}
          </span>
          <span
            v-if="pendingInvitations.length > 0"
            class="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full shrink-0"
          >
            {{ pendingInvitations.length }}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator
          v-if="
            props.manageDocumentsPath &&
            (!documentListLoaded ||
              (Array.isArray(sortedDocumentsForMenu) &&
                sortedDocumentsForMenu.length > 1))
          "
        />

        <PrimitiveLoadingGate :is-ready="documentListLoaded">
          <template #loading>
            <DropdownMenuItem
              v-for="i in [0, 1, 2]"
              :key="`skeleton-${i}`"
              disabled
            >
              <span style="width: 30px" aria-hidden />
              <span
                class="h-4 w-40 rounded bg-muted/50 animate-pulse"
                aria-hidden
              />
            </DropdownMenuItem>
          </template>

          <template
            v-if="
              Array.isArray(sortedDocumentsForMenu) &&
              sortedDocumentsForMenu.length > 1
            "
          >
            <DropdownMenuItem
              v-for="doc in sortedDocumentsForMenu"
              :key="doc.documentId"
              as-child
            >
              <button
                type="button"
                class="flex w-full items-center"
                @click="handleSwitchDocument(doc.documentId, doc.title)"
              >
                <span style="width: 30px" aria-hidden />
                <span
                  :class="{
                    'font-semibold': props.currentDocumentId === doc.documentId,
                  }"
                >
                  {{ doc.title }}
                </span>
                <span
                  v-if="props.currentDocumentId === doc.documentId"
                  class="ml-2 inline-block w-2 h-2 rounded-full bg-blue-600"
                  aria-hidden
                />
              </button>
            </DropdownMenuItem>
          </template>
        </PrimitiveLoadingGate>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
