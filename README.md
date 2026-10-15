# Consultório: agenda, prontuário e financeiro com criptografia

Sistema de agenda, prontuário e financeiro para um consultório de psicologia, com uma única usuária: a psicóloga.

Nomes, contatos e anotações são criptografados **no navegador** antes de ir para o servidor. O banco guarda só texto embaralhado. Quem administra o banco, inclusive quem desenvolveu o sistema, não consegue ler esses campos.

Documentação: [arquitetura](docs/arquitetura.md) · [decisões (ADR)](docs/adr/) · [segurança](SECURITY.md) · [incidente](docs/incidente.md) · [como contribuir](CONTRIBUTING.md) · [configurar o GitHub](docs/configurar-github.md)

> **Antes de colocar qualquer dado real:** leia [SECURITY.md](SECURITY.md), em especial a seção "O que ainda não está coberto". Uma revisão de segurança independente é pré-requisito.

## Sumário

1. [Como o sistema funciona](#1-como-o-sistema-funciona)
2. [Rodar a demonstração](#2-rodar-a-demonstração)
3. [Rodar os testes](#3-rodar-os-testes)
4. [Colocar no ar](#4-colocar-no-ar)
5. [Primeiro acesso da psicóloga](#5-primeiro-acesso-da-psicóloga)
6. [Backup](#6-backup)
7. [Manutenção](#7-manutenção)
8. [Estrutura do projeto](#8-estrutura-do-projeto)

---

## 1. Como o sistema funciona

```
Navegador da psicóloga                      Supabase (servidor)
┌────────────────────────────┐              ┌──────────────────────────────────┐
│ Senha do cofre             │              │ Login + código do celular (MFA)  │
│   └─> abre a chave de dados│              │                                  │
│ Chave de dados (só memória)│   HTTPS      │ Postgres com RLS:                │
│   ├─> criptografa nome     │ ───────────> │  patients   (nome cifrado)       │
│   ├─> criptografa contato  │              │  sessions   (data, valor)        │
│   └─> criptografa anotação │              │  payments   (sem texto livre)    │
│                            │              │  session_notes (só versões novas)│
│ Sai sozinho após 10 min    │              │  audit_log  (não pode apagar)    │
└────────────────────────────┘              └──────────────────────────────────┘
```

Três barreiras, uma atrás da outra:

| Barreira | O que protege | Onde está |
|---|---|---|
| Login com senha + código do celular | Ninguém entra só com a senha | Supabase Auth + política `mfa_*` no banco |
| Regras do banco (RLS, triggers) | Cada conta só vê o que é seu; nada é apagado; anotação não é sobrescrita | `supabase/migrations/` |
| Criptografia no navegador | Mesmo com o banco vazado, nomes e anotações são ilegíveis | `src/crypto/vault.ts` |

## 2. Rodar a demonstração

Requer Node.js 22.18 ou mais novo.

```bash
npm install
npm run dev:demo
```

Abra o endereço que aparecer no terminal. O e-mail e a senha já vêm preenchidos; o código do celular na demonstração é `123456`. Tudo fica em memória: recarregar a página apaga.

## 3. Rodar os testes

```bash
npm run test:crypto   # 16 testes da criptografia
npm run test:db       # 70 testes das regras do banco (precisa do PostgreSQL instalado)
npm run typecheck
```

O teste de ponta a ponta das telas está em `tests/e2e/fluxo_demo.py` (instruções no topo do arquivo).

O GitHub roda tudo isso a cada envio de código e toda segunda-feira (`.github/workflows/ci.yml`).

## 4. Colocar no ar

Os nomes dos menus do Supabase e da hospedagem mudam com o tempo. Se não encontrar exatamente o nome abaixo, procure por algo equivalente.

### 4.1 Criar o projeto no Supabase

1. Crie uma conta em supabase.com **com verificação em duas etapas ativada**.
2. Crie um projeto na região **South America (São Paulo)**.
3. Gere uma senha forte para o banco e guarde num gerenciador de senhas.

### 4.2 Criar as tabelas e regras

No painel do Supabase, abra o **SQL Editor**, cole todo o conteúdo de `supabase/migrations/20261015000000_esquema_seguro.sql` e execute.

Alternativa pela linha de comando: `npx supabase link` e depois `npx supabase db push`.

### 4.3 Configurar o login

Em **Authentication**:

| Configuração | Valor | Por quê |
|---|---|---|
| Permitir novos cadastros (sign ups) | **Desligado** | Só a conta da psicóloga existe |
| Multi-Factor Authentication > TOTP | **Ligado** | O app exige o código do celular |
| Tamanho mínimo da senha | 12 ou mais | Senha de entrar forte |
| Proteção contra senhas vazadas | Ligado, se o plano oferecer | Recusa senhas que já vazaram |
| Tempo de sessão (inatividade e limite total) | Inatividade 30 min, limite 12 h, se o plano oferecer | Um login roubado deixa de valer sozinho; o app sai em 10 min, mas isso só vale no navegador |

Depois, em **Authentication > Users > Add user**, crie a conta da psicóloga com o e-mail dela e uma senha temporária forte, marcando como confirmada.

### 4.4 Configurar o app

```bash
cp .env.example .env
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores de **Project Settings > API**.

As variáveis `VITE_PRO_NAME`, `VITE_PRO_ROLE` e `VITE_PRO_FIRST_NAME` definem o nome exibido nas telas. Assim o código não carrega o nome de nenhuma cliente e pode ir para o portfólio.

> Use **só** a chave `anon`. A chave `service_role` ignora todas as regras do banco: ela nunca entra no app, no `.env` do app nem no GitHub.

### 4.5 Fontes

Para não chamar o Google a cada acesso, as fontes ficam no próprio site. Baixe do Google Fonts (licença livre OFL) e coloque em `public/fonts/`:

- `CormorantGaramond-Bold.woff2`
- `Figtree-Variable.woff2`

Sem elas, o sistema funciona com as fontes do computador.

### 4.6 Publicar

Recomendado: **Cloudflare Pages** (Netlify também funciona com os mesmos arquivos).

1. Envie o projeto para um repositório **privado** no GitHub, com verificação em duas etapas na conta.
2. Em `public/_headers`, troque as duas ocorrências de `SEU-PROJETO` pelo endereço do seu projeto Supabase. Na Vercel, o arquivo equivalente é `vercel.json`.
3. Na hospedagem, conecte o repositório com:
   - comando de build: `npm run build`
   - pasta de saída: `dist`
   - variáveis: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
4. Depois de publicar, confira os cabeçalhos em securityheaders.com. O esperado é nota A ou A+.
5. No Supabase, em **Authentication > URL Configuration**, coloque o endereço publicado como Site URL.

## 5. Primeiro acesso da psicóloga

Faça junto com ela, no computador que ela vai usar.

1. Ela entra com o e-mail e a senha temporária e troca a senha.
2. Ativa o código do celular: instala um app autenticador e lê o QR code.
3. Cria a **senha do cofre**, diferente da senha de entrar.
4. **Anota à mão a chave de recuperação** e guarda em local físico seguro, longe do computador. Sem ela e sem a senha do cofre, as anotações ficam perdidas para sempre.
5. Confere que o computador tem senha de bloqueio de tela e disco criptografado (BitLocker no Windows, FileVault no Mac).

## 6. Backup

São duas camadas:

1. **Backups do Supabase.** Os planos pagos incluem backup diário automático. Confira na página de preços o que o plano escolhido oferece.
2. **Backup próprio, criptografado**, para não depender só de um fornecedor.

### Preparar, uma única vez

```bash
age-keygen -o chave-backup-PRIVADA.txt
```

- A linha `public key: age1...` é a chave pública: pode ficar no computador de quem faz o backup.
- O arquivo `chave-backup-PRIVADA.txt` abre os backups: imprima ou salve num pendrive, guarde junto com a chave de recuperação do cofre e **apague do computador**.

### Toda semana

```bash
export SUPABASE_DB_URL='postgresql://...'   # Project Settings > Database > Connection string
export BACKUP_AGE_RECIPIENT='age1...'
./scripts/backup.sh
```

Guarde o arquivo `.age` e o `.sha256` em dois lugares, por exemplo um HD externo e uma nuvem. Sem a chave privada, o arquivo é ilegível.

### Todo mês: provar que o backup funciona

```bash
./scripts/restore-check.sh backups/consultorio-AAAAMMDD-HHMMSS.dump.age chave-backup-PRIVADA.txt
```

O script restaura num banco temporário no seu computador e mostra quantas linhas cada tabela tem. Depois apague a chave privada do computador de novo.

### Restaurar de verdade num projeto novo

O backup não inclui a conta de login, que fica no esquema `auth` do Supabase. Depois de restaurar as tabelas num projeto novo e criar a conta da psicóloga, os registros ainda apontam para o id da conta antiga. O script `supabase/trocar-dona.sql` corrige isso de uma vez; as instruções estão no topo dele.

Faça isso com alguém experiente acompanhando e teste antes num projeto de testes.

## 7. Manutenção

| Quando | O quê |
|---|---|
| Toda semana | Backup. Revisar e aceitar as atualizações do Dependabot se os testes passarem |
| Todo mês | `restore-check.sh`. Olhar a tela **Segurança** com a psicóloga: algum acesso estranho? |
| A cada 6 meses | Revisar quem tem acesso ao Supabase, à hospedagem e ao GitHub |
| Se algo parecer errado | Seguir [docs/incidente.md](docs/incidente.md) |

## 8. Estrutura do projeto

```
supabase/migrations/   Tabelas, RLS, triggers e funções (a segurança mora aqui)
supabase/tests/        Testes das regras do banco
src/crypto/vault.ts    Criptografia: cofre, chave de recuperação, campos
src/backend/           Conversa com o servidor (real e demonstração)
src/security/          Saída por inatividade e log sem dados
src/ui/                Telas
src/config.ts          Nome e cargo exibidos (vêm do .env)
docs/                  Arquitetura, decisões (ADR), incidente, GitHub
tests/                 Testes de criptografia e de telas
scripts/               Testes do banco, backup e verificação de backup
public/_headers        Cabeçalhos de segurança da hospedagem
```
