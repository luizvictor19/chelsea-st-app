# Imagens do vocabulário: o que é gravado

Decidido em 18/09/2026, com o sexto tipo acrescentado em 19/09/2026 e `none` separado em três em
20/09/2026. Conferido contra o código, as migrations e o banco em 24/10/2026. Rigor alto: define
forma de dado gravado, bucket e políticas. As migrations de imagem são a fonte se algum dia
divergirem deste texto: `0008` a `0022`, `0025` e `0026`, em `supabase/migrations/`. Entraram pelas
PRs #14 a #26 e pelas que vieram depois.

## O que existia antes da 0008

`vocabulary_items(id, term, first_point_id, image_path, created_at)`, com `image_path` nulo em toda
linha: não existia bucket, o upload nunca tinha gravado. Confirmado no projeto antes de escrever a
migration, em 18/09/2026:

```sql
select count(*), count(*) filter (where image_path is not null) from vocabulary_items;
-- 283 linhas, 0 com image_path
```

Foi esse zero que permitiu acrescentar o `check` da dupla aprovada sem backfill e sem `not valid`.

A tela `/teacher/content/images` listava as palavras sem imagem em ordem alfabética e dizia que era
ordem do livro. RLS: só professor lia e escrevia; aluna alcançava zero linhas. O padrão de política
era `for all using (is_teacher())`, e a 0008 o seguiu.

## Decisões

- **Tipo de representação** por palavra: `photo`, `pose`, `action`, `figure`, `symbol`, `usage`,
  `metalanguage`, `none`. Os quatro últimos não levam imagem e contam como resolvidos. Sugestão do
  modelo e decisão do professor ficam em colunas separadas (`suggested_representation` e
  `representation`): sugestão nunca vira decisão sozinha, e a diferença entre as duas é a medição da
  qualidade da sugestão. Migrations 0008, 0010, 0018 e 0019.
- **Classe gramatical** em `vocabulary_items.word_class` (0012), separada do tipo: a classe é um fato
  sobre a palavra, o tipo é uma decisão sobre a imagem. Doze valores: `noun`, `verb`, `adjective`,
  `adverb`, `pronoun`, `preposition`, `determiner`, `conjunction`, `numeral`, `question_word`,
  `interjection`, `phrase`. Uma coluna só, sem `suggested_word_class` ao lado: o modelo acerta a
  classe muito mais do que o tipo, e confirmar 283 à mão custaria mais do que vale. O professor
  corrige no painel, e sugerir a lição de novo sobrescreve. Termo de várias palavras: verbo com
  partícula é `verb` (putting on), locução prepositiva é `preposition` (in front of), e `phrase` fica
  só para o que não tem uma função (what is). PR #19.
- **Sugestão automática por lição.** Um modelo de texto, hoje o DeepSeek atrás de `TextProvider`
  (`src/lib/text/provider.ts`, `src/lib/text/deepseek.ts`), lê a lição inteira em lotes e devolve
  tipo e classe de cada palavra no mesmo JSON (`src/lib/images/suggest.ts`). Grava
  `suggested_representation` e `word_class`, nunca `representation`. Sobrescreve o que já havia, e a
  tela pergunta antes quando a lição já tem sugestões. `suggestion_run_id` (0020) diz qual passada escreveu cada sugestão, para a tela
  reconhecer um lote que gravou mas não conseguiu responder. PRs #16 e #19.
- **Sugestão de Instrução.** "Sugerir instrução" pede ao modelo de texto uma Instrução para a palavra
  e grava a proposta em `vocabulary_items.image_subject`, o mesmo campo que o professor edita. PR #18.
- **Toda tentativa é guardada**, gerada ou enviada à mão, aprovada ou descartada. É de onde sai
  "tentativas até aprovação" por modelo. Cada tentativa guarda três coisas diferentes:
  - `prompt`: o que foi enviado ao fornecedor, estilo e regra da categoria incluídos;
  - `subject` (0011): a Instrução com que aquela imagem foi pedida, como registro; nula em upload e
    nas tentativas anteriores à coluna, sem backfill;
  - `completed_at` (0013): quando a tentativa saiu de `pending`, com imagem ou com erro. Não é
    `decided_at`, que é quando o professor julgou a tentativa e que só o descarte escreve.

  A Instrução atual da palavra mora em `vocabulary_items.image_subject` (0026), a última que veio,
  sugerida ou editada. Ela sobrevive a trocar de palavra e a recarregar a página, e o painel abre
  com ela preenchida. Limpeza de arquivos descartados é tarefa futura.

- **Uma aprovada por palavra**, garantida por índice único parcial e não só pelo código que aprova.
  A escrita mora em funções SQL `security invoker`, para a RLS continuar decidindo quem toca o quê e
  a sequência ficar atômica: `approve_image_attempt` e `clear_word_representation` (0009; a primeira
  refeita pela 0016, a segunda pela 0019 e pela 0021). A palavra guarda a aprovada duas vezes de propósito: o id da tentativa
  (verdade) e o caminho do arquivo (cópia para leitura sem join, que é o que o tutor vai ler numa
  linha só). Um `check` garante os dois nulos ou os dois preenchidos.
- **Bucket `vocabulary-images`, público para leitura, escrita só do professor.** Imagem de palavra
  não é dado sensível, e URL pública dispensa URL assinada na tela da aluna. Caminho:
  `{vocabulary_item_id}/{attempt_id}.{ext}`.
- **Geração atrás de `ImageProvider`** (`src/lib/images/provider.ts`). A implementação é a do
  Freepik, em `src/lib/images/freepik.ts`, que fala com `https://api.magnific.com`. Os modelos e o
  preço de cada imagem estão em `IMAGE_MODELS`: Seedream 4 a 50 créditos, Mystic a 80 e Flux Kontext
  Pro a 150, lidos no painel do Freepik e anotados ao lado da tabela. O modelo padrão vem do tipo
  (`defaultModelFor`): Mystic para `photo`, Seedream 4 para `figure`, `pose` e `action`. PR #22.
- **O custo é gravado pela aplicação.** O fornecedor não informa cobrança, então `credits_spent` é
  escrito quando o fornecedor aceita a tarefa, a partir do preço em `IMAGE_MODELS`. A 0015 preencheu
  do mesmo jeito as 50 tentativas que já existiam. Modelo e fornecedor ficam gravados por tentativa,
  para a comparação entre modelos, que vive fora deste repositório.
- **Referência de estrutura** (0014): a imagem que a palavra usa como forma, em
  `vocabulary_items.reference_path`, e a que cada tentativa de fato usou, em
  `image_attempts.reference_path`. Duas colunas, para trocar a referência da palavra não reescrever a
  história das tentativas.
- **Estilo por palavra** (0017): `vocabulary_items.image_style`, `flat` ou `realistic`. O professor
  escolhe o conjunto, não escreve estilo. Ver "Estilo do desenho".
- **Conjuntos de contraste** (0022): adjetivos de contraste (large e small, long e short) não se
  resolvem dentro de uma imagem. As palavras entram num conjunto ordenado, cada uma com a imagem de
  um sujeito só, e a apresentação mostra o conjunto lado a lado.

## A espera

Decidido em 19/09/2026, depois de duas falhas no mesmo dia. Rigor alto: define o que fica gravado
na linha e o que a tela pode concluir dela.

Até então a server action fazia tudo numa requisição só: abria a tarefa no fornecedor, ficava em
polling com teto de 90s, baixava a imagem e subia para o bucket. Isso segurava uma conexão HTTP por
8 a 21 segundos carregando duas coisas: a resposta da action e o re-render da tela. Todo salto do
caminho tinha veto sobre as duas, e duas vezes em 19/09 alguém usou esse veto: a linha estava
gravada, correta e paga, e a tela nunca soube.

O desenho agora (`src/lib/images/generation.ts` e `src/app/teacher/content/images/actions.ts`):

- **`startGeneration`** insere a tentativa como `pending`, faz **uma** chamada ao fornecedor e
  volta. Grava `provider_request_id`, que é o que torna a linha perguntável por qualquer um depois.
  Se o fornecedor recusa, ou se o handle não pode ser gravado, a linha é fechada como `failed` ali
  mesmo: uma tentativa `pending` sem handle é uma que ninguém consegue destravar.
- **`pollAttempt`** faz **uma** pergunta ao fornecedor e escreve a resposta. Uma geração ainda em
  curso responde nada (sem lista, sem `revalidatePath`), porque a tela já sabe que a linha está
  aberta e conta os segundos a partir de `created_at` sozinha.
- **O painel pergunta a cada 2s** (`POLL_INTERVAL_MS`), em sequência e não por intervalo: a última
  pergunta de uma geração é a que baixa a imagem e a sobe para o bucket, e duas delas ao mesmo tempo
  fariam o trabalho duas vezes.
- **O prazo é da linha.** `GENERATION_WINDOW_MS`, 90s, mede `now - created_at`, não um relógio
  dentro de uma requisição. Ele limita quanto tempo se espera por uma resposta, e nada mais: um
  fornecedor que diz COMPLETED depois do prazo ainda tem a imagem gravada, porque ela foi paga e
  descartá-la por causa de um relógio é o único erro aqui que custa dinheiro.
- **`completed_at`** é gravado uma vez, na saída de `pending`. `completed_at - created_at` é a
  duração real, por modelo. Medido no banco em 24/10/2026, só tentativas sem erro:

  | Modelo           | Tentativas | Mediana | Pior   |
  | ---------------- | ---------- | ------- | ------ |
  | Flux Kontext Pro | 27         | 13,2s   | 22,0s  |
  | Seedream 4       | 63         | 14,3s   | 81,1s  |
  | Mystic           | 43         | 24,9s   | 341,7s |

  ```sql
  select model, count(*),
         percentile_cont(0.5) within group (order by completed_at - created_at),
         max(completed_at - created_at)
  from image_attempts
  where provider = 'freepik' and completed_at is not null and error is null
  group by model;
  ```

O que isso compra, além de a resposta não ser mais cortável: a espera sobrevive a um F5 e a trocar
de palavra no meio, porque nunca esteve no navegador. O painel descobre que há geração aberta
olhando a lista, não um sinalizador posto no clique.

Enquanto a tentativa está aberta, o botão Gerar fica desabilitado para aquela palavra e o botão de
descartar não é oferecido: os créditos já foram gastos quando a tarefa abriu, e jogar fora uma
imagem paga por trás de um ícone sem rótulo é exatamente o caso que o AGENTS.md põe na coluna de
rigor alto.

O **webhook** do fornecedor seria um segundo escritor da mesma linha, e a sondagem pelo painel
continuaria como plano B. Ver "Fora desta entrega".

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
-- Este predicado foi refeito pela 0019: passa a nomear os tipos que são
-- desenhados, porque 'none' deixou de ser a única decisão sem imagem.
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

Desde a 0029 (#95, ADR 0004), `is_teacher()` não existe mais. As tabelas de imagem ganharam
`school_id` (nulo é conteúdo comum) e as políticas chamam `is_platform_admin()` e
`is_school_member()`. No bucket, escreve o admin da plataforma em qualquer caminho, e o admin ou o
professor de uma escola só sob a pasta `{school_id}/`; os caminhos de hoje não mudaram.

`scripts/verify-rls.sql` ganha duas coisas: a aluna vê zero `image_attempts`, e um stub do schema
`storage` ao lado do stub de `auth` que já existia. O script roda contra um Postgres puro na CI, onde
`storage` não existe, e sem o stub a 0008 derrubaria o check `verify` na PR. A checagem geral de "toda
tabela com RLS" já cobre a tabela nova.

## Regras de escrita

- **Gerar**: recusa antes de gastar, em `buildPrompt` (`src/lib/images/style.ts`): tipo que não é
  desenhado e Instrução vazia não chegam ao fornecedor. O tipo é lido do banco, não do que a tela
  mandou. A tentativa nasce `pending`, grava o handle e o custo, e segue "A espera".
- **Aprovar**, por `approve_image_attempt`, numa transação: aceita só tentativa `generated` ou
  `approved` (aprovar duas vezes não é erro) e com `storage_path`. Rebaixa a aprovada anterior para
  `generated`, com `decided_at` de volta a nulo, **depois** promove a nova para `approved`, e grava
  `approved_attempt_id` e `image_path` na palavra. Rebaixar para `generated`, e não para `rejected`,
  é da 0016: ser substituída não é ser recusada, e a imagem substituída continua candidata. A ordem
  não é estilo: o índice único parcial não é adiável, então promover antes de rebaixar levanta
  violação no meio da transação.
- **Descartar** (o botão "Descartar e apagar o arquivo"): marca `rejected` e `decided_at`, apaga o
  arquivo do bucket e limpa `storage_path`. `rejected` quer dizer "descartada, e o arquivo foi
  embora".
- **Escolher um tipo que não leva imagem** (`symbol`, `usage`, `metalanguage`, `none`), por
  `clear_word_representation`: grava `representation`, e se havia aprovada, ela volta a `generated`
  e os dois campos da palavra voltam a nulo. Até a 0021 ela virava `rejected`; reclassificar diz que
  a palavra não é desenhada, não que o desenho era ruim, e a imagem fica para o dia em que o
  professor mudar de ideia. `symbol` entrou nessa lista pela 0019: imagem aprovada numa palavra cujo
  caractere a tela desenha é o mesmo pendurado que a regra existe para impedir.
- **Upload à mão** ("Enviar imagem pronta"): cria tentativa `provider = 'upload'`, `status =
'generated'`, e segue o mesmo aprovar. A 0025 fecha o que um upload é: só `generated`, `approved`
  ou `rejected`, nunca `pending` nem `failed`; tem arquivo, salvo se descartado; e tudo que registra
  uma chamada ao fornecedor fica nulo (`model`, `provider_request_id`, `prompt`, `reference_path`,
  `error`).
- **Sugestão do modelo**: grava `suggested_representation` e `word_class`, nunca `representation`.
  Uma classe fora dos doze valores é descartada, não gravada.
- **Nada de otimismo na tela.** A tela mostra o que o banco devolveu depois da escrita, não o que
  ela espera que tenha acontecido.

## Lacunas aceitas

Aceitas em 18/09/2026, registradas para serem conhecidas em vez de esquecidas.

- `approved_attempt_id` não é preso a uma tentativa da mesma palavra. A chave composta que prenderia
  esbarra no `on delete set null`.
- `image_path` é cópia e pode divergir do `storage_path` da tentativa aprovada. O `check` emparelha
  as duas colunas, não as compara.
- O bucket é público e as tentativas substituídas ficam, então uma imagem que não é a aprovada segue
  buscável por URL até a limpeza, que não é desta entrega.
- Há duas chaves estrangeiras entre `vocabulary_items` e `image_attempts`, uma em cada sentido. Todo
  embed do PostgREST entre as duas precisa nomear a chave, como
  `image_attempts!image_attempts_vocabulary_item_id_fkey` em `src/lib/content/queries.ts`; sem o
  nome, a consulta falha por ambiguidade.

## Regras por categoria

Acrescentado em 19/09/2026. O critério geral é onde mora o sentido da palavra.

- **Foto**: o objeto sozinho (pen, book, table). Nome de pessoa é Foto, porque o livro mostra a
  pessoa.
- **Postura**: o corpo está em repouso e a posição dele é o sentido da palavra (standing, sitting,
  lying). Corpo inteiro.
- **Ação**: a pessoa está fazendo alguma coisa (sit down, stand up, smile, speak, write). O desenho
  pega o instante mais legível do movimento.
- **Figura**: diagrama, sem pessoa. Relação e posição são caixa e bola; cor é uma forma fixa
  preenchida, a mesma para todas; país e cidade são a silhueta do mapa. Estado de objeto também é
  Figura: `open` e `closed` estão decididos `figure` no banco (medido em 24/10/2026). Quando duas
  palavras se explicam juntas, o objeto é o mesmo nas duas: a mesma caixa em `box` e em `on`.
- **Símbolo**: não gera imagem, a tela renderiza o caractere.
- **Uso**: palavra funcional, sem nada para desenhar, mas com sentido que uma frase sobre o mundo
  mostra em uso (`a`, `the`, `or`, `this`, `yes`, `where`, `him`). Título sozinho (Mr, Mrs) entra
  aqui: "Mr Brown is a man." é a frase de que ele precisa.
- **Metalinguagem**: a palavra nomeia uma parte da própria língua, e o que a mostra é uma frase sobre
  o inglês, não sobre o mundo (`contraction`, `vowel`, `plural`, `imperative`, `non-specific`).
- **Nada**: não se exibe coisa alguma: nacionalidade e língua.

**Os três nasceram de um só, em 20/09/2026.** `none` estava carregando três respostas sob um nome, e
só uma delas era "não há o que mostrar". O que separa Uso de Metalinguagem é **sobre o que a frase
fala**, e não se há exemplo: metalinguagem também tem exemplo, e o exemplo é o coração de como ela é
ensinada. "Are there any books on the table?" é o que mostra `non-specific`. Migrations
`0018_none_was_three_things.sql` (só os dois valores) e `0019_not_drawn_is_not_nothing.sql` (as 22
linhas, o índice e a função).

Duas coisas caem junto. A linha que punha **título sozinho em Nada** foi escrita quando as únicas
opções eram imagem ou nada, e o mecanismo novo dissolve a premissa. E o **pronome pessoal**, que
estava aqui como item aberto preso à cena do tutor porque figura isolada não diz "him": ele é Uso, e
não precisa de cena nem de desenho, precisa de uma frase que o use.

**Metalinguagem é cobrada da aluna**, não só entendida. O ponto do livro pergunta "What's the
difference between 'any' and 'some'?" e a resposta esperada traz o jargão inteiro. Disso sai uma
regra de apresentação: ela é ancorada no **primeiro ponto em que é possível**, e não no ponto em que
a palavra aparece. `non-specific` entra no 50 e `any`, que ela rotula, no 51, então cobrar no 50
seria fazer uma pergunta cuja resposta exige palavra que a aluna ainda não viu. A coluna que guarda
essa âncora e o trigger que a segura não são desta entrega.

**Consistência de personagem fica de fora, por ora.** Tentada em 19/09/2026, como descrição fixa de
um homem dentro das regras de Postura e Ação. Três gerações reais: uma devolveu uma cadeira sem
ninguém, duas devolveram personagens diferentes entre si e da descrição. Modelo de texto para imagem
não guarda identidade entre chamadas, e o Seedream 4 não aceita imagem de referência, então descrever
era a única alavanca e ela não moveu nada. Saiu do prompt pela PR #21. A referência de estrutura
(0014) e o Flux Kontext Pro, que aceita imagem de referência, entraram depois, mas servem à forma do
desenho, não à identidade de um personagem. O tema volta com a cena (#62); os modelos citados como
candidatos em 19/09/2026 são Flux 2 Pro, Kontext e Mystic.

## Como se escreve a Instrução

**O ângulo é parte do sentido**, em toda categoria que desenha. Pessoa sentada desenhada de frente
não lê como sentada: o que comunica a postura é o joelho dobrado, de perfil. A Instrução é onde o
professor nomeia o ângulo. Descoberto em 19/09/2026, depois de quatro tentativas em `sitting`, e
generalizado no mesmo dia: nasceu valendo só para Postura e Ação, e rodar a regra sobre sete
palavras mostrou que caixa e bola leem de lado, e que a melhor das sete respostas foi um livro
aberto visto de cima. Nomear o ponto de vista vale para qualquer coisa que seja desenhada; **qual**
ponto de vista é o julgamento, e é para fazer esse julgamento que o professor edita a frase.

**Escolha a vista com a silhueta mais reconhecível.** Livro fechado em pé voltou como caixa, como
pasta e como cartão, porque os quatro têm o mesmo contorno; livro aberto não é confundível com nada.
A escolha existe para quase todo objeto e custa uma palavra: tesoura aberta, porta entreaberta.
Descoberto em 19/09/2026.

**Palavra de estado não leva adjetivo.** Para `open`, `closed`, `empty`, `full`, o adjetivo pede ao
modelo que subtraia, e ele não subtrai: faz média. "a closed cardboard box" voltou meio aberta e meio
fechada nos dois modelos, porque a caixa de abas levantadas é a caixa que ele conhece. O que resolve
é nomear um traço positivo que só existe naquele estado: "sealed with packing tape across the top"
funcionou nos dois, porque fita não convive com aba levantada. Descoberto em 19/09/2026.

As regras estão escritas como instruções ao modelo em `src/lib/images/subject.ts`, exportadas em
`LEARNED_RULES` e seguradas por teste, para que sumir do prompt seja uma falha e não uma imagem que
volta a sair errada em silêncio.

**Quando nada funciona, sobe o arquivo.** Uma imagem feita fora da plataforma entra pelo "Enviar
imagem pronta" e segue o mesmo aprovar.

Postura e Ação se separam por **repouso contra atividade**, não pela seta. Teste prático: congele o
desenho. Se ele continuar dizendo a palavra, é Postura; se virar outra palavra, é Ação.

A seta é consequência de desenho, não o critério: ela entra quando o movimento tem direção e fica
fora quando não tem. Por isso `smile` é Ação e não leva seta. Definir a categoria pela seta era o que
estava escrito aqui até 19/09/2026, e estava errado.

**Proveniência do tipo Postura.** Ele nasceu da medição cega da lição 2, em 19/09/2026, onde os dois
únicos erros foram `sitting` e `standing`: decididos Figura e sugeridos Ação. Os dois lados eram
coerentes com o que liam, e é isso que mostrou que faltava uma categoria, não que alguém errou.

## Estilo do desenho

Constantes em `src/lib/images/style.ts`, não editáveis na tela, porque o ponto de ter um estilo é
algumas centenas de imagens lerem como um conjunto em vez de como algumas centenas de decisões
separadas. O professor escreve a Instrução e escolhe o conjunto da palavra (`flat` ou `realistic`,
0017); o estilo entra sozinho. O campo se chamava Assunto na tela até 19/09/2026, e passou a se
chamar Instrução: o que o professor escreve ali é uma ordem para quem desenha, e "assunto" lia como o
tema da palavra.

`buildPrompt` monta o prompt em três partes, nesta ordem: o meio do estilo com a Instrução dentro
(`STYLES[style].medium`, por exemplo "Flat vector illustration of {subject}."), a regra da categoria
(`SUBJECT_RULES[kind]`) e o resto do estilo (`STYLES[style].rest`). O texto em inglês de cada parte
mora só no código, que é o que é enviado; esta spec não o copia, para não envelhecer ao lado dele.

**Reescrito em 19/09/2026 a partir do que voltou, não do que foi pedido.** A constante pedia `bold
outlines` e `no shading`; uma geração real de `sitting` ignorou os dois e devolveu formas chapadas
sem contorno, paleta reduzida e uma sombra suave sob o sujeito, melhor do que o que estava escrito.
Enquanto a constante descrevesse um desenho que ninguém quer, o resultado ficaria sorteando entre
dois, e o conjunto deixaria de parecer um conjunto.

## Migration 0010

Só acrescenta o valor ao enum, uma instrução e nada mais:

```sql
alter type representation_kind add value if not exists 'pose' after 'action';
```

Nada mais pode entrar nesse arquivo. `alter type ... add value` não permite usar o valor novo na
mesma transação em que ele é acrescentado, então qualquer consulta, função ou índice que mencione
`'pose'` tem de esperar uma migration posterior.

## Tela

`/teacher/content/images`. Rigor baixo.

- Lista por lição, na **ordem do livro** (`first_point`), com busca e contadores de palavras
  resolvidas.
- Gaveta de filtros (`filters.ts`) com três grupos: Tipo; Situação (Com imagem, Sem imagem ainda,
  Não leva imagem, Sem decidir); e Classe. Os filtros ativos aparecem como chips.
- Sugestão por lição, que pergunta antes quando a lição já tem sugestões.
- Painel da palavra: tipo (com "Aceitar sugestão"), classe, estilo, Instrução (com "Sugerir
  instrução"), referência de estrutura, modelo, Gerar, Enviar imagem pronta, tentativas com Aprovar e
  Descartar.
- Conjuntos de contraste da palavra.

## Medição

A primeira comparação entre modelos foi feita em 19/09/2026, e o registro dela vive fora deste
repositório. O que ela decidiu está no código: os modelos em `IMAGE_MODELS` e o padrão por tipo em
`defaultModelFor`. A tabela `image_attempts` é a fonte de qualquer medição nova.

## Fora desta entrega

O **webhook do fornecedor** continua fora, por uma razão mais forte do que "depois": ele exige um
endpoint público, e `localhost` não é um. Em dev seria um túnel toda vez. Com a espera na linha,
quando ele entrar não substitui nada: vira um **segundo escritor** da mesma linha, e a sondagem pelo
painel passa a ser o plano B para quando o webhook não chega, que é uma coisa de que ele vai precisar
de qualquer jeito.

Limpeza de arquivos substituídos. Leitura das imagens pela aluna, que precisa abrir
`vocabulary_items` para a aluna ler o que já foi introduzido. A cena do tutor e o elenco de
personagens, que andam com a #62.
