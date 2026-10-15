# Configurar o repositório no GitHub

Faça uma vez, logo depois de criar o repositório.

## Conta

- [ ] Verificação em duas etapas ativada na sua conta do GitHub.

## Repositório (Settings)

- [ ] **Visibilidade: privado.** Só torne público depois de autorização da cliente e confirmando que não há nome dela no código (ver README, variáveis `VITE_PRO_*`).
- [ ] **General > Pull Requests:** permitir só *squash merging*; marcar "Automatically delete head branches".
- [ ] **Code security:** ligar *Dependabot alerts*, *Dependabot security updates*, *Secret scanning* e *Push protection* (este último bloqueia o envio de chaves por engano).

## Proteção da branch `main` (Settings > Rules > Rulesets, ou Branches)

- [ ] Exigir pull request antes de juntar.
- [ ] Exigir que as verificações passem: **App (tipos, criptografia, build, dependências)** e **Banco (regras de segurança)**.
- [ ] Bloquear *force push* e exclusão da branch.

Trabalhando sozinha, você pode deixar a aprovação de revisão desligada, mas mantenha o PR: ele força o CI a rodar antes de chegar à `main`, e é a `main` que vai para o ar.

## Hospedagem

- [ ] Na Cloudflare Pages, publicar só a partir da `main`.
- [ ] Variáveis de ambiente cadastradas na hospedagem, nunca no repositório.
