/**
 * @module multiDocumentStore
 *
 * Pinia store for multi-document mode with tag-based collections.
 *
 * Use this store when your app needs to work with multiple documents
 * organized into collections. The store provides:
 *
 * - Tag-based document collections with auto-open
 * - Collection-level readiness tracking
 * - Auto-acceptance of invitations for specific collections
 * - Document creation within collections
 *
 * ## Usage
 *
 * ```ts
 * import { useMultiDocumentStore } from '@/stores/multiDocumentStore';
 *
 * const multiDoc = useMultiDocumentStore();
 *
 * // Register a collection
 * await multiDoc.registerCollection({
 *   name: 'projects',
 *   tag: 'project',
 *   autoOpen: true,
 *   autoAcceptInvites: true,
 * });
 *
 * // Access documents in the collection
 * const projects = multiDoc.getCollection('projects');
 *
 * // Create a new document in the collection
 * const newProject = await multiDoc.createDocument('projects', 'My Project');
 *
 * // Check collection readiness
 * const isReady = multiDoc.isCollectionReady('projects');
 * ```
 *
 * ## Configuration
 *
 * Configured via `createPrimitiveApp` with `documentStoreMode: 'multi'`.
 */
import { defineStore } from "pinia";
import {
  computed,
  ref,
  watch,
  type ComputedRef,
  type Ref,
  type WatchStopHandle,
} from "vue";
import { appBaseLogger } from "../lib/logger";
import { jsBaoClientService } from "primitive-app";
import {
  useJsBaoDocumentsStore,
  type PendingInvitation,
  type TrackedDocument,
} from "./jsBaoDocumentsStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for registering a document collection.
 */
export interface CollectionConfig {
  /** Identifier for the collection. Defaults to tag if not specified. */
  name?: string;
  /** The document tag to filter by. */
  tag: string;
  /** Auto-open matching documents when registered. Defaults to true. */
  autoOpen?: boolean;
  /** Auto-accept invitations for documents in this collection. Defaults to false. */
  autoAcceptInvites?: boolean;
}

/**
 * Internal representation of a registered collection.
 */
interface RegisteredCollection {
  name: string;
  tag: string;
  autoOpen: boolean;
  autoAcceptInvites: boolean;
  /** True when there are no pending document operations (opens/closes). */
  isReady: boolean;
  /** Document IDs with pending operations (for collection readiness tracking). */
  awaitingReadinessDocIds: Set<string>;
  /** Document IDs we know about (for detecting additions/removals). */
  knownDocumentIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Module-scoped lifecycle resources
// ---------------------------------------------------------------------------

let stopDocumentsWatcher: WatchStopHandle | null = null;
let stopInvitationWatcher: WatchStopHandle | null = null;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMultiDocumentStore = defineStore("multiDocument", () => {
  const logger = appBaseLogger.forScope("multiDocumentStore");

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /** Registry of all registered collections */
  const registeredCollections = ref<Map<string, RegisteredCollection>>(
    new Map()
  );

  /** Promises for documents currently being opened - allows waiting for opens in progress */
  const documentOpenPromises = ref<Map<string, Promise<boolean>>>(new Map());

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  /**
   * All registered collections as a reactive object.
   * Keys are collection names, values are arrays of TrackedDocuments matching the collection's tag.
   */
  const collections = computed<Record<string, TrackedDocument[]>>(() => {
    const documentsStore = useJsBaoDocumentsStore();
    const result: Record<string, TrackedDocument[]> = {};

    for (const [name, config] of registeredCollections.value) {
      result[name] = documentsStore.documents.filter((doc) =>
        doc.tags.includes(config.tag)
      );
    }

    return result;
  });

  // -------------------------------------------------------------------------
  // Collection management
  // -------------------------------------------------------------------------

  /**
   * Register a new document collection.
   * If autoOpen is true (default), all matching documents will be opened.
   */
  async function registerCollection(config: CollectionConfig): Promise<void> {
    const name = config.name ?? config.tag;
    const regLogger = logger.forScope("registerCollection");

    // Validate uniqueness
    if (registeredCollections.value.has(name)) {
      const error = new Error(
        `Collection "${name}" is already registered. Unregister it first.`
      );
      regLogger.error("Cannot register collection", error);
      throw error;
    }

    regLogger.debug("Registering collection", {
      name,
      tag: config.tag,
      autoOpen: config.autoOpen ?? true,
      autoAcceptInvites: config.autoAcceptInvites ?? false,
    });

    const collection: RegisteredCollection = {
      name,
      tag: config.tag,
      autoOpen: config.autoOpen ?? true,
      autoAcceptInvites: config.autoAcceptInvites ?? false,
      isReady: false,
      awaitingReadinessDocIds: new Set(),
      knownDocumentIds: new Set(),
    };

    // Add to registry (not ready yet)
    registeredCollections.value = new Map(registeredCollections.value).set(
      name,
      collection
    );

    // Set up documents watcher if this is the first collection
    if (registeredCollections.value.size === 1) {
      setupDocumentsWatcher();
    }

    // Set up invitation watcher if this is the first collection with autoAcceptInvites
    if (collection.autoAcceptInvites) {
      setupInvitationWatcher();
      // Accept any pending invitations that are already in the list
      await acceptPendingInvitations();
    }

    // THEN open documents (now finds the just-accepted docs)
    if (collection.autoOpen) {
      await openCollectionDocuments(collection);
    }

    // Now mark ready - all docs are accepted AND opened
    collection.isReady = true;
    registeredCollections.value = new Map(registeredCollections.value).set(
      name,
      collection
    );

    regLogger.debug("Collection registered", {
      name,
      documentCount: collections.value[name]?.length ?? 0,
    });
  }

  /**
   * Unregister a document collection.
   * If autoOpen was true, matching documents will be closed
   * (unless they belong to another collection).
   */
  async function unregisterCollection(name: string): Promise<void> {
    const unregLogger = logger.forScope("unregisterCollection");
    const collection = registeredCollections.value.get(name);

    if (!collection) {
      unregLogger.warn("Collection not found", { name });
      return;
    }

    unregLogger.debug("Unregistering collection", {
      name,
      tag: collection.tag,
    });

    // Close documents if autoOpen was enabled
    if (collection.autoOpen) {
      await closeCollectionDocuments(collection);
    }

    // Remove from registry
    const newMap = new Map(registeredCollections.value);
    newMap.delete(name);
    registeredCollections.value = newMap;

    // Clean up listeners if no collections remain
    if (registeredCollections.value.size === 0) {
      cleanupListeners();
    } else {
      // Stop invitation watcher if no collections need it
      const anyAutoAccept = [...registeredCollections.value.values()].some(
        (c) => c.autoAcceptInvites
      );
      if (!anyAutoAccept && stopInvitationWatcher) {
        stopInvitationWatcher();
        stopInvitationWatcher = null;
        unregLogger.debug(
          "Invitation watcher stopped (no autoAccept collections)"
        );
      }
    }

    unregLogger.debug("Collection unregistered", { name });
  }

  /**
   * Get documents for a specific collection.
   *
   * @param name - The collection name
   * @returns Array of TrackedDocuments in the collection
   */
  function getCollection(name: string): TrackedDocument[] {
    return collections.value[name] ?? [];
  }

  // -------------------------------------------------------------------------
  // Collection readiness
  // -------------------------------------------------------------------------

  /**
   * Check if a collection is registered (may still be loading).
   * Use this to avoid duplicate registration attempts.
   */
  function isCollectionRegistered(name: string): boolean {
    return registeredCollections.value.has(name);
  }

  /**
   * Check if a collection is ready.
   * A collection is ready when there are no pending document operations
   * (all opens/closes from registration or document changes have completed).
   */
  function isCollectionReady(name: string): boolean {
    const collection = registeredCollections.value.get(name);
    return collection?.isReady ?? false;
  }

  /**
   * Get a reactive ref for a collection's readiness.
   * Returns true when there are no pending document operations.
   */
  function getCollectionReadyRef(name: string): ComputedRef<boolean> {
    return computed(() => {
      const collection = registeredCollections.value.get(name);
      return collection?.isReady ?? false;
    });
  }

  // -------------------------------------------------------------------------
  // Document creation
  // -------------------------------------------------------------------------

  /**
   * Create a new document in a specific collection.
   * The document will be tagged with the collection's tag.
   * If autoOpen is enabled for the collection, the document will be opened immediately.
   *
   * @param collectionName - The name of the collection to create the document in
   * @param title - The title of the document
   * @param options - Optional creation options
   * @param options.alias - If provided, creates the document with an alias for uniqueness
   */
  async function createDocument(
    collectionName: string,
    title: string,
    options?: {
      alias?: { scope: "user" | "app"; aliasKey: string };
    }
  ): Promise<TrackedDocument> {
    const createLogger = logger.forScope("createDocument");

    createLogger.debug("[STEP 1/4] Starting document creation in collection", {
      collectionName,
      title,
      alias: options?.alias,
    });

    const collection = registeredCollections.value.get(collectionName);

    if (!collection) {
      const error = new Error(
        `Collection "${collectionName}" is not registered`
      );
      createLogger.error(
        "[FAILED] Cannot create document - collection not registered",
        error
      );
      throw error;
    }

    createLogger.debug("[STEP 1/4] Found collection", {
      collectionName,
      tag: collection.tag,
      autoOpen: collection.autoOpen,
    });

    createLogger.debug(
      "[STEP 2/4] Calling jsBaoDocumentsStore to create document",
      {
        collectionName,
        title,
        tag: collection.tag,
        alias: options?.alias,
        creationType: options?.alias
          ? "createDocumentWithAlias"
          : "createDocument",
      }
    );

    const documentsStore = useJsBaoDocumentsStore();

    let trackedDoc: TrackedDocument;
    if (options?.alias) {
      // Create with alias for uniqueness
      createLogger.debug("[STEP 2/4] Using createDocumentWithAlias");
      const result = await documentsStore.createDocumentWithAlias(
        title,
        options.alias,
        [collection.tag]
      );
      trackedDoc = result.trackedDoc;
    } else {
      // Standard document creation
      createLogger.debug("[STEP 2/4] Using createDocument");
      trackedDoc = await documentsStore.createDocument(title, [collection.tag]);
    }

    createLogger.debug("[STEP 3/4] Document created via jsBaoDocumentsStore", {
      documentId: trackedDoc.documentId,
      collectionName,
      trackedDoc,
    });

    // If autoOpen is enabled, open the document directly and update knownDocumentIds
    // to prevent handleDocumentsChanged from trying to open it again
    if (collection.autoOpen) {
      createLogger.debug(
        "[STEP 4/4] Auto-opening document (autoOpen enabled)",
        {
          documentId: trackedDoc.documentId,
          collectionName,
        }
      );
      collection.knownDocumentIds.add(trackedDoc.documentId);
      createLogger.debug("[STEP 4/4] Added to knownDocumentIds", {
        documentId: trackedDoc.documentId,
      });
      await safeOpenDocument(
        trackedDoc.documentId,
        `createDocument:${collectionName}`
      );
      createLogger.debug("[STEP 4/4] Document opened successfully", {
        documentId: trackedDoc.documentId,
      });
    } else {
      createLogger.debug("[STEP 4/4] Skipping auto-open (autoOpen disabled)", {
        documentId: trackedDoc.documentId,
        collectionName,
      });
    }

    createLogger.debug("[COMPLETE] Document creation in collection finished", {
      documentId: trackedDoc.documentId,
      collectionName,
      trackedDoc,
    });

    return trackedDoc;
  }

  // -------------------------------------------------------------------------
  // Document readiness
  // -------------------------------------------------------------------------

  /**
   * Check if a specific document is open and ready.
   */
  function isDocumentReady(documentId: string): boolean {
    const documentsStore = useJsBaoDocumentsStore();
    return documentsStore.openDocumentIds.has(documentId);
  }

  /**
   * Get a computed ref that tracks whether a specific document is ready.
   */
  function getDocumentReadyRef(
    documentIdRef: Ref<string> | ComputedRef<string>
  ): ComputedRef<boolean> {
    const documentsStore = useJsBaoDocumentsStore();
    return computed(() => {
      const docId = documentIdRef.value;
      if (!docId) return false;
      return documentsStore.openDocumentIds.has(docId);
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reset the store, unregistering all collections and closing their documents.
   * Call this when the user logs out.
   */
  function reset(): void {
    const resetLogger = logger.forScope("reset");
    resetLogger.debug("Resetting multiDocumentStore");

    // Close all documents from all collections
    const documentsStore = useJsBaoDocumentsStore();
    for (const [, collection] of registeredCollections.value) {
      if (collection.autoOpen) {
        const docs = collections.value[collection.name] ?? [];
        for (const doc of docs) {
          documentsStore.closeDocument(doc.documentId).catch((error) => {
            resetLogger.error("Failed to close document during reset", {
              documentId: doc.documentId,
              error,
            });
          });
        }
      }
    }

    // Clear registry
    registeredCollections.value = new Map();

    // Clean up listeners
    cleanupListeners();

    resetLogger.debug("Reset complete");
  }

  // -------------------------------------------------------------------------
  // Internal helpers - safe document opening
  // -------------------------------------------------------------------------

  /**
   * Safely open a document, preventing duplicate concurrent opens.
   * Uses a promise-based mechanism so all callers wait for the same open operation.
   *
   * @param docId - The document ID to open
   * @param context - Description of the caller for logging
   * @returns true if the document was opened successfully
   * @throws Error if the document fails to open (propagated to all waiters)
   */
  async function safeOpenDocument(
    docId: string,
    context: string
  ): Promise<boolean> {
    const safeOpenLogger = logger.forScope("safeOpenDocument");

    safeOpenLogger.debug("Attempting to open document", {
      documentId: docId,
      context,
    });

    // If there's already an open in progress, wait for it to complete
    const existingPromise = documentOpenPromises.value.get(docId);
    if (existingPromise) {
      safeOpenLogger.debug("Waiting for existing open in progress", {
        documentId: docId,
        context,
      });
      return await existingPromise;
    }

    // Check if already open
    const documentsStore = useJsBaoDocumentsStore();
    if (documentsStore.openDocumentIds.has(docId)) {
      safeOpenLogger.debug("Document already open", {
        documentId: docId,
        context,
      });
      return true;
    }

    // Create the promise for this open operation
    let resolveOpen!: (result: boolean) => void;
    let rejectOpen!: (error: unknown) => void;
    const openPromise = new Promise<boolean>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });

    // Store it so other callers can wait on it
    safeOpenLogger.debug("Claiming open lock", { documentId: docId });
    documentOpenPromises.value = new Map([
      ...documentOpenPromises.value,
      [docId, openPromise],
    ]);

    try {
      safeOpenLogger.debug("Calling jsBaoDocumentsStore.openDocument", {
        documentId: docId,
      });
      await documentsStore.openDocument(docId);
      safeOpenLogger.debug("Successfully opened document", {
        documentId: docId,
        context,
      });
      resolveOpen(true);
      return true;
    } catch (error) {
      safeOpenLogger.error("Failed to open document", {
        documentId: docId,
        context,
        error,
      });
      rejectOpen(error);
      throw error;
    } finally {
      safeOpenLogger.debug("Releasing open lock", { documentId: docId });
      const newMap = new Map(documentOpenPromises.value);
      newMap.delete(docId);
      documentOpenPromises.value = newMap;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers - reactive document watching
  // -------------------------------------------------------------------------

  /**
   * Set up a watch on jsBaoDocumentsStore.documents to auto-open/close
   * documents when they join or leave collections.
   */
  function setupDocumentsWatcher(): void {
    if (stopDocumentsWatcher) return; // Already watching

    const documentsStore = useJsBaoDocumentsStore();

    stopDocumentsWatcher = watch(
      () => documentsStore.documents,
      () => {
        // When documents change, check if any need to be opened or closed
        void handleDocumentsChanged();
      },
      { deep: true }
    );

    logger.debug("Documents watcher set up");
  }

  function cleanupListeners(): void {
    if (stopDocumentsWatcher) {
      stopDocumentsWatcher();
      stopDocumentsWatcher = null;
    }

    if (stopInvitationWatcher) {
      stopInvitationWatcher();
      stopInvitationWatcher = null;
    }

    logger.debug("Listeners cleaned up");
  }

  /**
   * Called when documents change in jsBaoDocumentsStore.
   * Opens documents that join collections with autoOpen, and closes
   * documents that leave collections with autoOpen.
   */
  async function handleDocumentsChanged(): Promise<void> {
    const changeLogger = logger.forScope("handleDocumentsChanged");
    const documentsStore = useJsBaoDocumentsStore();

    changeLogger.debug("Documents changed - checking for document changes", {
      totalDocuments: documentsStore.documents.length,
      openDocumentCount: documentsStore.openDocumentIds.size,
      registeredCollections: [...registeredCollections.value.keys()],
    });

    // Process each collection with autoOpen that has completed initial registration
    for (const [name, collection] of registeredCollections.value) {
      if (!collection.autoOpen) {
        changeLogger.debug("Skipping collection (autoOpen disabled)", {
          collection: collection.name,
        });
        continue;
      }

      const currentDocs = collections.value[collection.name] ?? [];
      const currentDocIds = new Set(currentDocs.map((d) => d.documentId));

      // Find added documents (in current but not in known)
      const addedDocIds: string[] = [];
      for (const docId of currentDocIds) {
        if (!collection.knownDocumentIds.has(docId)) {
          addedDocIds.push(docId);
        }
      }

      // Find removed documents (in known but not in current)
      const removedDocIds: string[] = [];
      for (const docId of collection.knownDocumentIds) {
        if (!currentDocIds.has(docId)) {
          removedDocIds.push(docId);
        }
      }

      if (addedDocIds.length === 0 && removedDocIds.length === 0) {
        continue;
      }

      changeLogger.debug("Detected document changes in collection", {
        collection: collection.name,
        addedCount: addedDocIds.length,
        removedCount: removedDocIds.length,
        addedDocIds,
        removedDocIds,
      });

      // Mark collection as not ready while processing
      collection.isReady = false;

      // Process added documents: update knownDocumentIds/awaitingReadinessDocIds and open atomically
      for (const docId of addedDocIds) {
        collection.knownDocumentIds.add(docId);
        collection.awaitingReadinessDocIds.add(docId);
        try {
          await safeOpenDocument(
            docId,
            `handleDocumentsChanged:${collection.name}`
          );
        } catch (error) {
          changeLogger.error("Failed to auto-open document", {
            documentId: docId,
            collection: collection.name,
            error,
          });
          // Continue with other documents
        } finally {
          collection.awaitingReadinessDocIds.delete(docId);
        }
      }

      // Process removed documents: update knownDocumentIds and close
      const otherCollectionDocIds = new Set<string>();
      for (const [otherName, otherCollection] of registeredCollections.value) {
        if (otherName === collection.name || !otherCollection.autoOpen)
          continue;
        const otherDocs = collections.value[otherName] ?? [];
        for (const doc of otherDocs) {
          otherCollectionDocIds.add(doc.documentId);
        }
      }

      for (const docId of removedDocIds) {
        collection.knownDocumentIds.delete(docId);

        // Skip if document is already closed (e.g., was deleted)
        if (!documentsStore.openDocumentIds.has(docId)) {
          changeLogger.debug("Skipping close (document already closed)", {
            documentId: docId,
          });
          continue;
        }

        // Don't close if document is in another collection
        if (otherCollectionDocIds.has(docId)) {
          changeLogger.debug(
            "Skipping close (document in another collection)",
            { documentId: docId }
          );
          continue;
        }

        collection.awaitingReadinessDocIds.add(docId);
        try {
          changeLogger.debug("Auto-closing document that left collection", {
            documentId: docId,
            collection: collection.name,
          });
          await documentsStore.closeDocument(docId);
          changeLogger.debug("Successfully auto-closed document", {
            documentId: docId,
          });
        } catch (error) {
          changeLogger.error("Failed to auto-close document", {
            documentId: docId,
            collection: collection.name,
            error,
          });
          // Continue with other documents
        } finally {
          collection.awaitingReadinessDocIds.delete(docId);
        }
      }

      // Mark collection as ready now that all operations are complete
      collection.isReady = true;
      registeredCollections.value = new Map(registeredCollections.value).set(
        name,
        collection
      );

      changeLogger.debug("Collection is ready after processing changes", {
        collection: collection.name,
        knownDocCount: collection.knownDocumentIds.size,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers - collection document management
  // -------------------------------------------------------------------------

  async function openCollectionDocuments(
    collection: RegisteredCollection
  ): Promise<void> {
    const openLogger = logger.forScope("openCollectionDocuments");
    const jsBaoClient = await jsBaoClientService.getClientAsync();

    openLogger.debug("Opening documents for collection", {
      name: collection.name,
      tag: collection.tag,
    });

    // Query for documents with the collection's tag
    const taggedDocs = await jsBaoClient.documents.list({
      tag: collection.tag,
      refreshFromServer: true,
    });

    openLogger.debug("Found tagged documents", {
      collection: collection.name,
      count: taggedDocs.length,
    });

    // Process each document atomically: add to known and pending, then open
    for (const doc of taggedDocs) {
      collection.knownDocumentIds.add(doc.documentId);
      collection.awaitingReadinessDocIds.add(doc.documentId);
      try {
        await safeOpenDocument(
          doc.documentId,
          `openCollectionDocuments:${collection.name}`
        );
      } catch (error) {
        openLogger.error("Failed to open document", {
          documentId: doc.documentId,
          collection: collection.name,
          error,
        });
        // Continue with other documents even if one fails
      } finally {
        collection.awaitingReadinessDocIds.delete(doc.documentId);
      }
    }

    openLogger.debug("Finished opening documents for collection", {
      collection: collection.name,
      openedCount: taggedDocs.length,
    });
  }

  async function closeCollectionDocuments(
    collection: RegisteredCollection
  ): Promise<void> {
    const closeLogger = logger.forScope("closeCollectionDocuments");
    const documentsStore = useJsBaoDocumentsStore();

    // Get documents in this collection (use knownDocumentIds since we're unregistering)
    const docsToClose = [...collection.knownDocumentIds];

    closeLogger.debug("Closing documents for collection", {
      name: collection.name,
      count: docsToClose.length,
    });

    // Check which documents are also in other collections (don't close those)
    const otherCollectionDocIds = new Set<string>();
    for (const [otherName, otherCollection] of registeredCollections.value) {
      if (otherName === collection.name || !otherCollection.autoOpen) continue;
      for (const docId of otherCollection.knownDocumentIds) {
        otherCollectionDocIds.add(docId);
      }
    }

    for (const docId of docsToClose) {
      // Check if this document belongs to another collection
      if (otherCollectionDocIds.has(docId)) {
        closeLogger.debug("Skipping document (in another collection)", {
          documentId: docId,
        });
        continue;
      }

      try {
        await documentsStore.closeDocument(docId);
        closeLogger.debug("Closed document", { documentId: docId });
      } catch (error) {
        closeLogger.error("Failed to close document", {
          documentId: docId,
          error,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers - invitation auto-accept
  // -------------------------------------------------------------------------

  /**
   * Set up a watch on jsBaoDocumentsStore.pendingInvitations to auto-accept
   * invitations when they arrive via WebSocket events.
   */
  function setupInvitationWatcher(): void {
    if (stopInvitationWatcher) return; // Already watching

    const documentsStore = useJsBaoDocumentsStore();

    stopInvitationWatcher = watch(
      () => documentsStore.pendingInvitations,
      (newInvitations, oldInvitations) => {
        // Find newly added invitations by comparing with previous list
        const oldIds = new Set(
          (oldInvitations ?? []).map((inv) => inv.invitationId)
        );
        const addedInvitations = newInvitations.filter(
          (inv) => !oldIds.has(inv.invitationId)
        );

        if (addedInvitations.length > 0) {
          logger.debug("New invitations detected via watcher", {
            count: addedInvitations.length,
            invitationIds: addedInvitations.map((inv) => inv.invitationId),
          });
          // Accept the new invitations
          void acceptPendingInvitations(addedInvitations);
        }
      },
      { deep: true }
    );

    logger.debug("Invitation watcher set up");
  }

  /**
   * Accept pending invitations that match collections with autoAcceptInvites enabled.
   * Only accepts invitations whose document tags match at least one auto-accept collection.
   * If no invitations are passed, processes all current pending invitations.
   */
  async function acceptPendingInvitations(
    invitationsToAccept?: PendingInvitation[]
  ): Promise<void> {
    const inviteLogger = logger.forScope("acceptPendingInvitations");

    // Build set of tags from all collections with autoAcceptInvites enabled
    const autoAcceptTags = new Set<string>();
    for (const collection of registeredCollections.value.values()) {
      if (collection.autoAcceptInvites) {
        autoAcceptTags.add(collection.tag);
      }
    }

    if (autoAcceptTags.size === 0) {
      inviteLogger.debug("No collections have autoAcceptInvites enabled");
      return;
    }

    const documentsStore = useJsBaoDocumentsStore();
    const invitations =
      invitationsToAccept ?? documentsStore.pendingInvitations;

    if (invitations.length === 0) {
      inviteLogger.debug("No pending invitations to accept");
      return;
    }

    inviteLogger.debug("Processing pending invitations", {
      count: invitations.length,
      autoAcceptTags: [...autoAcceptTags],
    });

    for (const invitation of invitations) {
      if (!invitation.documentId) {
        inviteLogger.warn("Skipping invitation without documentId", {
          invitationId: invitation.invitationId,
        });
        continue;
      }

      // Get tags from the document metadata
      const invitationTags = invitation.document?.tags ?? [];

      // Check if any of the invitation's tags match an auto-accept collection
      const matchingTags = invitationTags.filter((tag) =>
        autoAcceptTags.has(tag)
      );
      const shouldAccept = matchingTags.length > 0;

      if (!shouldAccept) {
        inviteLogger.debug(
          "Skipping invitation - no matching auto-accept tag",
          {
            invitationId: invitation.invitationId,
            documentId: invitation.documentId,
            invitationTags,
            autoAcceptTags: [...autoAcceptTags],
          }
        );
        continue;
      }

      try {
        await documentsStore.acceptInvitation(invitation.documentId);
        inviteLogger.debug("Auto-accepted invitation", {
          documentId: invitation.documentId,
          invitationId: invitation.invitationId,
          matchingTags,
        });
        // Note: The documents watcher (handleDocumentsChanged) will automatically
        // open the document once it appears in the documents store
      } catch (error) {
        inviteLogger.error("Failed to auto-accept invitation", {
          documentId: invitation.documentId,
          invitationId: invitation.invitationId,
          error,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Return public API
  // -------------------------------------------------------------------------

  return {
    // getters
    collections,
    getCollection,
    isCollectionRegistered,
    isCollectionReady,
    getCollectionReadyRef,
    isDocumentReady,
    getDocumentReadyRef,

    // actions
    registerCollection,
    unregisterCollection,
    createDocument,
    reset,
  };
});
