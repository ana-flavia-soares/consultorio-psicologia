# Plano de resposta a incidente

Use quando houver suspeita de que alguém acessou, alterou ou perdeu dados do consultório. Exemplos: acesso estranho na tela Segurança, celular com o app autenticador roubado, computador perdido, aviso do Supabase ou da hospedagem, senha digitada num site falso.

Não é orientação jurídica. Tenha o contato de um advogado antes de precisar.

## Na primeira hora: conter

1. **Trocar a senha de entrar** da psicóloga e encerrar todas as sessões (Supabase > Authentication > Users > a conta > sign out).
2. **Se o celular foi perdido:** remover o fator de duas etapas antigo e cadastrar de novo no celular novo.
3. **Se o computador foi perdido:** trocar a senha de entrar e a senha do cofre de outro computador (tela Segurança).
4. **Se houver suspeita no Supabase ou na hospedagem:** trocar a senha do banco, gerar novas chaves de API e revisar quem tem acesso às contas.
5. **Não apagar nada.** A auditoria e os logs são as provas do que aconteceu.

## No primeiro dia: entender

Registre por escrito, com data e hora:

- O que aconteceu e como foi percebido.
- Quais dados podem ter sido afetados. Lembre que nomes, contatos e anotações estão criptografados: se só o banco vazou, o risco é bem menor do que se o computador desbloqueado ou a senha do cofre vazaram.
- Quantos pacientes podem ter sido afetados.
- O que já foi feito para conter.

Fontes: tela Segurança, logs do Supabase (Logs > Auth e API) e histórico de publicações da hospedagem.

## Em até 3 dias úteis: comunicar

Pela Resolução CD/ANPD 15/2024, incidente que possa causar **risco ou dano relevante** aos titulares deve ser comunicado:

- **à ANPD**, pelo formulário no site da autoridade;
- **aos pacientes afetados**, em linguagem simples: o que aconteceu, quais dados, o que foi feito e o que eles podem fazer.

O prazo é de 3 dias úteis a partir de quando se soube que o incidente afetou dados pessoais. Agentes de pequeno porte têm o dobro (6 dias úteis), apresentando declaração dessa condição. Dado de saúde costuma ser considerado de risco relevante. Decida com o advogado.

Avalie também comunicar o Conselho Regional de Psicologia.

## Depois: aprender

- Corrigir a causa e registrar a correção.
- Atualizar este plano e o [SECURITY.md](../SECURITY.md).
- **Guardar o registro do incidente por no mínimo 5 anos**, mesmo que não tenha sido comunicado à ANPD. A autoridade pode pedir esse registro a qualquer momento.

## Contatos

Preencha antes de colocar dados reais:

| Papel | Nome | Contato |
|---|---|---|
| Psicóloga (controladora dos dados) | | |
| Responsável técnica pelo sistema | | |
| Advogado(a) | | |
| Suporte do Supabase | | |
