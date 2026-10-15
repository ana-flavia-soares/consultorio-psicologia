# Arquitetura

Visão de como as peças se conectam. Os porquês de cada escolha estão nos [registros de decisão](adr/).

## 1. Contexto

Uma única usuária, a psicóloga, usa o sistema num navegador. Não há servidor próprio: o app é um site estático, e os dados ficam num Postgres gerenciado pelo Supabase.

```mermaid
flowchart LR
  P([Psicóloga]) -->|navegador| APP[App React<br/>site estático]
  APP -->|HTTPS + token| AUTH[Supabase Auth<br/>senha + TOTP]
  APP -->|HTTPS + token| API[PostgREST<br/>API automática do banco]
  API --> DB[(Postgres<br/>RLS, triggers, auditoria)]
  CEL([App autenticador<br/>no celular]) -. código de 6 números .-> P
  DEV([Quem mantém]) -->|pg_dump + age| BK[(Backup criptografado<br/>fora do Supabase)]
  DB -.-> BK
```

## 2. Camadas do código

```mermaid
flowchart TB
  subgraph UI [src/ui: telas]
    Gate[Gate.tsx<br/>login, MFA, cofre]
    Screens[screens.tsx<br/>Hoje, Sessão, Pacientes, Financeiro, Segurança]
    Clinic[clinic.tsx<br/>dados descriptografados em memória]
  end
  subgraph Core [núcleo sem React]
    Vault[crypto/vault.ts<br/>criptografia]
    Types[backend/types.ts<br/>contrato Backend]
  end
  subgraph Adapters [backend: implementações]
    SB[supabase.ts<br/>produção]
    Demo[demo.ts<br/>memória, dados fictícios]
  end
  Sec[security/<br/>idle.ts, safeLog.ts]

  Gate --> Vault
  Screens --> Clinic --> Vault
  Gate & Screens & Clinic --> Types
  SB & Demo -.implementam.-> Types
  Screens --> Sec
```

Regras de dependência:

- **A tela nunca fala com o banco direto.** Fala com a interface `Backend` (`types.ts`). Isso permite trocar o servidor, ou rodar a demonstração, sem mexer em nenhuma tela.
- **`vault.ts` não depende de React nem do navegador além da Web Crypto.** Por isso roda nos testes com Node puro.
- **A segurança não depende do app.** Toda regra de acesso está no banco. Se o app tiver um erro, o banco ainda bloqueia.

## 3. Modelo de dados

```mermaid
erDiagram
  AUTH_USERS ||--|| VAULT : "1 cofre"
  AUTH_USERS ||--o{ PATIENTS : "dona"
  PATIENTS ||--o{ SESSIONS : "tem"
  SESSIONS ||--o{ PAYMENTS : "0..n (1 válido)"
  SESSIONS ||--o{ SESSION_NOTES : "versões"
  PATIENTS ||--o{ PATIENTS_HISTORY : "versões anteriores"
  VAULT ||--o{ VAULT_HISTORY : "senhas anteriores"
  AUTH_USERS ||--o{ AUDIT_LOG : "registros"

  VAULT { text wrapped_key "DEK embrulhada pela senha" text recovery_wrapped_key "DEK embrulhada pela chave de recuperação (fixa)" int kdf_iterations }
  PATIENTS { uuid id text name_enc "cifrado" text contact_enc "cifrado" text frequency int session_price_cents timestamptz archived_at }
  SESSIONS { uuid id timestamptz starts_at text status int price_cents }
  PAYMENTS { uuid id int amount_cents date paid_on text method timestamptz voided_at }
  SESSION_NOTES { uuid session_id int version text ciphertext "cifrado" text iv }
  AUDIT_LOG { text action text entity uuid entity_id timestamptz at }
```

Em claro no servidor ficam só datas, valores, status e quantidades. Nome, contato e anotação ficam cifrados. Detalhes em [SECURITY.md](../SECURITY.md#3-o-que-o-servidor-consegue-ver).

## 4. Fluxos principais

### Entrar e abrir o cofre

```mermaid
sequenceDiagram
  actor P as Psicóloga
  participant App
  participant Auth as Supabase Auth
  participant DB as Postgres
  P->>App: e-mail + senha
  App->>Auth: signInWithPassword
  Auth-->>App: token aal1
  P->>App: código do celular
  App->>Auth: challengeAndVerify (TOTP)
  Auth-->>App: token aal2
  App->>DB: select vault (RLS exige aal2)
  DB-->>App: DEK embrulhada + salt
  P->>App: senha do cofre
  Note over App: PBKDF2 600k → chave de embrulho<br/>AES-GCM abre a DEK (não exportável)
  App->>DB: rpc log_login
```

### Salvar uma anotação

```mermaid
sequenceDiagram
  participant App
  participant DB as Postgres
  App->>App: versão = última + 1
  App->>App: AES-GCM(DEK, texto, AAD = sessão + versão)
  App->>DB: rpc add_session_note(sessão, versão, cifra, iv)
  DB->>DB: confere dona, aal2, versão = máx + 1
  DB->>DB: insere (nunca atualiza) + auditoria
  DB-->>App: versão salva
```

Se outra aba salvou antes, o número de versão não bate e o banco recusa. A tela pede para recarregar, em vez de sobrescrever.

### Esquecer a senha do cofre

```mermaid
sequenceDiagram
  actor P as Psicóloga
  participant App
  participant DB as Postgres
  P->>App: chave de recuperação + nova senha
  App->>DB: select vault
  App->>App: abre a DEK com a chave de recuperação
  App->>App: embrulha a mesma DEK com a nova senha
  App->>DB: update vault (só salt e wrapped_key podem mudar)
  DB->>DB: guarda a versão anterior em vault_history
```

A chave de dados não muda, então nenhuma anotação precisa ser recriptografada.

## 5. Onde cada regra é garantida

| Regra | App | Banco | Teste |
|---|---|---|---|
| Só a dona acessa | — | RLS `dona_*` | `supabase/tests` |
| Exige código do celular | Fluxo de telas | RLS restritiva `mfa_*` | `supabase/tests` |
| Conteúdo ilegível no servidor | `vault.ts` | — | `tests/vault.test.ts` |
| Nada é apagado | Botões só arquivam/cancelam | Triggers de DELETE e TRUNCATE | `supabase/tests` |
| Anotação só ganha versões | Tela de versões | Sem UPDATE + trigger + RPC | ambos |
| Auditoria | Tela Segurança | Triggers + RPC de leitura | `supabase/tests` |
| Saída por inatividade | `idle.ts` | Tempo de sessão do Supabase (configuração) | `tests/e2e` |

## 6. Ambientes

| Ambiente | Como roda | Dados |
|---|---|---|
| Demonstração | `npm run dev:demo` ou build `build:demo` | Fictícios, em memória |
| Testes | `npm test` (Node + Postgres local) | Fictícios |
| Piloto | Supabase grátis + Cloudflare Pages | Fictícios |
| Produção | Supabase Pro + Cloudflare Pages | Reais, só depois da revisão de segurança |
