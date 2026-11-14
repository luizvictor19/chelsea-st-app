# Chelsea St

Plataforma das aulas de inglês da Chelsea St: aulas ao vivo com o professor e
o Robin, um tutor de voz para a prática diária (em construção, #71). O
conteúdo vem dos livros do método, é comum a todas as organizações da
plataforma e só o admin da plataforma escreve (ADR 0004).

## O que já existe

| Tela                         | Para quem                | O que faz                                                               |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `/teacher/content`           | admin da plataforma      | ingestão dos livros e revisão bloco a bloco                             |
| `/teacher/content/images`    | admin da plataforma      | tipo e imagem de cada palavra, conjuntos de contraste e cenas           |
| `/teacher/content/questions` | admin da plataforma      | perguntas por ponto, "Sugerir perguntas" e "Publicar revisadas"         |
| `/teacher/students`          | professor                | alunos e agenda das aulas                                               |
| `/teacher/lesson`            | professor                | a aula ao vivo e o "Parei aqui"                                         |
| `/teacher/organizations`     | admin da plataforma      | organizações e o primeiro admin de cada uma                             |
| `/teacher/invites`           | admin e professor        | convites para entrar numa organização                                   |
| `/dashboard`                 | aluno                    | agenda, link da aula e a prática com o Robin (por enquanto, "Em breve") |
| `/team`                      | admin de uma organização | dias e minutos de prática da equipe, nunca o que foi dito               |
| `/teacher/session-preview`   | professor                | prévia da tela do tutor, com um motor falso                             |
| `/teacher/audio-test`        | professor e admin        | teste do microfone (ver "Teste de gravação")                            |

As sugestões de conteúdo ("Sugerir") chamam o Claude Haiku e só gravam o que o
admin confirma.

**Em construção:** o Robin (#71 e as sub-issues dela).

## Ingestão de conteúdo

Em `/teacher/content`.

O admin abre um livro, diz de que ponto a que ponto vai, e sobe as fotos das
páginas. A leitura acontece no próprio navegador: as imagens não saem da
máquina em momento nenhum. Depois ele revisa página por página, com o recorte
original ao lado de cada bloco que a extração marcou como duvidoso, e só o que
ele confirma é gravado.

O que a extração não consegue decidir sozinha vira pergunta, nunca palpite. Uma
página cujo número de margem ficou ambíguo, ou que tem conteúdo pertencente a
uma página que não está no envio, fica retida até o admin responder.

## Ambientes

Um só. O projeto Supabase é a produção, sem staging, por decisão: toda
migration é uma mudança em produção. Cada merge na `main` publica em
app.chelsea-st.com (Vercel). No computador, o app roda na porta 3100.

## Como rodar

Requisitos: Node na versão do `.nvmrc` (`nvm use` resolve) e acesso ao projeto
Supabase.

```bash
nvm use
npm install
cp .env.example .env.local   # preencha com as chaves; nunca faça commit dele
npm run dev                  # http://localhost:3100
```

O `.env.example` explica cada variável. O app precisa de
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`; as sugestões de conteúdo, de `ANTHROPIC_API_KEY`;
a geração de imagens, de `FREEPIK_API_KEY`. `NEXT_PUBLIC_TEACHER_CONTACT_EMAIL`
é opcional. `OPENAI_API_KEY`, `DEEPGRAM_API_KEY` e `DEEPSEEK_API_KEY` servem
aos scripts de medição.

## Banco

As migrations ficam em `supabase/migrations`, aplicadas em ordem. O Claude
aplica cada uma com `supabase db push`, do worktree da issue, logo antes do
merge, com cópia lógica e `--dry-run` antes (`docs/commands.md`, Migrations). Toda tabela nasce com Row Level Security
ligada, na mesma migration que a cria, e o CI confere as regras rodando o
`scripts/verify-rls.sql` num Postgres de verdade (ADR 0003). Os tipos de
`src/lib/supabase/types.ts` saem das migrations, com `./scripts/gen-types.sh`,
nunca do projeto no ar.

Schema entra só por migration. O SQL Editor do painel serve para consultar.
DDL colado lá não fica registrado em arquivo nenhum, e a próxima pessoa a rodar
as migrations recebe um banco diferente do que elas descrevem.

## Fixtures

`fixtures/` não é versionado. Página de livro publicado não entra neste
repositório, então um clone limpo não tem `fixtures/real/book1/` nem
`fixtures/real/book2/`, e os scripts de medição em `scripts/` falham por
arquivo ausente. Isso é o comportamento correto, não um defeito.

Os testes não dependem disso: as fixtures que eles usam são sintéticas e
geradas em tempo de execução.

## Teste de gravação

`/teacher/audio-test` ("Teste de áudio") grava e reproduz áudio no próprio
navegador. Não envia nem salva nada: a gravação fica só na memória do
navegador até a próxima. Serve para confirmar que o microfone funciona antes
de a prática depender disso. Vale a mesma checagem em cada aparelho que o
aluno for usar: Android, desktop e iPhone.

Abre com uma conta de professor ou de admin (da organização ou da plataforma);
o aluno é mandado para `/dashboard`. A página não está no menu: chega-se pelo
endereço.

No `npm run dev`, e só nele, a página mostra também os casos de STT, que salvam
cada gravação em `fixtures/stt/` (fora do git) para o `scripts/measure-stt.ts`.

Onde testar:

- **iPhone:** o Safari só libera o microfone em HTTPS ou em `localhost`, então
  o teste é em `https://app.chelsea-st.com/teacher/audio-test`, entrando com a
  conta de professor.
- **Android pelo cabo:** `http://127.0.0.1:3100/teacher/audio-test`, depois do
  `adb reverse` de `docs/commands.md`.
- **Desktop:** `http://localhost:3100/teacher/audio-test` com `npm run dev`.

## Verificação

```bash
npm run check
```

Roda `format:check`, `lint`, `typecheck`, `test` e `build`, na mesma ordem do
CI, e para no primeiro que falhar. Antes de cada commit, um hook (husky e
lint-staged) formata e confere os arquivos em stage. O CI roda ainda o
`scripts/verify-rls.sql`, que precisa de um Postgres de verdade, e o
`npm audit --omit=dev --audit-level=high`; nenhum dos dois faz parte do
`check`.

## Onde estão as regras

- `AGENTS.md`: como se trabalha neste repositório (issue, plano, PR).
- `docs/context.md`: o que um plano precisa saber antes de mexer em algo; as
  contas de teste estão lá.
- `docs/commands.md`: os comandos do dia a dia.
- `docs/adr/`: as decisões de arquitetura.
- `docs/spec-*.md`: as especificações de cada parte.
- `LICENSE`: os direitos sobre o código e o material.
