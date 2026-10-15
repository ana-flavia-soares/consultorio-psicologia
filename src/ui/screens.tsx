// Telas do sistema (depois de entrar e desbloquear o cofre).
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { AuditRow, PaymentMethod, PaymentRow, SessionRow, SessionStatus } from '../backend/types.ts';
import { aad, changePassphrase, decryptField, encryptField, passphraseProblems, unlockVault, WrongSecretError } from '../crypto/vault.ts';
import { recentErrors } from '../security/safeLog.ts';
import { sealPatientFields, useClinic, type Patient } from './clinic.tsx';
import { messageOf } from './errors.ts';
import { bannedPassphraseWords, brand } from '../config.ts';
import {
  addDays,
  addMonths,
  brl,
  dateTime,
  ddmm,
  FREQ_LABEL,
  greeting,
  hhmm,
  initials,
  localDateInput,
  longToday,
  METHOD_LABEL,
  monthTitle,
  parseBrl,
  startOfDay,
  startOfMonth,
} from './format.ts';

export type Nav =
  | { screen: 'hoje' }
  | { screen: 'pacientes' }
  | { screen: 'ficha'; patientId: string }
  | { screen: 'sessao'; sessionId: string; patientId: string; back: Nav }
  | { screen: 'financeiro' }
  | { screen: 'seguranca' };

type Go = (n: Nav) => void;

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn link" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></svg>
      {label}
    </button>
  );
}

function Lock({ children }: { children: ReactNode }) {
  return (
    <span className="lock-line">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      {children}
    </span>
  );
}

function validPayment(payments: PaymentRow[], sessionId: string): PaymentRow | undefined {
  return payments.find((p) => p.session_id === sessionId && !p.voided_at);
}

/** Sessões que geram cobrança. Faltas e cancelamentos ficam fora; ajuste se ela cobrar falta. */
const CHARGEABLE: SessionStatus[] = ['realizada'];

function PayChip({ s, payments }: { s: SessionRow; payments: PaymentRow[] }) {
  if (s.status === 'agendada') return null;
  if (s.status === 'cancelada') return <span className="chip neutral">Cancelada</span>;
  if (s.status === 'falta') return <span className="chip neutral">Faltou</span>;
  return validPayment(payments, s.id) ? <span className="chip ok">Pago</span> : <span className="chip money">A receber</span>;
}

function NoteChip({ s }: { s: SessionRow }) {
  const { noteStatus } = useClinic();
  if (s.status === 'agendada') return <span className="chip neutral">Agendada</span>;
  if (s.status === 'cancelada') return null;
  return noteStatus.has(s.id) ? <span className="chip ok">Anotada</span> : <span className="chip plum">Falta anotar</span>;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let alive = true;
    setError('');
    run().then(
      (d) => alive && setData(d),
      (e) => alive && setError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [run, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

// ---------------------------------------------------------------------------
// Agendar sessão
// ---------------------------------------------------------------------------

function ScheduleForm({ fixedPatient, onDone, onCancel }: { fixedPatient?: Patient; onDone: () => void; onCancel: () => void }) {
  const { backend, patients } = useClinic();
  const active = patients.filter((p) => !p.archivedAt);
  const [pid, setPid] = useState(fixedPatient?.id ?? active[0]?.id ?? '');
  const [day, setDay] = useState(localDateInput());
  const [time, setTime] = useState('09:00');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = patients.find((x) => x.id === pid);
    if (!p) return setError('Escolha um paciente.');
    const when = new Date(`${day}T${time}:00`);
    if (Number.isNaN(when.getTime())) return setError('Data ou horário inválido.');
    setBusy(true);
    setError('');
    try {
      await backend.createSession({ patient_id: p.id, starts_at: when.toISOString(), status: when.getTime() < Date.now() ? 'realizada' : 'agendada', price_cents: p.priceCents });
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} aria-label="Agendar sessão">
      <h2>Agendar sessão</h2>
      <div className="form-grid">
        {!fixedPatient && (
          <div className="field">
            <label htmlFor="sp">Paciente</label>
            <select id="sp" className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="sd">Data</label>
          <input id="sd" className="input" type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="st">Horário</label>
          <input id="st" className="input" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="kv" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary" disabled={busy || active.length === 0}>Agendar</button>
        <button type="button" className="btn quiet" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Hoje
// ---------------------------------------------------------------------------

export function TodayScreen({ go }: { go: Go }) {
  const { backend, patientById, noteStatus, loading } = useClinic();
  const [scheduling, setScheduling] = useState(false);
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(today);

  const { data, error, reload } = useAsync(async () => {
    const [todayS, monthS] = await Promise.all([
      backend.listSessions(today.toISOString(), addDays(today, 1).toISOString()),
      backend.listSessions(monthStart.toISOString(), addMonths(monthStart, 1).toISOString()),
    ]);
    const payments = await backend.listPayments([...new Set([...todayS, ...monthS].map((s) => s.id))]);
    const recent = await backend.listSessions(addDays(today, -30).toISOString(), addDays(today, 1).toISOString());
    return { todayS, monthS, payments, recent };
  }, [backend]);

  if (loading || !data) return <p className="muted">{error || 'Carregando…'}</p>;
  const { todayS, monthS, payments, recent } = data;
  const charged = monthS.filter((s) => CHARGEABLE.includes(s.status));
  const received = charged.filter((s) => validPayment(payments, s.id)).reduce((a, s) => a + s.price_cents, 0);
  const pending = charged.filter((s) => !validPayment(payments, s.id)).reduce((a, s) => a + s.price_cents, 0);
  const toWrite = recent.filter((s) => s.status === 'realizada' && !noteStatus.has(s.id)).length;
  const next = todayS.find((s) => s.status === 'agendada' && new Date(s.starts_at) > new Date());

  return (
    <>
      <div className="head">
        <div className="stack">
          <span className="muted small">{greeting()}{brand.firstName ? `, ${brand.firstName}` : ''}</span>
          <h1>{longToday()}</h1>
          <span className="muted">
            {todayS.length === 1 ? '1 sessão hoje' : `${todayS.length} sessões hoje`}
            {next ? ` · próxima às ${hhmm(next.starts_at)}` : ''}
          </span>
        </div>
        <button className="btn primary" onClick={() => setScheduling(true)}>Agendar sessão</button>
      </div>
      {scheduling && <ScheduleForm onDone={() => { setScheduling(false); reload(); }} onCancel={() => setScheduling(false)} />}
      <div className="tiles">
        <div className="tile"><span className="small muted">Recebido em {monthTitle(today).split(' ')[0]}</span><strong>{brl(received)}</strong></div>
        <div className="tile"><span className="small muted">A receber</span><strong style={{ color: 'var(--money)' }}>{brl(pending)}</strong></div>
        <div className="tile"><span className="small muted">Prontuários por anotar (30 dias)</span><strong>{toWrite}</strong></div>
      </div>
      <section className="card flush" aria-label="Sessões de hoje">
        <div className="card-head"><h2>Sessões de hoje</h2></div>
        {todayS.length === 0 && <p className="empty">Nenhuma sessão hoje.</p>}
        {todayS.map((s) => {
          const urgent = s.status === 'realizada' && (!noteStatus.has(s.id) || !validPayment(payments, s.id));
          return (
            <div className="row" key={s.id}>
              <strong className="time">{hhmm(s.starts_at)}</strong>
              <span className="name">{patientById(s.patient_id)?.name ?? '—'}</span>
              <NoteChip s={s} />
              <PayChip s={s} payments={payments} />
              <button className={`btn ${urgent ? 'primary' : ''}`} onClick={() => go({ screen: 'sessao', sessionId: s.id, patientId: s.patient_id, back: { screen: 'hoje' } })}>
                Abrir sessão
              </button>
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sessão: prontuário e pagamento
// ---------------------------------------------------------------------------

interface DecryptedNote {
  version: number;
  text: string;
  at: string;
  ok: boolean;
}

async function loadNotes(sessionId: string, backendKey: { backend: ReturnType<typeof useClinic>['backend']; key: CryptoKey }): Promise<DecryptedNote[]> {
  const rows = await backendKey.backend.getNotes(sessionId);
  return Promise.all(
    rows.map(async (r) => {
      try {
        return { version: r.version, text: await decryptField(backendKey.key, { ct: r.ciphertext, iv: r.iv }, aad.note(sessionId, r.version)), at: r.created_at, ok: true };
      } catch {
        return { version: r.version, text: 'Esta versão não pôde ser aberta. O conteúdo pode ter sido alterado fora do sistema.', at: r.created_at, ok: false };
      }
    }),
  );
}

function PreviousNote({ session }: { session: SessionRow }) {
  const { backend, key } = useClinic();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<DecryptedNote | null | undefined>(undefined);
  useEffect(() => {
    if (!open || note !== undefined) return;
    loadNotes(session.id, { backend, key }).then((n) => setNote(n[n.length - 1] ?? null), () => setNote(null));
  }, [open, note, session.id, backend, key]);
  return (
    <details className="card" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 28 }}>Anotação da sessão anterior ({ddmm(session.starts_at)})</summary>
      {open && (note === undefined ? <p className="muted">Abrindo…</p> : note ? <div className="readonly-note">{note.text}</div> : <p className="muted">Sem anotação.</p>)}
    </details>
  );
}

export function SessionScreen({ nav, go }: { nav: Extract<Nav, { screen: 'sessao' }>; go: Go }) {
  const { backend, key, patientById, noteStatus, reloadNotes } = useClinic();
  const patient = patientById(nav.patientId);
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [draft, setDraft] = useState<string | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, error, reload } = useAsync(async () => {
    const all = await backend.listSessionsOfPatient(nav.patientId);
    const session = all.find((s) => s.id === nav.sessionId);
    if (!session) throw new Error('Sessão não encontrada');
    const [notes, payments] = await Promise.all([loadNotes(session.id, { backend, key }), backend.listPayments(all.map((s) => s.id))]);
    return { session, all, notes, payments };
  }, [backend, key, nav.sessionId, nav.patientId]);

  useEffect(() => {
    setDraft(null);
    setViewVersion(null);
    setMsg('');
  }, [nav.sessionId]);

  if (!data) return <p className="muted">{error || 'Carregando…'}</p>;
  const { session, all, notes, payments } = data;
  const latest = notes[notes.length - 1];
  const text = draft ?? latest?.text ?? '';
  const pay = validPayment(payments, session.id);
  const previous = all.filter((s) => s.starts_at < session.starts_at && s.status !== 'cancelada').reverse();
  const prevWithNote = previous.find((s) => noteStatus.has(s.id));
  const viewing = viewVersion !== null ? notes.find((n) => n.version === viewVersion) : undefined;

  async function act(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const saveNote = () =>
    act(async () => {
      if (!text.trim()) throw new Error('Escreva a anotação antes de salvar.');
      if (latest && text === latest.text) throw new Error('Nada mudou desde a última versão.');
      const nextVersion = (latest?.version ?? 0) + 1;
      const sealed = await encryptField(key, text, aad.note(session.id, nextVersion));
      const v = await backend.addNote(session.id, nextVersion, sealed.ct, sealed.iv);
      setDraft(null);
      await reloadNotes();
      reload();
      setMsg(`Versão ${v} salva às ${hhmm(new Date().toISOString())}.`);
    });

  const backLabel = nav.back.screen === 'ficha' ? 'Voltar para a ficha' : nav.back.screen === 'financeiro' ? 'Voltar para o financeiro' : 'Voltar para hoje';

  return (
    <>
      <BackButton label={backLabel} onClick={() => go(nav.back)} />
      <div className="head">
        <div className="stack">
          <h1>{patient?.name ?? 'Paciente'}</h1>
          <span className="muted">Sessão de {dateTime(session.starts_at)} · {session.status === 'falta' ? 'faltou' : session.status}</span>
        </div>
        <div className="kv" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          {session.status !== 'realizada' && <button className="btn" disabled={busy} onClick={() => act(async () => { await backend.updateSessionStatus(session.id, 'realizada'); reload(); })}>Marcar como realizada</button>}
          {session.status !== 'falta' && session.status !== 'cancelada' && <button className="btn quiet" disabled={busy} onClick={() => act(async () => { await backend.updateSessionStatus(session.id, 'falta'); reload(); })}>Faltou</button>}
          {session.status === 'agendada' && <button className="btn quiet" disabled={busy} onClick={() => act(async () => { await backend.updateSessionStatus(session.id, 'cancelada'); reload(); })}>Cancelar</button>}
        </div>
      </div>
      {msg && <p className={/salva|registrado|desfeito/.test(msg) ? 'success' : 'error'} role="status">{msg}</p>}

      <div className="split">
        <section className="card wide">
          <div className="kv" style={{ flexWrap: 'wrap' }}>
            <label htmlFor="anot"><h2>Anotação do prontuário</h2></label>
            <Lock>Criptografada no seu computador</Lock>
          </div>
          {notes.length > 1 && (
            <div className="versions" aria-label="Versões salvas">
              {notes.map((n) => (
                <button key={n.version} type="button" className="version-btn" aria-pressed={viewVersion === n.version} onClick={() => setViewVersion(viewVersion === n.version ? null : n.version)}>
                  v{n.version} · {dateTime(n.at)}
                </button>
              ))}
            </div>
          )}
          {viewing ? (
            <>
              <p className="small muted">Versão {viewing.version}, salva em {dateTime(viewing.at)}. Versões antigas não podem ser alteradas.</p>
              <div className="readonly-note">{viewing.text}</div>
              <button className="btn quiet" onClick={() => setViewVersion(null)}>Voltar para a versão atual</button>
            </>
          ) : (
            <>
              <textarea
                id="anot"
                className="input"
                placeholder={'Evolução:\nProcedimentos:\nEncaminhamentos:'}
                value={text}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck
              />
              <div className="kv" style={{ flexWrap: 'wrap' }}>
                <span className="small muted">
                  {latest ? `Versão ${latest.version} de ${dateTime(latest.at)}. Salvar cria uma nova versão; as anteriores ficam guardadas.` : 'Só você consegue ler este texto. Ele não aparece no financeiro.'}
                </span>
                <button className="btn primary" disabled={busy || draft === null} onClick={saveNote}>Salvar anotação</button>
              </div>
            </>
          )}
        </section>

        <div className="narrow">
          <section className="card">
            <h2>Pagamento</h2>
            <div className="kv"><span className="muted">Valor</span><strong>{brl(session.price_cents)}</strong></div>
            <div className="kv"><span className="muted">Situação</span><PayChip s={session} payments={payments} /></div>
            {session.status === 'realizada' && (pay ? (
              <>
                <p className="small muted">Pago via {METHOD_LABEL[pay.method]} em {ddmm(pay.paid_on + 'T12:00:00')}.</p>
                <button className="btn quiet" disabled={busy} onClick={() => { if (window.confirm('Desfazer este pagamento? Ele continua no histórico como desfeito.')) void act(async () => { await backend.voidPayment(pay.id); reload(); }, 'Pagamento desfeito.'); }}>Desfazer pagamento</button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="pm">Forma de pagamento</label>
                  <select id="pm" className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <button className="btn primary" disabled={busy} onClick={() => act(async () => { await backend.addPayment(session.id, session.price_cents, method, localDateInput()); reload(); }, 'Pagamento registrado.')}>Marcar como pago</button>
              </>
            ))}
            <span className="small muted">O financeiro recebe só valor, data e forma de pagamento.</span>
          </section>

          <section className="card">
            <h2>Sessões anteriores</h2>
            {previous.length === 0 && <p className="muted">Primeira sessão.</p>}
            {previous.slice(0, 6).map((s) => (
              <button key={s.id} type="button" className="btn quiet full" style={{ justifyContent: 'space-between', padding: '0 12px' }} onClick={() => go({ screen: 'sessao', sessionId: s.id, patientId: s.patient_id, back: nav.back })}>
                <span>{ddmm(s.starts_at)}</span>
                <span className="kv"><NoteChip s={s} /><PayChip s={s} payments={payments} /></span>
              </button>
            ))}
          </section>
        </div>
      </div>
      {prevWithNote && <PreviousNote key={prevWithNote.id} session={prevWithNote} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pacientes
// ---------------------------------------------------------------------------

function PatientForm({ initial, onDone, onCancel }: { initial?: Patient; onDone: (id: string) => void; onCancel: () => void }) {
  const { backend, key, reloadPatients } = useClinic();
  const [name, setName] = useState(initial?.name ?? '');
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [freq, setFreq] = useState(initial?.frequency ?? 'semanal');
  const [price, setPrice] = useState(initial ? String(initial.priceCents / 100).replace('.', ',') : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBrl(price);
    if (!name.trim()) return setError('Informe o nome.');
    if (cents === null) return setError('Valor da sessão inválido.');
    setBusy(true);
    setError('');
    try {
      const id = initial?.id ?? crypto.randomUUID();
      const sealed = await sealPatientFields(key, id, name, contact);
      if (initial) {
        await backend.updatePatient(id, { ...sealed, frequency: freq, session_price_cents: cents });
      } else {
        await backend.createPatient({ id, ...sealed, frequency: freq, session_price_cents: cents, started_on: localDateInput() });
      }
      await reloadPatients();
      onDone(id);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{initial ? 'Editar dados' : 'Novo paciente'}</h2>
      <div className="form-grid">
        <div className="field"><label htmlFor="pn">Nome</label><input id="pn" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
        <div className="field"><label htmlFor="pc">Contato (opcional)</label><input id="pc" className="input" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" /></div>
        <div className="field">
          <label htmlFor="pf">Frequência</label>
          <select id="pf" className="input" value={freq} onChange={(e) => setFreq(e.target.value as Patient['frequency'])}>
            {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="pv">Valor da sessão (R$)</label><input id="pv" className="input" inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150" /></div>
      </div>
      <p className="small muted">Nome e contato são criptografados antes de sair do seu computador. Guarde só o necessário: CPF, endereço e diagnóstico não são pedidos aqui de propósito.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="kv" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="btn quiet" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export function PatientsScreen({ go }: { go: Go }) {
  const { patients, loading } = useClinic();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const list = patients
    .filter((p) => (showArchived ? true : !p.archivedAt))
    .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const activeCount = patients.filter((p) => !p.archivedAt).length;

  return (
    <>
      <div className="head">
        <div className="stack"><h1>Pacientes</h1><span className="muted">{activeCount === 1 ? '1 paciente ativo' : `${activeCount} pacientes ativos`}</span></div>
        <button className="btn primary" onClick={() => setAdding(true)}>Novo paciente</button>
      </div>
      {adding && <PatientForm onDone={(id) => { setAdding(false); go({ screen: 'ficha', patientId: id }); }} onCancel={() => setAdding(false)} />}
      <div className="kv" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor="busca" className="sr-only">Buscar paciente</label>
          <input id="busca" className="input" placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Mostrar arquivados
        </label>
      </div>
      <section className="card flush" aria-label="Lista de pacientes">
        {loading && <p className="empty">Carregando…</p>}
        {!loading && list.length === 0 && <p className="empty">Nenhum paciente encontrado.</p>}
        {list.map((p) => (
          <div className="row" key={p.id}>
            <span className="avatar" aria-hidden="true">{initials(p.name)}</span>
            <span className="name stack" style={{ gap: 2 }}>
              <strong>{p.name}</strong>
              <span className="small muted">{FREQ_LABEL[p.frequency]} · desde {new Date(p.startedOn + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span>
            </span>
            {p.archivedAt && <span className="chip neutral">Arquivado</span>}
            <button className="btn" onClick={() => go({ screen: 'ficha', patientId: p.id })}>Ver ficha</button>
          </div>
        ))}
      </section>
    </>
  );
}

export function PatientScreen({ patientId, go }: { patientId: string; go: Go }) {
  const { backend, patientById, reloadPatients } = useClinic();
  const p = patientById(patientId);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [msg, setMsg] = useState('');

  const { data, error, reload } = useAsync(async () => {
    const sessions = await backend.listSessionsOfPatient(patientId);
    const payments = await backend.listPayments(sessions.map((s) => s.id));
    return { sessions, payments };
  }, [backend, patientId]);

  if (!p) return <p className="muted">Paciente não encontrado.</p>;
  const sessions = data?.sessions ?? [];
  const payments = data?.payments ?? [];
  const open = sessions.filter((s) => CHARGEABLE.includes(s.status) && !validPayment(payments, s.id)).reduce((a, s) => a + s.price_cents, 0);
  const nextS = sessions.find((s) => s.status === 'agendada' && new Date(s.starts_at) > new Date());

  async function toggleArchive() {
    try {
      await backend.updatePatient(p!.id, { archived_at: p!.archivedAt ? null : new Date().toISOString() });
      await reloadPatients();
      setMsg(p!.archivedAt ? 'Paciente reativado.' : 'Paciente arquivado. O histórico continua guardado.');
    } catch (e) {
      setMsg(messageOf(e));
    }
  }

  return (
    <>
      <BackButton label="Voltar para pacientes" onClick={() => go({ screen: 'pacientes' })} />
      <div className="head">
        <div className="kv" style={{ gap: 16 }}>
          <span className="avatar" style={{ width: 56, height: 56, fontSize: 20 }} aria-hidden="true">{initials(p.name)}</span>
          <div className="stack"><h1>{p.name}</h1><span className="muted">{FREQ_LABEL[p.frequency]} · desde {new Date(p.startedOn + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</span></div>
        </div>
        <div className="kv" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <button className="btn primary" onClick={() => setScheduling(true)}>Agendar sessão</button>
          <button className="btn" onClick={() => setEditing(true)}>Editar</button>
          <button className="btn quiet" onClick={toggleArchive}>{p.archivedAt ? 'Reativar' : 'Arquivar'}</button>
        </div>
      </div>
      {msg && <p className="success" role="status">{msg}</p>}
      {editing && <PatientForm initial={p} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      {scheduling && <ScheduleForm fixedPatient={p} onDone={() => { setScheduling(false); reload(); }} onCancel={() => setScheduling(false)} />}
      <div className="split">
        <section className="card narrow" style={{ gap: 12 }}>
          <h2>Dados</h2>
          <div className="kv"><span className="muted">Valor da sessão</span><strong>{brl(p.priceCents)}</strong></div>
          <div className="kv"><span className="muted">Contato</span><strong>{p.contact || '—'}</strong></div>
          <div className="kv"><span className="muted">Próxima sessão</span><strong>{nextS ? dateTime(nextS.starts_at) : '—'}</strong></div>
          <div className="kv"><span className="muted">Em aberto</span><strong style={{ color: open ? 'var(--money)' : undefined }}>{open ? brl(open) : 'Nada'}</strong></div>
        </section>
        <section className="card flush wide">
          <div className="card-head"><h2>Histórico de sessões</h2></div>
          {error && <p className="empty">{error}</p>}
          {!error && sessions.length === 0 && <p className="empty">Nenhuma sessão ainda.</p>}
          {sessions.slice().reverse().map((s) => (
            <div className="row" key={s.id}>
              <strong style={{ flex: '1 1 120px', whiteSpace: 'nowrap' }}>{dateTime(s.starts_at)}</strong>
              <NoteChip s={s} />
              <PayChip s={s} payments={payments} />
              <button className="btn" onClick={() => go({ screen: 'sessao', sessionId: s.id, patientId: p.id, back: { screen: 'ficha', patientId: p.id } })}>Abrir</button>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

function csvCell(v: string): string {
  // Evita que planilhas executem fórmulas vindas de dados (injeção de CSV).
  const safe = /^[=+\-@\t\r\n]/.test(v) || /^[=+\-@]/.test(v.trimStart()) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function FinanceScreen({ go }: { go: Go }) {
  const { backend, patientById } = useClinic();
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [busyId, setBusyId] = useState('');
  const [msg, setMsg] = useState('');

  const { data, error, reload } = useAsync(async () => {
    const sessions = await backend.listSessions(month.toISOString(), addMonths(month, 1).toISOString());
    const payments = await backend.listPayments(sessions.map((s) => s.id));
    return { sessions, payments };
  }, [backend, month.getTime()]);

  const rows = useMemo(() => (data ? data.sessions.filter((s) => CHARGEABLE.includes(s.status)).reverse() : []), [data]);
  if (!data) return <p className="muted">{error || 'Carregando…'}</p>;
  const { payments } = data;
  const received = rows.filter((s) => validPayment(payments, s.id)).reduce((a, s) => a + s.price_cents, 0);
  const pending = rows.filter((s) => !validPayment(payments, s.id)).reduce((a, s) => a + s.price_cents, 0);

  async function toggle(s: SessionRow) {
    const pay = validPayment(payments, s.id);
    if (pay && !window.confirm('Desfazer este pagamento? Ele continua no histórico como desfeito.')) return;
    setBusyId(s.id);
    setMsg('');
    try {
      if (pay) await backend.voidPayment(pay.id);
      else await backend.addPayment(s.id, s.price_cents, 'pix', localDateInput());
      reload();
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setBusyId('');
    }
  }

  function exportCsv() {
    if (!window.confirm('A planilha sai do sistema sem criptografia e terá os nomes dos pacientes. Guarde o arquivo em local protegido e apague quando não precisar mais. Continuar?')) return;
    const lines = [['Data', 'Paciente', 'Valor', 'Situação', 'Forma'].map(csvCell).join(';')];
    for (const s of rows.slice().reverse()) {
      const pay = validPayment(payments, s.id);
      lines.push(
        [dateTime(s.starts_at), patientById(s.patient_id)?.name ?? '', (s.price_cents / 100).toFixed(2).replace('.', ','), pay ? 'Pago' : 'A receber', pay ? METHOD_LABEL[pay.method] : '']
          .map(csvCell)
          .join(';'),
      );
    }
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-${localDateInput(month).slice(0, 7)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <div className="head">
        <div className="stack">
          <h1>Financeiro</h1>
          <span className="muted">Calculado a partir das sessões realizadas. Nada para digitar duas vezes.</span>
        </div>
        <div className="kv" style={{ flexWrap: 'wrap' }}>
          <div className="month-nav">
            <button className="btn quiet" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
            <strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{monthTitle(month)}</strong>
            <button className="btn quiet" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>›</button>
          </div>
          <button className="btn" onClick={exportCsv} disabled={rows.length === 0}>Baixar planilha do mês</button>
        </div>
      </div>
      <div className="tiles">
        <div className="tile hero"><span className="small" style={{ fontWeight: 600 }}>Recebido</span><strong>{brl(received)}</strong></div>
        <div className="tile"><span className="small muted">A receber</span><strong style={{ color: 'var(--money)' }}>{brl(pending)}</strong></div>
        <div className="tile"><span className="small muted">Sessões realizadas</span><strong>{rows.length}</strong></div>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
      <section className="card flush" aria-label="Sessões do mês">
        <div className="card-head"><h2>Sessões do mês</h2><Lock>Nenhuma anotação do prontuário aparece aqui</Lock></div>
        {rows.length === 0 && <p className="empty">Nenhuma sessão realizada neste mês.</p>}
        {rows.map((s) => {
          const pay = validPayment(payments, s.id);
          return (
            <div className="row" key={s.id}>
              <span className="date-col">{dateTime(s.starts_at)}</span>
              <button type="button" className="name btn link" style={{ justifyContent: 'flex-start', color: 'var(--ink)' }} onClick={() => go({ screen: 'sessao', sessionId: s.id, patientId: s.patient_id, back: { screen: 'financeiro' } })}>
                {patientById(s.patient_id)?.name ?? '—'}
              </button>
              <span className="money-col">{brl(s.price_cents)}</span>
              <span className="status-col"><PayChip s={s} payments={payments} /></span>
              <button className={`btn fixed ${pay ? 'quiet' : 'primary'}`} disabled={busyId === s.id} onClick={() => toggle(s)}>{pay ? 'Desfazer' : 'Marcar pago'}</button>
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<AuditRow['action'], string> = { insert: 'Criou', update: 'Alterou', read: 'Abriu', login: 'Entrou no sistema' };
const ENTITY_LABEL: Record<string, string> = {
  session_notes: 'anotação do prontuário',
  patients: 'cadastro de paciente',
  sessions: 'sessão da agenda',
  payments: 'pagamento',
  vault: 'cofre (senha)',
  auth: '',
};

export function SecurityScreen() {
  const { backend } = useClinic();
  const { data, error } = useAsync(() => backend.listAudit(500), [backend]);
  const [onlyReads, setOnlyReads] = useState(false);
  const shown = (data ?? []).filter((a) => !onlyReads || a.action === 'read');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const problems = next ? passphraseProblems(next, bannedPassphraseWords()) : [];
  const errs = recentErrors();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const record = await backend.getVault();
      if (!record) throw new Error('Cofre não encontrado.');
      const updated = await changePassphrase(record, { senha: cur }, next);
      await unlockVault(updated, next);
      await backend.updateVault(updated);
      setCur('');
      setNext('');
      setMsg('Senha do cofre trocada. Use a nova senha no próximo acesso.');
    } catch (err) {
      setMsg(err instanceof WrongSecretError ? 'Senha atual incorreta.' : messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="stack"><h1>Segurança</h1><span className="muted">Quem acessou o quê, e quando.</span></div>
      <div className="split">
        <section className="card flush wide">
          <div className="card-head">
            <h2>Histórico de acesso</h2>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={onlyReads} onChange={(e) => setOnlyReads(e.target.checked)} /> Só aberturas de anotação
            </label>
          </div>
          {error && <p className="empty">{error}</p>}
          {data && shown.length === 0 && <p className="empty">Nada registrado.</p>}
          {shown.map((a) => (
            <div className="row" key={a.id} style={{ padding: '10px 20px' }}>
              <span className="date-col" style={{ flex: '0 0 130px' }}>{dateTime(a.at)}</span>
              <span style={{ flex: '1 1 200px' }}>{ACTION_LABEL[a.action]} {ENTITY_LABEL[a.entity] ?? a.entity}</span>
            </div>
          ))}
        </section>
        <div className="narrow">
          <form className="card" onSubmit={submit}>
            <h2>Trocar a senha do cofre</h2>
            <div className="field"><label htmlFor="cp">Senha atual</label><input id="cp" className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
            <div className="field"><label htmlFor="np2">Nova senha</label><input id="np2" className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></div>
            {problems.length > 0 && <ul className="error small" style={{ margin: 0, paddingLeft: 20 }}>{problems.map((x) => <li key={x}>{x}</li>)}</ul>}
            {msg && <p className={msg.startsWith('Senha do cofre trocada') ? 'success' : 'error'} role="status">{msg}</p>}
            <button className="btn primary" disabled={busy || problems.length > 0}>Trocar senha</button>
            <span className="small muted">A chave de recuperação continua a mesma.</span>
          </form>
          <section className="card">
            <h2>Proteções ativas</h2>
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }} className="small">
              <li>Entrada com senha e código do celular.</li>
              <li>Nomes, contatos e anotações criptografados no seu computador.</li>
              <li>Anotações nunca são sobrescritas: cada edição vira uma versão.</li>
              <li>Nenhum registro pode ser apagado (guarda mínima de 5 anos).</li>
              <li>Saída automática após 10 minutos sem uso.</li>
            </ul>
          </section>
          {errs.length > 0 && (
            <section className="card">
              <h2>Erros recentes</h2>
              <p className="small muted">Sem nenhum dado de paciente. Útil para o suporte.</p>
              {errs.slice(-5).map((e) => <div key={e.at + e.where} className="small">{dateTime(e.at)} · {e.where} · {e.code}</div>)}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
