import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { defineConfig } from "vite";
import vueDevTools from "vite-plugin-vue-devtools";
import { primitiveDevTools } from "primitive-app/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
    tailwindcss(),
    primitiveDevTools({
      appName: "Primitive Template App",
      testsDir: "src/tests",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ws: fileURLToPath(new URL("./src/ws-browser-stub.js", import.meta.url)),
    },
  },
});
