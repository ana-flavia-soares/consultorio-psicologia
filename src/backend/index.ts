import { createDemoBackend } from './demo.ts';
import { createSupabaseBackend } from './supabase.ts';
import type { Backend } from './types.ts';

/**
 * Escolhe o servidor a partir das variáveis do arquivo .env:
 *   VITE_DEMO=true                -> modo demonstração (sem servidor)
 *   VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY -> produção
 * A chave "anon" é pública por definição: quem protege os dados é o RLS do banco.
 */
export function createBackend(): Backend {
  const env = import.meta.env;
  if (env.VITE_DEMO === 'true') return createDemoBackend();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (veja o README).');
  }
  if (!url.startsWith('https://')) throw new Error('VITE_SUPABASE_URL precisa começar com https://');
  return createSupabaseBackend(url, key);
}
