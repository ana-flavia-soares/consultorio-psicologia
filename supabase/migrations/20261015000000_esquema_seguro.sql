-- =============================================================================
-- Consultório de psicologia: esquema do banco com as camadas de segurança
-- =============================================================================
-- Princípios aplicados neste arquivo:
--   1. Cada linha pertence a uma dona (owner_id) e só ela acessa (RLS).
--   2. Nada é acessível sem verificação em duas etapas (aal2 no token).
--   3. O banco nunca recebe texto clínico em claro: anotações, nomes e
--      contatos chegam já criptografados pelo navegador.
--   4. Prontuário e financeiro ficam em tabelas separadas; o financeiro
--      não tem nenhuma coluna de texto livre.
--   5. Anotações não podem ser alteradas nem apagadas: cada edição é uma nova
--      versão. Nenhum registro pode ser apagado nem esvaziado com TRUNCATE
--      (guarda mínima de 5 anos, Resolução CFP 001/2009). Alterações em
--      pacientes e no cofre guardam a versão anterior.
--   Limite: quem é DONO do banco (papel postgres) consegue desativar triggers.
--   As travas protegem contra o app, erros e sessões roubadas; contra o dono
--   do banco, a proteção é a criptografia e o backup externo.
--   6. Toda escrita e toda leitura de anotação gera um registro de auditoria.
-- =============================================================================

set check_function_bodies = off;

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------

-- Verdadeiro só quando a sessão passou pela verificação em duas etapas.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

-- Impede qualquer exclusão. Registros devem ser guardados por no mínimo 5 anos.
create or replace function public.bloquear_exclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Exclusão não permitida em %. Registros devem ser guardados por no mínimo 5 anos (Resolução CFP 001/2009). Use arquivar ou cancelar.', tg_table_name
    using errcode = '42501';
end;
$$;

-- Impede trocar a dona de um registro.
create or replace function public.bloquear_troca_de_dona()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Não é permitido trocar a dona do registro.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'Não é permitido trocar o identificador do registro.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid        not null,
  actor_id    uuid,
  action      text        not null check (action in ('insert', 'update', 'read', 'login')),
  entity      text        not null,
  entity_id   uuid,
  at          timestamptz not null default now()
);

create index audit_log_owner_at on public.audit_log (owner_id, at desc);

-- Grava auditoria de escrita. Roda como dona da função para conseguir inserir
-- na tabela, que é fechada para escrita direta.
create or replace function public.auditar_escrita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Atualização que não muda nada não gera registro (evita encher a auditoria).
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return new;
  end if;
  insert into public.audit_log (owner_id, actor_id, action, entity, entity_id)
  values (new.owner_id, auth.uid(), lower(tg_op), tg_table_name, new.id);
  return new;
end;
$$;

-- Auditoria não pode ser alterada nem apagada por ninguém.
create or replace function public.bloquear_alteracao_auditoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O registro de auditoria não pode ser alterado nem apagado.' using errcode = '42501';
end;
$$;

create trigger audit_log_imutavel
  before update or delete on public.audit_log
  for each row execute function public.bloquear_alteracao_auditoria();

-- -----------------------------------------------------------------------------
-- Cofre: guarda a chave de dados embrulhada (nunca a chave em claro)
-- -----------------------------------------------------------------------------
-- A chave que criptografa as anotações é gerada no navegador. Aqui ficam só
-- duas cópias embrulhadas: uma com a senha do cofre e outra com a chave de
-- recuperação. Sem uma delas, o conteúdo é ilegível, inclusive para quem
-- administra o banco.

create table public.vault (
  id                   uuid        primary key default gen_random_uuid(),
  owner_id             uuid        not null unique default auth.uid() references auth.users (id) on delete restrict,
  version              int         not null default 1,
  kdf                  text        not null check (kdf = 'PBKDF2-SHA256'),
  kdf_iterations       int         not null check (kdf_iterations between 600000 and 5000000),
  salt                 text        not null,
  wrapped_key          text        not null,
  wrapped_key_iv       text        not null,
  recovery_salt        text        not null,
  recovery_wrapped_key text        not null,
  recovery_iv          text        not null,
  key_check            text        not null,
  key_check_iv         text        not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Pacientes: nome e contato chegam criptografados
-- -----------------------------------------------------------------------------

create table public.patients (
  id                  uuid        primary key default gen_random_uuid(),
  owner_id            uuid        not null default auth.uid() references auth.users (id) on delete restrict,
  name_enc            text        not null,
  name_iv             text        not null,
  contact_enc         text,
  contact_iv          text,
  frequency           text        not null check (frequency in ('semanal', 'quinzenal', 'mensal', 'avulsa')),
  session_price_cents int         not null check (session_price_cents >= 0),
  started_on          date        not null default current_date,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  check ((contact_enc is null) = (contact_iv is null))
);

create index patients_owner on public.patients (owner_id);

-- -----------------------------------------------------------------------------
-- Sessões (agenda)
-- -----------------------------------------------------------------------------

create table public.sessions (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete restrict,
  patient_id  uuid        not null references public.patients (id) on delete restrict,
  starts_at   timestamptz not null,
  status      text        not null default 'agendada' check (status in ('agendada', 'realizada', 'cancelada', 'falta')),
  price_cents int         not null check (price_cents >= 0),
  created_at  timestamptz not null default now()
);

create index sessions_owner_start on public.sessions (owner_id, starts_at);

-- -----------------------------------------------------------------------------
-- Financeiro: separado do prontuário e sem nenhuma coluna de texto livre
-- -----------------------------------------------------------------------------

create table public.payments (
  id           uuid        primary key default gen_random_uuid(),
  owner_id     uuid        not null default auth.uid() references auth.users (id) on delete restrict,
  session_id   uuid        not null references public.sessions (id) on delete restrict,
  amount_cents int         not null check (amount_cents > 0),
  paid_on      date        not null default current_date,
  method       text        not null check (method in ('pix', 'dinheiro', 'cartao', 'transferencia', 'outro')),
  voided_at    timestamptz,
  created_at   timestamptz not null default now()
);

-- No máximo um pagamento válido por sessão. Um pagamento desfeito continua no
-- histórico e permite registrar outro.
create unique index payments_one_valid_per_session on public.payments (session_id) where voided_at is null;
create index payments_owner on public.payments (owner_id, paid_on);

-- Pagamento só pode ser desfeito uma vez; valor, data e forma não mudam.
create or replace function public.pagamento_so_desfaz()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'Este pagamento já foi desfeito.' using errcode = '42501';
  end if;
  if new.amount_cents is distinct from old.amount_cents
     or new.paid_on is distinct from old.paid_on
     or new.method is distinct from old.method
     or new.session_id is distinct from old.session_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Pagamento registrado não pode ser editado. Desfaça e registre outro.' using errcode = '42501';
  end if;
  -- A data do desfazer é sempre a do servidor; não aceita data retroativa.
  new.voided_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Prontuário: anotações criptografadas, só inserção, com versões
-- -----------------------------------------------------------------------------

create table public.session_notes (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users (id) on delete restrict,
  session_id  uuid        not null references public.sessions (id) on delete restrict,
  version     int         not null check (version >= 1),
  ciphertext  text        not null,
  iv          text        not null,
  created_at  timestamptz not null default now(),
  unique (session_id, version)
);

create or replace function public.bloquear_alteracao_anotacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Anotações não podem ser alteradas nem apagadas. Salve uma nova versão.' using errcode = '42501';
end;
$$;

-- -----------------------------------------------------------------------------
-- Integridade entre tabelas: tudo da mesma dona
-- -----------------------------------------------------------------------------
-- RLS não vale para chaves estrangeiras, então sem esta checagem alguém
-- poderia ligar um registro seu a um paciente de outra conta.

create or replace function public.checar_mesma_dona()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dona uuid;
begin
  if tg_table_name = 'sessions' then
    select owner_id into dona from public.patients where id = new.patient_id;
  else
    select owner_id into dona from public.sessions where id = new.session_id;
  end if;
  if dona is null or dona <> new.owner_id then
    raise exception 'Registro relacionado não encontrado.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Travas adicionais
-- -----------------------------------------------------------------------------

-- TRUNCATE esvazia a tabela sem disparar as travas de linha; bloqueamos também.
create or replace function public.bloquear_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Não é permitido esvaziar a tabela %.', tg_table_name using errcode = '42501';
end;
$$;

-- No cofre, só a cópia embrulhada com a SENHA pode mudar (troca de senha).
-- A cópia da chave de recuperação, a verificação e os parâmetros são fixos:
-- assim, mesmo uma sessão roubada não consegue trancar a dona para fora.
create or replace function public.cofre_so_troca_senha()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recovery_salt is distinct from old.recovery_salt
     or new.recovery_wrapped_key is distinct from old.recovery_wrapped_key
     or new.recovery_iv is distinct from old.recovery_iv
     or new.key_check is distinct from old.key_check
     or new.key_check_iv is distinct from old.key_check_iv
     or new.kdf is distinct from old.kdf
     or new.kdf_iterations is distinct from old.kdf_iterations
     or new.created_at is distinct from old.created_at then
    raise exception 'Só a senha do cofre pode ser trocada. A chave de recuperação é permanente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Sessão com pagamento válido não muda de valor nem de situação.
create or replace function public.sessao_paga_congelada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.price_cents is distinct from old.price_cents or new.status is distinct from old.status)
     and exists (select 1 from public.payments p where p.session_id = old.id and p.voided_at is null) then
    raise exception 'Esta sessão já foi paga. Desfaça o pagamento antes de mudar valor ou situação.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Histórico: guarda a versão anterior de pacientes e do cofre a cada alteração.
create table public.patients_history (
  id                  bigint      generated always as identity primary key,
  patient_id          uuid        not null,
  owner_id            uuid        not null,
  name_enc            text        not null,
  name_iv             text        not null,
  contact_enc         text,
  contact_iv          text,
  frequency           text        not null,
  session_price_cents int         not null,
  archived_at         timestamptz,
  replaced_at         timestamptz not null default now()
);

create table public.vault_history (
  id             bigint      generated always as identity primary key,
  owner_id       uuid        not null,
  salt           text        not null,
  wrapped_key    text        not null,
  wrapped_key_iv text        not null,
  replaced_at    timestamptz not null default now()
);

create or replace function public.guardar_versao_anterior()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'patients' then
    if (to_jsonb(old)) is distinct from (to_jsonb(new)) then
      insert into public.patients_history (patient_id, owner_id, name_enc, name_iv, contact_enc, contact_iv, frequency, session_price_cents, archived_at)
      values (old.id, old.owner_id, old.name_enc, old.name_iv, old.contact_enc, old.contact_iv, old.frequency, old.session_price_cents, old.archived_at);
    end if;
  elsif tg_table_name = 'vault' then
    if old.wrapped_key is distinct from new.wrapped_key then
      insert into public.vault_history (owner_id, salt, wrapped_key, wrapped_key_iv)
      values (old.owner_id, old.salt, old.wrapped_key, old.wrapped_key_iv);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.bloquear_alteracao_historico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico não pode ser alterado nem apagado.' using errcode = '42501';
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger vault_sem_exclusao     before delete on public.vault         for each row execute function public.bloquear_exclusao();
create trigger patients_sem_exclusao  before delete on public.patients      for each row execute function public.bloquear_exclusao();
create trigger sessions_sem_exclusao  before delete on public.sessions      for each row execute function public.bloquear_exclusao();
create trigger payments_sem_exclusao  before delete on public.payments      for each row execute function public.bloquear_exclusao();

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger vault_updated_at       before update on public.vault         for each row execute function public.tocar_updated_at();
create trigger vault_dona_fixa        before update on public.vault         for each row execute function public.bloquear_troca_de_dona();
create trigger patients_dona_fixa     before update on public.patients      for each row execute function public.bloquear_troca_de_dona();
create trigger sessions_dona_fixa     before update on public.sessions      for each row execute function public.bloquear_troca_de_dona();
create trigger payments_dona_fixa     before update on public.payments      for each row execute function public.bloquear_troca_de_dona();

create trigger payments_so_desfaz     before update on public.payments      for each row execute function public.pagamento_so_desfaz();
create trigger vault_so_troca_senha   before update on public.vault         for each row execute function public.cofre_so_troca_senha();
create trigger sessions_paga_congelada before update on public.sessions     for each row execute function public.sessao_paga_congelada();

create trigger patients_historico     after update on public.patients       for each row execute function public.guardar_versao_anterior();
create trigger vault_historico        after update on public.vault          for each row execute function public.guardar_versao_anterior();
create trigger patients_hist_imutavel before update or delete on public.patients_history for each row execute function public.bloquear_alteracao_historico();
create trigger vault_hist_imutavel    before update or delete on public.vault_history    for each row execute function public.bloquear_alteracao_historico();

create trigger vault_sem_truncate         before truncate on public.vault            for each statement execute function public.bloquear_truncate();
create trigger patients_sem_truncate      before truncate on public.patients         for each statement execute function public.bloquear_truncate();
create trigger sessions_sem_truncate      before truncate on public.sessions         for each statement execute function public.bloquear_truncate();
create trigger payments_sem_truncate      before truncate on public.payments         for each statement execute function public.bloquear_truncate();
create trigger notes_sem_truncate         before truncate on public.session_notes    for each statement execute function public.bloquear_truncate();
create trigger audit_sem_truncate         before truncate on public.audit_log        for each statement execute function public.bloquear_truncate();
create trigger patients_hist_sem_truncate before truncate on public.patients_history for each statement execute function public.bloquear_truncate();
create trigger vault_hist_sem_truncate    before truncate on public.vault_history    for each statement execute function public.bloquear_truncate();

create trigger notes_imutaveis        before update or delete on public.session_notes for each row execute function public.bloquear_alteracao_anotacao();

create trigger sessions_mesma_dona    before insert or update on public.sessions      for each row execute function public.checar_mesma_dona();
create trigger payments_mesma_dona    before insert or update on public.payments      for each row execute function public.checar_mesma_dona();
create trigger notes_mesma_dona       before insert on public.session_notes           for each row execute function public.checar_mesma_dona();

create trigger vault_auditoria        after insert or update on public.vault         for each row execute function public.auditar_escrita();
create trigger patients_auditoria     after insert or update on public.patients      for each row execute function public.auditar_escrita();
create trigger sessions_auditoria     after insert or update on public.sessions      for each row execute function public.auditar_escrita();
create trigger payments_auditoria     after insert or update on public.payments      for each row execute function public.auditar_escrita();
create trigger notes_auditoria        after insert on public.session_notes           for each row execute function public.auditar_escrita();

-- -----------------------------------------------------------------------------
-- Funções que o app chama para o prontuário
-- -----------------------------------------------------------------------------
-- O app não lê nem escreve a tabela de anotações diretamente: passa por estas
-- funções, que conferem dona e verificação em duas etapas e registram a leitura.

-- p_version: a versão que o app está criando (última + 1). Ela também entra no
-- contexto da criptografia, então reenviar uma versão antiga como nova não abre.
create or replace function public.add_session_note(p_session_id uuid, p_version int, p_ciphertext text, p_iv text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  proxima int;
begin
  if uid is null or not public.mfa_ok() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sessions where id = p_session_id and owner_id = uid) then
    raise exception 'Sessão não encontrada.' using errcode = '42501';
  end if;
  if length(p_ciphertext) > 200000 or length(p_iv) <> 16 then
    raise exception 'Conteúdo inválido.' using errcode = '22023';
  end if;
  -- Trava a sessão para duas gravações simultâneas não pegarem o mesmo número.
  perform 1 from public.sessions where id = p_session_id for update;
  select coalesce(max(version), 0) + 1 into proxima from public.session_notes where session_id = p_session_id;
  if p_version is distinct from proxima then
    raise exception 'A anotação mudou em outra tela. Recarregue antes de salvar.' using errcode = '40001';
  end if;
  insert into public.session_notes (owner_id, session_id, version, ciphertext, iv)
  values (uid, p_session_id, proxima, p_ciphertext, p_iv);
  return proxima;
end;
$$;

create or replace function public.get_session_notes(p_session_id uuid)
returns table (version int, ciphertext text, iv text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.mfa_ok() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sessions s where s.id = p_session_id and s.owner_id = uid) then
    raise exception 'Sessão não encontrada.' using errcode = '42501';
  end if;
  insert into public.audit_log (owner_id, actor_id, action, entity, entity_id)
  values (uid, uid, 'read', 'session_notes', p_session_id);
  return query
    select n.version, n.ciphertext, n.iv, n.created_at
    from public.session_notes n
    where n.session_id = p_session_id and n.owner_id = uid
    order by n.version;
end;
$$;

-- Só diz quais sessões têm anotação e qual a última versão. Não devolve
-- conteúdo, por isso não conta como leitura de prontuário.
create or replace function public.notes_status()
returns table (session_id uuid, last_version int, last_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.mfa_ok() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return query
    select n.session_id, max(n.version), max(n.created_at)
    from public.session_notes n
    where n.owner_id = uid
    group by n.session_id;
end;
$$;

-- Registra no histórico de acesso que a dona entrou no sistema.
create or replace function public.log_login()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.mfa_ok() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  -- No máximo um registro de entrada por minuto (evita encher a auditoria).
  if exists (select 1 from public.audit_log a where a.owner_id = uid and a.action = 'login' and a.at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.audit_log (owner_id, actor_id, action, entity, entity_id)
  values (uid, uid, 'login', 'auth', uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security: cada uma só vê o que é seu, e só com duas etapas
-- -----------------------------------------------------------------------------

alter table public.vault         enable row level security;
alter table public.patients      enable row level security;
alter table public.sessions      enable row level security;
alter table public.payments      enable row level security;
alter table public.session_notes enable row level security;
alter table public.audit_log     enable row level security;
alter table public.patients_history enable row level security;
alter table public.vault_history    enable row level security;

-- Não usamos FORCE: as funções "security definer" acima rodam como dona das
-- tabelas e precisam enxergar as linhas para conferir dona e gravar auditoria.
-- Os papéis que o app usa (anon e authenticated) continuam sujeitos ao RLS.

-- Regra 1: só a dona.
create policy dona_vault    on public.vault    for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dona_patients on public.patients for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dona_sessions on public.sessions for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dona_payments on public.payments for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy dona_audit    on public.audit_log for select to authenticated using (owner_id = (select auth.uid()));

-- Regra 2 (restritiva, soma com a 1): sem verificação em duas etapas, nada.
create policy mfa_vault    on public.vault     as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_patients on public.patients  as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_sessions on public.sessions  as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_payments on public.payments  as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()));
create policy mfa_audit    on public.audit_log as restrictive for select to authenticated using ((select public.mfa_ok()));

-- session_notes não tem política nem permissão para authenticated: acesso
-- direto é negado. O caminho é pelas funções acima.

-- -----------------------------------------------------------------------------
-- Permissões: o mínimo necessário
-- -----------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;

grant select, insert, update on public.vault    to authenticated;
grant select, insert, update on public.patients to authenticated;
grant select, insert, update on public.sessions to authenticated;
grant select, insert         on public.payments to authenticated;
grant update (voided_at)     on public.payments to authenticated;
grant select                 on public.audit_log to authenticated;

grant execute on function public.mfa_ok()                          to authenticated;
grant execute on function public.add_session_note(uuid, int, text, text) to authenticated;
grant execute on function public.get_session_notes(uuid)           to authenticated;
grant execute on function public.notes_status()                    to authenticated;
grant execute on function public.log_login()                       to authenticated;

-- Tabelas criadas no futuro não herdam acesso por engano.
alter default privileges in schema public revoke all on tables    from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
-- O Postgres dá EXECUTE a PUBLIC em toda função nova; isto desliga esse padrão
-- para funções criadas por este papel. Funções futuras precisam de GRANT explícito.
alter default privileges revoke execute on functions from public;
