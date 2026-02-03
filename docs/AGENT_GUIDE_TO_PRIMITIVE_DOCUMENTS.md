# Working with Documents in the Primitive platform. (js-bao and js-bao-wss-client)

Guidelines for building apps with Primitive's document-based architecture.

## Core Concept: Documents

A **document** is:

1. A container for js-bao model objects
2. A sharing boundary—each document can be shared with different users at different permission levels
3. Can be used entirely interally, or exposed to app users as a concept that make sense for the application. For example a document might map to a Company in a business application, a Portfolio in a financial app, or a Channel in a communication app.

**Properties:**

- Documents are read/written locally. js-bao handles sync with the server.
- When other clients edit a document, local data updates in real-time.
- Access is all-or-nothing: users either have access to the entire document or none of it.

**Decision rule**: If data needs to be shared independently, it belongs in separate documents.

**Permission Levels:**

- **Reader** - View-only access
- **Read-write** - View and edit capabilities
- **Owner** - Full control including sharing and deletion

**Size Guidelines:** Documents work best around ~10MB each (soft limit). For most apps (thousands of records, years of data), this is sufficient.

## Critical Rules

1. **JS-Bao query operates over ALL open documents.** NEVER iterate over documents to query. Filter results by documentId or other fields in the query itself.

2. **Use model IDs, not document IDs.** Model data references entirely in objects using model IDs. Use documentIds ONLY when required for APIs (sharing, save location). In routes and queries, prefer model IDs.

3. **NEVER remove fields from models.** Add a deprecation comment instead.

4. **ALWAYS add new models to `getJsBaoConfig`.** Run `pnpm codegen` after creating models.

5. **Load data in pages, not sub-components.** Pass data into sub-components as props.

6. **Prefer `.query()` filtering over JavaScript filtering.** If filter params change based on app state, pass them via `queryParams` to the data loader.

7. **Understand the root document's role and limitations.** The root document is a special per-user document that is automatically created and opened. It can never be shared or deleted, and there is exactly one per user. The primitive template uses it to store user preferences via `userStore`—a great place for settings that should be available whenever the user signs in. While the root document can hold any js-bao model, we recommend storing most application data in regular documents for greater flexibility (sharing, collaboration, multiple documents). Use the "single document" pattern with aliases for personal apps, or the "one document at a time" pattern for multi-workspace apps.

## Document Lifecycle

### 1. Open Documents Before Querying

Documents must be opened before querying or modifying data within them.

```typescript
await jsBaoClient.documents.open(documentId);
const result = await MyModel.query({}, { documents: documentId });
```

Documents are ready to be queried once the .open() call finishes. Applications should wait for all requried documents to be opened and show a loading state until all needed documents have been opened. Often it's handy to track this with an `isReady` ref.

### 2. Document List Access

```typescript
const documents = await jsBaoClient.documents.list(); // All documents (owned + shared)
const invitations = await jsBaoClient.me.pendingDocumentInvitations(); // Pending share invitations
```

## Common Document Usage Patterns

**Helper Stores:** This project includes `singleDocumentStore` and `multiDocumentStore` in `/src/stores/` that implement the patterns described below. These stores handle document opening, closing, readiness tracking, and state management. They can be used as-is, customized to fit your needs, or ignored in favor of application-specific approaches.

### Pattern 1: Single Document (Personal Apps)

**Best for:** Personal tools, single-user apps, no sharing needed

Each user gets exactly one document that holds all their data. The document is opened on app load / user sign-in. No document management UI is needed.

**Examples:** Personal task manager, habit tracker, journal app, budgeting tool

**User experience:** Users sign in and immediately see their data. No concept of "documents" is exposed in the UI.

**Implementation:**

```typescript
// On app initialization after user is authenticated
// Use aliases for atomic get-or-create of a unique default document
const aliasParams = { scope: "user" as const, aliasKey: "default-doc" };

try {
  // Try to open by alias (common case - document already exists)
  await jsBaoClient.documents.openAlias(aliasParams);
} catch {
  // Alias doesn't exist - create document with alias atomically
  // Server prevents duplicates if another client creates simultaneously
  const result = await jsBaoClient.documents.createWithAlias({
    title: "My Data",
    alias: aliasParams,
  });
  await jsBaoClient.documents.open(result.documentId);
}
```

### Pattern 2: One Document at a Time (Workspaces)

**Best for:** Apps where users create discrete projects or workspaces they might share

Users have multiple documents but work in one at a time. They can create new documents, switch between them, and share each with different people.

**Examples:**

- Accounting app (one document per company)
- Project management (one document per project)
- Shared shopping lists (one list per household)

**User experience:** Users see a document switcher in the UI. They can create new workspaces, rename them, share them with teammates, and switch between them.

**UI Components:** This project includes document management components in `src/components/documents/` that are particularly helpful for this pattern:

- **`PrimitiveDocumentSwitcher`** - A dropdown menu designed for the sidebar header. Shows the current app/document name with an icon, lists available documents for quick switching, displays pending invitation badges, and links to a "Manage Documents" page. Emits events when users switch documents so the app can handle the transition.

- **`PrimitiveDocumentList`** - A full document management interface suitable for a dedicated "Manage Documents" page. Displays documents in a table (desktop) or list (mobile) with support for renaming, sharing, deleting, and accepting invitations. Handles permission-based UI (only owners can delete, etc.).

Both components load document data directly from the js-bao client, listen for metadata changes to stay current, and work well together—the switcher for quick access, the list for full management.

**Implementation:**

```typescript
// List available documents
const documents = await jsBaoClient.documents.list();

// Open the selected document
await jsBaoClient.documents.open(selectedDocumentId);

// Create a new document/workspace
const { metadata } = await jsBaoClient.documents.create({
  title: "New Project",
  tags: ["workspace"],
});
await jsBaoClient.documents.open(metadata.documentId);
```

When using this pattern, it's often convenient to keep track of a `currentDocument` reference and switch this as users open different documents.

### Pattern 3: Multiple Documents

**Best for:** Apps that need to be able to query over multiple documents, each of which has a different sharing context.

Apps can manage opening and closing documents as needed, with the guideline that all documents that need to receive live updates from changes, or be queried across must be open.

Often times it's convenient to organize documents by tag, so that it's easy to open all documents that match a known tag.

**Examples:**

- Chat app (one document per channel, multiple channels visible)
- Multi-tenant dashboard (separate data per client)
- Collaborative workspace with distinct data collections

**User experience:** The app manages which documents are open. Users might see a list of channels, each backed by a separate document with its own sharing settings.

**Implementation:**

```typescript
// Get all documents with a specific tag
const documents = await jsBaoClient.documents.list();
const channels = documents.filter((doc) => doc.tags?.includes("channel"));

// Open all channel documents
await Promise.all(
  channels.map((ch) => jsBaoClient.documents.open(ch.documentId))
);

// Query runs across all open documents by default
const messages = await Message.query({});
```

**Using multiDocumentStore:** For Pattern 3, the `multiDocumentStore` Pinia store provides a higher-level abstraction that handles:
- Registering collections by tag with automatic document opening (`autoOpen: true`)
- Tracking which documents belong to which collection
- Optional auto-acceptance of invitations (`autoAcceptInvites: true/false`)
- Proper document creation that ensures documents are opened and tracked

```typescript
// Register a collection (typically in a domain store's initialize function)
await multiDocStore.registerCollection({
  name: "todolists",
  tag: "todolist",
  autoOpen: true,        // Automatically open documents with this tag
  autoAcceptInvites: false, // Require manual invitation acceptance
});

// Create a document in the collection - ALWAYS use this, not documentsStore directly
const trackedDoc = await multiDocStore.createDocument(
  "todolists",  // collection name
  "My List",    // title
  { alias: { scope: "user", aliasKey: "default-list" } } // optional alias
);

// The document is automatically opened and tracked
// Now you can save models to it
const list = new TodoList();
list.title = "My List";
await list.save({ targetDocument: trackedDoc.documentId });
```

**Critical:** When working with multiDocumentStore collections, ALWAYS use `multiDocStore.createDocument()` to create new documents. Using `documentsStore.createDocumentWithAlias()` or other low-level methods bypasses the collection's auto-open and tracking logic, causing documents to not appear in reactive lists.

## Data Modeling Decisions

### Separate Documents When:

- Items need independent sharing (e.g., each todo list shared with different people)
- Items are logically distinct workspaces/projects
- You want to limit sync scope

### Single Document When:

- All data should always be shared together
- Data is tightly coupled
- Simplicity is more important than granular sharing

### Tagging Documents

Use tags to categorize documents by type:

```typescript
const { metadata } = await jsBaoClient.documents.create({
  title: "My List",
  tags: ["todolist"],
});

// Filter documents by tag
const documents = await jsBaoClient.documents.list();
const todoLists = documents.filter((doc) => doc.tags?.includes("todolist"));
```

## Defining Models

### Creating New Model Files

When creating a new js-bao model file, follow this exact workflow:

**Step 1: Create the minimal model file** with only these required sections:

```typescript
import { BaseModel, defineModelSchema } from "js-bao";

const todoSchema = defineModelSchema({
  name: "Todo",
  // Add fields here as needed (see Field Types below)
});

export class Todo extends BaseModel {
  static schema = todoSchema;
}
```

**Step 2: Add the model to `getJsBaoConfig`** in your config file so js-bao knows about it.

**Step 3: Run `pnpm codegen`** to generate the auto-generated sections. This generates TypeScript types, field accessors, and other boilerplate code.

**Step 4: Make any additional edits** to the schema (adding fields, constraints, etc.) and run `pnpm codegen` again.

**CRITICAL: NEVER create or edit auto-generated sections yourself.** The codegen script maintains these code blocks. Look for comments like `// --- auto-generated ---` to identify them. If you manually edit these sections, your changes will be overwritten the next time codegen runs.

### Field Types

| Type        | Description                  | Common Options                 |
| ----------- | ---------------------------- | ------------------------------ |
| `id`        | Unique identifier            | `autoAssign: true`             |
| `string`    | Text values                  | `indexed: true`, `default: ""` |
| `number`    | Numeric values               | `indexed: true`, `default: 0`  |
| `boolean`   | True/false                   | `default: false`               |
| `date`      | ISO-8601 strings             | `indexed: true`                |
| `stringset` | Collection of strings (tags) | `maxCount: 20`                 |

### Field Options

```typescript
const schema = defineModelSchema({
  name: "tasks",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    title: { type: "string", indexed: true },
    priority: { type: "number", default: 0 },
    dueDate: { type: "date" },
    tags: { type: "stringset", maxCount: 10 },
    archived: { type: "boolean", default: false },
  },
});
```

### Unique Constraints

Enforce uniqueness across one or more fields:

```typescript
const schema = defineModelSchema({
  name: "categories",
  fields: {
    id: { type: "id", autoAssign: true },
    name: { type: "string" },
    parentId: { type: "string" },
  },
  uniqueConstraints: [["name", "parentId"]], // name+parentId must be unique
});
```

### Working with StringSets

```typescript
// Add/remove tags
task.tags.add("urgent");
task.tags.remove("low-priority");

// Check membership
if (task.tags.has("urgent")) { ... }

// Convert to array for display
const tagList = task.tags.toArray();
```

### Working with Dates

Dates are stored as ISO-8601 strings. Convert for comparisons:

```typescript
// Store
task.dueDate = new Date().toISOString();

// Compare
const due = new Date(task.dueDate);
if (due < new Date()) {
  console.log("Overdue!");
}

// Query with date comparison
const result = await Task.query({
  dueDate: { $lt: new Date().toISOString() },
});
```

## Querying Data

### Single Document Query

```typescript
const result = await MyModel.query(
  { completed: false },
  { documents: documentId, sort: { order: 1 } }
);
```

### Query Operators

| Operator        | Description           | Example                                      |
| --------------- | --------------------- | -------------------------------------------- |
| `$eq`           | Equals (default)      | `{ status: "active" }`                       |
| `$gt`, `$lt`    | Greater/less than     | `{ priority: { $gt: 5 } }`                   |
| `$gte`, `$lte`  | Greater/less or equal | `{ dueDate: { $lte: today } }`               |
| `$in`           | Matches any in array  | `{ status: { $in: ["active", "pending"] } }` |
| `$startsWith`   | String prefix match   | `{ title: { $startsWith: "Bug:" } }`         |
| `$containsText` | Full-text search      | `{ title: { $containsText: "urgent" } }`     |
| `$exists`       | Field exists/not null | `{ dueDate: { $exists: true } }`             |

```typescript
const result = await Task.query({
  completed: false,
  priority: { $gte: 3 },
  tags: { $in: ["work", "urgent"] },
});
```

### Pagination

Use cursor-based pagination for large result sets:

```typescript
const pageSize = 20;
let cursor: string | undefined;

// First page
const page1 = await Task.query(
  { completed: false },
  { limit: pageSize, sort: { createdAt: -1 } }
);

// Next page using cursor
cursor = page1.uniqueStartKey;
const page2 = await Task.query(
  { completed: false },
  { limit: pageSize, sort: { createdAt: -1 }, uniqueStartKey: cursor }
);
```

### Counting Records

```typescript
const activeCount = await Task.count({ completed: false });
const totalCount = await Task.count({});
```

### Aggregations

Group and calculate statistics:

```typescript
const stats = await Task.aggregate({
  groupBy: ["category"],
  operations: [
    { type: "count" },
    { type: "avg", field: "priority" },
    { type: "sum", field: "estimatedHours" },
  ],
});
// Returns: [{ category: "work", count: 10, avg_priority: 2.5, sum_estimatedHours: 45 }, ...]
```

### useJsBaoDataLoader Pattern

`useJsBaoDataLoader` is a composable provided by the primitive library that centralizes data loading for a component. It handles four key concerns:

1. **Waiting for documents to be ready** - The `documentReady` ref/computed tells the loader when all required documents have been opened. Queries won't run until `documentReady` is true, preventing errors from querying before documents are available.

2. **Knowing when UI is ready to render** - The `initialDataLoaded` ref becomes true after the first successful data load, letting you show loading states appropriately.

3. **Subscribing to model changes** - When any model in `subscribeTo` changes (local edits or sync from other clients), the loader automatically re-runs `loadData` to keep the UI current.

4. **Reactive query parameters** - When `queryParams` change (route params, filters, pagination, etc.), the loader re-runs `loadData` with the new parameters. Route params are not automatically included in `queryParams` so you should include them if changes to route params should trigger reloading data.

**Data flow pattern:** Update `queryParams` based on page state, UI filters, or pagination → triggers `loadData` → returns data → reactive UI update. This keeps data loading centralized and predictable.

**Best practices:**

- Centralize all data loading for a component in a single `useJsBaoDataLoader` call
- Push filtering logic into js-bao `.query()` calls rather than fetching everything and filtering in JavaScript
- Always pass `documentReady` - typically a ref that becomes true after your document opening logic completes

```typescript
const {
  data: todos,
  initialDataLoaded,
  reload,
} = useJsBaoDataLoader<{ items: TodoItem[]; total: number }>({
  subscribeTo: [TodoItem],
  queryParams: computed(() => ({ listId: props.listId, showCompleted })),
  documentReady,
  async loadData({ listId, showCompleted }) {
    const query = showCompleted ? { listId } : { listId, completed: false };
    const result = await TodoItem.query(query, { sort: { order: 1 } });
    return { items: result.data, total: result.data.length };
  },
});
```

**Rules:**

- Use `useJsBaoDataLoader` no more than once per component
- **Return a single structured object** from `loadData`
- NEVER add a watch on `loadData` results. Do processing inside `loadData`.
- NEVER rely on component remounting for route param changes. The loader only sees changes via `queryParams`.
- `initialDataLoaded` becomes true after the first successful `loadData`. Use this (not `documentReady`) with `PrimitiveLoadingGate`.
- Make rendering/redirect decisions ONLY after `initialDataLoaded` is true.
- For side effects after load (like redirects), watch `initialDataLoaded` and act when it becomes true.
- For sequences of mutations (save/delete/reorder), set `pauseUpdates` while mutating, then call `reload()` afterward to avoid flicker.

## Saving Data

### Save to a Specific Document (when creating new obje)

```typescript
const newItem = new TodoItem();
newItem.title = "Buy groceries";
await newItem.save({ targetDocument: documentId });
```

### Update Existing Item

```typescript
// Items remember their document
todo.completed = true;
await todo.save();
```

### Upsert by Unique Constraint

Create or update based on unique fields:

```typescript
// If a category with this name+parentId exists, update it; otherwise create it
await Category.upsertByUnique(
  ["name", "parentId"], // unique constraint fields
  { name: "Work", parentId: null }, // match values
  { color: "blue" } // fields to set/update
);
```

## Design Patterns

### Singleton Model per Document (Avoiding ID Confusion)

Create a singleton model per document for metadata. Child models reference by model ID, not document ID:

```typescript
// TodoList - one per document
const todoListSchema = defineModelSchema({
  name: "todo_lists",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    title: { type: "string" },
    createdAt: { type: "number" },
    createdBy: { type: "string" },
  },
});

// TodoItem references TodoList by MODEL ID
const todoItemSchema = defineModelSchema({
  name: "todo_items",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    listId: { type: "string", indexed: true }, // Model ID, not document ID
    title: { type: "string" },
    completed: { type: "boolean" },
  },
});
```

**Use this pattern when:**

- Documents represent a meaningful entity (project, list, workspace)
- You need document-level metadata
- Child models need to reference their parent container

### Singleton Documents with Aliases

For documents that should exist exactly once (default document, settings), use document aliases. Aliases provide atomic get-or-create semantics that prevent race conditions when multiple clients initialize simultaneously.

```typescript
// Atomic get-or-create using aliases
const aliasParams = { scope: "user" as const, aliasKey: "user-preferences" };

try {
  // Try to open by alias (common case - document already exists)
  await jsBaoClient.documents.openAlias(aliasParams);
} catch {
  // Alias doesn't exist - create document with alias atomically
  const result = await jsBaoClient.documents.createWithAlias({
    title: "My Preferences",
    alias: aliasParams,
  });
  await jsBaoClient.documents.open(result.documentId);
}
```

**Alias scopes:**

- `"user"` - Unique per user (each user can have their own document with this alias)
- `"app"` - Unique across entire app (shared by all users)

**Alias API methods:**

- `documents.openAlias(params)` - Open document by alias (throws if not found)
- `documents.createWithAlias(options)` - Create document with alias atomically
- `documents.aliases.resolve(params)` - Get alias info (returns null if not found)
- `documents.aliases.set(params)` - Set an alias for an existing document
- `documents.aliases.delete(params)` - Remove an alias
- `documents.createWithAlias(options)` - Create document with alias atomically
- `documents.openAlias(params)` - Open document by alias directly

## Sharing Documents

### Using PrimitiveShareDocumentDialog

When allowing users to share documents, use `PrimitiveShareDocumentDialog`:

```vue
<PrimitiveShareDocumentDialog
  :is-open="showShareDialog"
  :document-id="currentDocumentId"
  :document-label="currentList?.title ?? 'Document'"
  :invite-url-template="`${window.location.origin}/lists`"
  @close="showShareDialog = false"
/>
```

**Critical:** The `invite-url-template` prop is REQUIRED when users send email notifications. Without it, the API returns HTTP 400. The URL should point to a page where invited users can see and accept their invitations.

### Handling Invitations

**Auto-accept vs Manual:**
- `autoAcceptInvites: true` - Invitations are automatically accepted when the document tag matches a registered collection. Documents appear immediately in the user's list.
- `autoAcceptInvites: false` - Users must manually accept invitations on a management page. Provides more control but requires UI for viewing/accepting invitations.

**Navigating after accepting an invitation:**

When a user accepts an invitation, you typically want to navigate them to the content. Since routes use model IDs (not document IDs), query for the model first:

```typescript
async function handleInvitationAccepted(documentId: string): Promise<void> {
  // Brief delay for document to sync after acceptance
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Query for the model in the newly accessible document
  const result = await TodoList.query({}, { documents: documentId });
  const list = result.data[0];
  if (list) {
    router.push({ name: "todo-list", params: { listId: list.id } });
  }
}
```

### Read-Only Permission Handling

When a user has "reader" permission, disable all edit functionality:

```typescript
const isReadOnly = computed(() => {
  if (!currentDocumentId.value) return true;
  const doc = todoStore.todoListDocuments.find(
    (d) => d.documentId === currentDocumentId.value
  );
  return doc?.permission === "reader";
});
```

Pass `isReadOnly` to child components and use it to:
- Hide create/add buttons (`v-if="!isReadOnly"`)
- Hide delete buttons and drag handles
- Disable checkboxes and inputs (`:disabled="isReadOnly"`)
- Hide share buttons (only owners can share)
- Prevent inline editing

## Common Errors

| Symptom                                         | Cause                                                                    | Fix                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Need document from item                         | N/A                                                                      | Use `item.getDocumentId()`                                                                           |
| Data doesn't update when route param changes    | Vue reuses components; `useJsBaoDataLoader` doesn't see the change       | Add the route param to `queryParams` in the data loader, OR use `:key="routeParam"` on the component |
| Spread object missing data or reactivity broken | js-bao model objects don't support JavaScript spreading (`{ ...model }`) | Access properties directly or use explicit property copying: `{ id: model.id, title: model.title }`  |
| Query `field: false` misses items               | Items with `field: undefined` don't match `field: false`                 | Use a default value in schema, OR filter in JavaScript with `item.field ?? false`                    |
| Document created but not in sidebar/list        | Used `documentsStore` directly instead of `multiDocStore`                | Always use `multiDocStore.createDocument()` when working with collections                            |
| HTTP 400 when sharing with email                | Missing `documentUrl` in invitation                                       | Pass `invite-url-template` prop to `PrimitiveShareDocumentDialog`                                    |
| New document not queryable immediately          | Document not opened after creation                                        | Use `multiDocStore.createDocument()` which handles opening automatically                             |
