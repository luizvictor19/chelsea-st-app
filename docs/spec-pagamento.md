# Pagamento: a assinatura do Chelsea St pela Asaas

Escrita em 12/11/2026 (#72), a partir do plano aprovado pelo Luiz no mesmo dia, das notas de 06/11,
07/11, 11/11 e 12/11 da issue, do ADR 0006 e da documentação da Asaas lida em 12/11
(`docs.asaas.com`), conferida no sandbox no mesmo dia. Rigor alto: define dado gravado, RLS e o
caminho do dinheiro. A migration é a fonte se este texto e ela divergirem: `0049`, em
`supabase/migrations/`.

Nenhum preço, crédito por plano, duração de teste nem desconto entra aqui: esses números são do
banco, escritos pelo admin da plataforma em `/teacher/plans`, e ficam fora do repositório
(ADR 0006).

## O que esta parte cobre

- A assinatura do Chelsea St, por pessoa, no cartão ou no Pix comum.
- As empresas da GrifoAI não pagam pelo app: a cobrança delas sai na fatura do contrato de
  automação (#274), até a #282. A cobrança recusa quem não é aluna de uma organização da marca
  `chelsea-st`.
- Ficam com as sub-issues:
  - créditos, pacote avulso e reembolso proporcional: #273;
  - cadeado, upgrade, downgrade e degustação: #274;
  - cadastro sem convite: #275;
  - Pix Automático: #281.

## As decisões do plano (12/11)

- **Q1 · O cartão é digitado no Checkout da Asaas,** hospedado. O número nunca passa pelo nosso
  servidor, e o escopo PCI fica com a Asaas.
- **Q2 · Só a service role grava o estado da cobrança,** por dez funções `security definer` que só
  ela executa. Nenhuma tabela de cobrança dá privilégio à service role: as funções são a única
  porta. A pessoa lê as próprias linhas por RLS e não grava nenhuma.
- **Q3 · O catálogo é a tabela `plans`,** com preço mensal e anual, créditos do mês, minutos da
  trilha por dia, o que o plano abre, dias e créditos do teste. Quem escreve é o admin da plataforma,
  em `/teacher/plans`.
- **Q4 · Um teste por CPF.** O app guarda só o HMAC do CPF (chave `BILLING_CPF_KEY`), único em
  `billing_customers`. Uma pessoa por CPF, um CPF por pessoa, um teste por pessoa. Um teste por
  cartão não dá para travar: a Asaas devolve só os 4 últimos dígitos e a bandeira.
- **Q5 · Atraso de 7 dias, sem cancelar antes.** Nova tentativa e e-mail nos dias 1, 3, 5 e 7 do
  atraso; no dia 7 sem pagamento, a assinatura é cancelada e um último e-mail avisa (Luiz, 12/11).

## Entrada

1. Em `/dashboard/plano`, a pessoa escolhe o plano, o ciclo (mensal ou anual) e a forma (cartão ou
   Pix), e informa nome e CPF.
2. O app confere o CPF (dígitos verificadores) e grava o HMAC. Um CPF de outra conta, ou outro CPF na
   mesma conta, é recusado com a frase do caso.
3. **O teste grátis** vale para quem ainda não teve um: os dias de teste do plano. O dia da
   assinatura é o 1º dia do teste, e a primeira cobrança é no dia da assinatura mais os dias do
   teste, no fuso de São Paulo. Quem já teve o teste assina sem ele, com a primeira cobrança no dia.
4. **Cartão:** o app abre um Checkout da Asaas sem cliente (a página pede os dados) e grava a
   assinatura como `pending`, ligada ao checkout. A pessoa digita o cartão lá.
   - A Asaas valida o cartão, cria a assinatura com a primeira cobrança no dia calculado e manda
     `SUBSCRIPTION_CREATED`.
   - O webhook lê a assinatura (`checkoutSession` liga ao checkout) e o cliente que a Asaas criou.
   - Se o CPF digitado no checkout não for o declarado e a assinatura tiver teste, ela é apagada na
     Asaas antes de qualquer cobrança e fica cancelada como `trial_used`: o teste foi dado ao CPF
     declarado.
   - O checkout espera 60 minutos. Expirado ou cancelado sem terminar, a linha `pending` vira
     `checkout_expired`. Um checkout novo da mesma pessoa troca o antigo (`replaced`).
5. **Pix:** o app cria o cliente e a assinatura Pix na Asaas na hora. A cobrança do primeiro
   vencimento já nasce, e a tela mostra o QR e o "copia e cola".
6. A volta do navegador nunca marca nada como pago. Só o webhook, depois de ler a Asaas.

## Estados da assinatura

Recalculados a cada evento a partir do que a Asaas guarda agora, nunca do corpo do evento
(`src/lib/billing/state.ts`):

| Estado     | Quando                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| `pending`  | o checkout do cartão foi aberto e não terminou                                          |
| `trialing` | tem teste e nenhuma cobrança paga ainda, inclusive no dia da primeira até ela confirmar |
| `active`   | uma cobrança foi confirmada ou recebida, ou não há teste                                |
| `past_due` | uma cobrança venceu sem pagamento; conta da mais antiga                                 |
| `canceled` | apagada ou inativada na Asaas, cancelada pela pessoa, pelo atraso ou pelo checkout      |

- `paid_through` é o último dia que as cobranças pagas cobrem: o vencimento da última paga mais um
  ciclo, menos um dia. O mês mais curto segura o dia (31/01 vai a 28/02).
- Uma assinatura cancelada nunca volta. Uma pessoa tem no máximo uma assinatura viva.
- Cobrança estornada ou apagada não paga nada.

## Cancelar

- Pela pessoa, em `/dashboard/plano`, atrás de uma segunda confirmação com o botão "Sim, cancelar a
  assinatura".
- Na Asaas, a assinatura é apagada, e com ela as cobranças pendentes e vencidas. As pagas ficam.
- No teste, nada foi cobrado. Depois do teste, o acesso vai até `paid_through`.
- O reembolso proporcional ao saldo de créditos (CDC art. 49) é da #273, pelo estorno parcial que o
  provedor já tem (`refund`).

## Atraso (Q5)

A rotina diária `/api/billing/daily` roda pelo Vercel Cron às 12h UTC (09h BRT), com
`Authorization: Bearer CRON_SECRET`.

- O dia 1 do atraso é o dia seguinte ao vencimento. Os passos são nos dias 1, 3, 5 e 7.
- Um dia que a rotina perde não se perde: ela dá o passo mais recente que ainda não deu.
- Cada passo de uma cobrança é reservado no banco antes de agir (`overdue_steps`), então a rotina
  rodando duas vezes não cobra nem escreve duas vezes.
- **Cartão:** cobra de novo a mesma cobrança com o cartão salvo dela
  (`POST /v3/payments/{id}/payWithCreditCard` com `creditCardToken`). Passou: sem e-mail.
- **Pix:** não há o que cobrar; o passo é o e-mail com o link da fatura.
- **Dia 7 sem pagamento:** a assinatura é apagada na Asaas, fica cancelada como `overdue`, e o último
  e-mail avisa.
- Os e-mails saem pela Resend, com a chave própria do app (`RESEND_API_KEY`), separada da do SMTP do
  Supabase.
- Cobrança em atraso não concede créditos. A paga no atraso concede uma vez, quando confirma (#273).

## O webhook

`POST /api/asaas/webhook` (`src/lib/billing/webhook.ts`). A Asaas manda cada evento pelo menos uma
vez, com o mesmo `id` nas reentregas; só o HTTP 200 conta como entregue; espera 10 s; depois de 15
falhas seguidas, a fila para (os eventos ficam guardados por até 14 dias).

- O cabeçalho `asaas-access-token` é comparado em tempo constante com `ASAAS_WEBHOOK_TOKEN`. Sem ele,
  ou errado: 401, nada é lido.
- O evento é guardado pelo `id` em `billing_events`. Um evento já terminado responde 200 na hora.
- O corpo só diz que algo mudou. O app consulta a assinatura e as cobranças na Asaas e grava o que
  elas dizem. Um evento atrasado, repetido ou forjado não muda o estado.
- O que não é nosso, ou não se lê, fica guardado com o motivo e responde 200: assim não conta para as
  15 falhas.
- Só a falha passageira (a Asaas ou o banco fora) responde 500, sem terminar o evento, para a Asaas
  entregar de novo.
- A fila é `SEQUENTIALLY` (ordem preservada), cadastrada por `scripts/asaas-webhook.ts`.
- O proxy que exige login não roda nas rotas de `/api/asaas/` e `/api/billing/`.

## O que se grava (0049)

| Tabela              | O quê                                           | Quem lê                     |
| ------------------- | ----------------------------------------------- | --------------------------- |
| `plans`             | o catálogo de cada marca                        | ativos: todos; todos: admin |
| `billing_customers` | a pessoa, o HMAC do CPF, quando o teste começou | ela e o admin da plataforma |
| `subscriptions`     | a assinatura e a última leitura dela na Asaas   | ela e o admin da plataforma |
| `payments`          | cada cobrança, como o app a leu por último      | ela e o admin da plataforma |
| `billing_events`    | cada evento do webhook, uma vez                 | ninguém pela API            |
| `overdue_steps`     | os passos da rotina de atraso                   | ninguém pela API            |

- O CPF em claro fica só na Asaas.
- `payments.asaas_payment_id` é a chave pela qual a #273 concede os créditos de um ciclo, uma vez.
- Um preço mudado em `plans` vale para assinaturas novas; a que existe guarda o valor dela na Asaas.
- Um plano sai de venda, nunca é apagado.

## Ambientes

- O endereço da Asaas sai do prefixo da chave: `$aact_hmlg_` é o sandbox, `$aact_prod_` a produção.
  No `.env.local`, a chave vai como `ASAAS_API_KEY=\$aact_...`: sem a barra, o Next lê `$aact_` como
  variável e a chave fica vazia (medido em 12/11). O app diz isso no erro.
- A Vercel Production recusa a chave do sandbox: o banco é um só, o de produção, e evento de sandbox
  não entra nele.
- O teste de ponta a ponta com o sandbox roda no Supabase local (`supabase start`), com um túnel
  (`cloudflared`) até o servidor local, e o webhook do sandbox apontado para o túnel.
- A preview da Vercel não tem chave paga.
- Antes do CNPJ, a produção não tem chave da Asaas, e a tela diz que a assinatura ainda não abriu.
- `scripts/asaas-sandbox-smoke.ts` passa o adaptador pelo sandbox de verdade e grava cada resposta em
  JSONL (`fixtures/asaas/`, fora do git).

## O que a Asaas mostrou no sandbox (12/11)

- A assinatura no cartão com a primeira cobrança 14 dias à frente é criada na hora, com essa
  cobrança `PENDING` no dia e o token do cartão nela (`creditCard.creditCardToken`).
- O Checkout com um cliente já criado exige o endereço inteiro desse cliente. Sem cliente, a página
  pede tudo. Por isso o app abre o checkout sem cliente.
- Uma assinatura Pix numa conta sem chave Pix volta como boleto. O app recusa isso, para nunca vender
  boleto como Pix: a conta precisa de uma chave Pix cadastrada.

## Pendências

- **O CNPJ:** a conta de produção nasce no CNPJ definitivo (não se troca de um CNPJ para outro), e só
  conta de pessoa jurídica emite nota fiscal e tem Pix Automático (#281).
- **Tokenização em produção:** depende de liberação da Asaas (até 4 dias úteis). Sem ela, a nova
  tentativa no cartão do atraso e o upgrade em um toque (#274) não funcionam em produção.
- **Nota fiscal:** automática pela Asaas na conta de pessoa jurídica, configurada quando ela existir.
- **A taxa do Pix:** conferir no menu Taxas da conta; o regulamento e a página de preços divergem.
- **Sem resposta oficial (central de ajuda fechada à leitura automática):** se a Asaas tenta de novo
  sozinha depois do cartão recusado, e o prazo do estorno.
