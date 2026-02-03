import { BaseModel, defineModelSchema } from "js-bao";

const userPrefSchema = defineModelSchema({
  name: "user_prefs",
  fields: {
    id: { type: "id", autoAssign: true, indexed: true },
    key: { type: "string", indexed: true, unique: true },
    value: { type: "string" },
  },
});
// 🔥🔥 BEGIN AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import type { InferAttrs } from "js-bao";
import { attachAndRegisterModel } from "js-bao";

export type UserPrefAttrs = InferAttrs<typeof userPrefSchema>;
export interface UserPref extends UserPrefAttrs, BaseModel {}
// 🔥🔥 END AUTO-GENERATED HEADER (DO NOT EDIT) 🔥🔥

export class UserPref extends BaseModel {}

// 🔥🔥 BEGIN AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
attachAndRegisterModel(UserPref, userPrefSchema);
// 🔥🔥 END AUTO-GENERATED FOOTER (DO NOT EDIT) 🔥🔥
