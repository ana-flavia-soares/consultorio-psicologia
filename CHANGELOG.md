# Changelog

Mudanças relevantes deste projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não publicado]

## [0.1.0] - 2026-10-15

Primeira versão, para piloto com dados fictícios.

### Adicionado

- Agenda do dia, pacientes, ficha, sessão com prontuário e pagamento, financeiro do mês e tela de segurança.
- Login com senha e código do celular (TOTP), exigido também pelo banco.
- Criptografia no navegador de nomes, contatos e anotações, com chave de recuperação.
- Anotações com versões; nenhuma exclusão; histórico de pacientes e da senha do cofre.
- Auditoria de escritas e de cada abertura de anotação.
- Saída automática após 10 minutos sem uso, com aviso.
- Backup criptografado com `age` e teste de restauração.
- CI com tipos, testes, build e auditoria de dependências.
