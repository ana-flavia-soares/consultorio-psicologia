// Implementação real, sobre o Supabase (Postgres + autenticação).
// Toda regra de acesso mora no banco (RLS, triggers e funções da migração).
// Este arquivo só traduz chamadas; se ele tiver um erro, o banco ainda bloqueia.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VaultRecord } from '../crypto/vault.ts';
import {
  UserFacingError,
  type AuditRow,
  type AuthStep,
  type Backend,
  type MfaEnrollment,
  type NewPatient,
  type NoteRow,
  type NoteStatus,
  type PatientRow,
  type PaymentMethod,
  type PaymentRow,
  type SessionRow,
  type SessionStatus,
} from './types.ts';
import { reportError } from '../security/safeLog.ts';

const VAULT_COLS =
  'kdf, kdf_iterations, salt, wrapped_key, wrapped_key_iv, recovery_salt, recovery_wrapped_key, recovery_iv, key_check, key_check_iv';
const PATIENT_COLS = 'id, name_enc, name_iv, contact_enc, contact_iv, frequency, session_price_cents, started_on, archived_at';
const SESSION_COLS = 'id, patient_id, starts_at, status, price_cents';
const PAYMENT_COLS = 'id, session_id, amount_cents, paid_on, method, voided_at, created_at';

function fail(where: string, error: unknown): never {
  // Nunca repassamos a mensagem crua do servidor para a tela nem para logs:
  // ela pode conter dados. Guardamos só onde falhou e o código.
  reportError(where, error);
  throw new UserFacingError('Não foi possível concluir agora. Verifique a internet e tente de novo.');
}

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: {
      // sessionStorage: o login some ao fechar a aba. Nada fica salvo no
      // computador depois que ela fecha o navegador.
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  async function stepAfterLogin(): Promise<AuthStep> {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) return { step: 'signed-out' };
    const { data: aal, error: aalErr } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErr) fail('auth.aal', aalErr);
    if (aal.currentLevel === 'aal2') return { step: 'ready', email: s.session.user.email ?? '' };
    const { data: f, error: fErr } = await sb.auth.mfa.listFactors();
    if (fErr) fail('auth.factors', fErr);
    const verified = f.totp.find((x) => x.status === 'verified');
    if (verified) return { step: 'mfa-verify', factorId: verified.id };
    return { step: 'mfa-enroll' };
  }

  async function uid(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new UserFacingError('Sua sessão expirou. Entre de novo.');
    return id;
  }

  return {
    isDemo: false,

    auth: {
      current: stepAfterLogin,

      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          reportError('auth.signIn', error);
          // Mensagem genérica: não revela se o e-mail existe.
          throw new UserFacingError('E-mail ou senha incorretos.');
        }
        return stepAfterLogin();
      },

      async startEnroll(): Promise<MfaEnrollment> {
        // Remove tentativas anteriores não concluídas antes de criar outra.
        const { data: f } = await sb.auth.mfa.listFactors();
        for (const old of f?.all ?? []) {
          if (old.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: old.id });
        }
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Consultório' });
        if (error) fail('auth.enroll', error);
        return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
      },

      async finishEnroll(factorId, code) {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) {
          reportError('auth.finishEnroll', error);
          throw new UserFacingError('Código inválido. Confira o horário do celular e tente o código atual.');
        }
        return stepAfterLogin();
      },

      async verify(factorId, code) {
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) {
          reportError('auth.verify', error);
          throw new UserFacingError('Código inválido. Tente o código que aparece agora no app.');
        }
        return stepAfterLogin();
      },

      async signOut() {
        await sb.auth.signOut({ scope: 'local' });
        window.sessionStorage.clear();
      },
    },

    async getVault() {
      const { data, error } = await sb.from('vault').select(VAULT_COLS).maybeSingle();
      if (error) fail('vault.get', error);
      return (data as unknown as VaultRecord | null) ?? null;
    },
    async createVault(record) {
      const { error } = await sb.from('vault').insert({ ...record, owner_id: await uid() });
      if (error) fail('vault.create', error);
    },
    async updateVault(record) {
      const { error } = await sb.from('vault').update(record).eq('owner_id', await uid());
      if (error) fail('vault.update', error);
    },

    async listPatients() {
      const { data, error } = await sb.from('patients').select(PATIENT_COLS).order('created_at');
      if (error) fail('patients.list', error);
      return data as unknown as PatientRow[];
    },
    async createPatient(p: NewPatient) {
      const { error } = await sb.from('patients').insert({ ...p, owner_id: await uid() });
      if (error) fail('patients.create', error);
    },
    async updatePatient(id, patch) {
      const { error } = await sb.from('patients').update(patch).eq('id', id);
      if (error) fail('patients.update', error);
    },

    async listSessions(fromIso, toIso) {
      const { data, error } = await sb
        .from('sessions')
        .select(SESSION_COLS)
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at');
      if (error) fail('sessions.list', error);
      return data as unknown as SessionRow[];
    },
    async listSessionsOfPatient(patientId) {
      const { data, error } = await sb.from('sessions').select(SESSION_COLS).eq('patient_id', patientId).order('starts_at');
      if (error) fail('sessions.ofPatient', error);
      return data as unknown as SessionRow[];
    },
    async createSession(s) {
      const { data, error } = await sb
        .from('sessions')
        .insert({ ...s, owner_id: await uid() })
        .select('id')
        .single();
      if (error) fail('sessions.create', error);
      return (data as unknown as { id: string }).id;
    },
    async updateSessionStatus(id, status: SessionStatus) {
      const { error } = await sb.from('sessions').update({ status }).eq('id', id);
      if (error) fail('sessions.status', error);
    },

    async listPayments(sessionIds) {
      if (sessionIds.length === 0) return [];
      const { data, error } = await sb.from('payments').select(PAYMENT_COLS).in('session_id', sessionIds).order('created_at');
      if (error) fail('payments.list', error);
      return data as unknown as PaymentRow[];
    },
    async addPayment(sessionId, amountCents, method: PaymentMethod, paidOn) {
      const { error } = await sb
        .from('payments')
        .insert({ session_id: sessionId, amount_cents: amountCents, method, paid_on: paidOn, owner_id: await uid() });
      if (error) fail('payments.add', error);
    },
    async voidPayment(id) {
      const { error } = await sb.from('payments').update({ voided_at: new Date().toISOString() }).eq('id', id);
      if (error) fail('payments.void', error);
    },

    async notesStatus() {
      const { data, error } = await sb.rpc('notes_status');
      if (error) fail('notes.status', error);
      return data as unknown as NoteStatus[];
    },
    async getNotes(sessionId) {
      const { data, error } = await sb.rpc('get_session_notes', { p_session_id: sessionId });
      if (error) fail('notes.get', error);
      return data as unknown as NoteRow[];
    },
    async addNote(sessionId, version, ciphertext, iv) {
      const { data, error } = await sb.rpc('add_session_note', { p_session_id: sessionId, p_version: version, p_ciphertext: ciphertext, p_iv: iv });
      if (error) {
        if (error.code === '40001') throw new UserFacingError('A anotação foi salva em outra tela. Recarregue antes de salvar de novo.');
        fail('notes.add', error);
      }
      return data as unknown as number;
    },

    async listAudit(limit) {
      const { data, error } = await sb
        .from('audit_log')
        .select('id, action, entity, entity_id, at')
        .order('at', { ascending: false })
        .limit(limit);
      if (error) fail('audit.list', error);
      return data as unknown as AuditRow[];
    },
    async logLogin() {
      const { error } = await sb.rpc('log_login');
      if (error) reportError('audit.login', error);
    },
  };
}
