## O que muda

<!-- Uma ou duas frases. Link para a issue, se houver. -->

## Por quê

<!-- O problema que esta mudança resolve. -->

## Como testei

- [ ] `npm run typecheck`
- [ ] `npm test` (criptografia e banco)
- [ ] Abri no modo demonstração e passei pelo fluxo afetado

## Checklist de segurança

- [ ] Nenhum dado real de paciente em código, teste, print ou descrição
- [ ] Nenhuma chave, senha ou `.env` no commit
- [ ] Mudança no banco? Nova migração (nunca editar uma já aplicada) e teste em `supabase/tests`
- [ ] Nova tabela ou função? RLS ligado, `grant` explícito e teste de acesso negado
- [ ] Nada novo sendo registrado em log com conteúdo de paciente
- [ ] Nova dependência? Justificada aqui
