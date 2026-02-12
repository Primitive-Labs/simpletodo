/**
 * @module todoStore
 *
 * Pinia store for managing todo lists and items.
 *
 * This store builds on top of multiDocumentStore to manage todo lists
 * as documents with the "todolist" tag. It provides:
 *
 * - Current list tracking for navigation
 * - Completion animation state management
 * - CRUD operations for todo items
 * - List creation and settings management
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createLogger } from "@/lib/logger";
import { jsBaoClientService } from "primitive-app";
import { useMultiDocumentStore } from "./multiDocumentStore";
import { useJsBaoDocumentsStore } from "./jsBaoDocumentsStore";
import { useUserStore } from "./userStore";
import { TodoList, TodoItem } from "@/models";

const logger = createLogger({ scope: "todoStore" });

const COLLECTION_NAME = "todolists";
const COLLECTION_TAG = "todolist";
const DEFAULT_LIST_ALIAS = "default-list";
const LAST_USED_LIST_PREF = "lastUsedList";
const RECENT_LISTS_PREF = "recentListIds";

interface LastUsedList {
  listId: string;
  documentId: string;
}

let initStarted = false;

export const useTodoStore = defineStore("todo", () => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** The currently viewed TodoList model ID */
  const currentListId = ref<string | null>(null);

  /** Set of TodoItem IDs currently animating completion (1s delay before marking done) */
  const completingItems = ref<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Derived State
  // ---------------------------------------------------------------------------

  const multiDocStore = useMultiDocumentStore();
  const documentsStore = useJsBaoDocumentsStore();

  /** Whether the todolist collection is ready */
  const isCollectionReady = computed(() =>
    multiDocStore.isCollectionReady(COLLECTION_NAME)
  );

  /** All todo list documents */
  const todoListDocuments = computed(() =>
    multiDocStore.getCollection(COLLECTION_NAME)
  );

  /** The current list's document ID (if we have a current list loaded) */
  const currentDocumentId = computed(() => {
    // This will be set by the page component after loading data
    return null as string | null;
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the todo store.
   * Registers the todolists collection with multiDocumentStore.
   */
  async function initialize(): Promise<void> {
    if (initStarted) {
      logger.debug("Initialize already started, skipping");
      return;
    }
    initStarted = true;

    logger.debug("Initializing todoStore");

    // Initialize documentsStore first (required for multiDocumentStore)
    logger.debug("Initializing documentsStore");
    await documentsStore.initialize();

    // Register the todolists collection
    if (!multiDocStore.isCollectionRegistered(COLLECTION_NAME)) {
      logger.debug("Registering todolists collection");
      await multiDocStore.registerCollection({
        name: COLLECTION_NAME,
        tag: COLLECTION_TAG,
        autoOpen: true,
        autoAcceptInvites: false,
      });
      logger.debug("Todolists collection registered");
    }

    logger.debug("TodoStore initialized");
  }

  // ---------------------------------------------------------------------------
  // List Management
  // ---------------------------------------------------------------------------

  /**
   * Set the current list to view.
   */
  function setCurrentList(listId: string | null): void {
    logger.debug("Setting current list", { listId });
    currentListId.value = listId;
  }

  /**
   * Create a new todo list.
   * Creates a new document with the todolist tag and a TodoList model inside.
   *
   * @param title - The title for the new list
   * @returns The created TodoList model ID
   */
  async function createTodoList(title: string): Promise<string> {
    logger.debug("Creating new todo list", { title });

    // Create the document via multiDocStore
    const trackedDoc = await multiDocStore.createDocument(
      COLLECTION_NAME,
      title
    );

    // Create the TodoList model inside the document
    const todoList = new TodoList();
    todoList.title = title;
    todoList.createdAt = new Date().toISOString();
    await todoList.save({ targetDocument: trackedDoc.documentId });

    logger.debug("Todo list created", {
      listId: todoList.id,
      documentId: trackedDoc.documentId,
    });

    return todoList.id;
  }

  /**
   * Toggle the showCompleted setting for a list.
   */
  async function toggleShowCompleted(listId: string): Promise<void> {
    logger.debug("Toggling showCompleted", { listId });

    const result = await TodoList.query({ id: listId });
    const list = result.data[0];
    if (!list) {
      logger.error("List not found", { listId });
      return;
    }

    list.showCompleted = !list.showCompleted;
    await list.save();

    logger.debug("ShowCompleted toggled", {
      listId,
      showCompleted: list.showCompleted,
    });
  }

  // ---------------------------------------------------------------------------
  // Todo Item Management
  // ---------------------------------------------------------------------------

  /**
   * Add a new todo item to a list.
   *
   * @param listId - The TodoList model ID
   * @param text - The todo text
   * @param documentId - The document to save to
   * @returns The created TodoItem
   */
  async function addTodo(
    listId: string,
    text: string,
    documentId: string
  ): Promise<TodoItem> {
    logger.debug("Adding todo", { listId, text });

    // Get max order for this list
    const existingItems = await TodoItem.query(
      { listId, completed: false },
      { sort: { order: -1 }, limit: 1 }
    );
    const maxOrder = existingItems.data[0]?.order ?? 0;

    const todo = new TodoItem();
    todo.listId = listId;
    todo.text = text;
    todo.completed = false;
    todo.order = maxOrder + 1;
    todo.createdAt = new Date().toISOString();
    await todo.save({ targetDocument: documentId });

    logger.debug("Todo added", { todoId: todo.id, order: todo.order });
    return todo;
  }

  /**
   * Toggle todo completion with animation delay.
   * When completing (not already completed):
   * 1. Adds item to completingItems set immediately
   * 2. Waits 1 second for animation
   * 3. Then marks as completed in the database
   *
   * When uncompleting:
   * - Marks as not completed immediately
   */
  async function toggleTodoComplete(itemId: string): Promise<void> {
    logger.debug("Toggling todo completion", { itemId });

    const result = await TodoItem.query({ id: itemId });
    const item = result.data[0];
    if (!item) {
      logger.error("Todo item not found", { itemId });
      return;
    }

    if (!item.completed) {
      // Starting completion - add to animating set
      completingItems.value = new Set([...completingItems.value, itemId]);

      // Wait 1 second for animation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Now mark as completed
      item.completed = true;
      item.completedAt = new Date().toISOString();
      await item.save();

      // Remove from animating set
      const newSet = new Set(completingItems.value);
      newSet.delete(itemId);
      completingItems.value = newSet;

      logger.debug("Todo completed", { itemId });
    } else {
      // Uncompleting - immediate
      item.completed = false;
      item.completedAt = "";
      await item.save();

      logger.debug("Todo uncompleted", { itemId });
    }
  }

  /**
   * Check if a todo is currently in the completing animation state.
   */
  function isItemCompleting(itemId: string): boolean {
    return completingItems.value.has(itemId);
  }

  /**
   * Reorder todos by updating their order fields.
   *
   * @param itemIds - Array of item IDs in their new order
   */
  async function reorderTodos(itemIds: string[]): Promise<void> {
    logger.debug("Reordering todos", { count: itemIds.length });

    // Filter out any invalid IDs
    const validIds = itemIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return;

    // Fetch all items
    const result = await TodoItem.query({ id: { $in: validIds } });
    const itemsById = new Map(
      result.data.map((item) => [item.id as string, item])
    );

    // Update order fields based on position
    const savePromises: Promise<void>[] = [];
    for (let i = 0; i < validIds.length; i++) {
      const id = validIds[i];
      if (!id) continue;
      const item = itemsById.get(id);
      if (item && item.order !== i) {
        item.order = i;
        savePromises.push(item.save());
      }
    }

    await Promise.all(savePromises);
    logger.debug("Todos reordered", { updatedCount: savePromises.length });
  }

  /**
   * Delete a todo item.
   */
  async function deleteTodo(itemId: string): Promise<void> {
    logger.debug("Deleting todo", { itemId });

    const result = await TodoItem.query({ id: itemId });
    const item = result.data[0];
    if (!item) {
      logger.error("Todo item not found", { itemId });
      return;
    }

    await item.delete();
    logger.debug("Todo deleted", { itemId });
  }

  /**
   * Update a todo's text.
   */
  async function updateTodoText(itemId: string, text: string): Promise<void> {
    logger.debug("Updating todo text", { itemId, text });

    const result = await TodoItem.query({ id: itemId });
    const item = result.data[0];
    if (!item) {
      logger.error("Todo item not found", { itemId });
      return;
    }

    item.text = text;
    await item.save();
    logger.debug("Todo text updated", { itemId });
  }

  // ---------------------------------------------------------------------------
  // Last Used List & Default List
  // ---------------------------------------------------------------------------

  const userStore = useUserStore();

  /**
   * Get the last used list from user preferences.
   */
  function getLastUsedList(): LastUsedList | null {
    return userStore.getPref<LastUsedList | null>(LAST_USED_LIST_PREF, null);
  }

  /**
   * Get the last used list ID from user preferences.
   * @deprecated Use getLastUsedList() instead
   */
  function getLastUsedListId(): string | null {
    const lastUsed = getLastUsedList();
    return lastUsed?.listId ?? null;
  }

  /**
   * Set the last used list in user preferences.
   */
  async function setLastUsedListId(
    listId: string,
    documentId: string
  ): Promise<void> {
    logger.debug("Setting last used list", { listId, documentId });
    await userStore.setPref(LAST_USED_LIST_PREF, { listId, documentId });
    // Also update recent lists
    await addToRecentLists(listId);
  }

  /**
   * Get the recent list IDs (up to 2) from user preferences.
   */
  function getRecentListIds(): string[] {
    return userStore.getPref<string[]>(RECENT_LISTS_PREF, []);
  }

  /**
   * Add a list ID to the recent lists, keeping only the most recent 2.
   */
  async function addToRecentLists(listId: string): Promise<void> {
    const current = getRecentListIds();
    // Remove if already exists, then add to front
    const filtered = current.filter((id) => id !== listId);
    const updated = [listId, ...filtered].slice(0, 2);
    logger.debug("Updating recent lists", { listId, updated });
    await userStore.setPref(RECENT_LISTS_PREF, updated);
  }

  /**
   * Get or create the default list for a new user.
   * Uses document aliases to ensure only one default list is created.
   *
   * @returns The TodoList model ID for the default list
   */
  async function getOrCreateDefaultList(): Promise<string> {
    const defaultListLogger = logger.forScope("getOrCreateDefaultList");
    defaultListLogger.debug("Getting or creating default list");

    const aliasParams = {
      scope: "user" as const,
      aliasKey: DEFAULT_LIST_ALIAS,
    };

    try {
      // Try to open existing default list by alias
      defaultListLogger.debug("Attempting to open default list by alias");
      const client = await jsBaoClientService.getClientAsync();
      await client.documents.openAlias(aliasParams);

      // Find the TodoList model in the opened document
      const alias = await client.documents.aliases.resolve(aliasParams);
      if (alias?.documentId) {
        const result = await TodoList.query(
          {},
          { documents: alias.documentId }
        );
        if (result.data[0]) {
          defaultListLogger.debug("Found existing default list", {
            listId: result.data[0].id,
          });
          return result.data[0].id;
        }
      }
    } catch {
      // Alias doesn't exist - create new default list with alias
      defaultListLogger.debug("Default list not found, creating new one");
    }

    // Create new document with alias atomically using the client directly
    // This avoids requiring the collection to be registered first
    try {
      const client = await jsBaoClientService.getClientAsync();
      const result = await client.documents.createWithAlias({
        title: "My List",
        alias: aliasParams,
      });

      // Open the newly created document
      await client.documents.open(result.documentId);

      // Create the TodoList model inside the document
      const todoList = new TodoList();
      todoList.title = "My List";
      todoList.createdAt = new Date().toISOString();
      await todoList.save({ targetDocument: result.documentId });

      defaultListLogger.debug("Created default list", {
        listId: todoList.id,
        documentId: result.documentId,
      });

      return todoList.id;
    } catch (err) {
      // 409 conflict means alias already exists (race condition)
      // Try to open it again
      defaultListLogger.debug("Create with alias failed, retrying open", err);

      const client = await jsBaoClientService.getClientAsync();
      await client.documents.openAlias(aliasParams);
      const alias = await client.documents.aliases.resolve(aliasParams);
      if (alias?.documentId) {
        const result = await TodoList.query(
          {},
          { documents: alias.documentId }
        );
        if (result.data[0]) {
          return result.data[0].id;
        }
      }

      throw new Error("Failed to get or create default list");
    }
  }

  /**
   * Get the list to navigate to on app load.
   * Returns the last used list if valid, otherwise creates/gets the default list.
   * Opens only the needed document rather than waiting for all documents.
   */
  async function getStartupListId(): Promise<string> {
    const startupLogger = logger.forScope("getStartupListId");
    startupLogger.debug("Determining startup list");

    // Check for last used list with document ID
    const lastUsed = getLastUsedList();
    if (lastUsed?.listId && lastUsed?.documentId) {
      try {
        // Open just this specific document
        startupLogger.debug("Opening last used document", {
          documentId: lastUsed.documentId,
        });
        await documentsStore.openDocument(lastUsed.documentId);

        // Verify the list still exists
        const result = await TodoList.query({ id: lastUsed.listId });
        if (result.data[0]) {
          startupLogger.debug("Using last used list", {
            listId: lastUsed.listId,
          });
          return lastUsed.listId;
        }
        startupLogger.debug("Last used list no longer exists in document");
      } catch (err) {
        startupLogger.debug("Failed to open last used document", { err });
      }
    }

    // Fall back to default list
    const defaultListId = await getOrCreateDefaultList();
    startupLogger.debug("Using default list", { listId: defaultListId });
    return defaultListId;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Reset the store state.
   * Call this on logout.
   */
  function reset(): void {
    logger.debug("Resetting todoStore");
    currentListId.value = null;
    completingItems.value = new Set();
    initStarted = false;
  }

  // ---------------------------------------------------------------------------
  // Return Public API
  // ---------------------------------------------------------------------------

  return {
    // State
    currentListId,
    completingItems,

    // Derived state
    isCollectionReady,
    todoListDocuments,
    currentDocumentId,

    // Initialization
    initialize,

    // List management
    setCurrentList,
    createTodoList,
    toggleShowCompleted,

    // Todo item management
    addTodo,
    toggleTodoComplete,
    isItemCompleting,
    reorderTodos,
    deleteTodo,
    updateTodoText,

    // Last used list & default list
    getLastUsedListId,
    setLastUsedListId,
    getRecentListIds,
    getOrCreateDefaultList,
    getStartupListId,

    // Lifecycle
    reset,
  };
});
