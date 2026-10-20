/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço da API em publicação. Vazio usa o mesmo host. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
