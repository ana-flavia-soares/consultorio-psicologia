-- Testes das regras de segurança do banco.
-- Cada teste imprime "OK" ou interrompe com "FALHOU". Rodar com scripts/test-db.sh.

\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
\o /dev/null

\set A '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set B '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''
\set A_MFA '''{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","aal":"aal2"}'''
\set A_SEM_MFA '''{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","aal":"aal1"}'''
\set B_MFA '''{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","aal":"aal2"}'''

-- Utilitários de teste ---------------------------------------------------------
create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(c boolean, nome text) returns void language plpgsql as $$
begin
  if c then raise notice 'OK      %', nome;
  else raise exception 'FALHOU  %', nome; end if;
end $$;

-- Executa o comando e exige que ele seja bloqueado.
create function t.bloqueia(cmd text, nome text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    raise notice 'OK      % -> bloqueado: %', nome, sqlerrm;
    return;
  end;
  raise exception 'FALHOU  % -> deveria ter sido bloqueado', nome;
end $$;

create table t.ids (k text primary key, v uuid);
grant select, insert on t.ids to authenticated;

grant execute on all functions in schema t to anon, authenticated;

insert into auth.users (id) values (:A), (:B);

-- Dados da conta A ------------------------------------------------------------
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

insert into public.vault (kdf, kdf_iterations, salt, wrapped_key, wrapped_key_iv, recovery_salt, recovery_wrapped_key, recovery_iv, key_check, key_check_iv)
values ('PBKDF2-SHA256', 600000, 's', 'w', 'iv', 'rs', 'rw', 'riv', 'kc', 'kciv');

with p as (
  insert into public.patients (name_enc, name_iv, frequency, session_price_cents)
  values ('nome-cifrado-A', 'aaaaaaaaaaaaaaaa', 'semanal', 15000) returning id
) insert into t.ids select 'pacA', id from p;

with s as (
  insert into public.sessions (patient_id, starts_at, status, price_cents)
  select v, now(), 'realizada', 15000 from t.ids where k = 'pacA' returning id
) insert into t.ids select 'sesA', id from s;

select t.ok(public.add_session_note((select v from t.ids where k = 'sesA'), 1, 'cifra-v1', 'aaaaaaaaaaaaaaaa') = 1, 'Primeira anotação recebe a versão 1');
select t.ok(public.add_session_note((select v from t.ids where k = 'sesA'), 2, 'cifra-v2', 'bbbbbbbbbbbbbbbb') = 2, 'Editar cria a versão 2 em vez de sobrescrever');

with pg as (
  insert into public.payments (session_id, amount_cents, method)
  select v, 15000, 'pix' from t.ids where k = 'sesA' returning id
) insert into t.ids select 'pagA', id from pg;

-- 1. Isolamento entre contas --------------------------------------------------
reset role;
select set_config('request.jwt.claims', :B_MFA, false);
set role authenticated;

select t.ok((select count(*) from public.patients) = 0, 'Conta B não vê pacientes da conta A');
select t.ok((select count(*) from public.sessions) = 0, 'Conta B não vê sessões da conta A');
select t.ok((select count(*) from public.payments) = 0, 'Conta B não vê pagamentos da conta A');
select t.ok((select count(*) from public.vault) = 0, 'Conta B não vê o cofre da conta A');
select t.ok((select count(*) from public.audit_log) = 0, 'Conta B não vê a auditoria da conta A');
select t.bloqueia($$select * from public.get_session_notes((select v from t.ids where k = 'sesA'))$$, 'Conta B não lê anotações da conta A');
select t.bloqueia($$select public.add_session_note((select v from t.ids where k = 'sesA'), 3, 'x', 'aaaaaaaaaaaaaaaa')$$, 'Conta B não escreve no prontuário da conta A');
select t.bloqueia($$insert into public.sessions (patient_id, starts_at, price_cents) select v, now(), 100 from t.ids where k = 'pacA'$$, 'Conta B não cria sessão para paciente da conta A');
select t.bloqueia($$insert into public.patients (owner_id, name_enc, name_iv, frequency, session_price_cents) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'y', 'semanal', 1)$$, 'Conta B não cria registro em nome da conta A');
with u as (update public.patients set frequency = 'mensal' where id = (select v from t.ids where k = 'pacA') returning 1)
select t.ok((select count(*) from u) = 0, 'Conta B não altera paciente da conta A');

-- 2. Verificação em duas etapas ----------------------------------------------
reset role;
select set_config('request.jwt.claims', :A_SEM_MFA, false);
set role authenticated;

select t.ok((select count(*) from public.patients) = 0, 'Sem duas etapas, a dona não vê os próprios pacientes');
select t.ok((select count(*) from public.payments) = 0, 'Sem duas etapas, a dona não vê o financeiro');
select t.bloqueia($$select * from public.get_session_notes((select v from t.ids where k = 'sesA'))$$, 'Sem duas etapas, o prontuário não abre');
select t.bloqueia($$insert into public.patients (name_enc, name_iv, frequency, session_price_cents) values ('x', 'y', 'semanal', 1)$$, 'Sem duas etapas, não cadastra paciente');

-- 3. Visitante sem login ------------------------------------------------------
reset role;
select set_config('t.sesa', (select v::text from t.ids where k = 'sesA'), false);
select set_config('request.jwt.claims', '', false);
set role anon;

select t.bloqueia($$select * from public.patients$$, 'Visitante sem login não lê pacientes');
select t.bloqueia($$select * from public.payments$$, 'Visitante sem login não lê o financeiro');
select t.bloqueia($$select * from public.get_session_notes(current_setting('t.sesa')::uuid)$$, 'Visitante sem login não chama o prontuário');

-- 4. Prontuário: acesso só pelas funções, sem alteração -----------------------
reset role;
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

select t.bloqueia($$select * from public.session_notes$$, 'Leitura direta da tabela de anotações é negada');
select t.bloqueia($$update public.session_notes set ciphertext = 'x'$$, 'Anotação não pode ser editada direto');
select t.bloqueia($$delete from public.session_notes$$, 'Anotação não pode ser apagada');
select t.ok((select count(*) from public.get_session_notes((select v from t.ids where k = 'sesA'))) = 2, 'Dona lê as duas versões da anotação');
select t.ok((select ciphertext from public.get_session_notes((select v from t.ids where k = 'sesA')) where version = 1) = 'cifra-v1', 'A versão 1 continua intacta depois da edição');
select t.ok((select count(*) from public.audit_log where action = 'read' and entity = 'session_notes') = 2, 'Cada leitura do prontuário fica registrada');
select t.ok((select last_version from public.notes_status() where session_id = (select v from t.ids where k = 'sesA')) = 2, 'Status mostra a última versão sem entregar conteúdo');
select t.bloqueia($$select public.add_session_note((select v from t.ids where k = 'sesA'), 3, 'x', 'curto')$$, 'Vetor de inicialização inválido é recusado');
select t.bloqueia($$select public.add_session_note((select v from t.ids where k = 'sesA'), 2, 'reenvio', 'cccccccccccccccc')$$, 'Gravar com número de versão já usado é recusado');
select t.bloqueia($$select public.add_session_note((select v from t.ids where k = 'sesA'), 9, 'pulo', 'cccccccccccccccc')$$, 'Gravar pulando versões é recusado');

-- Mesmo a dona do banco (administrador) não consegue alterar uma anotação.
reset role;
select t.bloqueia($$update public.session_notes set ciphertext = 'adulterado'$$, 'Nem o administrador do banco altera anotação');
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

-- 5. Nada é apagado ------------------------------------------------------------
select t.bloqueia($$delete from public.patients where id = (select v from t.ids where k = 'pacA')$$, 'Paciente não pode ser apagado (arquivar)');
select t.bloqueia($$delete from public.sessions where id = (select v from t.ids where k = 'sesA')$$, 'Sessão não pode ser apagada (cancelar)');
select t.bloqueia($$delete from public.payments where id = (select v from t.ids where k = 'pagA')$$, 'Pagamento não pode ser apagado');
select t.bloqueia($$delete from public.vault$$, 'Cofre não pode ser apagado');
reset role;
select t.bloqueia($$delete from public.patients$$, 'Nem o administrador apaga pacientes');
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

-- 6. Financeiro ----------------------------------------------------------------
select t.bloqueia($$update public.payments set amount_cents = 1 where id = (select v from t.ids where k = 'pagA')$$, 'Valor de pagamento não pode ser editado');
select t.bloqueia($$insert into public.payments (session_id, amount_cents, method) select v, 15000, 'pix' from t.ids where k = 'sesA'$$, 'Não registra dois pagamentos válidos para a mesma sessão');
with u as (update public.payments set voided_at = now() where id = (select v from t.ids where k = 'pagA') returning 1)
select t.ok((select count(*) from u) = 1, 'Pagamento pode ser desfeito');
select t.bloqueia($$update public.payments set voided_at = now() + interval '1 day' where id = (select v from t.ids where k = 'pagA')$$, 'Pagamento desfeito não pode ser desfeito de novo');
with i as (insert into public.payments (session_id, amount_cents, method) select v, 15000, 'dinheiro' from t.ids where k = 'sesA' returning 1)
select t.ok((select count(*) from i) = 1, 'Depois de desfeito, pode registrar o pagamento correto');

reset role;
select t.ok(
  (select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'payments')
  = array['amount_cents','created_at','id','method','owner_id','paid_on','session_id','voided_at'],
  'Financeiro não tem nenhuma coluna para texto clínico');
select t.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('patients', 'sessions')
      and data_type = 'text' and column_name not in ('name_enc', 'name_iv', 'contact_enc', 'contact_iv', 'frequency', 'status')),
  'Pacientes e sessões não têm campo de texto livre fora dos criptografados');

-- 7. Auditoria -----------------------------------------------------------------
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

select t.ok((select count(*) from public.audit_log where action = 'insert' and entity = 'patients') = 1, 'Cadastro de paciente fica registrado');
select t.ok((select count(*) from public.audit_log where action = 'insert' and entity = 'session_notes') = 2, 'Cada versão de anotação fica registrada');
select t.ok((select count(*) from public.audit_log where action = 'update' and entity = 'payments') = 1, 'Pagamento desfeito fica registrado');
select t.bloqueia($$update public.audit_log set action = 'read'$$, 'Auditoria não pode ser alterada pelo app');
select t.bloqueia($$delete from public.audit_log$$, 'Auditoria não pode ser apagada pelo app');
select t.bloqueia($$insert into public.audit_log (owner_id, action, entity) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'read', 'x')$$, 'App não consegue inserir auditoria falsa');
reset role;
select t.bloqueia($$delete from public.audit_log$$, 'Nem o administrador apaga a auditoria');

-- 8. Dona e identificador fixos -------------------------------------------------
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;
select t.bloqueia($$update public.patients set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = (select v from t.ids where k = 'pacA')$$, 'Dona de um paciente não pode ser trocada');
reset role;
select set_config('request.jwt.claims', :B_MFA, false);
set role authenticated;
select t.bloqueia($$insert into public.vault (kdf, kdf_iterations, salt, wrapped_key, wrapped_key_iv, recovery_salt, recovery_wrapped_key, recovery_iv, key_check, key_check_iv) values ('PBKDF2-SHA256', 1000, 's', 'w', 'iv', 'rs', 'rw', 'riv', 'kc', 'kciv')$$, 'Cofre com derivação de senha fraca é recusado');
select t.bloqueia($$insert into public.vault (kdf, kdf_iterations, salt, wrapped_key, wrapped_key_iv, recovery_salt, recovery_wrapped_key, recovery_iv, key_check, key_check_iv) values ('PBKDF2-SHA256', 2000000000, 's', 'w', 'iv', 'rs', 'rw', 'riv', 'kc', 'kciv')$$, 'Cofre com derivação absurda (travaria o navegador) é recusado');

-- 9. Travas adicionais (revisão independente) ----------------------------------
reset role;
select t.bloqueia($$truncate public.session_notes$$, 'Nem o administrador esvazia as anotações com TRUNCATE');
select t.bloqueia($$truncate public.audit_log$$, 'Nem o administrador esvazia a auditoria com TRUNCATE');
select t.bloqueia($$truncate public.patients cascade$$, 'Nem o administrador esvazia pacientes com TRUNCATE');

select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;
select t.bloqueia($$update public.vault set recovery_wrapped_key = 'lixo'$$, 'Sessão roubada não destrói a chave de recuperação');
select t.bloqueia($$update public.vault set key_check = 'lixo'$$, 'Sessão roubada não altera a verificação do cofre');
with u as (update public.vault set wrapped_key = 'nova-embrulhada', salt = 's2', wrapped_key_iv = 'iv2' returning 1)
select t.ok((select count(*) from u) = 1, 'Trocar a senha do cofre continua permitido');
reset role;
select t.ok((select count(*) from public.vault_history where wrapped_key = 'w') = 1, 'Troca de senha do cofre guarda a versão anterior');
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;

with u as (update public.patients set name_enc = 'sobrescrito' where id = (select v from t.ids where k = 'pacA') returning 1)
select t.ok((select count(*) from u) = 1, 'Dona pode editar o nome do paciente');
reset role;
select t.ok((select count(*) from public.patients_history where name_enc = 'nome-cifrado-A') = 1, 'Edição de paciente guarda o nome anterior no histórico');
select t.bloqueia($$delete from public.patients_history$$, 'Histórico de pacientes não pode ser apagado');
select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;
select t.bloqueia($$select * from public.patients_history$$, 'App não lê o histórico diretamente');

select t.bloqueia($$update public.sessions set price_cents = 1 where id = (select v from t.ids where k = 'sesA')$$, 'Sessão paga não muda de valor');
select t.bloqueia($$update public.sessions set status = 'cancelada' where id = (select v from t.ids where k = 'sesA')$$, 'Sessão paga não muda de situação');

reset role;
select set_config('t.pagA', (select v::text from t.ids where k = 'pagA'), false);
select t.ok((select voided_at > now() - interval '1 minute' from public.payments where id = current_setting('t.pagA')::uuid), 'Data de pagamento desfeito é a do servidor, não a enviada');

select set_config('request.jwt.claims', :A_MFA, false);
set role authenticated;
select public.log_login();
select public.log_login();
select t.ok((select count(*) from public.audit_log where action = 'login') = 1, 'Registro de entrada limitado a um por minuto');
select set_config('t.audit_antes', (select count(*)::text from public.audit_log), false);
update public.patients set frequency = frequency where id = (select v from t.ids where k = 'pacA');
select t.ok((select count(*) from public.audit_log) = current_setting('t.audit_antes')::int, 'Atualização que não muda nada não gera auditoria');

reset role;
create function public.funcao_futura() returns int language sql as $$ select 1 $$;
select t.ok(not has_function_privilege('anon', 'public.funcao_futura()', 'execute')
        and not has_function_privilege('authenticated', 'public.funcao_futura()', 'execute'),
  'Função criada no futuro não fica aberta para visitantes nem usuários');
drop function public.funcao_futura();
select t.ok(not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('anon', p.oid, 'execute')),
  'Nenhuma função do esquema público pode ser chamada por visitante');

reset role;
\o
\echo
\echo 'Todos os testes do banco passaram.'
