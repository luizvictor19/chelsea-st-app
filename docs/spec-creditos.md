# Créditos: o razão de lançamentos

Escrita em 12/11/2026 (#273), a partir do plano aprovado pelo Luiz no mesmo dia (com a recomendação
de cada pergunta, Q1 a Q8), dos comentários de 11/11 e 12/11 da issue, da #271 e do ADR 0006. Rigor
alto: define dado gravado, RLS e o caminho do dinheiro. A migration é a fonte se este texto e ela
divergirem: `0050`, em `supabase/migrations/`.

Nenhum preço, crédito por plano, custo de ação nem percentual de sobra entra aqui: esses números são
do banco, escritos pelo admin da plataforma em `/teacher/plans`, e ficam fora do repositório
(ADR 0006).

## O que esta parte cobre

- O saldo de créditos da pessoa no Chelsea St: o teste grátis, o mês do plano, a sobra, o consumo, o
  estorno de um consumo e a anulação quando a cobrança é estornada.
- O custo de cada ação em créditos, por marca.
- O cálculo do reembolso proporcional (CDC art. 49).
- Ficam com outras issues:
  - o saldo da organização (empresas), os modos de repartir, a transferência e o aviso de 80%: #299;
  - o pacote avulso, só para quem tem plano: #298;
  - o botão do reembolso no cancelamento: #297;
  - a reserva e o cancelamento da aula: #276;
  - o selo Fundador, que muda o custo: #292;
  - o cadeado e o upgrade: #274;
  - a sessão ao vivo, que debita por minuto: a issue do Robin ao vivo.

## As decisões do plano (12/11)

- **Q1 · Só o saldo da pessoa.** O razão já nasce com `organization_id`; a #299 acrescenta o dono
  "organização".
- **Q2 · Pacote avulso fora.** A #298 acrescenta o tipo `pack` ao razão.
- **Q3 · Crédito inteiro.** A sessão ao vivo debita o custo de um minuto no começo de cada minuto e
  confere a cada 10 s (o batimento). Sem saldo para o minuto seguinte, ela para em até 10 s.
- **Q4 · O teto da sobra mora no plano:** `plans.carryover_percent`, de 0 a 100. Começa em 0 (sem
  sobra) até o admin escrever outro.
- **Q5 · Os créditos do mês ficam gravados na assinatura:** `subscriptions.monthly_credits`, copiado
  do plano quando a assinatura nasce. Mudar o plano depois vale só para as assinaturas novas.
- **Q6 · O atraso não congela o saldo.** Os créditos vencem no fim do ciclo como sempre; a sobra é
  feita enquanto a assinatura não está cancelada; a cobrança paga no atraso concede o mês uma vez.
- **Q7 · O reembolso:** esta parte entrega o cálculo e a anulação quando a Asaas diz que o estorno
  foi feito. O botão é da #297.
- **Q8 · O estorno de um débito cujo lote já venceu** volta como lote novo, vencendo com o lote do
  mês corrente dela, ou em um mês se ela não tiver nenhum.

## Lotes num razão só

`credit_entries` é a única tabela de saldo. Só recebe linhas novas: nenhuma é editada nem apagada,
nem pelo `postgres` (`credit_entries_append_only`).

- Uma concessão abre um **lote**: uma linha com valor positivo e `expires_at`. Abrem lote: `trial`
  (o teste), `plan` (o mês), `carryover` (a sobra) e `refund` quando o lote de origem já venceu.
- Toda outra linha aponta para o seu lote (`lot_id`): `debit` (consumo), `refund` (estorno de um
  débito), `expire` (o que restou quando o lote venceu) e `void` (o que restou quando a cobrança que o
  pagou foi estornada ou apagada).
- **Lote vivo** é o que tem `expires_at` no futuro. O saldo (`credits_balance`) é a soma das linhas
  dos lotes vivos: um lote vencido sai da soma na hora, tenha a rotina rodado ou não.
- Depois que a rotina fecha um lote vencido, a soma de todas as linhas da pessoa é igual ao saldo.
- Um lote nunca fica abaixo de zero (`credit_entries_lot_not_negative`), e uma linha só aponta para
  um lote da mesma pessoa e da mesma organização (`credit_entries_lot_is_hers`).
- A organização de toda linha é a da assinatura que concedeu o lote.

## O custo de cada ação

- `credit_costs`: uma linha por marca e ação. As ações são `voice_minute` (minuto de voz),
  `video_minute` (minuto de vídeo) e `teacher_lesson` (aula com professor), as mesmas de
  `CREDIT_ACTIONS` em `src/lib/credits/actions.ts`.
- Uma ação sem linha na marca não se vende ali (`credit_cost_known`).
- O admin da plataforma escreve em `/teacher/plans`, seção "Custos em créditos". Todos leem: o custo
  faz parte da oferta pública, como o preço.
- O custo é lido de um lugar só, `credit_cost`, e nunca de uma constante. A pessoa lê o próprio; o de
  outra pessoa é recusado, porque com o selo Fundador (#292) ele diria quem é fundadora.

## Quando os créditos entram

- **O teste:** quando uma assinatura com teste passa a rodar, os créditos do teste do plano entram
  num lote que vence à 0h (São Paulo) do dia da primeira cobrança. Uma vez por assinatura. Se esse
  dia já passou (eventos atrasados), nada entra.
- **O mês:** o mês `k` de uma cobrança começa à 0h de `vencimento + k meses`, em São Paulo, e vence
  um mês depois. Mensal: só o mês 0. Anual: os meses 0 a 11, contados do vencimento original (o mês
  mais curto segura o dia).
  - Um mês é concedido quando já começou e a cobrança está paga (`CONFIRMED`, `RECEIVED`,
    `RECEIVED_IN_CASH`), não foi apagada e não tem estorno.
  - Quem concede primeiro é o webhook ou a rotina diária; a concessão acontece uma vez por cobrança e
    mês (`credit_entries_one_grant_per_period`), então o evento repetido não concede duas vezes.
  - Um Pix pago antes do vencimento concede no dia do vencimento, pela rotina: o mês seguinte nunca se
    soma ao atual.
  - No anual, a rotina concede cada mês no dia em que ele começa, até umas 9h depois da meia-noite
    (o Vercel Hobby roda a rotina uma vez por dia).

## Vencimento e sobra

- A rotina fecha cada lote vencido: uma linha `expire` com o que restou (zero também, para marcar
  fechado).
- De um lote do mês, ela abre a sobra: o menor entre o que restou e a porcentagem do plano sobre os
  créditos daquele mês, arredondada para baixo. A sobra vence um mês depois do lote de origem.
- Sobra de sobra não passa; teste e estorno também não.
- Só há sobra se a assinatura não está cancelada, ou se o que ela pagou cobre o mês seguinte.
- O débito e o estorno fecham os lotes vencidos da pessoa antes de contar, então a sobra nunca falta
  para quem gasta entre a meia-noite e a rotina. Só a tela pode mostrar o saldo sem a sobra nessas
  horas.

## O consumo

- Só no servidor, nunca pelo navegador. `credit_debit(pessoa, ação, quantidade, referência)`:
  - trava a pessoa (`pg_advisory_xact_lock`): dois débitos dela esperam um pelo outro, e o segundo vê
    o saldo que o primeiro deixou;
  - fecha os lotes vencidos dela;
  - calcula custo × quantidade;
  - recusa a referência já usada (`credit_debit_reference_used`), a ação sem custo na marca
    (`credit_cost_known`) e o saldo que não cobre (`credits_not_negative`): o saldo nunca fica
    negativo;
  - consome os lotes vivos na ordem do vencimento, o mais próximo primeiro, uma linha por lote tocado.
- Ninguém executa o débito por `grant`. Quem chama é outra função `security definer`, dentro da
  própria transação: a reserva da #276. A sessão ao vivo, quando existir, ganha o `execute` na issue
  dela e chama `credit_debit(pessoa, 'voice_minute', 1, 'session:<id>:minute:<n>')` no começo de cada
  minuto.
- O débito não confere o plano: o cadeado é da #274.

## O estorno de um débito

- Para a aula cancelada (#276): `credit_refund(pessoa, referência)` devolve cada débito daquela
  referência, uma vez (`credit_entries_once_per_entry`). Não havendo o que devolver, devolve 0.
- Volta para o lote de onde saiu, enquanto ele vive. Se o lote já venceu, abre um lote novo que vence
  com o lote do mês corrente dela, ou em um mês se ela não tiver nenhum (Q8).

## Cobrança estornada ou apagada

- O que resta de cada lote vivo da cobrança (os meses e a sobra deles) é anulado (`void`), uma vez.
- O que já foi gasto fica gasto, e os meses que ainda não começaram não são concedidos.
- Um estorno pedido e ainda não feito não anula nada: só o estorno que a Asaas dá como feito, a
  cobrança `REFUNDED` ou apagada.
- Se o estorno for revertido na Asaas, o lote anulado não volta sozinho. O ajuste manual do admin não
  existe ainda.

## O reembolso proporcional (CDC art. 49)

`credit_refund_quote(cobrança)` dá os créditos que a cobrança pagou, os não usados (o que resta nos
lotes vivos dela, mais os meses do anual ainda não começados) e o valor em centavos:
`ceil(valor × não usados ÷ créditos da cobrança)`. O arredondamento nunca vai contra a pessoa. Uma
cobrança de plano sem créditos devolve o valor inteiro; uma cobrança que não concede devolve 0.

## O que se grava (0050)

| Tabela / coluna                 | O quê                                     | Quem lê                     |
| ------------------------------- | ----------------------------------------- | --------------------------- |
| `credit_entries`                | o razão: lotes e as linhas de cada lote   | ela e o admin da plataforma |
| `credit_costs`                  | o custo de cada ação, por marca           | todos; escreve o admin      |
| `plans.carryover_percent`       | o teto da sobra, em % dos créditos do mês | como `plans`                |
| `subscriptions.monthly_credits` | os créditos do mês, copiados do plano     | como `subscriptions`        |

As funções:

| Função                  | O que faz                                                   | Quem executa                     |
| ----------------------- | ----------------------------------------------------------- | -------------------------------- |
| `credits_balance`       | o saldo da pessoa                                           | `authenticated` (pela RLS dela)  |
| `credit_live_lots`      | cada lote vivo, o que resta e quando vence                  | `authenticated` (pela RLS dela)  |
| `credit_cost`           | o custo de uma ação para a pessoa                           | `authenticated`, `service_role`  |
| `credit_debit`          | o consumo                                                   | ninguém: outra função chama      |
| `credit_refund`         | o estorno de um consumo                                     | ninguém: outra função chama      |
| `credit_settle_payment` | concede o mês ou anula, a partir da cobrança gravada        | `service_role` (o webhook)       |
| `credit_daily`          | concede os meses que começaram, anula, fecha e abre a sobra | `service_role` (a rotina diária) |
| `credit_refund_quote`   | o reembolso proporcional                                    | `service_role`                   |

## No app

- **O webhook:** depois de gravar as cobranças da assinatura, o `sync` chama `credit_settle_payment`
  para cada cobrança lida, paga ou não. O banco decide entre conceder, anular ou nada, a partir da
  cobrança que acabou de gravar, nunca do corpo do evento. Uma falha passageira responde 500 e a
  reentrega é segura, porque tudo é idempotente.
- **A rotina diária** (`/api/billing/daily`): roda `credit_daily` sempre, também sem a Asaas, e depois
  o atraso, como antes. Uma falha dos créditos é registrada e não impede o atraso.
- **`/teacher/plans`:** o campo do teto da sobra em cada plano e a seção "Custos em créditos".
- **`/dashboard/plano`:** o cartão "Seus créditos", com o saldo e quantos vencem na data mais
  próxima.

## Riscos

- Um erro de concessão não se corrige editando: a correção é um lançamento compensatório, e hoje
  isso seria uma migration (não há função de ajuste do admin).
- A tela pode mostrar o saldo sem a sobra entre a 0h e a rotina das 9h.
- O teste de débito concorrente usa `dblink`, criado só no banco do teste, nunca por migration.
