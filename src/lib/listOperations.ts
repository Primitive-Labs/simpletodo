import { TodoList } from "@/models";
import { useMultiDocumentStore } from "@/stores/multiDocumentStore";

const COLLECTION_NAME = "todolists";

export interface CreateListResult {
  documentId: string;
  listId: string;
}

/**
 * Creates a new todo list with the given title.
 * This handles both document creation and TodoList model creation.
 */
export async function createList(title: string): Promise<CreateListResult> {
  const multiDocStore = useMultiDocumentStore();

  console.log("[listOperations:createList] Starting", { title });

  // Create document through multiDocStore
  console.log("[listOperations:createList] Creating document");
  const trackedDoc = await multiDocStore.createDocument(COLLECTION_NAME, title);
  console.log("[listOperations:createList] Document created", {
    documentId: trackedDoc.documentId,
    permission: trackedDoc.permission,
  });

  // Create the TodoList model inside the document
  console.log("[listOperations:createList] Creating TodoList model");
  const todoList = new TodoList();
  todoList.title = title;

  console.log("[listOperations:createList] Saving TodoList model", {
    todoListId: todoList.id,
    targetDocument: trackedDoc.documentId,
  });

  try {
    await todoList.save({ targetDocument: trackedDoc.documentId });
    console.log("[listOperations:createList] TodoList saved successfully", {
      todoListId: todoList.id,
    });

    // Also check all TodoLists in this document
    const allInDoc = await TodoList.query(
      {},
      { documents: trackedDoc.documentId }
    );
    console.log("[listOperations:createList] All TodoLists in document", {
      count: allInDoc.data.length,
      items: allInDoc.data.map((item) => ({ id: item.id, title: item.title })),
    });
  } catch (error) {
    console.error("[listOperations:createList] Failed to save TodoList", error);
    throw error;
  }

  return {
    documentId: trackedDoc.documentId,
    listId: todoList.id,
  };
}
