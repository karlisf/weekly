/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated relay URLs used for new spaces and code lookups. */
  readonly VITE_DEFAULT_RELAYS?: string;
}
