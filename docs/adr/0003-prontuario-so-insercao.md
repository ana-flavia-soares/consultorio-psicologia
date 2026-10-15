# ADR-0003: Prontuário só por inserção e nenhuma exclusão

- **Status:** Aceito
- **Data:** 2026-10-15

## Contexto

A Resolução CFP 001/2009 exige guarda do registro por no mínimo 5 anos. Alteração silenciosa de uma anotação compromete a integridade do prontuário, seja por erro, seja por sessão roubada.

## Decisão

- Anotações só podem ser inseridas. Editar cria a versão seguinte; versões antigas ficam legíveis.
- O app grava e lê anotações só por funções do banco (`add_session_note`, `get_session_notes`), que conferem dona, MFA e número da versão, e registram a leitura.
- Nenhuma tabela aceita DELETE ou TRUNCATE. Paciente é arquivado; sessão é cancelada; pagamento é desfeito.
- Alterações em pacientes e na senha do cofre guardam a versão anterior em tabelas de histórico.

## Alternativas

| Opção | Por que não |
|---|---|
| UPDATE com coluna `updated_at` | Perde o conteúdo anterior |
| Exclusão lógica (`deleted_at`) com expurgo após 5 anos | Mais simples de errar; precisa de rotina. Pode ser revisto com orientação jurídica |

## Consequências

- Positivas: histórico completo; adulteração pelo app é impossível; testes cobrem cada trava.
- Negativas: o banco só cresce (irrelevante no volume de um consultório); o direito de exclusão da LGPD precisa de análise jurídica frente à obrigação de guarda.
