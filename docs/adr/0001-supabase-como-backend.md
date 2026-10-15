# ADR-0001: Supabase como backend

- **Status:** Aceito
- **Data:** 2026-10-15

## Contexto

O sistema tem uma única usuária e dados sensíveis de saúde. Precisa de banco relacional, login com verificação em duas etapas e regras de acesso no próprio banco. O orçamento é baixo e não há equipe para manter servidor.

## Decisão

Usar o Supabase: Postgres gerenciado, autenticação com TOTP e API gerada a partir do banco (PostgREST). Toda regra de acesso fica no banco, com Row Level Security, triggers e funções. O app é um site estático, sem servidor próprio.

## Alternativas

| Opção | Por que não agora |
|---|---|
| AWS (RDS + Cognito + API Gateway/Lambda) | Mais peças para configurar e manter; custo mínimo maior para uma usuária. Faz sentido se o sistema crescer |
| Backend próprio (Node + Postgres) | Mais código de autenticação e autorização para escrever e auditar; precisa de servidor |
| Firebase | Banco não relacional; regras de acesso menos expressivas para auditoria e imutabilidade |

## Consequências

- Positivas: login e MFA prontos; regras testáveis em SQL; plano gratuito para piloto.
- Negativas: dependência de um fornecedor; quem é dono do projeto no Supabase pode desativar as travas do banco (mitigado pela criptografia e pelo backup externo); plano gratuito pausa por inatividade e não tem backup automático.
