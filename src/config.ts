// Identidade de quem usa o sistema. Vem do .env (ou das variáveis da
// hospedagem), para o código não carregar o nome de nenhuma cliente.

const env = import.meta.env;

function clean(v: string | undefined): string {
  return (v ?? '').trim();
}

export const brand = {
  /** Nome exibido no menu e na tela de entrada. Ex.: "Maria Souza". */
  name: clean(env.VITE_PRO_NAME) || 'Seu consultório',
  /** Linha de apoio abaixo do nome. Ex.: "Psicóloga". */
  role: clean(env.VITE_PRO_ROLE) || 'Psicologia',
  /** Usado na saudação ("Bom dia, Maria"). Opcional. */
  firstName: clean(env.VITE_PRO_FIRST_NAME),
};

export function brandInitials(name = brand.name): string {
  const words = name.split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Palavras que não podem aparecer na senha do cofre (fáceis de adivinhar). */
export function bannedPassphraseWords(): string[] {
  return [brand.firstName, ...brand.name.split(/\s+/)].map((w) => w.toLowerCase()).filter((w) => w.length >= 4);
}
