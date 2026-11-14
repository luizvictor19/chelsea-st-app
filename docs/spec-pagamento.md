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
  - créditos e o cálculo do reembolso proporcional: #273, em `docs/spec-creditos.md`; pacote
    avulso: #298; botão do reembolso: #297;
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
| `awaiting` | sem teste, e a primeira cobrança ainda não foi paga; nada abre antes do pagamento       |
| `active`   | uma cobrança foi confirmada ou recebida                                                 |
| `past_due` | uma cobrança venceu sem pagamento; conta da mais antiga                                 |
| `canceled` | apagada ou inativada na Asaas, cancelada pela pessoa, pelo atraso ou pelo checkout      |

- `paid_through` é o último dia que as cobranças pagas cobrem: o vencimento da última paga mais um
  ciclo, menos um dia. O mês mais curto segura o dia (31/01 vai a 28/02).
- Uma leitura da Asaas troca `paid_through`: uma cobrança estornada leva os dias dela. Só o
  cancelamento feito pelo app (por ela, pelo atraso) mantém os dias já pagos.
- Uma assinatura cancelada nunca volta. Uma pessoa tem no máximo uma assinatura viva.
- Uma assinatura cancelada aqui nunca roda na Asaas. Se um checkout deixado aberto for pago depois que
  a linha dele foi cancelada (por ela, ou trocada por outra assinatura), o webhook estorna o que ele
  cobrou e apaga a assinatura na Asaas.
- O teste conta como usado assim que a assinatura com teste roda na Asaas, qualquer que seja a
  primeira leitura (em teste, já paga ou já em atraso, quando os eventos chegam tarde).
- Cobrança estornada ou apagada não paga nada.

## Cancelar

- Pela pessoa, em `/dashboard/plano`, atrás de uma segunda confirmação com o botão "Sim, cancelar a
  assinatura".
- Na Asaas, a assinatura é apagada, e com ela as cobranças pendentes e vencidas. As pagas ficam.
- No teste, nada foi cobrado. Depois do teste, o acesso vai até `paid_through`.
- O reembolso proporcional ao saldo de créditos (CDC art. 49): o cálculo é da #273
  (`credit_refund_quote`, `docs/spec-creditos.md`), e o botão é da #297: ver "Desistência" abaixo.
- O estorno de uma cobrança que chega depois do cancelamento ainda é lido e gravado, e anula os
  créditos dela (#302): o webhook grava as cobranças da assinatura com que a linha rodou também
  depois de cancelada, e a linha continua cancelada.

## Desistência (CDC art. 49, 0060, #297)

Plano aprovado pelo Luiz em 14/11 (Q1 B, Q2 A, Q3 A, Q4 A, Q5 A). O texto do art. 49 e do parágrafo
único está no plano da issue; o que se decidiu aqui é do produto, e o que o art. 49 exige fica com o
Luiz.

- **O prazo (Q1 B):** a primeira cobrança paga de uma assinatura, até as 23h59 (São Paulo) do 7º dia
  depois do dia do pagamento. Com teste grátis, conta o pagamento da primeira cobrança, depois do
  teste. Renovação não abre prazo novo.
- **O valor (Q2 A):** proporcional ao que ela não usou, o de `credit_refund_quote` na hora do pedido,
  arredondado para cima. Sem nada usado, é o valor inteiro; um plano sem créditos devolve tudo. A
  correção monetária não entra.
- **Aulas marcadas (Q5 A):** com uma aula marcada que ainda não terminou, o pedido é recusado e a tela
  pede que ela cancele antes, pelo cancelamento de sempre (até 1 h antes, com devolução).
- **O pedido (Q4 A):** `refund_requests`, gravado no banco antes de chamar a Asaas: um aberto por
  pessoa, um não falho por cobrança. Enquanto ele está aberto, nada do saldo dela é gasto
  (`credit_refund_open`): nem aula, nem proposta aceita.
- **A ordem:** o banco reserva o pedido com o valor; o app pede o estorno parcial
  (`POST /v3/payments/{id}/refund`, com `value` e `description`); só com o estorno aceito pela Asaas
  a assinatura é cancelada, como no "Cancelar". Um 4xx da Asaas (sem saldo na conta, estorno cedo
  demais) encerra o pedido como falho e nada é cancelado. Uma resposta perdida (tempo esgotado, 5xx)
  deixa o pedido como pedido; a rotina diária lê a cobrança depois de 30 minutos e decide.
- **Os estados:** `requested` (reservado), `sent` (a Asaas aceitou: `PENDING` ou
  `AWAITING_CRITICAL_ACTION_AUTHORIZATION`), `done` (um estorno do valor em `DONE`), `failed` (a Asaas
  recusou, nunca recebeu, ou todos os estornos do valor ficaram `CANCELLED`). Toda leitura da cobrança
  (o webhook, a rotina) passa os `refunds[]` lidos para `billing_refund_reading`, e o banco decide.
- **Os créditos:** só no `DONE`. A cobrança é gravada com `refunded_cents` e `credit_settle` anula o
  que restava nos lotes dela (0050). Com `done` ou `failed`, o saldo volta a ser gasto.
- **A autorização no painel (Q3 A):** fica ligada na conta de produção. Enquanto o estorno espera, o
  app manda um e-mail para contato@chelsea-st.com com o id da cobrança na Asaas, sem nome nem e-mail
  da pessoa; o Luiz autoriza no painel.
- **O que não muda:** o selo de fundador (nada o liga à assinatura) e o acesso até `paid_through`,
  como em todo cancelamento.
- **Na tela** (`/dashboard/plano`, cartão "Reembolso"): o valor e o último dia, "Desistir e pedir
  reembolso" atrás de uma segunda confirmação que diz o valor e que a assinatura é cancelada, e o
  estado do pedido.

## Atraso (Q5)

A rotina diária `/api/billing/daily` roda pelo Vercel Cron às 12h UTC (09h BRT), com
`Authorization: Bearer CRON_SECRET`.

- O dia 1 do atraso é o dia seguinte ao vencimento. Os passos são nos dias 1, 3, 5 e 7.
- Um dia que a rotina perde não se perde: ela dá o passo mais recente que ainda não deu.
- Cada passo de uma cobrança é reservado no banco antes de agir (`overdue_steps`), então a rotina
  rodando duas vezes não cobra nem escreve duas vezes. Um passo que terminou em erro (a Asaas, o
  banco ou o e-mail fora) é dado de novo na próxima rodada; ele começa lendo a cobrança, então uma
  cobrança paga no meio do caminho não é cobrada de novo.
- **Cartão:** cobra de novo a mesma cobrança com o cartão salvo dela
  (`POST /v3/payments/{id}/payWithCreditCard` com `creditCardToken`). Passou: sem e-mail.
- **Pix:** não há o que cobrar; o passo é o e-mail com o link da fatura.
- **Dia 7 sem pagamento:** a assinatura é apagada na Asaas, fica cancelada como `overdue`, e o último
  e-mail avisa.
- Os e-mails saem pela Resend, com a chave própria do app (`RESEND_API_KEY`), separada da do SMTP do
  Supabase.
- Cobrança em atraso não concede créditos. A paga no atraso concede uma vez, quando confirma
  (`docs/spec-creditos.md`).

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
- Só a falha passageira responde 500, sem terminar o evento, para a Asaas entregar de novo: a Asaas
  com 5xx ou 429, a conexão caída, o tempo esgotado, um erro do banco que não é recusa. Uma recusa do
  banco (constraint, raise), um 4xx da Asaas ou uma resposta ilegível encontram a mesma coisa em toda
  reentrega: ficam guardados com o motivo e respondem 200.
- A fila é `SEQUENTIALLY` (ordem preservada), cadastrada por `scripts/asaas-webhook.ts`.
- O proxy que exige login não roda nas rotas de `/api/asaas/` e `/api/billing/`.

## O que se grava (0049)

| Tabela              | O quê                                           | Quem lê                     |
| ------------------- | ----------------------------------------------- | --------------------------- |
| `plans`             | o catálogo de cada marca                        | ver "Plano Fundador" abaixo |
| `billing_customers` | a pessoa, o HMAC do CPF, quando o teste começou | ela e o admin da plataforma |
| `subscriptions`     | a assinatura e a última leitura dela na Asaas   | ela e o admin da plataforma |
| `payments`          | cada cobrança, como o app a leu por último      | ela e o admin da plataforma |
| `billing_events`    | cada evento do webhook, uma vez                 | ninguém pela API            |
| `overdue_steps`     | os passos da rotina de atraso                   | ninguém pela API            |
| `refund_requests`   | cada pedido de desistência e como ele andou     | ela e o admin da plataforma |

- O CPF em claro fica só na Asaas.
- `payments.asaas_payment_id` é a chave pela qual os créditos de um ciclo são concedidos, uma vez
  por mês (`docs/spec-creditos.md`).
- Um preço mudado em `plans` vale para assinaturas novas; a que existe guarda o valor dela na Asaas.
- Um plano sai de venda, nunca é apagado.

## Plano Fundador (0058, #292)

- **Quem vê cada plano** (`plans.audience`):
  - `public`: os planos de todos; os ativos são lidos por qualquer um, também sem login;
  - `founder`: o Plano Fundador, lido só por quem tem o selo de fundador vivo;
  - `person`: o Plano Fundador Personalizado, lido só pela conta ligada a ele;
  - o admin da plataforma lê todos. Fundador e Personalizado são só da marca chelsea-st.
- **O selo de fundador** (`person_badges`) é o direito de assinar o Plano Fundador pelo preço de
  fundador, de ficar nele e de voltar a ele, para sempre. Não sai quando a assinatura vence, atrasa
  ou é cancelada. Vem por cupom ou convite (#296) ou, como reparo, pelo admin da plataforma em
  `/teacher/founders`. Ninguém dá o selo a si mesmo.
- **As vagas** (`founder_program`): o total, escrito pelo admin. Uma vaga é um selo vivo; tirar o
  selo devolve a vaga, cancelar a assinatura não. Sem vaga, nenhum selo novo, nem pelo admin.
  `founder_seats_left()` dá o número restante, também sem login (a landing).
- **O preço garantido**: no primeiro pagamento confirmado de um Plano Fundador (a assinatura passa a
  `active`), o selo guarda os termos dela: o preço mensal e o anual, os créditos do mês, o teto, os
  dias depois do cancelamento e o custo da aula. Quem volta ao Plano Fundador assina com esses
  termos, não com os do plano no dia. Um checkout abandonado ou um Pix nunca pago não guarda nada.
- **O Plano Fundador nunca sai de venda**: o último Plano Fundador ativo da marca não pode ser
  desmarcado nem mudar de público (`plans_founder_stays_on_sale`). Para mudar, o admin põe outro à
  venda antes.
- **Recusas novas de `billing_open_subscription`**:
  - `billing_plan_audience`: Plano Fundador sem selo vivo, ou Personalizado que não é da pessoa;
    frase "Este plano não está disponível para você. Escolha outro.";
  - `billing_value_matches`: valor diferente do que a pessoa tem direito (os termos do selo no
    Plano Fundador, o preço do plano no resto, para o ciclo); frase "O valor deste plano mudou.
    Recarregue a página e assine de novo.".
- **O Personalizado** nasce em `/teacher/invites` (tipo "Plano personalizado"), para um e-mail. O
  app manda da agenda@ "Seu plano personalizado está pronto", com o nome do plano e dois links
  (entrar, criar conta), sem nenhum número. O plano se liga à conta confirmada com aquele e-mail, na
  hora (se ela já existe) ou na primeira confirmação; ligado, não muda de pessoa. Enquanto a
  assinatura está aberta, ela não tem assinatura viva e nunca assinou aquele plano, a porta da frente
  leva a pessoa a `/dashboard/plano?plano=<id>`. Os
  números se editam em `/teacher/plans`, seção Personalizados. "Tirar de venda" encerra o convite.
- **A trilha**: 0 minutos por dia é um plano sem trilha (o Plano Fundador, hoje).
- **O custo da aula** de cada plano: ver `docs/spec-creditos.md`, "O custo de cada ação".

## A entrada do fundador (0059, #296)

O selo chega por dois caminhos, os dois pelo `badge_grant` da 0058: só com vaga, e sem vaga nada
é gasto. Dar o selo à mão em `/teacher/founders` fica como reparo.

- **O cupom** (`founder_coupons`), criado pelo admin da plataforma na seção Cupons de
  `/teacher/founders`:
  - **geral**: ele escolhe o código (para um post, por exemplo), o número de usos e a validade;
  - **pessoal**: o app gera um código de 12 caracteres (`XXXX-XXXX-XXXX`, sem I, L, O nem U), de
    um uso, com validade.
  - O código aparece uma vez, na criação, com o link `/cadastro?cupom=<código>`. O banco guarda só
    o `sha256` do código em maiúsculas, sem espaços nem hífens: a lista mostra o nome, os usos e a
    validade, nunca o código. "Encerrar" põe a validade em agora; um cupom nunca é apagado.
  - O resgate confere, com a linha do cupom travada: existe, quem já tem o selo não gasta uso, não
    venceu, a pessoa nunca o usou (também depois de perder o selo), ela é aluna de uma organização
    da marca do cupom, ainda tem uso, e há vaga. O uso só é gravado com o selo dado.
  - Onde se usa: no cadastro (o campo "Tenho um cupom", ou `?cupom=` da landing), que guarda o
    código nos metadados da conta e o resgata na primeira confirmação do e-mail, depois da entrada
    no Chelsea St; e em `/dashboard/plano`, "Tenho um cupom de fundador", para quem está sem selo,
    com o motivo de cada recusa:

    | Regra                            | Frase                                                       |
    | -------------------------------- | ----------------------------------------------------------- |
    | `founder_coupon_exists`          | "Esse cupom não existe. Confira o código, letra por letra." |
    | `founder_coupon_expired`         | "Esse cupom venceu."                                        |
    | `founder_coupon_exhausted`       | "Esse cupom já foi usado todas as vezes que podia."         |
    | `founder_coupon_once_per_person` | "Você já usou esse cupom."                                  |
    | `founder_coupon_brand`           | "Esse cupom não vale para a sua conta."                     |
    | `founder_coupon_seats`           | "As vagas de fundador acabaram."                            |

  - O cadastro responde igual com qualquer cupom, válido ou não. A única coisa que ele diz é o que
    `founder_seats_left()` já diz a qualquer um: com 0 vagas, "As vagas de fundador acabaram. Você
    pode se cadastrar e assinar outro plano."
- **O convite de fundador** (`founder_invites`), tipo "Fundador" de `/teacher/invites`, só para o
  admin da plataforma: um e-mail e a validade em dias, com as vagas restantes ao lado. O app manda
  da agenda@ "Você foi convidada como fundadora", com o link `/cadastro#fundador&email=<e-mail>` (o
  e-mail no fragmento, fora dos logs). O selo entra na primeira confirmação daquele e-mail; se a
  conta já está confirmada, entra na hora e o e-mail é "Você ganhou o selo de fundadora". O convite
  não guarda vaga: sem vaga na confirmação, fica aberto; sem vaga para uma conta já confirmada, a
  gravação é recusada ("Não há vagas de fundador. Aumente o total em Fundadores."). A lista de
  convites abertos tem Reenviar (renova por 15 dias a partir de agora e manda de novo), Copiar link e
  Cancelar. Sem `RESEND_API_KEY`, a tela mostra o link para mandar à mão.
- **`?origem=grifoai`** (o link da seção do Chelsea St na landing da GrifoAI): o cadastro não mostra
  o campo do cupom, nem as vagas, nem fala de fundador; um `?cupom=` na mesma URL ainda vale. A
  origem vai nos metadados e é gravada em `signup_origins` na primeira confirmação; a tela de
  reparo de `/teacher/founders` mostra "veio pela GrifoAI" ao lado do nome.
- **Metadados da primeira vez**: um segundo `/cadastro` do mesmo e-mail ainda não confirmado reenvia
  o e-mail com os metadados que ele já tinha. O cupom ou a origem do segundo cadastro não entram;
  o caminho é "Tenho um cupom" em `/dashboard/plano`.

## Ambientes

- O endereço da Asaas sai do prefixo da chave: `$aact_hmlg_` é o sandbox, `$aact_prod_` a produção.
  No `.env.local`, a chave vai como `ASAAS_API_KEY=\$aact_...`: sem a barra, o Next lê `$aact_` como
  variável e a chave fica vazia (medido em 12/11). O app diz isso no erro.
- A chave do sandbox só roda contra um Supabase local (`localhost` ou `127.0.0.1`): o `.env.local`
  aponta para o banco de produção, e um `npm run dev` comum com ela gravaria assinaturas de teste
  nele. Também é recusada na Vercel Production. O banco é um só, e evento de sandbox não entra nele.
  Os scripts, que não gravam banco, não passam por essa trava.
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
- Uma assinatura Pix voltou como boleto uma vez, no primeiro teste de 12/11. Feita de novo no mesmo
  dia, com a conta aprovada e uma chave Pix aleatória ativa, ela voltou como Pix, com o QR da
  cobrança, e a cobrança avulsa por Pix também. A causa da primeira vez não ficou clara; se acontecer,
  o app apaga a assinatura na Asaas e recusa, para nunca vender boleto como Pix.
- De ponta a ponta, com o webhook passando por um túnel até o servidor local e um Supabase local:
  - **Pix:** a assinatura com teste nasceu em teste; a confirmação do sandbox chegou pelo webhook em
    cerca de 2 s e a fez ativa, paga até o dia antes do próximo vencimento; o cancelamento a apagou
    na Asaas e manteve os dias pagos.
  - **Cartão:** o checkout pago com o cartão de teste criou a assinatura; o webhook a ligou à linha
    pelo checkout (`checkoutSession`) e a fez em teste, com a primeira cobrança pendente no 15º dia e
    o token do cartão nela. O cliente que o checkout criou tem endereço completo.
  - Todo webhook respondeu 200, entre 10 e 744 ms.
- O estorno logo depois da confirmação é recusado ("tente novamente em alguns instantes"). Pedido
  depois, ele é aceito e fica em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`: a Asaas pede que alguém
  autorize no painel o estorno feito pela API (evento crítico). O app conta um estorno só quando ele
  chega a `DONE`.

## Pendências

- **O CNPJ:** a conta de produção nasce no CNPJ definitivo (não se troca de um CNPJ para outro), e só
  conta de pessoa jurídica emite nota fiscal e tem Pix Automático (#281).
- **Tokenização em produção:** depende de liberação da Asaas (até 4 dias úteis). Sem ela, a nova
  tentativa no cartão do atraso e o upgrade em um toque (#274) não funcionam em produção.
- **Nota fiscal:** automática pela Asaas na conta de pessoa jurídica, configurada quando ela existir.
- **A taxa do Pix:** conferir no menu Taxas da conta; o regulamento e a página de preços divergem.
- **Estorno pela API:** decidido em 14/11 (#297, Q3 A): a autorização de evento crítico fica ligada na
  conta de produção, e cada estorno passa pelo Luiz no painel.
- **Sem resposta oficial (central de ajuda fechada à leitura automática):** se a Asaas tenta de novo
  sozinha depois do cartão recusado, e o prazo do estorno.
