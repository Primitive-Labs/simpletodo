/**
 * @module jsBaoDocumentsStore
 *
 * Pinia store for managing the user's document list and invitations.
 *
 * This is a low-level store that provides direct access to the user's documents
 * from js-bao-wss-client. For most use cases, prefer using `useSingleDocumentStore`
 * or `useMultiDocumentStore` which build on top of this store.
 *
 * ## Features
 *
 * - Reactive document list with metadata (title, tags, permission)
 * - Pending invitation management
 * - Document CRUD operations
 * - Real-time updates via WebSocket events
 *
 * ## Usage
 *
 * ```ts
 * import { useJsBaoDocumentsStore } from '@/stores/jsBaoDocumentsStore';
 *
 * const docsStore = useJsBaoDocumentsStore();
 *
 * // Access all documents
 * const allDocs = docsStore.documents;
 *
 * // Create a new document
 * const doc = await docsStore.createDocument('My Document', ['project']);
 *
 * // Open a document for use
 * await docsStore.openDocument(doc.documentId);
 *
 * // Share a document
 * await docsStore.shareDocument(doc.documentId, 'user@example.com', 'read-write');
 *
 * // Accept a pending invitation
 * await docsStore.acceptInvitation(documentId);
 * ```
 */
import type {
  DocumentInfo,
  DocumentMetadataChangedEvent,
  InvitationEvent,
} from "js-bao-wss-client";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { appBaseLogger } from "../lib/logger";
import { jsBaoClientService } from "primitive-app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The fields we track for documents in the store.
 * This is a subset of DocumentInfo focused on what the UI needs.
 */
export interface TrackedDocument {
  documentId: string;
  permission: DocumentInfo["permission"];
  tags: string[];
  title: string;
}

/**
 * Extended invitation type that includes document metadata.
 * This type is used for pending invitations stored in the store, which include
 * document metadata from WebSocket events and the pendingDocumentInvitations API.
 */
export interface PendingInvitation {
  invitationId: string;
  documentId: string;
  email: string;
  permission: "owner" | "read-write" | "reader";
  invitedBy: string;
  invitedAt: string;
  expiresAt?: string;
  accepted: boolean;
  acceptedAt?: string;
  title?: string;
  document?: {
    documentId?: string;
    title?: string;
    tags?: string[];
    createdAt?: string;
    lastModified?: string;
    createdBy?: string;
  };
}

/**
 * Fields that trigger a document list update when changed.
 */
const TRACKED_FIELDS = new Set([
  "documentId",
  "permission",
  "lastKnownPermission",
  "tags",
  "title",
]);

// ---------------------------------------------------------------------------
// Module-scoped lifecycle resources
// ---------------------------------------------------------------------------

let initStarted = false;
let removeDocumentMetadataListener: (() => void) | null = null;
let removeInvitationListener: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useJsBaoDocumentsStore = defineStore("jsBaoDocuments", () => {
  const logger = appBaseLogger.forScope("jsBaoDocumentsStore");

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /**
   * List of all tracked documents the user has access to.
   */
  const documents = ref<TrackedDocument[]>([]);

  /**
   * List of pending document invitations for the current user.
   */
  const pendingInvitations = ref<PendingInvitation[]>([]);

  /**
   * Set of document IDs that are currently open and syncing.
   */
  const openDocumentIds = ref<Set<string>>(new Set());

  /**
   * Whether the document list has been loaded from the backend.
   */
  const documentListLoaded = ref(false);

  /**
   * Whether the invitation list has been loaded from the backend.
   */
  const invitationListLoaded = ref(false);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  /**
   * Whether both the document list and invitation list have been loaded.
   */
  const isReady = computed(
    () => documentListLoaded.value && invitationListLoaded.value
  );

  // -------------------------------------------------------------------------
  // Internal helpers - type conversion
  // -------------------------------------------------------------------------

  /**
   * Convert a DocumentInfo from js-bao to our TrackedDocument type.
   * Note: getLocalMetadata() returns `lastKnownPermission` while documents.list()
   * returns `permission`, so we check both fields.
   *
   * When `existing` is provided, undefined fields in the incoming metadata will
   * preserve the existing values rather than being cleared. This handles cases
   * where metadata events arrive with partial data (e.g., title undefined after create).
   */
  const toTrackedDocument = (
    doc: DocumentInfo,
    existing?: TrackedDocument
  ): TrackedDocument => {
    const conversionLogger = logger.forScope("toTrackedDocument");
    const docWithAltFields = doc as DocumentInfo & {
      tags?: string[];
      lastKnownPermission?: DocumentInfo["permission"];
    };

    // Compute new values, preferring defined incoming values over existing
    const newPermission =
      doc.permission ?? docWithAltFields.lastKnownPermission;
    const newTags = docWithAltFields.tags;
    const newTitle = doc.title;

    conversionLogger.debug("Field resolution", {
      documentId: doc.documentId,
      incoming: {
        permission: doc.permission,
        lastKnownPermission: docWithAltFields.lastKnownPermission,
        tags: docWithAltFields.tags,
        title: doc.title,
      },
      computed: {
        newPermission,
        newTags,
        newTitle,
      },
      existing: existing
        ? {
            permission: existing.permission,
            tags: existing.tags,
            title: existing.title,
          }
        : null,
    });

    const result = {
      documentId: doc.documentId,
      // Preserve existing values when incoming values are undefined
      // Permission defaults to "reader" if neither incoming nor existing has a value
      permission:
        newPermission !== undefined
          ? newPermission
          : (existing?.permission ?? "reader"),
      tags: newTags !== undefined ? newTags : (existing?.tags ?? []),
      title: newTitle !== undefined ? newTitle : (existing?.title ?? ""),
    };

    conversionLogger.debug("Result", { result });
    return result;
  };

  // -------------------------------------------------------------------------
  // Public lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the documents store, loading the document list and setting up
   * real-time listeners for metadata and invitation changes.
   * This is typically called by `createPrimitiveApp` during app bootstrap.
   */
  const initialize = async (): Promise<void> => {
    const initLogger = logger.forScope("initialize");
    if (initStarted) {
      initLogger.debug("Already initialized; skipping");
      return;
    }
    initStarted = true;

    try {
      initLogger.debug("Initialization started");

      // Clear any previous state without calling reset() (which would clear initStarted)
      documents.value = [];
      pendingInvitations.value = [];
      openDocumentIds.value = new Set();
      documentListLoaded.value = false;
      invitationListLoaded.value = false;

      // Clean up any existing listeners
      if (removeDocumentMetadataListener) {
        removeDocumentMetadataListener();
        removeDocumentMetadataListener = null;
      }
      if (removeInvitationListener) {
        removeInvitationListener();
        removeInvitationListener = null;
      }

      const jsBaoClient = await jsBaoClientService.getClientAsync();

      // Register metadata change listener
      const metadataCallback = (
        updates: DocumentMetadataChangedEvent | DocumentMetadataChangedEvent[]
      ) => handleDocumentMetadataChanged(updates);

      jsBaoClient.on("documentMetadataChanged", metadataCallback);
      removeDocumentMetadataListener = () => {
        jsBaoClient.off("documentMetadataChanged", metadataCallback);
      };

      // Register invitation change listener
      const invitationCallback = (event: InvitationEvent) =>
        handleInvitationEvent(event);

      jsBaoClient.on("invitation", invitationCallback);
      removeInvitationListener = () => {
        jsBaoClient.off("invitation", invitationCallback);
      };

      // Load initial document list and invitations in parallel
      await Promise.all([loadDocumentList(), loadInvitationList()]);

      initLogger.debug("Initialization complete", {
        documentCount: documents.value.length,
        invitationCount: pendingInvitations.value.length,
      });
    } catch (error) {
      initLogger.error("Initialization error", error);
      throw error;
    }
  };

  /**
   * Reset the store state and clean up listeners.
   * Call this when the user logs out.
   */
  const reset = (): void => {
    const resetLogger = logger.forScope("reset");
    resetLogger.debug("Resetting jsBaoDocumentsStore state");

    documents.value = [];
    pendingInvitations.value = [];
    openDocumentIds.value = new Set();
    documentListLoaded.value = false;
    invitationListLoaded.value = false;

    if (removeDocumentMetadataListener) {
      try {
        removeDocumentMetadataListener();
      } catch {
        // Ignore cleanup errors
      }
      removeDocumentMetadataListener = null;
    }

    if (removeInvitationListener) {
      try {
        removeInvitationListener();
      } catch {
        // Ignore cleanup errors
      }
      removeInvitationListener = null;
    }

    initStarted = false;
  };

  // -------------------------------------------------------------------------
  // Document list management
  // -------------------------------------------------------------------------

  const loadDocumentList = async (): Promise<void> => {
    const loadLogger = logger.forScope("loadDocumentList");
    try {
      loadLogger.debug("Loading document list...");
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      // Uses default waitForLoad: "localIfAvailableElseNetwork"
      const list: DocumentInfo[] = await jsBaoClient.documents.list();
      const trackedList = list.map((doc) => toTrackedDocument(doc));
      loadLogger.debug("Document list loaded", {
        count: trackedList.length,
        documents: trackedList,
      });
      documents.value = trackedList;
      documentListLoaded.value = true;
    } catch (error) {
      loadLogger.error("Failed to load document list", error);
      throw error;
    }
  };

  /**
   * Refresh the document list from the backend.
   */
  const refreshDocuments = async (): Promise<void> => {
    await loadDocumentList();
  };

  /**
   * Get document metadata by ID.
   *
   * @param documentId - The document ID to look up
   * @returns TrackedDocument or undefined if not found
   */
  const getDocumentMetadataById = (
    documentId: string
  ): TrackedDocument | undefined => {
    return documents.value.find((doc) => doc.documentId === documentId);
  };

  // -------------------------------------------------------------------------
  // Document operations
  // -------------------------------------------------------------------------

  /**
   * Open a document for use. The document will be synced and available for queries.
   *
   * @param documentId - The document ID to open
   * @returns The TrackedDocument metadata
   */
  const openDocument = async (documentId: string): Promise<TrackedDocument> => {
    const openLogger = logger.forScope("openDocument");
    openLogger.debug("[STEP 1/4] Starting document open", { documentId });

    // Check if document is already open
    if (openDocumentIds.value.has(documentId)) {
      openLogger.debug("[STEP 1/4] Document already open, returning existing", {
        documentId,
      });
      const existingDoc = documents.value.find(
        (doc) => doc.documentId === documentId
      );
      if (existingDoc) {
        return existingDoc;
      }
      // Document is tracked as open but not in list - this shouldn't happen
      // but let's handle it by continuing with the open operation
      openLogger.warn(
        "[STEP 1/4] Document tracked as open but not in documents list, re-opening",
        { documentId }
      );
    }

    try {
      openLogger.debug("[STEP 2/4] Calling jsBaoClient.documents.open()", {
        documentId,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      await jsBaoClient.documents.open(documentId);
      openLogger.debug("[STEP 2/4] Document opened via js-bao", { documentId });

      // Ensure document is in our list via getLocalMetadata
      openLogger.debug("[STEP 3/4] Ensuring document is in list", {
        documentId,
      });
      const trackedDoc = await ensureDocumentInList(documentId);
      if (!trackedDoc) {
        const error = new Error(
          `Could not get metadata for document ${documentId} after opening`
        );
        openLogger.error("[FAILED] Could not get metadata after opening", {
          documentId,
        });
        throw error;
      }
      openLogger.debug("[STEP 3/4] Document ensured in list", {
        documentId,
        trackedDoc,
      });

      // Track as open
      openLogger.debug("[STEP 4/4] Adding to openDocumentIds", { documentId });
      openDocumentIds.value = new Set([...openDocumentIds.value, documentId]);

      openLogger.debug("[COMPLETE] Document opened successfully", {
        documentId,
        trackedDoc,
      });
      return trackedDoc;
    } catch (error) {
      openLogger.error("[FAILED] Failed to open document", {
        documentId,
        error,
      });
      throw error;
    }
  };

  /**
   * Close a document, stopping sync and releasing resources.
   *
   * @param documentId - The document ID to close
   */
  const closeDocument = async (documentId: string): Promise<void> => {
    const closeLogger = logger.forScope("closeDocument");
    closeLogger.debug("Closing document...", { documentId });

    try {
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      await jsBaoClient.documents.close(documentId);

      // Remove from open set
      const newSet = new Set(openDocumentIds.value);
      newSet.delete(documentId);
      openDocumentIds.value = newSet;

      closeLogger.debug("Document closed successfully", { documentId });
    } catch (error) {
      closeLogger.warn("Error closing document", { documentId, error });
      // Still remove from open set even if close fails
      const newSet = new Set(openDocumentIds.value);
      newSet.delete(documentId);
      openDocumentIds.value = newSet;
    }
  };

  /**
   * Create a new document.
   *
   * @param title - The document title
   * @param tags - Optional array of tags to apply to the document
   * @returns The created TrackedDocument
   */
  const createDocument = async (
    title: string,
    tags?: string[]
  ): Promise<TrackedDocument> => {
    const createLogger = logger.forScope("createDocument");
    try {
      createLogger.debug("[STEP 1/6] Starting document creation", {
        title,
        tags,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      createLogger.debug("[STEP 1/6] Got js-bao client");

      // Create the document
      createLogger.debug("[STEP 2/6] Calling jsBaoClient.documents.create()");
      const createRes = await jsBaoClient.documents.create({ title });
      createLogger.debug("[STEP 2/6] Raw response from documents.create", {
        createRes,
        metadata: createRes.metadata,
      });
      const metadata = createRes.metadata as DocumentInfo;
      const newId = metadata.documentId;
      createLogger.debug("[STEP 2/6] Document created locally", {
        documentId: newId,
        rawMetadata: metadata,
        hasTitle: "title" in metadata,
        titleValue: metadata.title,
        hasPermission: "permission" in metadata,
        permissionValue: metadata.permission,
      });

      // Commit the document to the server before adding tags.
      // documents.create() is local-first and the document may not exist on the server yet.
      // commitOfflineCreate() ensures the server acknowledges the document before we proceed.
      // If this fails (e.g., document already synced), we continue anyway since the goal is
      // just to ensure the document exists on the server.
      createLogger.debug(
        "[STEP 3/6] Committing document to server (commitOfflineCreate)",
        {
          documentId: newId,
        }
      );
      try {
        await jsBaoClient.documents.commitOfflineCreate(newId);
        createLogger.debug("[STEP 3/6] Document committed to server", {
          documentId: newId,
        });
      } catch (commitError) {
        // commitOfflineCreate can fail if the document has already synced to the server.
        // This is fine - we just want to ensure it exists on the server somehow.
        createLogger.warn(
          "[STEP 3/6] commitOfflineCreate failed (continuing anyway - document may already be synced)",
          {
            documentId: newId,
            error: commitError,
          }
        );
      }

      // Add tags via the documents.addTag() method if provided
      createLogger.debug("[STEP 4/6] Adding tags to document", {
        documentId: newId,
        tagCount: tags?.length ?? 0,
        tags,
      });
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          try {
            await jsBaoClient.documents.addTag(newId, tag);
            createLogger.debug("[STEP 4/6] Added tag to document", {
              documentId: newId,
              tag,
            });
          } catch (tagError) {
            createLogger.warn("[STEP 4/6] Failed to add tag to document", {
              documentId: newId,
              tag,
              error: tagError,
            });
            // Continue with other tags even if one fails
          }
        }
      }
      createLogger.debug("[STEP 4/6] Finished adding tags", {
        documentId: newId,
      });

      // Use toTrackedDocument with known values as fallbacks for undefined fields
      createLogger.debug("[STEP 5/6] Building TrackedDocument", {
        documentId: newId,
      });
      const knownValues: TrackedDocument = {
        documentId: newId,
        permission: "owner", // Creator is always owner
        tags: tags ?? [],
        title: title,
      };
      createLogger.debug("[STEP 5/6] Known values for fallback", {
        knownValues,
      });
      const trackedDoc = toTrackedDocument(metadata, knownValues);
      createLogger.debug("[STEP 5/6] Result from toTrackedDocument", {
        trackedDoc,
      });

      // Add directly to the documents list
      createLogger.debug("[STEP 6/6] Adding document to store list", {
        documentId: newId,
      });
      const idx = documents.value.findIndex((doc) => doc.documentId === newId);
      createLogger.debug("[STEP 6/6] Document list state before add", {
        existingIndex: idx,
        documentCount: documents.value.length,
      });
      if (idx !== -1) {
        documents.value[idx] = trackedDoc;
        createLogger.debug("[STEP 6/6] Updated existing document at index", {
          idx,
        });
      } else {
        documents.value = [...documents.value, trackedDoc];
        createLogger.debug("[STEP 6/6] Added new document to list");
      }

      createLogger.debug("[COMPLETE] Document creation finished successfully", {
        documentId: newId,
        trackedDoc,
        finalDocumentCount: documents.value.length,
      });
      return trackedDoc;
    } catch (error) {
      createLogger.error("[FAILED] Document creation failed", error);
      throw error;
    }
  };

  /**
   * Create a document with an alias atomically.
   * Used for creating default documents that should be uniquely identified by alias.
   *
   * @param title - The document title
   * @param alias - Alias configuration with scope ('user' or 'app') and aliasKey
   * @param tags - Optional array of tags to apply to the document
   * @returns Object containing the documentId and TrackedDocument
   */
  const createDocumentWithAlias = async (
    title: string,
    alias: { scope: "user" | "app"; aliasKey: string },
    tags?: string[]
  ): Promise<{ documentId: string; trackedDoc: TrackedDocument }> => {
    const createLogger = logger.forScope("createDocumentWithAlias");
    try {
      createLogger.debug("[STEP 1/5] Starting document creation with alias", {
        title,
        alias,
        tags,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      createLogger.debug("[STEP 1/5] Got js-bao client");

      // Create the document with alias atomically
      createLogger.debug(
        "[STEP 2/5] Calling jsBaoClient.documents.createWithAlias()"
      );
      const createRes = await jsBaoClient.documents.createWithAlias({
        title,
        alias,
      });
      createLogger.debug(
        "[STEP 2/5] Raw response from documents.createWithAlias",
        {
          createRes,
          hasMetadata: "metadata" in createRes,
          metadata: (createRes as { metadata?: unknown }).metadata,
        }
      );

      const newId = createRes.documentId;
      const metadata = (createRes as { metadata?: unknown }).metadata as
        | DocumentInfo
        | undefined;

      createLogger.debug("[STEP 2/5] Document created with alias", {
        documentId: newId,
        rawMetadata: metadata,
        hasTitle: metadata ? "title" in metadata : false,
        titleValue: metadata?.title,
        hasPermission: metadata ? "permission" in metadata : false,
        permissionValue: metadata?.permission,
      });

      // Add tags via the documents.addTag() method if provided
      createLogger.debug("[STEP 3/5] Adding tags to document", {
        documentId: newId,
        tagCount: tags?.length ?? 0,
        tags,
      });
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          try {
            await jsBaoClient.documents.addTag(newId, tag);
            createLogger.debug("[STEP 3/5] Added tag to document", {
              documentId: newId,
              tag,
            });
          } catch (tagError) {
            createLogger.warn("[STEP 3/5] Failed to add tag to document", {
              documentId: newId,
              tag,
              error: tagError,
            });
            // Continue with other tags even if one fails
          }
        }
      }
      createLogger.debug("[STEP 3/5] Finished adding tags", {
        documentId: newId,
      });

      // Use toTrackedDocument with known values as fallbacks for undefined fields
      createLogger.debug("[STEP 4/5] Building TrackedDocument", {
        documentId: newId,
      });
      const knownValues: TrackedDocument = {
        documentId: newId,
        permission: "owner", // Creator is always owner
        tags: tags ?? [],
        title: title,
      };
      createLogger.debug("[STEP 4/5] Known values for fallback", {
        knownValues,
      });

      // If metadata was returned, use it; otherwise use known values directly
      const trackedDoc = metadata
        ? toTrackedDocument(metadata, knownValues)
        : knownValues;
      createLogger.debug("[STEP 4/5] Result TrackedDocument", { trackedDoc });

      // Add directly to the documents list
      createLogger.debug("[STEP 5/5] Adding document to store list", {
        documentId: newId,
      });
      const idx = documents.value.findIndex((doc) => doc.documentId === newId);
      createLogger.debug("[STEP 5/5] Document list state before add", {
        existingIndex: idx,
        documentCount: documents.value.length,
      });
      if (idx !== -1) {
        documents.value[idx] = trackedDoc;
        createLogger.debug("[STEP 5/5] Updated existing document at index", {
          idx,
        });
      } else {
        documents.value = [...documents.value, trackedDoc];
        createLogger.debug("[STEP 5/5] Added new document to list");
      }

      createLogger.debug(
        "[COMPLETE] Document creation with alias finished successfully",
        {
          documentId: newId,
          trackedDoc,
          finalDocumentCount: documents.value.length,
        }
      );
      return { documentId: newId, trackedDoc };
    } catch (error) {
      createLogger.error("[FAILED] Document creation with alias failed", error);
      throw error;
    }
  };

  /**
   * Ensure a document exists for the given alias.
   * If a document with the alias already exists, returns its ID (and ensures it has the specified tags).
   * If not, creates a new document with the alias and returns the new ID.
   *
   * @param title - The document title (used if creating a new document)
   * @param alias - Alias configuration with scope ('user' or 'app') and aliasKey
   * @param tags - Optional array of tags to apply to the document
   * @returns The document ID (existing or newly created)
   */
  const ensureDocWithAlias = async (
    title: string,
    alias: { scope: "user" | "app"; aliasKey: string },
    tags?: string[]
  ): Promise<string> => {
    const ensureLogger = logger.forScope("ensureDocWithAlias");
    try {
      ensureLogger.debug("Ensuring document with alias exists", {
        title,
        alias,
        tags,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();

      // Try to resolve the alias to see if document already exists
      const existingAlias = await jsBaoClient.documents.aliases.resolve({
        scope: alias.scope,
        aliasKey: alias.aliasKey,
      });

      if (existingAlias && existingAlias.documentId) {
        ensureLogger.debug("Document with alias already exists", {
          documentId: existingAlias.documentId,
          alias,
        });

        // If tags were requested, ensure the existing document has them
        if (tags && tags.length > 0) {
          const existingDoc = documents.value.find(
            (d) => d.documentId === existingAlias.documentId
          );
          const existingTags = existingDoc?.tags ?? [];
          let addedAnyTags = false;

          for (const tag of tags) {
            if (!existingTags.includes(tag)) {
              try {
                await jsBaoClient.documents.addTag(
                  existingAlias.documentId,
                  tag
                );
                addedAnyTags = true;
                ensureLogger.debug("Added missing tag to existing document", {
                  documentId: existingAlias.documentId,
                  tag,
                });
              } catch (tagError) {
                ensureLogger.warn("Failed to add tag to existing document", {
                  documentId: existingAlias.documentId,
                  tag,
                  error: tagError,
                });
              }
            }
          }

          // Refresh document metadata from local storage to pick up new tags
          if (addedAnyTags) {
            await ensureDocumentInList(existingAlias.documentId);
          }
        }

        return existingAlias.documentId;
      }

      // Alias doesn't exist, create the document with alias
      ensureLogger.debug("Alias not found, creating new document", {
        title,
        alias,
        tags,
      });
      const { documentId } = await createDocumentWithAlias(title, alias, tags);
      ensureLogger.debug("Created new document with alias", {
        documentId,
        alias,
      });
      return documentId;
    } catch (error) {
      ensureLogger.error("Failed to ensure document with alias", error);
      throw error;
    }
  };

  /**
   * Rename a document.
   *
   * @param documentId - The document ID
   * @param newTitle - The new title for the document
   */
  const renameDocument = async (
    documentId: string,
    newTitle: string
  ): Promise<void> => {
    const renameLogger = logger.forScope("renameDocument");
    try {
      renameLogger.debug("Renaming document", { documentId, newTitle });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      await jsBaoClient.documents.update(documentId, { title: newTitle });

      // Refresh document metadata from local storage to pick up new title
      await ensureDocumentInList(documentId);

      renameLogger.debug("Document renamed successfully", { documentId });
    } catch (error) {
      renameLogger.error("Failed to rename document", error);
      throw error;
    }
  };

  /**
   * Delete a document.
   *
   * @param documentId - The document ID to delete
   * @param options - Optional deletion options
   * @param options.force - Force delete even if document has collaborators
   */
  const deleteDocument = async (
    documentId: string,
    options?: { force?: boolean }
  ): Promise<void> => {
    const deleteLogger = logger.forScope("deleteDocument");
    try {
      deleteLogger.debug("Deleting document", {
        documentId,
        force: options?.force,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();

      // Cast to any to pass force option - types may not be updated yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (jsBaoClient.documents.delete as any)(documentId, options);

      // Immediately remove from list for responsive UI
      removeDocumentFromList(documentId);

      deleteLogger.debug("Document deleted successfully", { documentId });
    } catch (error) {
      deleteLogger.error("Failed to delete document", error);
      throw error;
    }
  };

  /**
   * Share a document with another user by email.
   * Creates an invitation that the recipient can accept.
   *
   * @param documentId - The document ID to share
   * @param email - The recipient's email address
   * @param permission - Permission level to grant ('read-write' or 'reader')
   */
  const shareDocument = async (
    documentId: string,
    email: string,
    permission: "read-write" | "reader"
  ): Promise<void> => {
    const shareLogger = logger.forScope("shareDocument");
    try {
      shareLogger.debug("Sharing document", { documentId, email, permission });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      await jsBaoClient.documents.createInvitation(
        documentId,
        email,
        permission
      );
      shareLogger.debug("Document shared successfully", {
        documentId,
        email,
      });
    } catch (error) {
      shareLogger.error("Failed to share document", error);
      throw error;
    }
  };

  // -------------------------------------------------------------------------
  // Invitation management
  // -------------------------------------------------------------------------

  /**
   * Load pending invitations from the backend.
   * Called during initialization and when refreshing.
   */
  const loadInvitationList = async (): Promise<void> => {
    const loadLogger = logger.forScope("loadInvitationList");
    try {
      loadLogger.debug("Loading pending invitations...");
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      // pendingDocumentInvitations() returns invitations with document metadata
      const invitations = await jsBaoClient.me.pendingDocumentInvitations();
      loadLogger.debug("Pending invitations loaded", {
        count: invitations.length,
      });
      // The API returns invitations with document metadata, which is compatible
      // with PendingInvitation
      pendingInvitations.value = invitations;
      invitationListLoaded.value = true;
    } catch (error) {
      loadLogger.error("Failed to load invitations", error);
      // Don't throw - invitations are not critical for initialization
      invitationListLoaded.value = true;
    }
  };

  /**
   * Refresh the list of pending invitations from the backend.
   */
  const refreshPendingInvitations = async (): Promise<void> => {
    await loadInvitationList();
  };

  /**
   * Accept a pending invitation to access a document.
   * After accepting, the document will appear in the documents list.
   *
   * @param documentId - The document ID from the invitation
   */
  const acceptInvitation = async (documentId: string): Promise<void> => {
    const acceptLogger = logger.forScope("acceptInvitation");
    try {
      acceptLogger.debug("Accepting pending invitation for document", {
        documentId,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      const access = await jsBaoClient.documents.acceptInvitation(documentId);
      acceptLogger.debug("Invitation accepted, access granted", { access });
      // Refresh both invitations and documents list so the newly accessible
      // document appears in the documents list
      await Promise.all([refreshPendingInvitations(), refreshDocuments()]);
    } catch (error) {
      acceptLogger.error("Failed to accept invitation", error);
      throw error;
    }
  };

  /**
   * Decline a pending invitation.
   * The invitation will be removed from the pending list.
   *
   * @param documentId - The document ID from the invitation
   * @param invitationId - The invitation ID
   */
  const declineInvitation = async (
    documentId: string,
    invitationId: string
  ): Promise<void> => {
    const declineLogger = logger.forScope("declineInvitation");
    try {
      declineLogger.debug("Declining pending invitation", {
        documentId,
        invitationId,
      });
      const jsBaoClient = await jsBaoClientService.getClientAsync();
      await jsBaoClient.documents.declineInvitation(documentId, invitationId);
      declineLogger.debug("Invitation declined and removed from pending list", {
        documentId,
        invitationId,
      });
      await refreshPendingInvitations();
    } catch (error) {
      declineLogger.error("Failed to decline invitation", error);
      throw error;
    }
  };

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Ensures a document is in our tracked list by fetching its metadata.
   * Returns the TrackedDocument if successful, undefined if:
   * - The document is the root document (never added to list)
   * - The metadata couldn't be fetched (may have been deleted)
   */
  const ensureDocumentInList = async (
    documentId: string
  ): Promise<TrackedDocument | undefined> => {
    const ensureLogger = logger.forScope("ensureDocumentInList");

    try {
      const jsBaoClient = await jsBaoClientService.getClientAsync();

      // Skip root document - it should not be added to the list
      const rootDocId = jsBaoClient.getRootDocId();
      if (rootDocId && documentId === rootDocId) {
        ensureLogger.debug("Skipping root document", { documentId });
        return undefined;
      }

      const metadata = (await jsBaoClient.documents.getLocalMetadata(
        documentId
      )) as DocumentInfo | null;

      if (!metadata) {
        ensureLogger.debug(
          "getLocalMetadata returned null; document may have been deleted or not synced yet",
          { documentId }
        );
        return undefined;
      }

      ensureLogger.debug("Raw metadata from getLocalMetadata", {
        documentId,
        rawMetadata: metadata,
      });

      // Find existing document to preserve values when incoming data has undefined fields
      const idx = documents.value.findIndex(
        (doc) => doc.documentId === documentId
      );
      const existing = idx !== -1 ? documents.value[idx] : undefined;
      const trackedDoc = toTrackedDocument(metadata, existing);

      // Update or add to documents list
      if (idx !== -1) {
        documents.value[idx] = trackedDoc;
        ensureLogger.debug("Updated existing document in list", {
          documentId,
          metadata: trackedDoc,
        });
      } else {
        documents.value = [...documents.value, trackedDoc];
        ensureLogger.debug("Added new document to list", {
          documentId,
          metadata: trackedDoc,
        });
      }

      return trackedDoc;
    } catch (error) {
      ensureLogger.warn("Failed to ensure document in list", {
        documentId,
        error,
      });
      return undefined;
    }
  };

  const removeDocumentFromList = (documentId: string): void => {
    const removeLogger = logger.forScope("removeDocumentFromList");
    const idx = documents.value.findIndex(
      (doc) => doc.documentId === documentId
    );
    if (idx !== -1) {
      documents.value = documents.value.filter(
        (doc) => doc.documentId !== documentId
      );
      removeLogger.debug("Removed document from list", { documentId });
    }

    // Also remove from open set if present
    if (openDocumentIds.value.has(documentId)) {
      const newSet = new Set(openDocumentIds.value);
      newSet.delete(documentId);
      openDocumentIds.value = newSet;
      removeLogger.debug("Removed document from open set", { documentId });
    }
  };

  const handleDocumentMetadataChanged = async (
    updates: DocumentMetadataChangedEvent | DocumentMetadataChangedEvent[]
  ): Promise<void> => {
    const updateList = Array.isArray(updates) ? updates : [updates];

    for (const update of updateList) {
      if (!update) continue;

      const { documentId, action, changedFields } = update;

      // Ignore events without an action (these are internal metadata updates
      // that don't affect the document list)
      if (!action) continue;

      logger.debug("documentMetadataChanged:event", {
        documentId,
        action,
        source: update.source,
        changedFields,
      });

      switch (action) {
        case "created":
          // Skip local creates - the createDocument/createDocumentWithAlias path
          // already adds the document to the list, so processing the event would
          // cause a race condition with incomplete metadata.
          if (update.source === "local") {
            logger.debug(
              "Skipping local create event (handled by create path)",
              {
                documentId,
              }
            );
            break;
          }
          // Add remotely created documents (e.g., accepted invitations, shared docs)
          await ensureDocumentInList(documentId);
          break;

        case "updated": {
          // Skip local updates - local operations (renameDocument, etc.) update
          // the list directly for immediate UI responsiveness.
          if (update.source === "local") {
            logger.debug(
              "Skipping local update event (handled by operation path)",
              { documentId }
            );
            break;
          }

          // Only update if one of our tracked fields changed
          const hasTrackedFieldChange =
            Array.isArray(changedFields) &&
            changedFields.some((field) => TRACKED_FIELDS.has(field));

          if (hasTrackedFieldChange) {
            await ensureDocumentInList(documentId);
          } else {
            logger.debug("Skipping update - no tracked fields changed", {
              documentId,
              changedFields,
            });
          }
          break;
        }

        case "deleted":
        case "evicted":
          // Skip local deletes - deleteDocument updates the list directly.
          if (update.source === "local") {
            logger.debug(
              "Skipping local delete/evict event (handled by operation path)",
              { documentId }
            );
            break;
          }
          // Remove from list for server-initiated deletions
          removeDocumentFromList(documentId);
          break;

        default:
          // Ignore any other action types silently
          break;
      }
    }
  };

  /**
   * Handle invitation events from the WebSocket.
   * Updates pendingInvitations based on the action:
   * - created: Add new invitation to list
   * - updated: Update existing invitation in list
   * - cancelled/declined: Remove invitation from list
   */
  const handleInvitationEvent = (event: InvitationEvent): void => {
    const inviteLogger = logger.forScope("handleInvitationEvent");

    inviteLogger.debug("Received invitation event", {
      action: event.action,
      invitationId: event.invitationId,
      documentId: event.documentId,
      permission: event.permission,
      title: event.title,
      documentTags: event.document?.tags,
    });

    switch (event.action) {
      case "created": {
        // Check if invitation already exists (avoid duplicates)
        const existingIdx = pendingInvitations.value.findIndex(
          (inv) => inv.invitationId === event.invitationId
        );
        if (existingIdx !== -1) {
          inviteLogger.debug("Invitation already exists, skipping add", {
            invitationId: event.invitationId,
          });
          break;
        }

        // Map event to PendingInvitation type
        const newInvitation: PendingInvitation = {
          invitationId: event.invitationId,
          documentId: event.documentId,
          // email is the invitee's email - for pending invitations to us,
          // this is our own email. The event doesn't include it, so we use
          // an empty string as a placeholder since UI doesn't display it.
          email: "",
          permission: event.permission as PendingInvitation["permission"],
          invitedBy: event.invitedBy ?? "",
          invitedAt: event.invitedAt ?? new Date().toISOString(),
          expiresAt: event.expiresAt,
          accepted: false,
          title: event.title,
          document: event.document,
        };

        pendingInvitations.value = [...pendingInvitations.value, newInvitation];
        inviteLogger.debug("Added new invitation to pending list", {
          invitationId: event.invitationId,
          documentId: event.documentId,
        });
        break;
      }

      case "updated": {
        const idx = pendingInvitations.value.findIndex(
          (inv) => inv.invitationId === event.invitationId
        );
        if (idx === -1) {
          inviteLogger.debug("Invitation not found for update, adding it", {
            invitationId: event.invitationId,
          });
          // If we don't have it, treat as created
          handleInvitationEvent({ ...event, action: "created" });
          break;
        }

        // Update the existing invitation with new values from the event
        const existing = pendingInvitations.value[idx]!;
        const updated: PendingInvitation = {
          invitationId: existing.invitationId,
          documentId: existing.documentId,
          email: existing.email,
          permission: event.permission as PendingInvitation["permission"],
          invitedBy: existing.invitedBy,
          invitedAt: existing.invitedAt,
          expiresAt: event.expiresAt ?? existing.expiresAt,
          accepted: existing.accepted,
          acceptedAt: existing.acceptedAt,
          title: event.title ?? existing.title,
          document: event.document ?? existing.document,
        };

        const newList = [...pendingInvitations.value];
        newList[idx] = updated;
        pendingInvitations.value = newList;

        inviteLogger.debug("Updated invitation in pending list", {
          invitationId: event.invitationId,
        });
        break;
      }

      case "cancelled":
      case "declined": {
        const idx = pendingInvitations.value.findIndex(
          (inv) => inv.invitationId === event.invitationId
        );
        if (idx === -1) {
          inviteLogger.debug("Invitation not found for removal", {
            invitationId: event.invitationId,
            action: event.action,
          });
          break;
        }

        pendingInvitations.value = pendingInvitations.value.filter(
          (inv) => inv.invitationId !== event.invitationId
        );
        inviteLogger.debug("Removed invitation from pending list", {
          invitationId: event.invitationId,
          action: event.action,
        });
        break;
      }

      default:
        inviteLogger.debug("Unknown invitation action, ignoring", {
          action: (event as InvitationEvent).action,
        });
        break;
    }
  };

  // -------------------------------------------------------------------------
  // Return public API
  // -------------------------------------------------------------------------

  return {
    // state
    documents,
    pendingInvitations,
    openDocumentIds,
    documentListLoaded,
    invitationListLoaded,

    // getters
    isReady,

    // actions
    initialize,
    reset,
    refreshDocuments,
    getDocumentMetadataById,
    openDocument,
    closeDocument,
    createDocument,
    createDocumentWithAlias,
    ensureDocWithAlias,
    renameDocument,
    deleteDocument,
    shareDocument,
    refreshPendingInvitations,
    acceptInvitation,
    declineInvitation,
  };
});
