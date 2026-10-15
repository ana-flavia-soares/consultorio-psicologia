# ADR-0002: Criptografia de envelope no navegador

- **Status:** Aceito
- **Data:** 2026-10-15

## Contexto

Anotações clínicas, nomes e contatos não podem ser lidos por ninguém além da psicóloga, nem por quem administra o banco ou desenvolve o sistema. Criptografia em disco do fornecedor não resolve: o fornecedor e o administrador ainda leem.

## Decisão

Criptografar no navegador antes de enviar:

1. Uma chave de dados (DEK) aleatória AES-256-GCM criptografa os campos.
2. A DEK é guardada no servidor só embrulhada, duas vezes: com a senha do cofre (PBKDF2-SHA256, 600 mil rodadas) e com uma chave de recuperação de 256 bits mostrada uma única vez.
3. Cada campo usa um IV novo e um contexto (AAD) com o id do registro e, nas anotações, o número da versão.

## Alternativas

| Opção | Por que não |
|---|---|
| Derivar a chave direto da senha | Trocar a senha exigiria recriptografar tudo; não há como ter chave de recuperação |
| Criptografia só no servidor (pgcrypto) | O servidor teria a chave; administrador leria |
| Sem chave de recuperação | Esquecer a senha seria perda total garantida |

## Consequências

- Positivas: banco vazado não expõe conteúdo; troca de senha instantânea.
- Negativas: busca por texto dentro das anotações não é possível no servidor; perder senha e chave de recuperação juntas é irreversível; o servidor ainda vê metadados (datas, valores).
