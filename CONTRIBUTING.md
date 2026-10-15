# Como trabalhar neste projeto

## Regra número um

**Nunca use dado real de paciente** em código, teste, print, issue, pull request ou conversa com IA. Use o modo demonstração.

## Ambiente

```bash
nvm use            # Node 22 (arquivo .nvmrc)
npm install
npm run dev:demo   # sem servidor, dados fictícios
```

Os testes do banco precisam do PostgreSQL 15 ou mais novo instalado (`initdb`, `pg_ctl` e `psql`).

## Fluxo de trabalho

1. Crie uma branch a partir de `main` com o tipo da mudança: `feat/agenda-semanal`, `fix/csv-acentos`, `docs/backup`.
2. Faça commits pequenos, no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/):
   - `feat(app): agenda da semana`
   - `fix(db): impede pagamento com valor zero`
   - `test(crypto): cobre troca de senha`
   - `docs: explica restauração de backup`
   - Tipos usados: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `ci`, `security`.
3. Abra um pull request. O modelo traz o checklist de segurança.
4. O CI precisa passar (tipos, testes de criptografia, testes do banco, build e auditoria de dependências).
5. Junte com **squash merge** e apague a branch.

## Banco de dados

- Toda mudança é uma **migração nova** em `supabase/migrations/`, com data no nome. Nunca edite uma migração que já foi aplicada em algum ambiente.
- Toda tabela nova: `enable row level security`, políticas `dona_*` e `mfa_*`, `grant` só do necessário e trigger de bloqueio de exclusão.
- Toda função nova: `set search_path = ''` e `grant execute` explícito só para `authenticated`.
- Escreva o teste em `supabase/tests/` antes de considerar pronto, inclusive o teste de acesso negado.

## Criptografia

- Não troque algoritmo, parâmetros ou formato do contexto (AAD) sem um ADR novo em `docs/adr/` e um plano de migração dos dados já gravados.
- Não adicione biblioteca de criptografia (ver ADR-0004).

## Versões

O projeto segue [versionamento semântico](https://semver.org/lang/pt-BR/). Cada versão publicada ganha uma tag (`v0.2.0`) e uma entrada no [CHANGELOG](CHANGELOG.md).
