// Dados do consultório já descriptografados, só em memória, enquanto o cofre está aberto.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Backend, Frequency, NoteStatus, PatientRow } from '../backend/types.ts';
import { aad, decryptField, encryptField } from '../crypto/vault.ts';

export interface Patient {
  id: string;
  name: string;
  contact: string;
  frequency: Frequency;
  priceCents: number;
  startedOn: string;
  archivedAt: string | null;
}

interface Clinic {
  backend: Backend;
  key: CryptoKey;
  patients: Patient[];
  patientById: (id: string) => Patient | undefined;
  noteStatus: Map<string, NoteStatus>;
  reloadPatients: () => Promise<void>;
  reloadNotes: () => Promise<void>;
  loading: boolean;
}

const Ctx = createContext<Clinic | null>(null);

export function useClinic(): Clinic {
  const c = useContext(Ctx);
  if (!c) throw new Error('ClinicProvider ausente');
  return c;
}

async function decryptPatient(key: CryptoKey, row: PatientRow): Promise<Patient> {
  let name: string;
  try {
    name = await decryptField(key, { ct: row.name_enc, iv: row.name_iv }, aad.patientName(row.id));
  } catch {
    name = '[nome ilegível]';
  }
  let contact = '';
  if (row.contact_enc && row.contact_iv) {
    try {
      contact = await decryptField(key, { ct: row.contact_enc, iv: row.contact_iv }, aad.patientContact(row.id));
    } catch {
      contact = '[contato ilegível]';
    }
  }
  return {
    id: row.id,
    name,
    contact,
    frequency: row.frequency,
    priceCents: row.session_price_cents,
    startedOn: row.started_on,
    archivedAt: row.archived_at,
  };
}

export async function sealPatientFields(key: CryptoKey, id: string, name: string, contact: string) {
  const n = await encryptField(key, name.trim(), aad.patientName(id));
  const c = contact.trim() ? await encryptField(key, contact.trim(), aad.patientContact(id)) : null;
  return { name_enc: n.ct, name_iv: n.iv, contact_enc: c?.ct ?? null, contact_iv: c?.iv ?? null };
}

export function ClinicProvider({ backend, cryptoKey, children }: { backend: Backend; cryptoKey: CryptoKey; children: ReactNode }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [noteStatus, setNoteStatus] = useState<Map<string, NoteStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  const reloadPatients = useCallback(async () => {
    const rows = await backend.listPatients();
    const list = await Promise.all(rows.map((r) => decryptPatient(cryptoKey, r)));
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    setPatients(list);
  }, [backend, cryptoKey]);

  const reloadNotes = useCallback(async () => {
    const st = await backend.notesStatus();
    setNoteStatus(new Map(st.map((s) => [s.session_id, s])));
  }, [backend]);

  useEffect(() => {
    let alive = true;
    void Promise.all([reloadPatients(), reloadNotes()]).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadPatients, reloadNotes]);

  const value: Clinic = {
    backend,
    key: cryptoKey,
    patients,
    patientById: (id) => patients.find((p) => p.id === id),
    noteStatus,
    reloadPatients,
    reloadNotes,
    loading,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
