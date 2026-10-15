# ADR-0005: Backend como interface, com modo demonstração

- **Status:** Aceito
- **Data:** 2026-10-15

## Contexto

O sistema precisa ser mostrado à cliente antes de existir servidor, e as telas precisam ser testadas sem dados reais.

## Decisão

As telas dependem só da interface `Backend` (`src/backend/types.ts`). Há duas implementações: `supabase.ts` (produção) e `demo.ts` (em memória, com dados fictícios). A demonstração usa a mesma criptografia da produção e imita as regras do banco que afetam a tela (versão de anotação, sessão paga congelada).

## Consequências

- Positivas: demonstração sem custo; teste de ponta a ponta sem servidor; troca de backend sem mexer nas telas.
- Negativas: duas implementações para manter coerentes. A regra de verdade é sempre a do banco; a demonstração pode divergir em detalhes.
