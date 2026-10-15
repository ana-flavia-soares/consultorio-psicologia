// Registro de erros sem vazar dados.
//
// Regra: nenhum log pode conter conteúdo de paciente. Por isso guardamos só
// ONDE o erro aconteceu e um código técnico curto. A mensagem crua do servidor
// fica de fora, porque pode trazer valores enviados na requisição.

export interface SafeErrorEntry {
  where: string;
  code: string;
  at: string;
}

const recent: SafeErrorEntry[] = [];

function codeOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof e.code === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(e.code)) return e.code;
    if (typeof e.status === 'number') return `http_${e.status}`;
    if (typeof e.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name)) return e.name;
  }
  return 'desconhecido';
}

export function reportError(where: string, error: unknown): void {
  const entry: SafeErrorEntry = { where, code: codeOf(error), at: new Date().toISOString() };
  recent.push(entry);
  if (recent.length > 50) recent.shift();
  // Só onde e o código. Nunca o objeto de erro inteiro.
  console.warn(`[consultorio] erro em ${entry.where}: ${entry.code}`);
}

/** Últimos erros, para a tela de Segurança ajudar no suporte sem expor dados. */
export function recentErrors(): readonly SafeErrorEntry[] {
  return recent;
}
