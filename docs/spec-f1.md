# F1 · Entrar e ver a próxima aula

Spec de implementação. Escrita para ser executada com a skill `implement-spec`.

## Objetivo

A aluna abre o link, entra sem senha, e vê quando é a próxima aula e como entrar nela.
O professor entra pelo mesmo login e é levado para outra área.

## Decisões

| Tema         | Decisão                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| Login        | Magic link por e-mail. Sem senha em nenhum momento                          |
| Agenda       | Regra recorrente por aluno (ex.: seg e qui às 19h) que materializa as aulas |
| Meet         | Sala fixa por aluno, colada uma vez pelo professor em `students.meet_url`   |
| Fuso         | Guardar em UTC (`timestamptz`), exibir no fuso de `profiles.timezone`       |
| Estado vazio | Sem aula agendada, a tela mostra o desafio do dia                           |

## Schema: migration 0003

Falta a tabela de recorrência.

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

| Rota             | Quem acessa | O que faz                                               |
| ---------------- | ----------- | ------------------------------------------------------- |
| `/login`         | anônimo     | Campo de e-mail, envia o magic link, mostra confirmação |
| `/auth/callback` | anônimo     | Troca o código pela sessão e redireciona                |
| `/`              | qualquer    | Redireciona conforme o papel                            |
| `/dashboard`     | aluno       | Próxima aula e desafio do dia                           |
| `/teacher`       | professor   | Placeholder nesta fase                                  |

`src/proxy.ts` renova a sessão em toda requisição e protege `/dashboard` e
`/teacher`. O nome é esse porque o Next 16 depreciou a convenção
`middleware.ts` em favor de `proxy.ts`; o papel é o mesmo.

## Redirecionamento por papel

Lê `profiles.role` no servidor. Nunca no cliente, porque papel decidido no
navegador é papel que o navegador pode mentir. A RLS já é a defesa real; isto é
só roteamento.

- sem sessão: `/login`
- `role = 'teacher'`: `/teacher`
- `role = 'student'` com linha em `students`: `/dashboard`
- `role = 'student'` sem linha em `students`: tela dizendo que a conta ainda não
  foi liberada, com contato do professor. Acontece se alguém logar antes de ser
  cadastrado como aluno

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

Se `students.meet_url` estiver vazio, mostra o horário sem botão e avisa que o
link chega antes da aula. Não inventar link nem esconder a aula.

## Critérios de aceite

1. Pedir magic link com e-mail cadastrado leva à sessão ativa depois do clique.
2. Pedir magic link com e-mail desconhecido mostra a mesma mensagem de sucesso.
   Resposta diferente por e-mail existente entrega a lista de quem tem conta.
3. Acessar `/dashboard` sem sessão redireciona para `/login`.
4. Professor logado em `/dashboard` é levado para `/teacher`.
5. Com uma aula amanhã às 19h e fuso America/Sao_Paulo, a tela mostra amanhã
   e 19h, não 22h.
6. Com aula em 10 minutos, o bloco aparece em estado de destaque.
7. Sem aula futura, a tela mostra o bloco do desafio, nunca vazia.
8. Chamar a materialização duas vezes seguidas não cria aula duplicada.
9. `prettier --check`, `lint`, `tsc --noEmit` e `build` passam.

## Fora de escopo

Correção de resposta, gravação de áudio, e-mail de lembrete, tela de professor
de verdade, cancelamento e remarcação pela interface. Cada um tem sua fase.
