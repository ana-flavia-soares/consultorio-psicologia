// Contrato entre o app e o servidor. Há duas implementações:
//   - supabase.ts: a real, usada em produção.
//   - demo.ts: em memória, com dados fictícios, para demonstração e testes.
// O app só conversa com esta interface; nunca com o banco diretamente.

import type { VaultRecord } from '../crypto/vault.ts';

export type Frequency = 'semanal' | 'quinzenal' | 'mensal' | 'avulsa';
export type SessionStatus = 'agendada' | 'realizada' | 'cancelada' | 'falta';
export type PaymentMethod = 'pix' | 'dinheiro' | 'cartao' | 'transferencia' | 'outro';

export interface PatientRow {
  id: string;
  name_enc: string;
  name_iv: string;
  contact_enc: string | null;
  contact_iv: string | null;
  frequency: Frequency;
  session_price_cents: number;
  started_on: string;
  archived_at: string | null;
}

export interface SessionRow {
  id: string;
  patient_id: string;
  starts_at: string;
  status: SessionStatus;
  price_cents: number;
}

export interface PaymentRow {
  id: string;
  session_id: string;
  amount_cents: number;
  paid_on: string;
  method: PaymentMethod;
  voided_at: string | null;
  created_at: string;
}

export interface NoteRow {
  version: number;
  ciphertext: string;
  iv: string;
  created_at: string;
}

export interface NoteStatus {
  session_id: string;
  last_version: number;
  last_at: string;
}

export interface AuditRow {
  id: number;
  action: 'insert' | 'update' | 'read' | 'login';
  entity: string;
  entity_id: string | null;
  at: string;
}

export type AuthStep =
  | { step: 'signed-out' }
  | { step: 'mfa-enroll' }
  | { step: 'mfa-verify'; factorId: string }
  | { step: 'ready'; email: string };

export interface MfaEnrollment {
  factorId: string;
  /** Imagem do QR code (data URL) para o app autenticador. */
  qrCode: string;
  /** Código para digitar manualmente, se a câmera não ler o QR. */
  secret: string;
}

export interface NewPatient {
  id: string;
  name_enc: string;
  name_iv: string;
  contact_enc: string | null;
  contact_iv: string | null;
  frequency: Frequency;
  session_price_cents: number;
  started_on: string;
}

export interface Backend {
  readonly isDemo: boolean;

  auth: {
    current(): Promise<AuthStep>;
    signIn(email: string, password: string): Promise<AuthStep>;
    startEnroll(): Promise<MfaEnrollment>;
    finishEnroll(factorId: string, code: string): Promise<AuthStep>;
    verify(factorId: string, code: string): Promise<AuthStep>;
    signOut(): Promise<void>;
  };

  getVault(): Promise<VaultRecord | null>;
  createVault(record: VaultRecord): Promise<void>;
  updateVault(record: VaultRecord): Promise<void>;

  listPatients(): Promise<PatientRow[]>;
  createPatient(p: NewPatient): Promise<void>;
  updatePatient(id: string, patch: Partial<Omit<PatientRow, 'id'>>): Promise<void>;

  listSessions(fromIso: string, toIso: string): Promise<SessionRow[]>;
  listSessionsOfPatient(patientId: string): Promise<SessionRow[]>;
  createSession(s: Omit<SessionRow, 'id'>): Promise<string>;
  updateSessionStatus(id: string, status: SessionStatus): Promise<void>;

  listPayments(sessionIds: string[]): Promise<PaymentRow[]>;
  addPayment(sessionId: string, amountCents: number, method: PaymentMethod, paidOn: string): Promise<void>;
  voidPayment(id: string): Promise<void>;

  notesStatus(): Promise<NoteStatus[]>;
  getNotes(sessionId: string): Promise<NoteRow[]>;
  /** version = última versão + 1; o banco recusa se outra tela salvou antes. */
  addNote(sessionId: string, version: number, ciphertext: string, iv: string): Promise<number>;

  listAudit(limit: number): Promise<AuditRow[]>;
  logLogin(): Promise<void>;
}

/** Erro com mensagem já pronta para mostrar na tela, sem detalhes internos. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
