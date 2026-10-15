/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PRO_NAME?: string;
  readonly VITE_PRO_ROLE?: string;
  readonly VITE_PRO_FIRST_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
