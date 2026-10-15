-- Usado SÓ ao restaurar um backup num projeto novo do Supabase.
-- O backup não leva a conta de login; a conta nova tem outro id.
-- Este script passa todos os registros do id antigo para o id novo.
--
-- Como usar, no SQL Editor:
--   1. Troque ID-ANTIGO (aparece em public.vault.owner_id) e ID-NOVO
--      (Authentication > Users) nas duas linhas abaixo.
--   2. Execute tudo de uma vez. Se algo falhar, nada é alterado.

begin;

create temporary table troca (antigo uuid, novo uuid) on commit drop;
insert into troca values ('ID-ANTIGO', 'ID-NOVO');

alter table public.vault         disable trigger user;
alter table public.patients      disable trigger user;
alter table public.sessions      disable trigger user;
alter table public.payments      disable trigger user;
alter table public.session_notes disable trigger user;
alter table public.audit_log     disable trigger user;
alter table public.patients_history disable trigger user;
alter table public.vault_history    disable trigger user;

update public.vault         set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.patients      set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.sessions      set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.payments      set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.session_notes set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.audit_log     set owner_id = (select novo from troca), actor_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.patients_history set owner_id = (select novo from troca) where owner_id = (select antigo from troca);
update public.vault_history    set owner_id = (select novo from troca) where owner_id = (select antigo from troca);

alter table public.vault         enable trigger user;
alter table public.patients      enable trigger user;
alter table public.sessions      enable trigger user;
alter table public.payments      enable trigger user;
alter table public.session_notes enable trigger user;
alter table public.audit_log     enable trigger user;
alter table public.patients_history enable trigger user;
alter table public.vault_history    enable trigger user;

commit;
