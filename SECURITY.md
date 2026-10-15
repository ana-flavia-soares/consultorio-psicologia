# Segurança

Este documento diz o que o sistema protege, como, onde isso está no código, como é testado e, principalmente, **o que ainda não está coberto**.

Não existe sistema que garanta que nunca vai vazar. O objetivo aqui é: tornar o vazamento muito difícil, fazer com que o dado vazado seja inútil, e saber o que aconteceu se algo der errado.

## 1. Contexto legal

Não substitui orientação jurídica. Valide com um advogado.

| Norma | O que exige | Como o sistema atende |
|---|---|---|
| LGPD, art. 11 | Dado de saúde é dado pessoal sensível | Criptografia no navegador, acesso só da dona, auditoria |
| Resolução CFP 001/2009, art. 1º | Registro do atendimento é obrigatório e sigiloso, em papel ou informatizado | Prontuário criptografado; só a psicóloga lê |
| Resolução CFP 001/2009, art. 4º | Guarda por no mínimo 5 anos | Nenhum registro pode ser apagado, nem pelo administrador do banco |
| Resolução CFP 001/2009, art. 6º | Registrar só o necessário ao trabalho | Cadastro sem CPF, endereço ou diagnóstico; modelo de anotação enxuto |
| Resolução CFP 001/2009, art. 5º | No prontuário, o paciente tem acesso integral às informações | **Ainda não há exportação por paciente** (ver seção 4) |
| Resolução CD/ANPD 15/2024 | Comunicar incidente relevante à ANPD e aos titulares em 3 dias úteis (6 para agente de pequeno porte); guardar registro do incidente por 5 anos | Plano em [docs/incidente.md](docs/incidente.md) |

## 2. Ameaças e proteções

| Ameaça | Proteção | Onde | Teste |
|---|---|---|---|
| Alguém descobre a senha de entrar | Código do celular obrigatório; o banco recusa qualquer acesso sem ele | Supabase Auth; políticas `mfa_*` | Banco: "Sem duas etapas, a dona não vê…" |
| Outra conta tenta ler os dados | RLS: cada linha só para a dona; checagem de dona entre tabelas | Políticas `dona_*`; trigger `checar_mesma_dona` | Banco: "Conta B não vê / não cria / não altera…" |
| Visitante sem login | Papel `anon` sem nenhuma permissão | `revoke all` na migração | Banco: "Visitante sem login…" |
| O banco vaza inteiro (backup, invasão, erro do fornecedor) | Nome, contato e anotação são criptografados no navegador com AES-256-GCM; a chave nunca vai ao servidor | `src/crypto/vault.ts` | Cripto: "o banco nunca recebe a senha, a chave…" |
| Quem administra o banco tenta ler | Mesma criptografia: o administrador vê só texto embaralhado | idem | idem |
| Conteúdo adulterado no banco | AES-GCM detecta alteração do texto cifrado; o contexto (AAD) amarra cada texto ao seu registro e, na anotação, ao número da versão. Reenviar uma versão antiga como nova não abre | `vault.ts`, `aad`; `add_session_note` exige versão = última + 1 | Cripto: "conteúdo adulterado…", "versão antiga reenviada…"; Banco: "número de versão já usado" |
| Adivinhar a senha do cofre a partir do banco vazado | PBKDF2-SHA256 com 600 mil rodadas por tentativa; senha mínima de 12 caracteres | `vault.ts`; `check` no banco | Cripto: "600 mil rodadas"; Banco: "derivação fraca é recusada" |
| Sessão roubada tenta trancar a dona para fora do cofre | Só a cópia embrulhada pela senha pode mudar; a da chave de recuperação, a verificação e os parâmetros são fixos. A versão anterior vai para `vault_history` | `cofre_so_troca_senha`, `guardar_versao_anterior` | Banco: "Sessão roubada não destrói a chave de recuperação" |
| Sessão roubada sobrescreve nomes de pacientes | Toda alteração guarda a versão anterior em `patients_history`, que não pode ser alterada | `guardar_versao_anterior` | Banco: "Edição de paciente guarda o nome anterior" |
| Anotação alterada ou apagada, por engano ou de propósito | Só inserção: cada edição é uma versão nova; triggers bloqueiam UPDATE, DELETE e TRUNCATE, inclusive por quem administra pelo painel | `session_notes`, `notes_imutaveis`, `bloquear_truncate` | Banco: "Nem o administrador altera anotação", "…esvazia com TRUNCATE" |
| Registros apagados | Triggers bloqueiam DELETE e TRUNCATE em todas as tabelas; paciente é arquivado, sessão é cancelada | `bloquear_exclusao`, `bloquear_truncate` | Banco: "Nem o administrador apaga pacientes" |
| Pagamento editado para esconder valor | Pagamento só pode ser desfeito uma vez, com a data do servidor; valor, data e forma são fixos; sessão paga não muda de valor nem de situação | `pagamento_so_desfaz`, `sessao_paga_congelada` | Banco: "Valor de pagamento não pode ser editado", "Sessão paga não muda…" |
| Não saber quem fez o quê | Toda escrita e toda abertura de anotação geram registro; auditoria não pode ser alterada nem apagada; atualizações vazias e entradas repetidas não poluem o histórico | `audit_log`, `auditar_escrita`, `get_session_notes`, `log_login` | Banco: "Cada leitura do prontuário fica registrada", "Nem o administrador apaga a auditoria", "limitado a um por minuto" |
| Função nova no banco ficar aberta para qualquer um | Padrão do Postgres de liberar funções novas foi desligado; teste confere que nenhuma função pode ser chamada por visitante | fim da migração | Banco: "Função criada no futuro…" |
| Texto clínico indo parar no financeiro | Financeiro em tabela própria, sem nenhuma coluna de texto livre; planilha exportada sem anotações | `payments`; `FinanceScreen` | Banco: "Financeiro não tem coluna para texto clínico"; Tela: "Planilha não contém texto do prontuário" |
| Computador esquecido aberto | Saída automática após 10 minutos sem uso, com aviso um minuto antes; a chave é descartada da memória | `src/security/idle.ts` | Tela: "Aviso…", "Saída automática por inatividade" |
| Login salvo no computador | Sessão em `sessionStorage`, e não em `localStorage`: em geral some ao fechar a aba, mas o navegador pode restaurá-la ao reabrir abas. A saída por inatividade é do lado do navegador; um token roubado só expira pelas regras do Supabase (ver README, tempo de sessão) | `backend/supabase.ts` | Revisão de código |
| Script malicioso injetado na página (XSS) | CSP sem scripts de terceiros nem inline; React escapa todo texto; chave não exportável | `public/_headers`, `vercel.json` | Tela: "Nenhuma violação da CSP" |
| Página aberta dentro de outro site (clickjacking) | `frame-ancestors 'none'` e `X-Frame-Options: DENY` | `_headers` | Revisão |
| Erros espalhando dados em logs | Log guarda só onde falhou e um código; nunca a mensagem do servidor | `src/security/safeLog.ts` | Revisão de código |
| Dependência com falha conhecida | `npm audit` no CI toda semana; Dependabot abre atualizações | `.github/` | CI |
| Perda de dados | Backup criptografado com `age` + teste de restauração mensal | `scripts/backup.sh`, `restore-check.sh` | Testado localmente |
| Esquecer a senha do cofre | Chave de recuperação de 256 bits, mostrada uma vez, para guardar em papel | `vault.ts`, tela de criação | Cripto e Tela: "chave de recuperação recupera o acesso" |

## 3. O que o servidor consegue ver

A criptografia no navegador tem um custo: o servidor precisa de alguns dados em claro para filtrar e somar. Ficam **sem** criptografia:

- datas e horários das sessões, status (realizada, falta…) e valores;
- frequência e valor da sessão de cada paciente, data de início;
- pagamentos (valor, data, forma);
- quantas anotações e versões existem e quando foram salvas;
- o e-mail da psicóloga.

Ou seja: quem tiver acesso ao banco descobre **quantos pacientes ela atende, quando e quanto cobra**, mas não **quem são** nem **o que foi dito**.

## 4. O que ainda não está coberto

Esta lista é o motivo de não colocar dados reais antes de resolvê-la.

### Precisa de outra pessoa

| Item | Por quê | Quem |
|---|---|---|
| Revisão de código independente | Quem escreveu não acha os próprios erros | Dev sênior ou especialista em segurança |
| Teste de invasão (pentest) | Alguém tentando entrar de propósito encontra o que testes não encontram | Profissional de segurança |
| Revisão jurídica | Termo de consentimento, política de privacidade, contrato com o Supabase (DPA), conflito entre direito de exclusão (LGPD) e guarda de 5 anos (CFP) | Advogado com experiência em LGPD e saúde |
| Responsável pela operação | Atualizar dependências, olhar alertas, fazer e testar backups | Alguém com compromisso contínuo |

### Limites do próprio modelo

- **Confiança no código entregue.** Em qualquer sistema web com criptografia no navegador, quem controla a hospedagem ou o repositório pode publicar uma versão alterada que capture a senha do cofre. Mitigação: verificação em duas etapas nas contas do GitHub, da hospedagem e do Supabase; repositório privado; proteção da branch principal.
- **Computador comprometido.** Vírus ou programa espião no computador dela vê o que ela vê. Fora do alcance do sistema: antivírus, sistema atualizado e disco criptografado.
- **XSS enquanto o cofre está aberto.** A chave não pode ser exportada, mas um script injetado conseguiria pedir ao navegador que descriptografe. A CSP rígida é a defesa principal.
- **Perda da senha do cofre e da chave de recuperação ao mesmo tempo** = perda definitiva das anotações. É o preço de ninguém mais conseguir ler.
- **Quem é dono do banco consegue desativar as travas.** O papel `postgres` (painel do Supabase) pode desligar triggers e alterar qualquer linha. Por isso as travas protegem contra o app, erros e sessões roubadas, mas não contra quem controla o projeto no Supabase. Contra isso, valem a criptografia (que impede ler) e o backup externo (que impede perder). Proteja a conta do Supabase com duas etapas e não compartilhe o acesso.
- **Leitura de nomes não é auditada individualmente.** A lista de pacientes é carregada inteira ao abrir; o registro de acesso marca a entrada no sistema e cada abertura de anotação.

### Funcionalidades que faltam

| Funcionalidade | Por quê |
|---|---|
| Exportar o prontuário de um paciente | Direito de acesso do paciente (CFP 001/2009, art. 5º) e da LGPD |
| Bloquear o cofre sem sair do sistema | Hoje a única forma é sair |
| Encerramento e encaminhamento formal | O CFP pede registro de encaminhamento ou encerramento |
| Limite de tentativas da senha do cofre | Hoje o limite é só o custo do PBKDF2 |
| Alerta de login em local ou dispositivo novo | Depende de configuração do Supabase |

## 5. Decisões e alternativas

| Decisão | Alternativa | Por que esta |
|---|---|---|
| Supabase | AWS (RDS + Cognito) | Mesmo Postgres e RLS, com login e MFA prontos e custo menor para uma usuária. AWS faz sentido se crescer |
| PBKDF2 nativo do navegador | Argon2id | Argon2 é mais resistente a placas de vídeo, mas exige biblioteca externa. PBKDF2 com 600 mil rodadas segue a recomendação da OWASP e não traz dependência |
| Criptografia de envelope (chave de dados + chave embrulhada) | Derivar a chave direto da senha | Trocar a senha não exige recriptografar tudo; permite a chave de recuperação |
| Acesso ao prontuário só por funções no banco | Acesso direto à tabela | Permite registrar cada leitura e conferir MFA num só lugar |
| Nenhuma exclusão | Exclusão lógica com prazo | Atende a guarda de 5 anos sem depender de rotina. Rever com o jurídico |
| Faltas fora do "a receber" | Cobrar falta | Decisão de negócio da psicóloga. Ajustar `CHARGEABLE` em `src/ui/screens.tsx` |
