// Cofre de criptografia do consultório.
//
// Como funciona (criptografia de envelope):
//   1. O navegador gera uma chave de dados aleatória (DEK, AES-256-GCM).
//      É ela que criptografa nomes, contatos e anotações.
//   2. A DEK nunca sai do navegador em claro. O servidor guarda só duas cópias
//      embrulhadas: uma com a senha do cofre e outra com a chave de recuperação.
//   3. A senha vira uma chave de embrulho com PBKDF2-SHA256 (600 mil rodadas),
//      o que torna tentativas de adivinhação lentas e caras.
//   4. Cada campo criptografado leva um "contexto" (AAD) com o id do registro.
//      Se alguém copiar o conteúdo cifrado de um paciente para outro, a
//      descriptografia falha em vez de mostrar dado trocado.
//
// Usa só a Web Crypto API, nativa do navegador. Nenhuma biblioteca externa.

export const KDF_NAME = 'PBKDF2-SHA256';
export const KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;
/** Acima disso o navegador travaria; um cofre assim é recusado. */
export const MAX_KDF_ITERATIONS = 5_000_000;

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const AAD_WRAP_PASS = 'cofre:dek:senha:v1';
const AAD_WRAP_RECOVERY = 'cofre:dek:recuperacao:v1';
const AAD_CHECK = 'cofre:verificacao:v1';
const CHECK_PLAINTEXT = 'consultorio-cofre-ok';

/** Como o cofre é guardado no banco (tabela public.vault). */
export interface VaultRecord {
  kdf: string;
  kdf_iterations: number;
  salt: string;
  wrapped_key: string;
  wrapped_key_iv: string;
  recovery_salt: string;
  recovery_wrapped_key: string;
  recovery_iv: string;
  key_check: string;
  key_check_iv: string;
}

export interface Sealed {
  ct: string;
  iv: string;
}

export class WrongSecretError extends Error {
  constructor() {
    super('Senha ou chave de recuperação incorreta.');
    this.name = 'WrongSecretError';
  }
}

export class DecryptError extends Error {
  constructor() {
    super('Não foi possível abrir este conteúdo. Ele pode ter sido alterado.');
    this.name = 'DecryptError';
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function normalize(secret: string): string {
  return secret.normalize('NFKC');
}

// Alfabeto Crockford: sem I, L, O, U para evitar confusão ao digitar.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Normaliza a chave de recuperação digitada (ignora espaços, traços e minúsculas). */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function formatRecoveryKey(raw: string): string {
  return raw.match(/.{1,4}/g)!.join('-');
}

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

const COMMON = ['123456', 'senha', 'password', 'qwerty', 'abcdef', '111111', 'consultorio', 'psicologa', 'psicologo'];

/**
 * Devolve a lista de problemas da senha. Lista vazia = senha aceita.
 * `banned`: palavras fáceis de adivinhar neste contexto (ex.: o nome de quem usa).
 */
export function passphraseProblems(p: string, banned: string[] = []): string[] {
  const problems: string[] = [];
  const s = normalize(p);
  if (s.length < MIN_PASSPHRASE_LENGTH) problems.push(`Use pelo menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);
  const lower = s.toLowerCase();
  if ([...COMMON, ...banned].some((c) => c && lower.includes(c.toLowerCase()))) problems.push('Evite palavras e sequências óbvias, como seu nome.');
  if (new Set(s).size < 6) problems.push('Use caracteres mais variados.');
  return problems;
}

// ---------------------------------------------------------------------------
// Chaves
// ---------------------------------------------------------------------------

async function deriveWrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', enc.encode(normalize(secret)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // extractable = false: depois de importada, a chave não pode ser exportada
  // nem por código malicioso rodando na página.
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrap(kek: CryptoKey, raw: Uint8Array<ArrayBuffer>, aad: string): Promise<Sealed> {
  const iv = random(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, kek, raw));
  return { ct: toB64(ct), iv: toB64(iv) };
}

async function unwrapRaw(kek: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const raw = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: enc.encode(aad) },
      kek,
      fromB64(sealed.ct),
    );
    return new Uint8Array(raw);
  } catch {
    throw new WrongSecretError();
  }
}

// ---------------------------------------------------------------------------
// Cofre
// ---------------------------------------------------------------------------

export interface NewVault {
  record: VaultRecord;
  /** Mostrar uma única vez para a psicóloga anotar e guardar em local físico seguro. */
  recoveryKey: string;
  key: CryptoKey;
}

export async function createVault(passphrase: string, iterations = KDF_ITERATIONS): Promise<NewVault> {
  const problems = passphraseProblems(passphrase);
  if (problems.length) throw new Error(problems.join(' '));

  const raw = random(32);
  try {
    const salt = random(16);
    const passWrapped = await wrap(await deriveWrappingKey(passphrase, salt, iterations), raw, AAD_WRAP_PASS);

    const recoveryRaw = toBase32(random(32)); // 256 bits de entropia
    const recoverySalt = random(16);
    const recWrapped = await wrap(await deriveWrappingKey(recoveryRaw, recoverySalt, iterations), raw, AAD_WRAP_RECOVERY);

    const key = await importDataKey(raw);
    const check = await encryptField(key, CHECK_PLAINTEXT, AAD_CHECK);

    return {
      key,
      recoveryKey: formatRecoveryKey(recoveryRaw),
      record: {
        kdf: KDF_NAME,
        kdf_iterations: iterations,
        salt: toB64(salt),
        wrapped_key: passWrapped.ct,
        wrapped_key_iv: passWrapped.iv,
        recovery_salt: toB64(recoverySalt),
        recovery_wrapped_key: recWrapped.ct,
        recovery_iv: recWrapped.iv,
        key_check: check.ct,
        key_check_iv: check.iv,
      },
    };
  } finally {
    raw.fill(0);
  }
}

async function unwrapWith(record: VaultRecord, secret: string, mode: 'senha' | 'recuperacao'): Promise<Uint8Array<ArrayBuffer>> {
  if (record.kdf !== KDF_NAME) throw new Error('Formato de cofre desconhecido.');
  if (!Number.isInteger(record.kdf_iterations) || record.kdf_iterations > MAX_KDF_ITERATIONS) throw new Error('Cofre com parâmetros inválidos.');
  const isPass = mode === 'senha';
  const kek = await deriveWrappingKey(
    isPass ? secret : normalizeRecoveryKey(secret),
    fromB64(isPass ? record.salt : record.recovery_salt),
    record.kdf_iterations,
  );
  return unwrapRaw(
    kek,
    isPass ? { ct: record.wrapped_key, iv: record.wrapped_key_iv } : { ct: record.recovery_wrapped_key, iv: record.recovery_iv },
    isPass ? AAD_WRAP_PASS : AAD_WRAP_RECOVERY,
  );
}

async function keyFromRaw(record: VaultRecord, raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const key = await importDataKey(raw);
  // Confere que a chave aberta é mesmo a deste cofre.
  try {
    if ((await decryptField(key, { ct: record.key_check, iv: record.key_check_iv }, AAD_CHECK)) !== CHECK_PLAINTEXT) {
      throw new WrongSecretError();
    }
  } catch {
    throw new WrongSecretError();
  }
  return key;
}

export async function unlockVault(record: VaultRecord, passphrase: string): Promise<CryptoKey> {
  const raw = await unwrapWith(record, passphrase, 'senha');
  try {
    return await keyFromRaw(record, raw);
  } finally {
    raw.fill(0);
  }
}

export async function unlockWithRecovery(record: VaultRecord, recoveryKey: string): Promise<CryptoKey> {
  const raw = await unwrapWith(record, recoveryKey, 'recuperacao');
  try {
    return await keyFromRaw(record, raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * Troca a senha do cofre usando a senha atual ou a chave de recuperação.
 * A chave de dados continua a mesma, então nada precisa ser recriptografado.
 */
export async function changePassphrase(
  record: VaultRecord,
  current: { senha: string } | { recuperacao: string },
  newPassphrase: string,
): Promise<VaultRecord> {
  const problems = passphraseProblems(newPassphrase);
  if (problems.length) throw new Error(problems.join(' '));
  const raw = 'senha' in current
    ? await unwrapWith(record, current.senha, 'senha')
    : await unwrapWith(record, current.recuperacao, 'recuperacao');
  try {
    await keyFromRaw(record, raw);
    const salt = random(16);
    const sealed = await wrap(await deriveWrappingKey(newPassphrase, salt, record.kdf_iterations), raw, AAD_WRAP_PASS);
    return { ...record, salt: toB64(salt), wrapped_key: sealed.ct, wrapped_key_iv: sealed.iv };
  } finally {
    raw.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

/** Contextos de criptografia: amarram o conteúdo ao registro a que pertence. */
export const aad = {
  patientName: (patientId: string) => `paciente:${patientId}:nome`,
  patientContact: (patientId: string) => `paciente:${patientId}:contato`,
  // A versão entra no contexto: reenviar a v1 como se fosse a v3 não abre.
  note: (sessionId: string, version: number) => `sessao:${sessionId}:anotacao:v${version}`,
};

export async function encryptField(key: CryptoKey, plaintext: string, context: string): Promise<Sealed> {
  const iv = random(12); // 12 bytes = 16 caracteres em base64; novo a cada gravação
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(plaintext)),
  );
  return { ct: toB64(ct), iv: toB64(iv) };
}

export async function decryptField(key: CryptoKey, sealed: Sealed, context: string): Promise<string> {
  try {
    const pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: enc.encode(context) },
      key,
      fromB64(sealed.ct),
    );
    return dec.decode(pt);
  } catch {
    throw new DecryptError();
  }
}
