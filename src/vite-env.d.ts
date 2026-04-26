/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** When true, production API base is `window.location.origin` (single-container FastAPI + static). */
  readonly VITE_USE_SAME_ORIGIN_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
