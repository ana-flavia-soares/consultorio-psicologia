# ADR-0004: Web Crypto nativa, sem biblioteca de criptografia

- **Status:** Aceito
- **Data:** 2026-10-15

## Contexto

Cada dependência é código de terceiros rodando ao lado dos dados descriptografados. Criptografia feita à mão é uma das maiores fontes de falha.

## Decisão

Usar só a Web Crypto API do navegador: AES-GCM, PBKDF2-SHA256 e `getRandomValues`. Nenhuma biblioteca de criptografia. As únicas dependências de execução são React e o cliente do Supabase.

## Alternativas

| Opção | Por que não agora |
|---|---|
| Argon2id via WebAssembly | Mais resistente a ataques com placa de vídeo, mas adiciona dependência. PBKDF2 com 600 mil rodadas segue a recomendação da OWASP |
| libsodium | Ótima, mas grande e desnecessária para o que a Web Crypto já faz |

## Consequências

- Positivas: superfície de ataque menor; implementação auditada pelos navegadores; chave não exportável.
- Negativas: PBKDF2 é mais fraco que Argon2id contra hardware dedicado. Revisitar se a Web Crypto ganhar Argon2.
