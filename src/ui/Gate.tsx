// Telas antes de entrar: login, verificação em duas etapas e cofre.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AuthStep, Backend, MfaEnrollment } from '../backend/types.ts';
import { DEMO_EMAIL, DEMO_MFA_CODE, DEMO_PASSWORD } from '../backend/demo.ts';
import {
  changePassphrase,
  createVault,
  passphraseProblems,
  unlockVault,
  WrongSecretError,
  type VaultRecord,
} from '../crypto/vault.ts';
import { messageOf } from './errors.ts';
import { Brand } from './Brand.tsx';
import { bannedPassphraseWords } from '../config.ts';

function GateFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-box">
        <Brand compact />
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

// ---------------------------------------------------------------------------

export function LoginScreen({ backend, onStep }: { backend: Backend; onStep: (s: AuthStep) => void }) {
  const [email, setEmail] = useState(backend.isDemo ? DEMO_EMAIL : '');
  const [password, setPassword] = useState(backend.isDemo ? DEMO_PASSWORD : '');
  const { busy, error, run } = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => onStep(await backend.auth.signIn(email, password)));
  };

  return (
    <GateFrame title="Entrar">
      {backend.isDemo && (
        <p className="notice">Modo demonstração: dados fictícios, nada é salvo. O e-mail e a senha já estão preenchidos.</p>
      )}
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha da conta</label>
          <input id="senha" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </GateFrame>
  );
}

// ---------------------------------------------------------------------------

export function MfaEnrollScreen({ backend, onStep }: { backend: Backend; onStep: (s: AuthStep) => void }) {
  const [enroll, setEnroll] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useBusy();

  return (
    <GateFrame title="Proteja sua conta">
      <div className="card">
        <p>
          Toda entrada vai pedir, além da senha, um código de 6 números gerado no seu celular. Assim, mesmo que alguém
          descubra sua senha, não consegue entrar.
        </p>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator ou similar).</li>
          <li>Toque em "Começar" e leia o QR code com o app.</li>
          <li>Digite o código que aparecer no app.</li>
        </ol>
        {!enroll ? (
          <button className="btn primary" disabled={busy} onClick={() => run(async () => setEnroll(await backend.auth.startEnroll()))}>
            Começar
          </button>
        ) : (
          <form
            className="stack"
            style={{ gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => onStep(await backend.auth.finishEnroll(enroll.factorId, code.trim())));
            }}
          >
            <img className="qr" src={enroll.qrCode} alt="QR code para o app autenticador" />
            <p className="small muted">
              Se a câmera não ler, digite este código no app: <span className="secret">{enroll.secret}</span>
            </p>
            <div className="field">
              <label htmlFor="code">Código de 6 números</label>
              <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            {backend.isDemo && <p className="small muted">Na demonstração, use {DEMO_MFA_CODE}.</p>}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary" disabled={busy || code.length !== 6}>Ativar</button>
          </form>
        )}
        {!enroll && error && <p className="error" role="alert">{error}</p>}
      </div>
    </GateFrame>
  );
}

export function MfaVerifyScreen({ backend, factorId, onStep }: { backend: Backend; factorId: string; onStep: (s: AuthStep) => void }) {
  const [code, setCode] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <GateFrame title="Código de verificação">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onStep(await backend.auth.verify(factorId, code.trim())));
        }}
      >
        <p>Abra o app autenticador no celular e digite o código de 6 números.</p>
        <div className="field">
          <label htmlFor="code">Código</label>
          <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </div>
        {backend.isDemo && <p className="small muted">Na demonstração, use {DEMO_MFA_CODE}.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy || code.length !== 6}>Confirmar</button>
        <button type="button" className="btn link" onClick={() => void backend.auth.signOut().then(() => onStep({ step: 'signed-out' }))}>
          Sair
        </button>
      </form>
    </GateFrame>
  );
}

// ---------------------------------------------------------------------------

/** Primeiro acesso: cria a senha do cofre e mostra a chave de recuperação uma única vez. */
export function VaultSetupScreen({ backend, onReady }: { backend: Backend; onReady: (key: CryptoKey, isNew: boolean) => void }) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [created, setCreated] = useState<{ key: CryptoKey; recoveryKey: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmTail, setConfirmTail] = useState('');
  const { busy, error, setError, run } = useBusy();
  const problems = pass ? passphraseProblems(pass, bannedPassphraseWords()) : [];

  if (created) {
    const tail = created.recoveryKey.slice(-4);
    return (
      <GateFrame title="Sua chave de recuperação">
        <div className="card">
          <p>
            <strong>Esta é a única forma de recuperar suas anotações se você esquecer a senha do cofre.</strong> Nem a
            desenvolvedora consegue recuperar sem ela.
          </p>
          <div className="recovery-key" aria-label="Chave de recuperação">{created.recoveryKey}</div>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Escreva à mão ou imprima e guarde em local físico seguro, longe do computador.</li>
            <li>Não tire foto nem salve em e-mail, WhatsApp ou nuvem.</li>
            <li>Ela não será mostrada de novo.</li>
          </ul>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span>Anotei a chave e guardei em local seguro.</span>
          </label>
          <div className="field">
            <label htmlFor="tail">Para confirmar, digite os 4 últimos caracteres da chave</label>
            <input id="tail" className="input" value={confirmTail} maxLength={4} onChange={(e) => setConfirmTail(e.target.value.toUpperCase())} autoComplete="off" />
          </div>
          <button className="btn primary" disabled={!saved || confirmTail !== tail} onClick={() => onReady(created.key, true)}>
            Continuar
          </button>
        </div>
      </GateFrame>
    );
  }

  return (
    <GateFrame title="Crie a senha do cofre">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (pass !== pass2) return setError('As duas senhas não são iguais.');
          void run(async () => {
            const v = await createVault(pass);
            await backend.createVault(v.record);
            setPass('');
            setPass2('');
            setCreated({ key: v.key, recoveryKey: v.recoveryKey });
          });
        }}
      >
        <p>
          O cofre protege nomes, contatos e anotações. Eles são embaralhados aqui no seu computador antes de ir para o
          servidor. Use uma senha diferente da senha de entrar: uma frase longa é mais forte e mais fácil de lembrar.
        </p>
        <div className="field">
          <label htmlFor="p1">Senha do cofre</label>
          <input id="p1" className="input" type="password" autoComplete="new-password" required value={pass} onChange={(e) => setPass(e.target.value)} aria-describedby="p1-help" />
          <span id="p1-help" className="small muted">Exemplo de formato: três ou quatro palavras com um número, como "chuva-de-outono-no-cafe-27".</span>
        </div>
        {problems.length > 0 && <ul className="error small" style={{ margin: 0, paddingLeft: 20 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <div className="field">
          <label htmlFor="p2">Repita a senha</label>
          <input id="p2" className="input" type="password" autoComplete="new-password" required value={pass2} onChange={(e) => setPass2(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy || problems.length > 0 || !pass2}>{busy ? 'Criando o cofre…' : 'Criar cofre'}</button>
      </form>
    </GateFrame>
  );
}

/** Acessos seguintes: desbloqueia com a senha, ou recupera com a chave de recuperação. */
export function UnlockScreen({ backend, record, onReady, onSignOut }: { backend: Backend; record: VaultRecord; onReady: (key: CryptoKey) => void; onSignOut: () => void }) {
  const [mode, setMode] = useState<'senha' | 'recuperar'>('senha');
  const [pass, setPass] = useState('');
  const [recovery, setRecovery] = useState('');
  const [newPass, setNewPass] = useState('');
  const { busy, error, setError, run } = useBusy();
  const problems = newPass ? passphraseProblems(newPass, bannedPassphraseWords()) : [];

  if (mode === 'recuperar') {
    return (
      <GateFrame title="Recuperar o cofre">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              try {
                const updated = await changePassphrase(record, { recuperacao: recovery }, newPass);
                await backend.updateVault(updated);
                onReady(await unlockVault(updated, newPass));
              } catch (err) {
                if (err instanceof WrongSecretError) throw new Error('Chave de recuperação incorreta.');
                throw err;
              }
            });
          }}
        >
          <p>Digite a chave de recuperação que você guardou e escolha uma nova senha para o cofre. Suas anotações continuam as mesmas.</p>
          <div className="field">
            <label htmlFor="rk">Chave de recuperação</label>
            <input id="rk" className="input" autoComplete="off" spellCheck={false} required value={recovery} onChange={(e) => setRecovery(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="np">Nova senha do cofre</label>
            <input id="np" className="input" type="password" autoComplete="new-password" required value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          </div>
          {problems.length > 0 && <ul className="error small" style={{ margin: 0, paddingLeft: 20 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary full" disabled={busy || problems.length > 0}>{busy ? 'Recuperando…' : 'Recuperar e entrar'}</button>
          <button type="button" className="btn link" onClick={() => { setMode('senha'); setError(''); }}>Voltar</button>
        </form>
      </GateFrame>
    );
  }

  return (
    <GateFrame title="Desbloquear o cofre">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            try {
              const key = await unlockVault(record, pass);
              setPass('');
              onReady(key);
            } catch (err) {
              if (err instanceof WrongSecretError) throw new Error('Senha do cofre incorreta.');
              throw err;
            }
          });
        }}
      >
        <div className="field">
          <label htmlFor="vp">Senha do cofre</label>
          <input id="vp" className="input" type="password" autoComplete="current-password" required autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Abrindo…' : 'Desbloquear'}</button>
        <div className="kv">
          <button type="button" className="btn link" onClick={() => { setMode('recuperar'); setError(''); }}>Esqueci a senha do cofre</button>
          <button type="button" className="btn link" onClick={onSignOut}>Sair</button>
        </div>
      </form>
    </GateFrame>
  );
}
