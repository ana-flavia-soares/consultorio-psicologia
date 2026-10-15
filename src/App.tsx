import { useCallback, useEffect, useState } from 'react';
import type { AuthStep, Backend } from './backend/types.ts';
import { seedDemoData } from './backend/demo.ts';
import type { VaultRecord } from './crypto/vault.ts';
import { useIdleTimeout, IDLE_MINUTES } from './security/idle.ts';
import { ClinicProvider } from './ui/clinic.tsx';
import { LoginScreen, MfaEnrollScreen, MfaVerifyScreen, UnlockScreen, VaultSetupScreen } from './ui/Gate.tsx';
import { messageOf } from './ui/errors.ts';
import { Brand } from './ui/Brand.tsx';
import { FinanceScreen, PatientScreen, PatientsScreen, SecurityScreen, SessionScreen, TodayScreen, type Nav } from './ui/screens.tsx';

type Phase =
  | { kind: 'loading' }
  | { kind: 'auth'; step: Exclude<AuthStep, { step: 'ready' }> }
  | { kind: 'vault-setup' }
  | { kind: 'vault-unlock'; record: VaultRecord }
  | { kind: 'open'; key: CryptoKey };

export function App({ backend }: { backend: Backend }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [nav, setNav] = useState<Nav>({ screen: 'hoje' });
  const [notice, setNotice] = useState('');
  const [fatal, setFatal] = useState('');

  const afterAuth = useCallback(
    async (step: AuthStep) => {
      if (step.step !== 'ready') return setPhase({ kind: 'auth', step });
      const record = await backend.getVault();
      setPhase(record ? { kind: 'vault-unlock', record } : { kind: 'vault-setup' });
    },
    [backend],
  );

  useEffect(() => {
    backend.auth.current().then(afterAuth, (e) => setFatal(messageOf(e)));
  }, [backend, afterAuth]);

  const signOut = useCallback(
    async (reason?: string) => {
      // Descarta a chave da memória ao trocar de fase; o React solta a referência.
      setPhase({ kind: 'loading' });
      setNav({ screen: 'hoje' });
      await backend.auth.signOut().catch(() => undefined);
      setNotice(reason ?? '');
      setPhase({ kind: 'auth', step: { step: 'signed-out' } });
    },
    [backend],
  );

  const idle = useIdleTimeout(phase.kind === 'open' || phase.kind === 'vault-unlock' || phase.kind === 'vault-setup', () =>
    void signOut(`Você saiu automaticamente depois de ${IDLE_MINUTES} minutos sem uso.`),
  );
  const idleBanner = idle.warning && (
    <div className="idle-warning" role="alertdialog" aria-live="assertive" aria-label="Aviso de saída automática">
      <span>Sem uso há {IDLE_MINUTES - 1} minutos. Você vai sair em 1 minuto; texto não salvo será perdido.</span>
      <button className="btn primary" onClick={idle.stay}>Continuar conectada</button>
    </div>
  );

  async function opened(key: CryptoKey, isNew = false) {
    if (isNew && backend.isDemo) await seedDemoData(backend, key);
    await backend.logLogin();
    setNotice('');
    setPhase({ kind: 'open', key });
  }

  if (fatal) return <div className="gate"><p className="error">{fatal}</p></div>;

  switch (phase.kind) {
    case 'loading':
      return <div className="gate"><p className="muted">Carregando…</p></div>;
    case 'auth': {
      const step = phase.step;
      const onStep = (s: AuthStep) => void afterAuth(s).catch((e) => setFatal(messageOf(e)));
      return (
        <>
          {notice && <p className="notice" role="status" style={{ margin: 16 }}>{notice}</p>}
          {step.step === 'signed-out' && <LoginScreen backend={backend} onStep={onStep} />}
          {step.step === 'mfa-enroll' && <MfaEnrollScreen backend={backend} onStep={onStep} />}
          {step.step === 'mfa-verify' && <MfaVerifyScreen backend={backend} factorId={step.factorId} onStep={onStep} />}
        </>
      );
    }
    case 'vault-setup':
      return <>{idleBanner}<VaultSetupScreen backend={backend} onReady={(k, isNew) => void opened(k, isNew)} /></>;
    case 'vault-unlock':
      return <>{idleBanner}<UnlockScreen backend={backend} record={phase.record} onReady={(k) => void opened(k)} onSignOut={() => void signOut()} /></>;
    case 'open':
      return (
        <ClinicProvider backend={backend} cryptoKey={phase.key}>
          {idleBanner}
          <Shell nav={nav} go={setNav} onSignOut={() => void signOut()} demo={backend.isDemo} />
        </ClinicProvider>
      );
  }
}

function Shell({ nav, go, onSignOut, demo }: { nav: Nav; go: (n: Nav) => void; onSignOut: () => void; demo: boolean }) {
  const section = nav.screen === 'ficha' ? 'pacientes' : nav.screen === 'sessao' ? nav.back.screen === 'ficha' ? 'pacientes' : nav.back.screen : nav.screen;
  const items: Array<[Nav['screen'], string]> = [
    ['hoje', 'Hoje'],
    ['pacientes', 'Pacientes'],
    ['financeiro', 'Financeiro'],
    ['seguranca', 'Segurança'],
  ];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [nav]);

  return (
    <div className="shell">
      <nav className="side" aria-label="Principal">
        <Brand />
        {items.map(([k, label]) => (
          <button key={k} type="button" className="nav-btn" aria-current={section === k ? 'page' : undefined} onClick={() => go({ screen: k } as Nav)}>
            {label}
          </button>
        ))}
        <div className="side-foot">
          {demo && <span className="notice">Modo demonstração com dados fictícios. Nada é salvo.</span>}
          <button type="button" className="nav-btn" onClick={onSignOut}>Sair</button>
        </div>
      </nav>
      <main className="main">
        {nav.screen === 'hoje' && <TodayScreen go={go} />}
        {nav.screen === 'pacientes' && <PatientsScreen go={go} />}
        {nav.screen === 'ficha' && <PatientScreen key={nav.patientId} patientId={nav.patientId} go={go} />}
        {nav.screen === 'sessao' && <SessionScreen key={nav.sessionId} nav={nav} go={go} />}
        {nav.screen === 'financeiro' && <FinanceScreen go={go} />}
        {nav.screen === 'seguranca' && <SecurityScreen />}
      </main>
    </div>
  );
}
