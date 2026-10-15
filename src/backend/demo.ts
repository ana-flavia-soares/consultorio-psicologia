// Modo demonstração: tudo em memória, com dados fictícios.
// Serve para mostrar o sistema sem servidor e para os testes de tela.
// Os dados de demonstração passam pela MESMA criptografia do modo real.

import { aad, encryptField, type VaultRecord } from '../crypto/vault.ts';
import {
  UserFacingError,
  type AuditRow,
  type AuthStep,
  type Backend,
  type NoteRow,
  type PatientRow,
  type PaymentRow,
  type SessionRow,
} from './types.ts';

export const DEMO_EMAIL = 'demonstracao@consultorio.local';
export const DEMO_PASSWORD = 'demonstracao';
export const DEMO_MFA_CODE = '123456';

const DEMO_QR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#fff"/>' +
      '<g fill="#2E2A24"><rect x="10" y="10" width="30" height="30"/><rect x="80" y="10" width="30" height="30"/><rect x="10" y="80" width="30" height="30"/>' +
      '<rect x="50" y="50" width="10" height="10"/><rect x="65" y="60" width="10" height="10"/><rect x="50" y="75" width="10" height="10"/><rect x="85" y="85" width="10" height="10"/></g>' +
      '<rect x="17" y="17" width="16" height="16" fill="#fff"/><rect x="87" y="17" width="16" height="16" fill="#fff"/><rect x="17" y="87" width="16" height="16" fill="#fff"/></svg>',
  );

export function createDemoBackend(): Backend {
  let step: AuthStep = { step: 'signed-out' };
  let enrolled = false;
  let vault: VaultRecord | null = null;
  const patients: PatientRow[] = [];
  const sessions: SessionRow[] = [];
  const payments: PaymentRow[] = [];
  const notes = new Map<string, NoteRow[]>();
  const audit: AuditRow[] = [];
  let auditId = 0;

  const log = (action: AuditRow['action'], entity: string, entity_id: string | null) =>
    audit.unshift({ id: ++auditId, action, entity, entity_id, at: new Date().toISOString() });

  const requireReady = () => {
    if (step.step !== 'ready') throw new UserFacingError('Acesso negado.');
  };

  return {
    isDemo: true,
    auth: {
      async current() {
        return step;
      },
      async signIn(email, password) {
        if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
          throw new UserFacingError('E-mail ou senha incorretos.');
        }
        step = enrolled ? { step: 'mfa-verify', factorId: 'demo' } : { step: 'mfa-enroll' };
        return step;
      },
      async startEnroll() {
        return { factorId: 'demo', qrCode: DEMO_QR, secret: 'DEMO DEMO DEMO DEMO' };
      },
      async finishEnroll(_f, code) {
        if (code !== DEMO_MFA_CODE) throw new UserFacingError('Código inválido. Confira o horário do celular e tente o código atual.');
        enrolled = true;
        step = { step: 'ready', email: DEMO_EMAIL };
        return step;
      },
      async verify(_f, code) {
        if (code !== DEMO_MFA_CODE) throw new UserFacingError('Código inválido. Tente o código que aparece agora no app.');
        step = { step: 'ready', email: DEMO_EMAIL };
        return step;
      },
      async signOut() {
        step = { step: 'signed-out' };
      },
    },

    async getVault() {
      requireReady();
      return vault;
    },
    async createVault(record) {
      requireReady();
      if (vault) throw new UserFacingError('O cofre já existe.');
      vault = { ...record };
      log('insert', 'vault', null);
    },
    async updateVault(record) {
      requireReady();
      vault = { ...record };
      log('update', 'vault', null);
    },

    async listPatients() {
      requireReady();
      return patients.map((p) => ({ ...p }));
    },
    async createPatient(p) {
      requireReady();
      patients.push({ ...p, archived_at: null });
      log('insert', 'patients', p.id);
    },
    async updatePatient(id, patch) {
      requireReady();
      const p = patients.find((x) => x.id === id);
      if (!p) throw new UserFacingError('Paciente não encontrado.');
      Object.assign(p, patch);
      log('update', 'patients', id);
    },

    async listSessions(fromIso, toIso) {
      requireReady();
      return sessions
        .filter((s) => s.starts_at >= fromIso && s.starts_at < toIso)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((s) => ({ ...s }));
    },
    async listSessionsOfPatient(patientId) {
      requireReady();
      return sessions
        .filter((s) => s.patient_id === patientId)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((s) => ({ ...s }));
    },
    async createSession(s) {
      requireReady();
      if (!patients.some((p) => p.id === s.patient_id)) throw new UserFacingError('Paciente não encontrado.');
      const id = crypto.randomUUID();
      sessions.push({ ...s, id });
      log('insert', 'sessions', id);
      return id;
    },
    async updateSessionStatus(id, status) {
      requireReady();
      const s = sessions.find((x) => x.id === id);
      if (!s) throw new UserFacingError('Sessão não encontrada.');
      if (s.status !== status && payments.some((p) => p.session_id === id && !p.voided_at)) {
        throw new UserFacingError('Esta sessão já foi paga. Desfaça o pagamento antes de mudar valor ou situação.');
      }
      s.status = status;
      log('update', 'sessions', id);
    },

    async listPayments(sessionIds) {
      requireReady();
      return payments.filter((p) => sessionIds.includes(p.session_id)).map((p) => ({ ...p }));
    },
    async addPayment(sessionId, amountCents, method, paidOn) {
      requireReady();
      if (payments.some((p) => p.session_id === sessionId && !p.voided_at)) {
        throw new UserFacingError('Esta sessão já tem um pagamento registrado.');
      }
      const id = crypto.randomUUID();
      payments.push({ id, session_id: sessionId, amount_cents: amountCents, method, paid_on: paidOn, voided_at: null, created_at: new Date().toISOString() });
      log('insert', 'payments', id);
    },
    async voidPayment(id) {
      requireReady();
      const p = payments.find((x) => x.id === id);
      if (!p || p.voided_at) throw new UserFacingError('Este pagamento já foi desfeito.');
      p.voided_at = new Date().toISOString();
      log('update', 'payments', id);
    },

    async notesStatus() {
      requireReady();
      return [...notes.entries()].map(([session_id, list]) => ({
        session_id,
        last_version: list[list.length - 1].version,
        last_at: list[list.length - 1].created_at,
      }));
    },
    async getNotes(sessionId) {
      requireReady();
      log('read', 'session_notes', sessionId);
      return (notes.get(sessionId) ?? []).map((n) => ({ ...n }));
    },
    async addNote(sessionId, wanted, ciphertext, iv) {
      requireReady();
      if (iv.length !== 16) throw new UserFacingError('Conteúdo inválido.');
      const list = notes.get(sessionId) ?? [];
      const version = list.length + 1;
      if (wanted !== version) throw new UserFacingError('A anotação foi salva em outra tela. Recarregue antes de salvar de novo.');
      list.push({ version, ciphertext, iv, created_at: new Date().toISOString() });
      notes.set(sessionId, list);
      log('insert', 'session_notes', sessionId);
      return version;
    },

    async listAudit(limit) {
      requireReady();
      return audit.slice(0, limit);
    },
    async logLogin() {
      log('login', 'auth', null);
    },
  };
}

// ---------------------------------------------------------------------------
// Dados fictícios
// ---------------------------------------------------------------------------

interface SeedPatient {
  nome: string;
  freq: PatientRow['frequency'];
  preco: number;
  inicio: string;
}

const SEED_PATIENTS: SeedPatient[] = [
  { nome: 'Marina Alves', freq: 'semanal', preco: 15000, inicio: '2025-03-10' },
  { nome: 'Rafael Costa', freq: 'semanal', preco: 15000, inicio: '2025-08-04' },
  { nome: 'Juliana Prado', freq: 'quinzenal', preco: 18000, inicio: '2026-01-12' },
  { nome: 'Carlos Mendes', freq: 'semanal', preco: 15000, inicio: '2026-05-18' },
  { nome: 'Beatriz Lima', freq: 'semanal', preco: 15000, inicio: '2026-07-06' },
];

// [paciente, dias a partir de hoje, hora, pago, anotação]
const SEED_SESSIONS: Array<[number, number, string, boolean, string | null]> = [
  [0, -13, '09:00', true, 'Evolução: relata semana com menos crises de ansiedade antes das reuniões. Conseguiu aplicar a respiração combinada em duas situações.\nProcedimentos: revisão do registro de pensamentos; reestruturação de uma crença sobre "precisar agradar a todos".\nEncaminhamentos: manter o registro diário; retomar o tema dos limites no trabalho.'],
  [4, -13, '10:00', true, 'Evolução: primeira semana após definir metas da terapia. Descreve cobrança excessiva consigo mesma ao revisar entregas.\nProcedimentos: psicoeducação sobre perfeccionismo; identificação de situações-gatilho.\nEncaminhamentos: observar quando adia tarefas por medo de errar.'],
  [1, -13, '11:00', true, 'Evolução: sono ainda irregular, mas com horário de deitar mais estável. Relata adaptação difícil à nova função.\nProcedimentos: higiene do sono; organização da rotina da semana.\nEncaminhamentos: registrar horários de sono; trazer exemplos de conflitos na equipe.'],
  [2, -12, '15:00', true, 'Evolução: retomou atividades sociais que havia evitado. Ainda relata insegurança ao expressar opiniões no relacionamento.\nProcedimentos: ensaio de comunicação assertiva com situação recente.\nEncaminhamentos: praticar uma conversa difícil antes da próxima sessão.'],
  [0, -7, '09:00', true, 'Evolução: aplicou o registro diário nos sete dias. Percebe que a ansiedade aumenta nas segundas-feiras.\nProcedimentos: análise dos registros; planejamento de pausas na agenda.\nEncaminhamentos: testar uma pausa de 10 minutos após reuniões longas.'],
  [1, -7, '11:00', false, 'Evolução: menos horas de sono nesta semana por excesso de trabalho. Relata irritação com a equipe.\nProcedimentos: identificação de sinais de sobrecarga; priorização de tarefas.\nEncaminhamentos: conversar com a gestão sobre prazos; retomar na próxima sessão.'],
  [3, -7, '17:00', false, 'Demanda inicial: estresse no trabalho e dificuldade de desligar no fim do dia.\nObjetivos combinados: reduzir sintomas de estresse e criar rotina de descanso.\nEncaminhamentos: preencher escala de estresse; definir horário fixo para encerrar o trabalho.'],
  [4, -6, '10:00', true, 'Evolução: conseguiu entregar uma tarefa sem revisá-la várias vezes. Relata desconforto, mas sem prejuízo.\nProcedimentos: reforço dos avanços; exposição gradual a tarefas "boas o suficiente".\nEncaminhamentos: escolher mais uma tarefa para entregar sem revisão extra.'],
  [0, 0, '09:00', true, 'Evolução: semana estável; usou a pausa após reuniões em três dias. Ansiedade de segunda-feira menor.\nProcedimentos: revisão dos avanços desde o início; discussão sobre manutenção.\nEncaminhamentos: avaliar na próxima sessão a passagem para frequência quinzenal.'],
  [1, 0, '11:00', false, null],
  [2, 0, '15:00', false, null],
  [3, 0, '17:00', false, null],
  [4, 1, '10:00', false, null],
];

function at(daysFromToday: number, hhmm: string): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Preenche a demonstração com dados fictícios, já criptografados com a chave do cofre. */
export async function seedDemoData(backend: Backend, key: CryptoKey): Promise<void> {
  const ids: string[] = [];
  for (const p of SEED_PATIENTS) {
    const id = crypto.randomUUID();
    const name = await encryptField(key, p.nome, aad.patientName(id));
    await backend.createPatient({
      id,
      name_enc: name.ct,
      name_iv: name.iv,
      contact_enc: null,
      contact_iv: null,
      frequency: p.freq,
      session_price_cents: p.preco,
      started_on: p.inicio,
    });
    ids.push(id);
  }
  const now = Date.now();
  for (const [pi, days, hhmm, pago, nota] of SEED_SESSIONS) {
    const when = at(days, hhmm);
    const price = SEED_PATIENTS[pi].preco;
    const sid = await backend.createSession({
      patient_id: ids[pi],
      starts_at: when.toISOString(),
      status: when.getTime() < now ? 'realizada' : 'agendada',
      price_cents: price,
    });
    if (pago) await backend.addPayment(sid, price, 'pix', when.toISOString().slice(0, 10));
    if (nota) {
      const sealed = await encryptField(key, nota, aad.note(sid, 1));
      await backend.addNote(sid, 1, sealed.ct, sealed.iv);
    }
  }
}
