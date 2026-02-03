import { BaseModel, defineModelSchema } from "js-bao";

const todoListSchema = defineModelSchema({
  name: "todo_lists",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    title: { type: "string", indexed: true },
    showCompleted: { type: "boolean", default: false },
    createdAt: { type: "date" },
  },
});
// 🔥🔥 BEGIN AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import type { InferAttrs } from "js-bao";
import { attachAndRegisterModel } from "js-bao";

export type TodoListAttrs = InferAttrs<typeof todoListSchema>;
export interface TodoList extends TodoListAttrs, BaseModel {}
// 🔥🔥 END AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥

export class TodoList extends BaseModel {
  static schema = todoListSchema;
}

// 🔥🔥 BEGIN AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
attachAndRegisterModel(TodoList, todoListSchema);
// 🔥🔥 END AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
