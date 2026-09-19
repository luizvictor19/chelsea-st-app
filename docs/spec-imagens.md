# Imagens do vocabulário: o que é gravado

Decidido em 18/09/2026, com o sexto tipo acrescentado em 19/09/2026. Rigor alto: define forma de
dado gravado, bucket e políticas. A migration é
`supabase/migrations/0008_vocabulary_images.sql`, e é ela a fonte se algum dia divergir deste texto.

## O que existe hoje

`vocabulary_items(id, term, first_point_id, image_path, created_at)`, com `image_path` nulo em toda
linha: não existe bucket, o upload nunca gravou. Confirmado no projeto antes de escrever a migration,
em 18/09/2026:

```sql
select count(*), count(*) filter (where image_path is not null) from vocabulary_items;
-- 283 linhas, 0 com image_path
```

É esse zero que permite acrescentar o `check` da dupla aprovada sem backfill e sem `not valid`.

A tela `/teacher/content/images` lista as palavras sem imagem em ordem alfabética, e diz que é ordem
do livro. RLS: só professor lê e escreve; aluna alcança zero linhas.

## Decisões

- **Tipo de representação** por palavra: `photo`, `pose`, `action`, `figure`, `symbol`, `none`. `none` é "não
  leva imagem" e conta como resolvida. Sugestão do modelo e decisão do professor ficam em colunas
  separadas: sugestão nunca vira decisão sozinha, e a diferença entre as duas é a medição da
  qualidade da sugestão.
- **Toda tentativa é guardada**, gerada ou enviada à mão, aprovada ou recusada. É de onde sai
  "tentativas até aprovação" por modelo. Limpeza de arquivos recusados é tarefa futura, não desta
  entrega.
- **Uma aprovada por palavra**, garantida por índice único parcial e não só pelo código que aprova.
  Aprovar outra substitui, a anterior vira recusada. A palavra guarda a aprovada duas vezes de
  propósito: o id da tentativa (verdade) e o caminho do arquivo (cópia para leitura sem join, que é o
  que o tutor vai ler numa linha só). Um `check` garante os dois nulos ou os dois preenchidos.
- **Bucket público para leitura, escrita só do professor.** Imagem de palavra não é dado sensível e
  URL pública dispensa URL assinada na tela da aluna. Caminho:
  `{vocabulary_item_id}/{attempt_id}.{ext}`.
- **Geração pela API do Freepik em modo de espera** (polling numa server action), sem webhook nesta
  entrega. O secret do webhook fica guardado para depois. Modelo e fornecedor gravados por tentativa,
  para o registro da comparação entre modelos, que vive fora deste repositório.

## Migration 0008

```sql
create type representation_kind as enum
  ('photo', 'symbol', 'figure', 'action', 'none');
-- 'pose' entra depois de 'action' pela migration 0010.

create table image_attempts (
  id uuid primary key default gen_random_uuid(),
  vocabulary_item_id uuid not null references vocabulary_items on delete cascade,
  provider text not null,              -- 'freepik' para gerada, 'upload' para arquivo enviado
  model text,                          -- id do modelo no fornecedor; nulo em upload
  prompt text,
  provider_request_id text,            -- id da tarefa no fornecedor, para rastrear a cobrança
  storage_path text,
  status text not null check (status in
    ('pending', 'generated', 'failed', 'approved', 'rejected')),
  credits_spent integer,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index image_attempts_item_idx on image_attempts (vocabulary_item_id, created_at);

-- Uma aprovada por palavra, no banco e não só na transação que aprova.
create unique index image_attempts_one_approved_per_item
  on image_attempts (vocabulary_item_id) where status = 'approved';

alter table vocabulary_items
  add column representation representation_kind,
  add column suggested_representation representation_kind,
  add column approved_attempt_id uuid references image_attempts on delete set null,
  add constraint vocabulary_items_approved_pair check (
    (approved_attempt_id is null) = (image_path is null)
  );

-- Pendentes: sem decisão, ou decidida como algo que leva imagem e ainda não tem.
-- Chaveado em first_point_id, não em term: a tela lê isto em ordem do livro.
create index vocabulary_items_pending_image_idx on vocabulary_items (first_point_id)
  where representation is null
     or (representation <> 'none' and image_path is null);
drop index vocabulary_items_without_image_idx;

alter table image_attempts enable row level security;
create policy image_attempts_teacher_all on image_attempts
  for all using (is_teacher()) with check (is_teacher());
grant select, insert, update, delete on image_attempts to authenticated;
revoke all on image_attempts from anon;

insert into storage.buckets (id, name, public)
  values ('vocabulary-images', 'vocabulary-images', true);
create policy vocabulary_images_read on storage.objects
  for select using (bucket_id = 'vocabulary-images');
create policy vocabulary_images_write_teacher on storage.objects
  for all
  using (bucket_id = 'vocabulary-images' and public.is_teacher())
  with check (bucket_id = 'vocabulary-images' and public.is_teacher());
```

`public.is_teacher()` vai qualificado porque uma requisição de storage não chega com `public` no
`search_path`.

`scripts/verify-rls.sql` ganha duas coisas: a aluna vê zero `image_attempts`, e um stub do schema
`storage` ao lado do stub de `auth` que já existia. O script roda contra um Postgres puro na CI, onde
`storage` não existe, e sem o stub a 0008 derrubaria o check `verify` na PR. A checagem geral de "toda
tabela com RLS" já cobre a tabela nova.

## Regras de escrita

- **Aprovar**, numa transação: rebaixa a aprovada anterior para `rejected`, **depois** promove a nova
  para `approved`, e grava `approved_attempt_id` e `image_path` na palavra. A ordem não é estilo: o
  índice único parcial não é adiável, então promover antes de rebaixar levanta violação no meio da
  transação.
- **Recusar**: marca `rejected`, `decided_at`. Arquivo fica.
- **Escolher `none`**: grava `representation`, e se havia aprovada, ela vira `rejected` e os dois
  campos da palavra voltam a nulo.
- **Upload à mão**: cria tentativa `provider = 'upload'`, `status = 'generated'`, e segue o mesmo
  aprovar.
- **Sugestão do modelo**: grava `suggested_representation`, nunca `representation`.

## Lacunas aceitas

Aceitas em 18/09/2026, registradas para serem conhecidas em vez de esquecidas.

- `approved_attempt_id` não é preso a uma tentativa da mesma palavra. A chave composta que prenderia
  esbarra no `on delete set null`.
- `image_path` é cópia e pode divergir do `storage_path` da tentativa aprovada. O `check` emparelha
  as duas colunas, não as compara.
- O bucket é público e as recusadas ficam, então uma imagem recusada segue buscável por URL até a
  limpeza, que não é desta entrega.

## Regras por categoria

Acrescentado em 19/09/2026. O critério geral é onde mora o sentido da palavra.

- **Foto**: o objeto sozinho (pen, book, table). Nome de pessoa é Foto, porque o livro mostra a
  pessoa; mesmo personagem sempre, com dois ou três traços fixos no assunto.
- **Postura**: o corpo está em repouso e a posição dele é o sentido da palavra (standing, sitting,
  lying). Corpo inteiro.
- **Ação**: a pessoa está fazendo alguma coisa (sit down, stand up, open, close, smile, speak,
  write). O desenho pega o instante mais legível do movimento.
- **Figura**: diagrama, sem pessoa. Relação e posição são caixa e bola; cor é uma forma fixa
  preenchida, a mesma para todas; país e cidade são a silhueta do mapa.
- **Símbolo**: não gera imagem, a tela renderiza o caractere.
- **Nada**: palavra funcional ou que o livro não ilustra; título sozinho (Mr, Mrs); nacionalidade e
  língua. Pronome pessoal também é Nada por enquanto, porque figura isolada não diz "him": a foto de
  um homem diz "man". Item aberto, ligado à cena do tutor.

Postura e Ação se separam por **repouso contra atividade**, não pela seta. Teste prático: congele o
desenho. Se ele continuar dizendo a palavra, é Postura; se virar outra palavra, é Ação.

A seta é consequência de desenho, não o critério: ela entra quando o movimento tem direção e fica
fora quando não tem. Por isso `smile` é Ação e não leva seta. Definir a categoria pela seta era o que
estava escrito aqui até 19/09/2026, e estava errado.

**Proveniência do tipo Postura.** Ele nasceu da medição cega da lição 2, em 19/09/2026, onde os dois
únicos erros foram `sitting` e `standing`: decididos Figura e sugeridos Ação. Os dois lados eram
coerentes com o que liam, e é isso que mostrou que faltava uma categoria, não que alguém errou.

## Migration 0010

Só acrescenta o valor ao enum, uma instrução e nada mais:

```sql
alter type representation_kind add value if not exists 'pose' after 'action';
```

Nada mais pode entrar nesse arquivo. `alter type ... add value` não permite usar o valor novo na
mesma transação em que ele é acrescentado, então qualquer consulta, função ou índice que mencione
`'pose'` tem de esperar uma migration posterior.

## Tela

A desenhada (artifact "Imagens e Aula"): lista por lição, na **ordem do livro** (corrige a mentira
atual), filtros por tipo, painel da palavra com tipo, prompt, gerar, subir arquivo, tentativas,
aprovar. Rigor baixo.

## Medição

Primeira: 10 palavras do capítulo 1, dois modelos médios, mesmo prompt de estilo, contar tentativas
até aprovação e créditos por tentativa. O resultado é escrito fora deste repositório; a tabela
`image_attempts` é a
fonte.

## Fora desta entrega

Limpeza de arquivos recusados; webhook do Freepik; leitura das imagens pela aluna (entra na
`spec-tutor.md`, que precisa abrir `vocabulary_items` para a aluna ler o que já foi introduzido).
