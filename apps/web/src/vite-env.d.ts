/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin, no /api suffix (09 §4). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
