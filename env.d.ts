/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ID: string;
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_OAUTH_REDIRECT_URI: string;
  readonly VITE_LOG_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}

declare module "*.png" {
  const src: string;
  export default src;
}


