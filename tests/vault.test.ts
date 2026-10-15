// Testes da criptografia. Rodar com: npm run test:crypto
// Usa poucas rodadas de PBKDF2 para ficar rápido; um teste confere o valor real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aad,
  changePassphrase,
  createVault,
  decryptField,
  DecryptError,
  encryptField,
  KDF_ITERATIONS,
  passphraseProblems,
  unlockVault,
  unlockWithRecovery,
  WrongSecretError,
} from '../src/crypto/vault.ts';

const SENHA = 'cafe-com-leite-e-chuva-27';
const FAST = 2_000;

test('anotação criptografada volta igual com a chave certa', async () => {
  const { key } = await createVault(SENHA, FAST);
  const texto = 'Evolução: relata semana estável.\nEncaminhamentos: manter registro.';
  const sealed = await encryptField(key, texto, aad.note('s1', 1));
  assert.notEqual(sealed.ct, texto);
  assert.ok(!sealed.ct.includes('Evolução'));
  assert.equal(await decryptField(key, sealed, aad.note('s1', 1)), texto);
});

test('o vetor de inicialização tem 16 caracteres e muda a cada gravação', async () => {
  const { key } = await createVault(SENHA, FAST);
  const a = await encryptField(key, 'mesmo texto', aad.note('s1', 1));
  const b = await encryptField(key, 'mesmo texto', aad.note('s1', 1));
  assert.equal(a.iv.length, 16);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('senha errada não abre o cofre', async () => {
  const { record } = await createVault(SENHA, FAST);
  await assert.rejects(unlockVault(record, 'outra-senha-qualquer-99'), WrongSecretError);
});

test('senha certa abre o cofre e lê o que foi gravado antes', async () => {
  const { record, key } = await createVault(SENHA, FAST);
  const sealed = await encryptField(key, 'conteúdo', aad.note('s9', 1));
  const reaberta = await unlockVault(record, SENHA);
  assert.equal(await decryptField(reaberta, sealed, aad.note('s9', 1)), 'conteúdo');
});

test('chave de recuperação abre o cofre, mesmo digitada com espaços e minúsculas', async () => {
  const { record, key, recoveryKey } = await createVault(SENHA, FAST);
  assert.match(recoveryKey, /^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  const sealed = await encryptField(key, 'conteúdo', aad.note('s2', 1));
  const digitada = recoveryKey.toLowerCase().replace(/-/g, ' ');
  const reaberta = await unlockWithRecovery(record, digitada);
  assert.equal(await decryptField(reaberta, sealed, aad.note('s2', 1)), 'conteúdo');
});

test('chave de recuperação errada não abre o cofre', async () => {
  const { record } = await createVault(SENHA, FAST);
  await assert.rejects(unlockWithRecovery(record, 'AAAA-BBBB-CCCC-DDDD'), WrongSecretError);
});

test('conteúdo adulterado é detectado em vez de mostrar texto errado', async () => {
  const { key } = await createVault(SENHA, FAST);
  const sealed = await encryptField(key, 'texto original', aad.note('s1', 1));
  const bytes = Uint8Array.from(atob(sealed.ct), (c) => c.charCodeAt(0));
  bytes[0] ^= 1;
  const adulterado = { ...sealed, ct: btoa(String.fromCharCode(...bytes)) };
  await assert.rejects(decryptField(key, adulterado, aad.note('s1', 1)), DecryptError);
});

test('anotação copiada para outra sessão não abre', async () => {
  const { key } = await createVault(SENHA, FAST);
  const sealed = await encryptField(key, 'anotação da sessão 1', aad.note('sessao-1', 1));
  await assert.rejects(decryptField(key, sealed, aad.note('sessao-2', 1)), DecryptError);
});

test('versão antiga reenviada como nova não abre', async () => {
  const { key } = await createVault(SENHA, FAST);
  const v1 = await encryptField(key, 'versão 1', aad.note('s1', 1));
  await assert.rejects(decryptField(key, v1, aad.note('s1', 3)), DecryptError);
});

test('cofre com número absurdo de rodadas é recusado antes de travar o navegador', async () => {
  const { record } = await createVault(SENHA, FAST);
  await assert.rejects(unlockVault({ ...record, kdf_iterations: 2_000_000_000 }, SENHA));
});

test('nome de um paciente não pode ser trocado pelo de outro', async () => {
  const { key } = await createVault(SENHA, FAST);
  const sealed = await encryptField(key, 'Maria', aad.patientName('p1'));
  await assert.rejects(decryptField(key, sealed, aad.patientName('p2')), DecryptError);
});

test('a chave de dados não pode ser exportada pela página', async () => {
  const { key } = await createVault(SENHA, FAST);
  assert.equal(key.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey('raw', key));
});

test('o banco nunca recebe a senha, a chave de recuperação nem a chave de dados', async () => {
  const { record, recoveryKey } = await createVault(SENHA, FAST);
  const json = JSON.stringify(record);
  assert.ok(!json.includes(SENHA));
  assert.ok(!json.includes(recoveryKey.replace(/-/g, '')));
});

test('trocar a senha com a chave de recuperação mantém os dados e invalida a senha antiga', async () => {
  const { record, key, recoveryKey } = await createVault(SENHA, FAST);
  const sealed = await encryptField(key, 'histórico', aad.note('s3', 1));
  const NOVA = 'outono-no-parque-das-aguas-8';
  const novo = await changePassphrase(record, { recuperacao: recoveryKey }, NOVA);
  await assert.rejects(unlockVault(novo, SENHA), WrongSecretError);
  const reaberta = await unlockVault(novo, NOVA);
  assert.equal(await decryptField(reaberta, sealed, aad.note('s3', 1)), 'histórico');
  // A chave de recuperação continua valendo.
  await unlockWithRecovery(novo, recoveryKey);
});

test('senhas fracas são recusadas', async () => {
  assert.ok(passphraseProblems('curta').length > 0);
  assert.ok(passphraseProblems('senha123456789').length > 0);
  assert.ok(passphraseProblems('aaaaaaaaaaaaaaaa').length > 0);
  assert.deepEqual(passphraseProblems(SENHA), []);
  assert.ok(passphraseProblems('marcela-no-parque-27', ['marcela']).length > 0, 'nome de quem usa é recusado');
  await assert.rejects(createVault('fraca', FAST));
});

test('o padrão usa 600 mil rodadas de PBKDF2', async () => {
  assert.equal(KDF_ITERATIONS, 600_000);
  const inicio = Date.now();
  const { record } = await createVault(SENHA);
  assert.equal(record.kdf_iterations, 600_000);
  await unlockVault(record, SENHA);
  console.log(`  criar e abrir o cofre com 600 mil rodadas levou ${Date.now() - inicio} ms`);
});
