# F1 · Entrar e ver a próxima aula

Spec de implementação.

## Objetivo

A aluna entra com e-mail e senha (desde a #96; antes, só pelo link mágico) e vê quando é a
próxima aula e como entrar nela.
O professor entra pelo mesmo login e é levado para outra área.

## Decisões

| Tema         | Decisão                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Login        | E-mail e senha; link mágico como opção (#96). Senha definida pelo link                         |
| Agenda       | Reserva paga em créditos, nos horários que o professor abre (#276); a agenda fixa saiu na #295 |
| Meet         | O link do professor (`teachers.meet_url`), o mesmo em todas as aulas dele                      |
| Fuso         | Guardar em UTC (`timestamptz`), exibir no fuso de `profiles.timezone`                          |
| Estado vazio | Sem aula agendada, a tela mostra o desafio do dia                                              |

## Schema: migration 0003

Histórico: a 0054 (#295) apagou a tabela e a função abaixo. Uma aula nasce só pela reserva
(seção "Reserva de aula").

```sql
create table lesson_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  timezone text not null default 'America/Sao_Paulo',
  duration_minutes integer not null default 50 check (duration_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, weekday, start_time)
);
```

Com RLS na mesma migration, no mesmo padrão das outras: aluno lê o que é dele,
professor lê e escreve tudo. E o grant explícito, porque a exposição automática
está desligada no projeto.

Materialização: uma função que, dado um aluno e um horizonte em semanas, insere
em `lessons` as ocorrências que ainda não existem. Idempotente: rodar duas vezes
não duplica. Na v1 é chamada à mão; virar job agendado fica para depois.

## Rotas

| Rota                     | Quem acessa        | O que faz                                               |
| ------------------------ | ------------------ | ------------------------------------------------------- |
| `/login`                 | anônimo            | E-mail e senha; links para as duas rotas abaixo         |
| `/login/link`            | anônimo            | Campo de e-mail, envia o magic link, mostra confirmação |
| `/forgot-password`       | anônimo            | Envia o link que leva a `/set-password`                 |
| `/set-password`          | com sessão         | Define a senha; onde caem o convite e o "esqueci"       |
| `/auth/callback`         | anônimo            | Troca o código ou o `token_hash` pela sessão            |
| `/`                      | qualquer           | Redireciona conforme o papel                            |
| `/dashboard`             | aluno              | Próxima aula e desafio do dia                           |
| `/teacher`               | professor          | Placeholder nesta fase                                  |
| `/teacher/invites`       | admin ou professor | Convida por e-mail e acompanha os convites              |
| `/teacher/students`      | professor          | Alunos, com a próxima aula reservada e o progresso      |
| `/teacher/students/[id]` | professor          | Aulas reservadas e progresso; cancelar uma aula         |

Desde a #116 todos os caminhos são em inglês. Os antigos em português (`/definir-senha`,
`/esqueci-senha`, `/teacher/convites`, `/teacher/aula`) redirecionam para os novos, para sempre:
e-mails já enviados levam o caminho antigo (`src/lib/renamed-paths.ts`).

`src/proxy.ts` renova a sessão em toda requisição e protege `/dashboard`,
`/teacher` e `/set-password`. O nome é esse porque o Next 16 depreciou a convenção
`middleware.ts` em favor de `proxy.ts`; o papel é o mesmo.

"Sair da conta" fica no menu do professor, na tela da aluna e na de conta ainda não
liberada (#106). É um POST para `/auth/sign-out`, que encerra a sessão só neste aparelho e
leva para `/login`, sem confirmação. Se o servidor de Auth não responder, os cookies da
sessão são apagados assim mesmo.

## Redirecionamento por papel

Lê os papéis no servidor, em `organization_members` e `platform_admins` (desde a
0029; antes era `profiles.role`). Nunca no cliente, porque papel decidido no
navegador é papel que o navegador pode mentir. A RLS já é a defesa real; isto é
só roteamento. Uma pessoa pode ter mais de um papel na mesma escola.

- sem sessão: `/login`
- admin ou professor de alguma escola, ou admin da plataforma: `/teacher`
- aluna com linha em `students`: `/dashboard`
- quem também é aluna abre o `/dashboard` pelo link "Ver como aluna" do menu do
  professor, sem trocar de usuário
- sem papel, ou aluna sem linha em `students`: tela dizendo que a conta ainda não
  foi liberada, com contato do professor. Acontece se alguém logar sem convite

## Convite (#96, migration 0031)

O vínculo com a escola nasce só de um convite por e-mail (ADR 0004), em
`organization_invites`:

- o admin da escola convida qualquer papel, o professor só aluna, a aluna
  ninguém; o admin da plataforma convida em qualquer escola;
- o convite vale 15 dias; "Reenviar" renova e manda o e-mail de novo;
- o vínculo (e a linha de `students`, para aluna) nasce na primeira confirmação
  do e-mail, ou na hora em que o convite é gravado, se o e-mail já estava
  confirmado; convite vencido nunca vira vínculo;
- uma aluna estuda em uma escola só: o convite de aluna para quem já é aluna de
  outra escola é recusado;
- o e-mail sai pelo `inviteUserByEmail` do Supabase, com a chave de service role
  só no servidor (`src/lib/supabase/admin.ts`), depois de a RLS aceitar o
  convite gravado com o cliente de quem convidou.

## Estados da tela do aluno

**Com aula futura agendada.** Dia da semana por extenso, data, hora no fuso dela,
e quanto falta em linguagem humana ("em 2 dias", "amanhã", "em 3 horas"). Botão
de entrar na aula.

**A menos de 15 minutos.** O bloco ganha destaque com a cor de acento e o botão
vira a ação principal da tela. Este é o lembrete in-app prometido no plano.

**Aula em andamento**, entre o início e o fim previsto. Continua mostrando o
botão de entrar, porque atraso acontece.

**Sem aula futura.** Mostra o desafio do dia. Enquanto a F2 não existir, mostra
uma linha neutra dizendo que o treino diário chega em breve. Não deixar a tela
em branco em nenhuma hipótese.

## Regras

Data e hora sempre gravadas em UTC e convertidas na exibição. Nada de formatar
data no servidor com o fuso do servidor, que é a origem clássica do bug de "a
aula aparece um dia antes".

"Próxima aula" é a aula com `status = 'scheduled'` e `scheduled_at` maior que
agora menos a duração, ordenada pela mais próxima. A subtração da duração é o
que faz a aula em andamento continuar aparecendo.

Se o professor da aula estiver sem link do Meet (`teachers.meet_url`), mostra o horário sem
botão e avisa que o link chega antes da aula. Não inventar link nem esconder a aula.

## Agenda do aluno (#129)

Aposentada pela #295 (migration 0054): saíram os horários da semana, "Gerar aulas", o link do
Meet por aluno e "Remarcar". As aulas dela foram levadas para a reserva (seção abaixo).

## Reserva de aula (#276)

Migration 0052. Desde a #295 (migration 0054) é o único jeito de marcar aula. O convite de
agenda por e-mail (`.ics`) é a #294; o preço com o selo Fundador, a #292.

- **As aulas da agenda fixa:** a 0054 deu a cada uma o único professor ativo da organização dela
  (passadas, canceladas e futuras), e para inteira, sem mudar nada, se a organização tiver nenhum
  ou mais de um. Guardam o status, o horário, a duração (45 min), o "Parei aqui" e a nota. As
  futuras viraram reservas sem cobrança: débito zero e nenhum lançamento no razão; cancelar uma
  delas não devolve nada, porque nada foi pago. Depois delas, o aluno reserva com créditos.

- **O professor:** uma linha em `teachers` por pessoa e organização, presa à filiação de quem
  ensina ali. Guarda o link do Meet (um por professor, só `https://`), o "e-mail da agenda"
  (pode ser outro que o do login) e "aceito reservas". Só aceita reservas com o Meet e o e-mail
  da agenda preenchidos. Um segundo professor é convite de professor mais esse cadastro.
- **Os horários livres:** janelas semanais (dia, início e fim, no fuso do professor) e folgas (de
  um instante a outro). Os horários reserváveis não são gravados: o banco os calcula na hora, a
  partir das janelas, das folgas e das aulas já marcadas.
- **As regras numéricas**, numa função só (`lesson_rules()`), mudadas por migration:
  - aula de 50 min, um horário a cada 60 min dentro da janela;
  - a reserva fecha 12 h antes do início e abre até 8 semanas à frente;
  - o cancelamento do aluno devolve os créditos até 1 h antes do início.
- **Reservar:** o aluno escolhe o professor (pulado quando há um só), vê os horários livres da
  semana no próprio fuso e o custo, e confirma ("Reservar por N créditos"). O banco grava a aula
  e debita o custo da aula do saldo dele, na mesma transação, com a referência
  `lesson:<id da aula>`. Saldo que não cobre recusa tudo: nem aula, nem débito. O custo vem de
  `credit_cost` (#273), nunca do código.
- **Cancelar:**
  - o aluno cancela a aula dele até o início; até 1 h antes recebe de volta o que pagou
    (não o preço do dia); depois, a aula é cancelada e nada volta;
  - o professor da aula, o admin da organização ou o admin da plataforma cancelam até o fim
    previsto, e o estorno é sempre integral;
  - a falta não tem botão: a aula sem cancelamento já não devolve;
  - remarcar é cancelar e reservar de novo.
- **Duas aulas no mesmo horário:** o banco recusa duas aulas do mesmo professor, ou do mesmo
  aluno, que se cruzem, venham de onde vierem. Um professor em duas organizações tem o horário
  ocupado nas duas.
- **Escrever direto em `lessons`:** pelo navegador ninguém cria nem apaga aula, e quem ensina na
  organização (ou o admin da plataforma) muda só o "Parei aqui" e a nota (#295). Uma aula nasce
  só pela reserva e muda de status só pelo cancelamento.
- **"Parei aqui" sem aula reservada:** recusa com "Nenhuma aula reservada com {nome} agora.
  Marque numa aula da agenda." Não cria mais uma aula fora da agenda (#295).
- **Some nas organizações sem professor:** as funções da reserva recusam ali, e a tela não
  mostra "Reservar aula" a quem só pratica.

Rotas:

| Rota                 | Quem                | O quê                                                                                    |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `/teacher/agenda`    | quem ensina         | perfil (Meet, e-mail da agenda, aceito reservas), janelas, folgas e as próximas reservas |
| `/dashboard/lessons` | aluno com professor | horários livres, custo, saldo, reservar; as próximas aulas com "Cancelar"                |
| `/dashboard`         | aluno               | a próxima aula vem das reservas, com o Meet do professor; vazia, oferece "Reservar aula" |

Estados da tela do aluno:

- sem professor aceitando reservas: "Nenhum professor com horários abertos agora";
- custo da aula não definido: "As aulas ainda não estão à venda";
- sem horário livre na semana: "Nenhum horário livre nesta semana", com a semana seguinte;
- saldo menor que o custo: o horário aparece, e a reserva diz que faltam créditos;
- depois de cancelar, a mensagem diz o que de fato aconteceu: "N créditos devolvidos" ou "Aula
  cancelada, sem devolução".

Antes da aula, o professor vê em cada reserva onde o aluno parou (o último "Parei aqui") e a
última nota. O painel do Robin entra com a #255.

## Critérios de aceite

1. Pedir magic link com e-mail cadastrado leva à sessão ativa depois do clique.
2. Pedir magic link com e-mail desconhecido mostra a mesma mensagem de sucesso.
   Resposta diferente por e-mail existente entrega a lista de quem tem conta.
   Vale também para "Esqueci minha senha" e para senha errada: a mesma frase
   para e-mail sem conta.
3. Acessar `/dashboard` sem sessão redireciona para `/login`.
4. Professor logado em `/dashboard` é levado para `/teacher`.
5. Com uma aula amanhã às 19h e fuso America/Sao_Paulo, a tela mostra amanhã
   e 19h, não 22h.
6. Com aula em 10 minutos, o bloco aparece em estado de destaque.
7. Sem aula futura, a tela mostra o bloco do desafio, nunca vazia.
8. `prettier --check`, `lint`, `tsc --noEmit` e `build` passam.

## Fora de escopo

Correção de resposta, gravação de áudio, e-mail de lembrete, tela de professor
de verdade. Cada um tem sua fase. Cancelar entrou com a agenda (#129) e hoje é o
`cancel_lesson` da reserva (#276); remarcar é cancelar e reservar de novo.
