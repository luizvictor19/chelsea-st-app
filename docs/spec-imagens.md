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
- **Geração pela API do Freepik, com a espera na linha e não na conexão.** Revisto em 19/09/2026;
  ver "A espera" abaixo. O secret do webhook continua guardado para depois. Modelo e fornecedor
  gravados por tentativa, para o registro da comparação entre modelos, que vive fora deste
  repositório.

## A espera

Decidido em 19/09/2026, depois de duas falhas no mesmo dia. Rigor alto: define o que fica gravado
na linha e o que a tela pode concluir dela.

Até então a server action fazia tudo numa requisição só: abria a tarefa no Freepik, ficava em
polling com teto de 90s, baixava a imagem e subia para o bucket. Isso segurava uma conexão HTTP por
8 a 21 segundos carregando duas coisas — a resposta da action e o re-render da tela. Todo salto do
caminho tinha veto sobre as duas, e duas vezes em 19/09 alguém usou esse veto: a linha estava
gravada, correta e paga, e a tela nunca soube.

O desenho agora:

- **`startGeneration`** insere a tentativa como `pending`, faz **uma** chamada ao fornecedor e
  volta. Grava `provider_request_id`, que é o que torna a linha perguntável por qualquer um depois.
  Se o fornecedor recusa, ou se o handle não pode ser gravado, a linha é fechada como `failed` ali
  mesmo: uma tentativa `pending` sem handle é uma que ninguém consegue destravar.
- **`pollAttempt`** faz **uma** pergunta ao fornecedor e escreve a resposta. Uma geração ainda em
  curso responde nada — sem lista, sem `revalidatePath` — porque a tela já sabe que a linha está
  aberta e conta os segundos a partir de `created_at` sozinha.
- **O painel pergunta a cada 2s**, em sequência e não por intervalo: a última pergunta de uma
  geração é a que baixa a imagem e a sobe para o bucket, e duas delas ao mesmo tempo fariam o
  trabalho duas vezes.
- **O prazo é da linha.** `GENERATION_WINDOW_MS` mede `now - created_at`, não um relógio dentro de
  uma requisição. Ele limita quanto tempo se espera por uma resposta, e nada mais: um fornecedor que
  diz COMPLETED depois do prazo ainda tem a imagem gravada, porque ela foi paga e descartá-la por
  causa de um relógio é o único erro aqui que custa dinheiro.
- **`completed_at`** é gravado uma vez, na saída de `pending`, tenha a tentativa acabado em imagem
  ou em erro. `completed_at - created_at` é a duração real, por modelo, e é o que vai substituir o
  número do prazo por um medido. Migration `0013_attempt_completed_at.sql`.

O que isso compra, além de a resposta não ser mais cortável: a espera sobrevive a um F5 e a trocar
de palavra no meio, porque nunca esteve no navegador. O painel descobre que há geração aberta
olhando a lista, não um sinalizador posto no clique.

Enquanto a tentativa está aberta, o botão Gerar fica desabilitado para aquela palavra e o botão de
descartar não é oferecido: os créditos já foram gastos quando a tarefa abriu, e jogar fora uma
imagem paga por trás de um ícone sem rótulo é exatamente o caso que o AGENTS.md põe na coluna de
rigor alto.

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
  pessoa.
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

**Consistência de personagem fica de fora, por ora.** Tentada em 19/09/2026, como descrição fixa de
um homem dentro das regras de Postura e Ação. Três gerações reais: uma devolveu uma cadeira sem
ninguém, duas devolveram personagens diferentes entre si e da descrição. Modelo de texto para imagem
não guarda identidade entre chamadas, e o Seedream 4 não aceita imagem de referência, então descrever
era a única alavanca e ela não moveu nada. O assunto de um nome de pessoa também não precisa carregar
traços fixos pelo mesmo motivo. O tema volta com a cena do tutor, com um modelo que aceite referência.

**O ângulo é parte do sentido**, em Postura e em Ação. Pessoa sentada desenhada de frente não lê
como sentada: o que comunica a postura é o joelho dobrado, de perfil. O assunto é onde o professor
nomeia o ângulo, e a regra da categoria pede isso. Descoberto em 19/09/2026, depois de quatro
tentativas em `sitting`.

Postura e Ação se separam por **repouso contra atividade**, não pela seta. Teste prático: congele o
desenho. Se ele continuar dizendo a palavra, é Postura; se virar outra palavra, é Ação.

A seta é consequência de desenho, não o critério: ela entra quando o movimento tem direção e fica
fora quando não tem. Por isso `smile` é Ação e não leva seta. Definir a categoria pela seta era o que
estava escrito aqui até 19/09/2026, e estava errado.

**Proveniência do tipo Postura.** Ele nasceu da medição cega da lição 2, em 19/09/2026, onde os dois
únicos erros foram `sitting` e `standing`: decididos Figura e sugeridos Ação. Os dois lados eram
coerentes com o que liam, e é isso que mostrou que faltava uma categoria, não que alguém errou.

## Estilo do desenho

Uma constante só, não editável na tela, porque o ponto de ter um estilo é algumas centenas de
imagens lerem como um conjunto em vez de como algumas centenas de decisões separadas. O professor
escreve o assunto; o estilo entra sozinho.

O prompt abre pelo meio e pelo assunto ("Flat vector illustration of {subject}."), segue pela regra
da categoria e fecha pelo resto do estilo:

> Simple shapes, solid flat colors, no outlines, a limited muted palette, plain warm off-white
> background, a soft shadow under the subject only, no text, no letters, no numbers, no watermark.
> Minimal, clean, friendly. No frame, no border, the background fills the entire image.

**Reescrito em 19/09/2026 a partir do que voltou, não do que foi pedido.** A constante pedia `bold
outlines` e `no shading`; uma geração real de `sitting` ignorou os dois e devolveu formas chapadas
sem contorno, paleta reduzida e uma sombra suave sob o sujeito, melhor do que o que estava escrito.

O motivo de mudar não é um estilo ser melhor que o outro. É que, enquanto a constante descrever um
desenho que ninguém quer, o resultado fica sorteando entre dois: `book` voltou com contorno grosso e
cartunesco, `sitting` voltou assim, e o conjunto deixou de parecer um conjunto.

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

O **webhook do Freepik** continua fora, e agora por uma razão mais forte do que "depois": ele exige
um endpoint público, e `localhost` não é um. Em dev seria um túnel toda vez. Com a espera na linha,
quando ele entrar não substitui nada — vira um **segundo escritor** da mesma linha, e a sondagem
pelo painel passa a ser o plano B para quando o webhook não chega, que é uma coisa de que ele vai
precisar de qualquer jeito.

Limpeza de arquivos recusados; leitura das imagens pela aluna (entra na
`spec-tutor.md`, que precisa abrir `vocabulary_items` para a aluna ler o que já foi introduzido).
