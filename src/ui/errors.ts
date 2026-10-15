import { UserFacingError } from '../backend/types.ts';
import { DecryptError } from '../crypto/vault.ts';
import { reportError } from '../security/safeLog.ts';

/** Mensagem segura para a tela. Erros inesperados viram texto genérico. */
export function messageOf(e: unknown): string {
  if (e instanceof UserFacingError || e instanceof DecryptError) return e.message;
  if (e instanceof Error && /^(As duas|Senha|Chave|Use pelo|Evite|Use caracteres)/.test(e.message)) return e.message;
  reportError('ui', e);
  return 'Algo deu errado. Tente de novo.';
}
