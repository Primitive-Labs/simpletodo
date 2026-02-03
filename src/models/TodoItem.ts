import { BaseModel, defineModelSchema } from "js-bao";

const todoItemSchema = defineModelSchema({
  name: "todo_items",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    listId: { type: "string", indexed: true },
    text: { type: "string", indexed: true },
    completed: { type: "boolean", default: false, indexed: true },
    order: { type: "number", default: 0, indexed: true },
    completedAt: { type: "date" },
    createdAt: { type: "date" },
  },
});
// 🔥🔥 BEGIN AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import type { InferAttrs } from "js-bao";
import { attachAndRegisterModel } from "js-bao";

export type TodoItemAttrs = InferAttrs<typeof todoItemSchema>;
export interface TodoItem extends TodoItemAttrs, BaseModel {}
// 🔥🔥 END AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥

export class TodoItem extends BaseModel {
  static schema = todoItemSchema;
}

// 🔥🔥 BEGIN AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
attachAndRegisterModel(TodoItem, todoItemSchema);
// 🔥🔥 END AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
