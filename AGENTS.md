## Project Stack

- This project uses vite, typescript, vue, vue-router, tailwind, shadcn-vue, primitive-app and js-bao. Do not deviate from this stack. If there are additional foundational components required, ask the user before installing them.

## Project Organization

- `/src/assets`: Static images/assets
- `/src/components`: Vue Components. Organized by area.
- `/src/components/documents`: Document management components (PrimitiveDocumentSwitcher, PrimitiveDocumentList, PrimitiveShareDocumentDialog).
- `/src/components/ui`: Installation location for base shadcn-vue components.
- `/src/config`: Config options for primitive app
- `/src/lib`: Shared business logic, not Vue specific -- pure typescript code only.
- `/src/composables`: Vue composables (useJsBaoDataLoader, useTheme).
- `/src/layouts`: Vue layout components. Used directly by the router to render different layouts for different types of pages based on route
- `/src/models`: JS-bao model file definitions.
- `/src/pages`: Top level Vue components that map to a route.
- `/src/router`: Vue-router configuration
- `/src/stores`: Pinia stores (userStore, jsBaoDocumentsStore, singleDocumentStore, multiDocumentStore).
- `/src/tests`: Tests registered with the primitive-app test harness.

## General Coding Guidelines

- ALWAYS Fail early. Don't mask missing required inputs with inline fallbacks or try to recover from errors caused by improper usage or bad input. Expose the errors directly.
- ALWAYS use strong typing and invariants over scattered defensive code.
- PREFER keeping components and source files under 500 lines of code. ALWAYS refactor code into components if files get large.
- After completing a task, ALWAYS do a final review code review of your work. Automatically refactor if there is a way to delete dead code, simplify, or reduce duplicative code.
- ALWAYS delete old code rather than comment it out or deprecate it. If removing code will be a breaking change, CONFIRM with the user how to handle it. Don't assume.
- js-bao is a client side library. All data syncing with the server is handled in the background. NEVER try to write server code.
- ALWAYS use logger.createLogger to create a new logger for each file rather than logging to the console directly. Pass in the current log level with an explicit "level: getLogLevel()". NEVER use the primitiveAppBaseLogger.
- ALWAYS add meaningful comments that explain WHY something is done, NEVER add comments that just explain what code does, or code changes from a prior version.
- ALWAYS organize functions in code files in a logical order (e.g. "initialze" functions at the top of the file, a logical sequence or grouping, etc.). Add comments to break up sections of related functions.
- ALWAYS run pnpm codegen and pnpm type-check after making changes and fix any errors.
- NEVER modify worker.js. This is a library provided file and should not be edited.

## Vue Code Guidelines

- ALWAYS use Composition API + <script setup>, NEVER use Options API
- ALWAYS Keep types alongside your code, use TypeScript for type safety, prefer interface over type for defining types
- ALWAYS use named functions when declaring methods, use arrow functions only for callbacks
- ALWAYS prefer named exports over default exports
- AVOID watch/watchEffect wherever possible. PREFER to call code directly after a user action or after loading data.
- ALWAYS place Vue lifecycle methods (e.g. onMounted) as the first functions in the component
- ALWAYS use Pinia for state management. Pina stores should expose:
  - State – refs/reactive objects that can be returned
  - Getters – derived, reactive values from state
  - Actions – functions that do stuff (async, mutations, side effects)
- AVOID writing exported functions in Pina stores that return non-reactive state. Helper functions should be internal, actions can return non-reactive status, but shouldn't return non-reactive state. Use reactive getters instead.

## Using Primitive-app

- Primitive-app (the library) provides: jsBaoClientService for initializing js-bao, dev tools (test harness, document explorer), and shared UI components (PrimitiveLoadingGate, PrimitiveLogoSpinner, DeleteConfirmationDialog).
- This project includes additional Pinia stores (in `/src/stores`) and document components (in `/src/components/documents`) that may be helpful in implementing common use patterns. They can be used as is, customized as needed, or removed in favor of application specific code.
- Refer to the Primitive Docs and guidelines in @./docs/AGENT_GUIDE_TO_PRIMITIVE_DOCUMENTS.md, @./node_modules/js-bao/README.md and @./node_modules/js-bao-wss-client/README.md for additional context on using these libraries.
- The `primitive-admin` CLI tool (accessible via the `primitive` command) provides command-line integration with the Primitive Admin server for managing apps, users, and other admin tasks.
- ALWAYS use the js-bao-wss-client library to make API requests. NEVER hit http endpoints directly to accomplish tasks with js-bao.
- The @docs directory provides guides and design patterns for common usage scenarios.

### Data Storage and Loading

- ALWAYS use js-bao for data persistence, and the js-bao-wss-client for interacting with the backend (auth, API calls, opening/closing js-bao documents, storing blobs, etc.).
- The **root document** is a special per-user document that is automatically created and can never be shared or deleted (there is exactly one per user). The primitive template uses it to store user preferences via `userStore`, making settings automatically available whenever the user signs in. While the root document can hold any js-bao model, we recommend storing most application data in regular documents for greater flexibility (sharing, collaboration, multiple documents, etc.). See @./docs/AGENT_GUIDE_TO_PRIMITIVE_DOCUMENTS.md for details.

### Creating New js-bao Models

When creating a new model file, follow this exact workflow:

1. **Create the minimal model file** with only these required sections:

```typescript
import { BaseModel, defineModelSchema } from "js-bao";

const todoSchema = defineModelSchema({
  name: "Todo",
  // Add fields here as needed
});

export class Todo extends BaseModel {
  static schema = todoSchema;
}
```

2. **Add the model to `getJsBaoConfig`** in your config file.

3. **Run `pnpm codegen`** to generate the auto-generated sections (TypeScript types, field accessors, etc.).

4. **NEVER create or edit auto-generated sections yourself.** The codegen script maintains these code blocks. Look for comments like `// --- auto-generated ---` to identify them.

- ALWAYS use useJsBaoDataLoader for data loading. Use it no more than once per component to load data. When multiple documents are open, this will automatically query across all open documents.
- NEVER add a watch function that triggers on the results of the loadData function changing. Instead, if there is processing required after data changes, do that processing in loadData.
- NEVER rely on the component remounting when route params change; the jsBaoDataLoader monitors its queryParams object so ALWAYS include relevant route parameters in this object to trigger a reload.
- PREFER filtering for needed data using js-bao .query() rather than querying all objects and filtering in Javascript. If those queryParams can be changed by application state, pass those to the jsBaoDataLoader via queryParams.
- PREFER loading data in pages rather than sub-components. Pass data into sub components directly.
- NEVER remove data fields from js-bao models, just add a comment that they have been deprecated.
- When using useJsBaoDataLoader, ALWAYS return a single structured object from loadData and, for sequences of related mutations (save/delete/reorder), set pauseUpdates while mutating then call a single reload() afterward to avoid mid-interaction flicker.
- JS-Bao query always operates over ALL open documents. You NEVER need to iterate over documents to query. You can filter results by documentId or any other field on the ORM.
- ALWAYS model data references entirely in objects, using model IDs to create connections. Don't rely on document boundaries for modeling relationships.
- PREFER using model IDs as identifiers (in routes, queries etc.), not documentIds. Use documentIds when REQUIRED for APIs like sharing, setting model save location, etc.
- From an object you can get the document its stored in by accessing the model object's getDocumentId() function.

### useJsBaoDataLoader Pattern

- ALWAYS pass a `documentReady` ref/computed to `useJsBaoDataLoader`. This should be true after the relevant document(s) have been opened using the js-bao-wss-client.
- The loader returns `initialDataLoaded` which becomes `true` only after the first successful `loadData` call completes. Use this (not `documentReady`) with `PrimitiveLoadingGate`.
- Make rendering/redirect decisions based ONLY on the loaded `data`. Only act on data after `initialDataLoaded` is true.
- If you need to perform a side effect (like a redirect) after data loads, use a `watch` on `initialDataLoaded` that fires once when it becomes true, then make decisions based on `data.value`.

## UI/UX Guidelines

## Responsive Design

- Unless specifically directed otherwise, ALWAYS think about building UI that's responsive to desktop, tablet, and mobile phone sized screens.
- If you write UI components that utilize desktop UX patterns (like Dialogs) ALWAYS provide a phone pattern (like a Sheet) that is used on smaller screens.

### CSS & Component Library

- ALWAYS use shadcn-vue components without modification if possible.
- ALWAYS install needed shadcn-vue components if they are not available in the current project, ONLY using the command line installation tool.
- NEVER build components from scratch. If a default shadcn-vue component does not meet the project needs, create new components by composing shadcn-vue components.
- ALWAYS use TailwindCSS classes rather than manual CSS.
- NEVER hard code colors, use Tailwind's color system.
- ALWAYS use `v-model` for two-way binding with shadcn-vue Switch and Checkbox components. These components use Reka UI internally which expects `modelValue`/`update:modelValue`, NOT `checked`/`update:checked`. Using `:checked` + `@update:checked` will not work.

### Writing Components

- It is NEVER an error for components to mount before js-bao document isReady becomes true or data is loaded. Components should handle this case using jsBaoDataLoader and PrimitiveLoadingGate, waiting until the required data is available.
- AVOID writing business logic in Vue components. Components should be focused on rendering and UI interaction - move data manipulation and business logic to a related /lib file so it can be tested.
- ALWAYS make customizations at the layout level, not in App.vue. You can compose a provided primitive-app layout to customize it, or create a new one.

### PrimitiveLoadingGate Pattern

- Use `PrimitiveLoadingGate` with `:is-ready="initialDataLoaded"` to show loading state while data loads.
- The gate includes a configurable delay (default 50ms) before showing the loading slot to avoid flash of loading for fast operations.
- The `#loading` slot accepts any loading indicator: skeletons, spinners, progress bars, or custom loading UI.

## Writing Tests

- ALWAYS use the primitive-app test harness to write browser based tests for business logic in lib files/functions. For EVERY new lib file/function you create or update write tests that cover key cases. Refer to the Primitive Docs at https://primitive-labs.github.io/primitive-docs/ for examples.
