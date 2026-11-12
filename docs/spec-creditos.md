# Créditos: o razão de lançamentos

Escrita em 12/11/2026 (#273), a partir do plano aprovado pelo Luiz no mesmo dia (com a recomendação
de cada pergunta, Q1 a Q8), da mudança no vencimento que o Luiz aprovou na mesma noite (comentário
"Mudança no plano aprovado: vencimento dos créditos" da issue), dos comentários de 11/11 e 12/11, da
#271 e do ADR 0006. Rigor alto: define dado gravado, RLS e o caminho do dinheiro. A migration é a
fonte se este texto e ela divergirem: `0050`, em `supabase/migrations/`.

Nenhum preço, crédito por plano, custo de ação, teto nem prazo entra aqui: esses números são do
banco, escritos pelo admin da plataforma em `/teacher/plans`, e ficam fora do repositório
(ADR 0006).

## O que esta parte cobre

- O saldo de créditos da pessoa no Chelsea St: o teste grátis, o mês do plano, o teto do saldo, o
  vencimento depois do cancelamento, o consumo, o estorno de um consumo e a anulação quando o
  dinheiro da cobrança volta.
- O custo de cada ação em créditos, por marca.
- O cálculo do reembolso proporcional (CDC art. 49).
- Ficam com outras issues:
  - o saldo da organização (empresas), os modos de repartir, a transferência e o aviso de 80%: #299;
  - o pacote avulso, só para quem tem plano: #298;
  - o botão do reembolso no cancelamento: #297;
  - a reserva e o cancelamento da aula: #276;
  - o selo Fundador, que muda o custo: #292;
  - o cadeado e o upgrade: #274;
  - o acerto mensal entre Chelsea St e GrifoAI dos créditos pagos a uma e gastos na outra: #307 (o
    razão já guarda a cobrança de cada lote);
  - a sessão ao vivo, que debita por minuto: a issue do Robin ao vivo.

## As decisões (12/11)

- **Q1 · Só o saldo da pessoa.** O razão já nasce com `organization_id`; a #299 acrescenta o dono
  "organização".
- **Q2 · Pacote avulso fora.** A #298 acrescenta o tipo `pack` ao razão.
- **Q3 · Crédito inteiro.** A sessão ao vivo debita o custo de um minuto no começo de cada minuto e
  confere a cada 10 s (o batimento). Sem saldo para o minuto seguinte, ela para em até 10 s.
- **Q4, substituída na mesma noite:** não há sobra nem vencimento no fim do ciclo. Entram o teto do
  saldo e o prazo depois do cancelamento (abaixo). `carryover_percent` saiu.
- **Q5 · Os créditos do mês ficam gravados na assinatura:** `subscriptions.monthly_credits`, copiado
  do plano quando a assinatura nasce, e com ele o teto e os dias depois do cancelamento
  (`subscriptions.credit_ceiling_months`, `subscriptions.credit_days_after_cancel`). Mudar o plano
  depois vale só para as assinaturas novas.
- **Q6 · O atraso não congela o saldo.** Assinatura em atraso continua viva: os créditos não vencem,
  e a cobrança paga no atraso concede o mês uma vez.
- **Q7 · O reembolso:** esta parte entrega o cálculo e a anulação quando a Asaas diz que o estorno
  foi feito. O botão é da #297.
- **Q8 · O estorno de um débito cujo lote já venceu** volta como lote novo: sem vencimento enquanto a
  assinatura dela está viva, vencendo em um mês se não está.

## Lotes num razão só

`credit_entries` é a única tabela de saldo. Só recebe linhas novas: nenhuma é editada nem apagada,
nem pelo `postgres` (`credit_entries_append_only`).

- Uma concessão abre um **lote**. Abrem lote: `trial` (o teste), `plan` (o mês) e `refund` quando o
  lote de origem já venceu.
- Toda outra linha aponta para o seu lote (`lot_id`): `debit` (consumo), `refund` (estorno de um
  débito), `expire` (o que restou quando o lote venceu) e `void` (o que restou quando o dinheiro da
  cobrança que o pagou voltou).
- O saldo (`credits_balance`) é a soma das linhas dos lotes vivos. Um lote vencido sai da soma na
  hora, tenha a rotina rodado ou não; depois que a rotina o fecha, a soma de todas as linhas da
  pessoa é igual ao saldo.
- Um lote nunca fica abaixo de zero (`credit_entries_lot_not_negative`), e uma linha só aponta para
  um lote da mesma pessoa e da mesma organização (`credit_entries_lot_is_hers`).
- A organização de toda linha é a da assinatura que concedeu o lote.

## Quando um crédito vence

- **Enquanto a assinatura está viva, o crédito do plano não vence.** O lote do mês nasce sem
  vencimento. Viva é em teste, aguardando o primeiro pagamento, ativa ou em atraso (Q6); o checkout
  não terminado não conta.
- **O teto do saldo:** `plans.credit_ceiling_months`, em meses de créditos do plano (de 1 a 60). A
  concessão do mês concede só até o teto: o que passaria dele não é concedido, e o mês fica decidido
  (um lote de 0 quando o saldo já está no teto).
- **Depois do cancelamento:** os lotes vivos vencem à 0h (São Paulo) do dia seguinte ao fim do
  período pago (`paid_through`) mais `plans.credit_days_after_cancel` dias (de 0 a 365). Vale o fim
  mais tardio entre as assinaturas canceladas que foram pagas: uma assinatura aberta e nunca paga, ou
  uma mais curta depois de uma longa, não mexe no prazo. Sem nenhuma paga (ou com os dias tomados de
  volta por um estorno), conta o dia do último cancelamento de uma que rodou. Um checkout que nunca
  rodou (trocado, expirado, teste recusado) não mexe nesse prazo.
- **Voltar a assinar dentro do prazo** devolve o vencimento indefinido aos lotes que restam. Depois
  do prazo, o que venceu fica vencido: antes de uma assinatura nova passar a rodar, os lotes vencidos
  dela são fechados (`subscriptions_close_ended_credits`).
- **O teste** vence à 0h do dia da primeira cobrança, como antes.
- Como nenhuma linha é editada, esse vencimento não fica escrito no lote: ele é lido das assinaturas
  dela (`credit_deadline`). O lote só guarda o vencimento próprio (o do teste, o do estorno sem
  assinatura).
- O teto e o prazo são do plano, copiados para a assinatura quando ela nasce, como os créditos do
  mês (Q5; resposta do Luiz à pergunta 9 da PR #304): mudá-los em `/teacher/plans` vale só para as
  assinaturas novas. A concessão lê o teto da assinatura, e o vencimento lê os dias da assinatura
  cancelada.

## O custo de cada ação

- `credit_costs`: uma linha por marca e ação. As ações são `voice_minute` (minuto de voz),
  `video_minute` (minuto de vídeo) e `teacher_lesson` (aula com professor), as mesmas de
  `CREDIT_ACTIONS` em `src/lib/credits/actions.ts`.
- Uma ação sem linha na marca não se vende ali (`credit_cost_known`).
- O admin da plataforma escreve em `/teacher/plans`, seção "Custos em créditos". Todos leem: o custo
  faz parte da oferta pública, como o preço. Um custo salvo muda, mas não é apagado por lá (não há
  política de `delete`).
- O custo é lido de um lugar só, `credit_cost`, e nunca de uma constante. A pessoa lê o próprio; o de
  outra pessoa é recusado, porque com o selo Fundador (#292) ele diria quem é fundadora.

## Quando os créditos entram

- **O teste:** quando uma assinatura com teste passa a rodar, os créditos do teste do plano entram
  num lote que vence à 0h (São Paulo) do dia da primeira cobrança. Uma vez por assinatura. Se esse
  dia já passou (eventos atrasados), nada entra.
- **O mês:** o mês `k` de uma cobrança começa à 0h de `vencimento + k meses`, em São Paulo. Mensal:
  só o mês 0. Anual: os meses 0 a 11, contados do vencimento original (o mês mais curto segura o
  dia).
  - Todo mês que já começou é concedido, se a cobrança está paga (`CONFIRMED`, `RECEIVED`,
    `RECEIVED_IN_CASH`), não foi apagada e não tem estorno. O mês ainda não começado espera.
  - Quem concede primeiro é o webhook, a rotina diária ou o próprio débito; a concessão acontece uma
    vez por cobrança e mês (`credit_entries_one_grant_per_period`), então o evento repetido não
    concede duas vezes.
  - Um Pix pago antes do vencimento concede no dia do vencimento: o mês seguinte nunca se soma ao
    atual antes da hora.

## O consumo

- Só no servidor, nunca pelo navegador. `credit_debit(pessoa, ação, quantidade, referência)`:
  - trava a pessoa (`pg_advisory_xact_lock`): dois débitos dela esperam um pelo outro, e o segundo vê
    o saldo que o primeiro deixou;
  - concede os meses dela que já começaram e ninguém concedeu ainda (um mês pago antes, entre a
    meia-noite e a rotina), e fecha os lotes vencidos dela;
  - calcula custo × quantidade;
  - recusa a referência já usada (`credit_debit_reference_used`), a ação sem custo na marca
    (`credit_cost_known`) e o saldo que não cobre (`credits_not_negative`): o saldo nunca fica
    negativo;
  - consome primeiro o lote que vence antes, os sem vencimento por último, os mais antigos primeiro
    (`credit_entries.seq`, a ordem em que as linhas foram escritas); uma linha por lote tocado.
- Ninguém executa o débito por `grant`. Quem chama é outra função `security definer`, dentro da
  própria transação: a reserva da #276. A sessão ao vivo, quando existir, ganha o `execute` na issue
  dela e chama `credit_debit(pessoa, 'voice_minute', 1, 'session:<id>:minute:<n>')` no começo de cada
  minuto.
- O débito não confere o plano: o cadeado é da #274.

## O estorno de um débito

- Para a aula cancelada (#276): `credit_refund(pessoa, referência)` devolve cada débito daquela
  referência, uma vez (`credit_entries_once_per_entry`). Não havendo o que devolver, devolve 0.
- Volta para o lote de onde saiu, enquanto ele vive. Se o lote já venceu, abre um lote novo (Q8).
- O débito de um lote anulado, ou cuja cobrança foi estornada ou contestada (mesmo que o lote tenha
  vencido antes), não volta: aqueles créditos saíram com o dinheiro.

## Cobrança estornada, contestada ou apagada

- O que resta de cada lote da cobrança ainda não fechado é anulado (`void`), uma vez, mesmo que o
  cancelamento que veio com o estorno já o tenha feito vencer.
- O que já foi gasto fica gasto, e os meses que ainda não começaram não são concedidos.
- Um estorno pedido e ainda não feito não anula nada: só o estorno que a Asaas dá como feito, a
  cobrança `REFUNDED`, a contestação no cartão (`CHARGEBACK_REQUESTED`, `CHARGEBACK_DISPUTE`,
  `AWAITING_CHARGEBACK_REVERSAL`) ou a cobrança apagada.
- Se a contestação for ganha ou o estorno revertido na Asaas, o lote anulado não volta sozinho. O
  ajuste manual do admin não existe ainda.
- Uma cobrança estornada depois que a assinatura foi cancelada ainda não chega ao banco: #302.

## O reembolso proporcional (CDC art. 49)

`credit_refund_quote(cobrança)` dá os créditos que a cobrança pagou, os não usados (o que resta nos
lotes vivos dela, o que o teto cortou dos meses dela, mais os meses ainda não concedidos) e o valor em centavos:
`ceil(valor × não usados ÷ créditos da cobrança)`. O arredondamento nunca vai contra a pessoa. Uma
cobrança de plano sem créditos devolve o valor inteiro; uma cobrança que não concede devolve 0.

## O que se grava (0050)

| Tabela / coluna                                                                 | O quê                                                   | Quem lê                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| `credit_entries`                                                                | o razão: lotes e as linhas de cada lote                 | ela e o admin da plataforma |
| `credit_costs`                                                                  | o custo de cada ação, por marca                         | todos; escreve o admin      |
| `plans.credit_ceiling_months`                                                   | o teto do saldo, em meses de créditos do plano          | como `plans`                |
| `plans.credit_days_after_cancel`                                                | quantos dias os créditos valem depois do fim do período | como `plans`                |
| `subscriptions.monthly_credits`                                                 | os créditos do mês, copiados do plano                   | como `subscriptions`        |
| `subscriptions.credit_ceiling_months`, `subscriptions.credit_days_after_cancel` | o teto e os dias, copiados do plano                     | como `subscriptions`        |

As funções:

| Função                  | O que faz                                                       | Quem executa                     |
| ----------------------- | --------------------------------------------------------------- | -------------------------------- |
| `credits_balance`       | o saldo da pessoa                                               | `authenticated`, `service_role`  |
| `credit_live_lots`      | cada lote vivo, o que resta e quando vence (nulo: não vence)    | `authenticated`, `service_role`  |
| `credit_cost`           | o custo de uma ação para a pessoa                               | `authenticated`, `service_role`  |
| `credit_debit`          | o consumo                                                       | ninguém: outra função chama      |
| `credit_refund`         | o estorno de um consumo                                         | ninguém: outra função chama      |
| `credit_settle_payment` | concede os meses ou anula, a partir da cobrança gravada         | `service_role` (o webhook)       |
| `credit_daily`          | concede os meses que começaram, anula e fecha os lotes vencidos | `service_role` (a rotina diária) |
| `credit_refund_quote`   | o reembolso proporcional                                        | `service_role`                   |

Saldo, lotes e custo recusam (42501) quem pede os de outra pessoa, salvo o admin da plataforma e a
`service_role`.

## No app

- **O webhook:** depois de gravar as cobranças da assinatura, o `sync` chama `credit_settle_payment`
  para cada cobrança lida, paga ou não. O banco decide entre conceder, anular ou nada, a partir da
  cobrança que acabou de gravar, nunca do corpo do evento. Uma falha passageira responde 500 e a
  reentrega é segura, porque tudo é idempotente.
- **A rotina diária** (`/api/billing/daily`): roda `credit_daily` sempre, também sem a Asaas, e depois
  o atraso, como antes. Uma falha dos créditos é registrada e não impede o atraso.
- **`/teacher/plans`:** o teto do saldo e os dias depois do cancelamento em cada plano, e a seção
  "Custos em créditos".
- **`/dashboard/plano`:** o cartão "Seus créditos", com o saldo, quantos vencem na data mais próxima
  e o aviso de que os créditos do plano não vencem enquanto a assinatura estiver ativa.

## Riscos

- Um erro de concessão não se corrige editando: a correção é um lançamento compensatório, e hoje
  isso seria uma migration (não há função de ajuste do admin).
- A tela pode mostrar o saldo sem o mês pago antes entre a 0h e a rotina das 9h. O débito não erra:
  concede e fecha antes de contar.
- O mês decidido no teto fica decidido: quem está no teto quando o mês começa não recebe aquele mês
  depois, mesmo que gaste.
- A rotina roda numa transação só, e a trava de cada pessoa fica presa até ela terminar: um débito
  dessa pessoa espera esses instantes.
- O teste de débito concorrente usa `dblink`, criado só no banco do teste, nunca por migration.
