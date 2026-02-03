import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";
import { globalIgnores } from "eslint/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfigWithVueTs(
  {
    name: "template/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: dirname(fileURLToPath(new URL(".", import.meta.url))),
      },
    },
  },

  globalIgnores(["**/dist/**", "**/dist-ssr/**", "**/coverage/**"]),

  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  skipFormatting
);


