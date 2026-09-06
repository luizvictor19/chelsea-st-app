# Ingestão de conteúdo

Fase anterior à geração de aula. Sem conteúdo, nem a tela compartilhada nem o desafio do dia têm o
que mostrar.

## Objetivo

Popular o banco com o mapa curricular dos 12 livros a partir de prints das páginas, sem custo por
página. O conteúdo extraído alimenta dois consumidores:

1. **Tela compartilhada da aula.** O professor compartilha a tela e a aluna vê, na ordem do livro, o
   vocabulário do ponto atual, a imagem do objeto, o texto explicativo em inglês e as frases de
   prática geradas.
2. **Desafio do dia.** Fora da aula, sobre o vocabulário já introduzido, com repetição espaçada
   individual.

As frases de prática são geradas por nós a partir dos alvos extraídos. As frases de exemplo do livro
não são gravadas.

## Anatomia da página, verificada

Medido em 61 páginas do livro 2 normalizadas para 1100px de largura.

| Elemento                          | Onde fica                             | Como se reconhece                                                        |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Caixa de vocabulário ou gramática | Faixa sombreada `(232,235,243)`       | Linha com mais de 45% de pixels sombreados                               |
| Número do ponto                   | Margem esquerda, fora da caixa        | OCR da faixa à esquerda de `box_left`                                    |
| Cabeçalho de lição                | Topo da página, caixa alta            | Regex `LESSON \d+`                                                       |
| Texto explicativo                 | Branco, justificado na coluna inteira | Linha que começa na margem do texto e não tem vão interno maior que 25px |
| Pergunta e resposta               | Branco, duas colunas                  | Vão interno de 80px ou mais, ou início à direita do centro               |
| Ditado                            | Branco, parágrafo com barras          | Densidade de tokens contendo `/` acima de 0,10                           |
| Exercício de revisão              | Branco, com ícone                     | Regex `Revision Exercise \d+`                                            |
| Referência de chart               | Branco, com ícone                     | Regex `See Chart \d+`                                                    |

`box_left` é o menor x da máscara sombreada da página. Serve de referência para tudo: a margem dos
números fica à esquerda dele, a coluna de texto começa nele.

### Números de ponto, não de unidade

Os números da margem são sequenciais e globais dentro do livro, e não reiniciam por lição. A Lição
17 vai do ponto 90 ao 93, a 18 do 94 ao 98. Vários caem no meio de uma sequência de perguntas, sem
caixa nenhuma começando ali.

Consequências:

- A fronteira de lição vem do cabeçalho `LESSON N`, nunca dos números.
- Os números são a régua fina de progresso dentro da lição, e é neles que o marcador de onde o
  professor parou se apoia.
- Os números dão a ordem das páginas. O professor pode subir na ordem que quiser.
- Os números são a chave de deduplicação. Subir a mesma página duas vezes, em resoluções
  diferentes, não duplica nada.
- Buraco na sequência é página faltando, e a tela avisa quais.

## Como a extração funciona

1. **Normalizar** a imagem para 1100px de largura. A escolha de zoom do professor deixa de importar.
2. **Máscara sombreada** e agrupamento em faixas contíguas.
3. **Fundir faixas** separadas por menos de 16px. Caixa com texto denso perde a proporção de sombra
   em algumas linhas e se parte em duas sem isso.
4. **Descartar faixas** com menos de 35px de altura. São artefatos de sublinhado, nunca conteúdo.
5. **Ler os números** da margem com Tesseract em três combinações de recorte e modo de segmentação,
   `box_left - 2` com psm 6, `box_left + 22` com psm 6 e `box_left + 14` com psm 11, e unir os
   resultados. Nenhuma combinação sozinha acerta todos, e as três juntas acertam todos.
6. **Validar por sequência e por teto**, nunca por confiança. Um `123` legítimo saiu com confiança 0
   e um `1` falso saiu com 68. O que separa sinal de ruído é a monotonia da sequência mais o teto
   `books.last_point`, que mata leituras coladas como `1091` na página do ponto 109.
7. **Ler as caixas** com Tesseract, uma por vez.
8. **Ler as explicações** pela geometria das linhas descrita na tabela acima.
9. **Marcar para revisão** toda caixa com mais de 250px de altura. São tabelas de conjugação e
   grades de comparação, e o achatamento em uma linha perde o pareamento das colunas.
10. **Desviar as páginas de exercício de revisão.** Uma página cujo texto casa com
    `Revision Exercise \d+ \(Lessons \d+ . \d+\)` é um segundo tipo de página, não uma página de
    lição, e o pipeline acima a destrói: 61% a 73% dela é sombreada, então o detector devolve uma
    caixa única de cerca de 1400px marcada como tabela. Ela é classificada como tipo não suportado,
    não é extraída, não grava nada, e a tela diz isso. Continuação herda do último cabeçalho visto,
    mesma regra do `LESSON N`, para as páginas do meio caírem no mesmo desvio.

    O cabeçalho pede a faixa de lições entre parênteses de propósito. O marcador
    `Do Revision Exercise N`, que aparece solto no meio de página de ditado legítima, não casa com
    ele e continua sendo extraído como bloco.

## Resultado medido

61 páginas, cobrindo as lições 10 a 24 do livro 2, ou seja os pontos 53 a 128 sem buraco.

| Métrica                                                 | Resultado                                          |
| ------------------------------------------------------- | -------------------------------------------------- |
| Números de ponto recuperados                            | 76 de 76                                           |
| Caixas detectadas                                       | 154, sem falso positivo após fusão e altura mínima |
| Caixas de vocabulário extraídas palavra por palavra     | 141 de 154                                         |
| Caixas achatadas, marcadas automaticamente              | 13 de 154                                          |
| Cabeçalhos `LESSON N`                                   | 15 de 15                                           |
| `Revision Exercise N`                                   | 4 de 4                                             |
| `See Chart N`                                           | 9 de 9                                             |
| Páginas de ditado identificadas por densidade de barras | 8 de 8                                             |
| Ocorrências de `Dictation N` lidas por OCR              | 1 de 8                                             |

O texto `Dictation N` é itálico claro ao lado de um ícone e o OCR não o lê. A densidade de barras
identifica a página com folga: páginas de ditado ficam entre 0,11 e 0,35, todas as outras abaixo de
0,07. O número do ditado sai da ordem de ocorrência no livro, não do OCR.

As tabelas achatadas são detectáveis pela altura, então o programa sabe quais errou e as apresenta
para correção. O professor não precisa procurar.

## Schema: migration 0004

Substitui `stages`, que não tem dado e é raso demais.

**books**: os 12. `position` de 1 a 12, `title`, `last_point` digitado pelo professor, `created_at`.

**lessons_content**: a lição do livro. `book_id`, `number`, `first_point`, `last_point`, único por
`(book_id, number)`. Nome com sufixo para não colidir com `lessons`, que são as aulas da aluna.

**points**: o ponto numerado. `book_id`, `number`, `lesson_content_id`, `filled_at` nulo enquanto
vazio, único por `(book_id, number)`.

**blocks**: uma unidade de conteúdo dentro de um ponto. `point_id`, `position`, `content`,
`needs_review` boolean, e `kind` como enum `block_kind`: `vocabulary`, `grammar_table`,
`explanation`, `dictation`, `revision_exercise`, `chart_ref`.

**vocabulary_items**: a palavra, única no sistema. `term`, `first_point_id`, `image_path` nulo até
subirem a imagem.

`questions` deixa de apontar para `stages` e passa a apontar para `points`.

RLS e grants na mesma migration, no padrão das outras. Só professor lê e escreve conteúdo. Aluna
alcança `questions` publicadas e mais nada.

### Formato de `blocks.content` numa tabela

`blocks.content` é texto puro. Num bloco `grammar_table` ele carrega uma convenção que hoje só
existe no editor, e o mesmo campo vai ser lido pela tela compartilhada da aula e pelo desafio do
dia. A regra fica escrita aqui antes de existir um segundo leitor.

- `|` separa coluna, linha em branco separa sub-bloco.
- Linha sem nenhum `|` é o título do sub-bloco que vem depois dela.
- Linha de uma célula só grava com `|` no fim. É esse `|` final que a distingue de um título, que
  não tem nenhum.
- Bloco sem nenhum `|` no conteúdo inteiro é tabela achatada: a extração não conseguiu separar as
  colunas e ninguém separou à mão ainda. Cada linha dele é uma linha de uma célula, nenhuma é
  título.

```
Present continuous (negative)
I | am not speaking
you | are not speaking
he, she, it | is not speaking
ver também o chart 3 |
```

Quatro linhas de tabela, a primeira delas título, a última de uma célula só. E uma tabela achatada,
que é a forma que chega marcada com `needs_review`:

```
many more than the most
few fewer than the fewest
```

**Consequência para quem consome:** ao dar split em `|`, descarte uma última célula vazia, que é o
marcador da linha de uma célula e não uma coluna. Duas células vazias seguidas no fim nunca são
geradas, então descartar uma basta. Célula vazia no meio é buraco de verdade na linha e se mantém.

## Telas

**`/teacher/content`**: os 12 livros, cada um com barra de pontos preenchidos contra `last_point`, e
uma barra geral. Livro sem `last_point` aparece como não configurado.

**`/teacher/content/[book]`**: campo do último ponto do livro, área de upload, lista dos pontos
mostrando quais estão preenchidos, e destaque para buracos na sequência.

**Revisão da extração**: depois do upload, por ponto, mostra o que foi extraído com as linhas
editáveis e o `kind` trocável. As caixas com `needs_review` aparecem primeiro, com a imagem do
recorte original ao lado, para o professor reconstruir a tabela. Grava só ao confirmar.

Três responsabilidades a mais, que apareceram ao construir:

1. **Resolver número de ponto não atribuído.** Quando a reconciliação não consegue decidir, a tela
   mostra a página, os candidatos que ela listou, e a opção "sem número, é continuação". Nas 60
   páginas de teste isso acontece 4 vezes: três leituras de ruído e o ponto 74, cuja página lê
   `4`, `45` e `74` com uma config cada e não tem outro número para corroborar.
2. **As caixas com `needs_review` vêm primeiro**, com o recorte original ao lado.
3. **A idempotência do critério 4 mora aqui, não no banco.** Ao confirmar, os `blocks` do ponto são
   apagados antes de inserir os novos. O `unique (point_id, position)` impede o bug, não faz upsert;
   está dito no comentário da migration 0004.

**`/teacher/content/images`**: as palavras sem imagem, com upload. Barra própria.

## Geração das frases

Entrada: os `blocks` de tipo `vocabulary` e `explanation` do ponto, mais todo o vocabulário dos
pontos anteriores do mesmo livro e dos livros anteriores.

Restrição dura: uma frase gerada só pode usar palavras já introduzidas até aquele ponto. É o que
sustenta o método. Uma frase que use vocabulário futuro quebra a aula.

Saída: linhas em `questions`, ligadas ao ponto, revisadas pelo professor antes de publicar.

## Revisão e ditado

O calendário não é regra nossa, é do livro. `Dictation N` e `Do Revision Exercise N` são extraídos
como `blocks` e a plataforma os apresenta quando a aula chega naquele ponto. O texto do ditado já
vem fatiado pelas barras, que são as pausas de leitura.

A revisão espaçada individual, essa sim é nossa, e sai dos `attempts` da aluna pelo
`review_schedule` que já existe.

## Critérios de aceite

Cada critério é um teste. Os testes correm contra fixtures sintéticas, geradas com a
geometria medida e conteúdo original, porque a verdade de referência é construída em vez
de rotulada à mão. As páginas reais ficam fora do repositório, uma pasta por livro: as 61
do livro 2 em `fixtures/real/book2/`, com o `manifest.json` e a baseline de prosa ao lado,
e as 31 do livro 1 em `fixtures/real/book1/`, com o `truth.txt` lido à mão. Elas servem a
um smoke test local que nenhum critério depende, e o alvo desse smoke test é o gabarito que
acompanha as páginas, nunca a saída anterior do próprio extrator.

A pasta é por livro porque a faixa do livro é o que valida uma leitura de margem: o
reconciliador descarta tudo abaixo do primeiro ponto e acima do último, então um `3` solto
é ruído no livro 2, que vai de 53 a 128, e número de ponto de verdade no livro 1, que vai
de 1 a 52. Toda medição diz contra qual pasta correu, e os scripts locais recebem
`--fixtures`.

1. Definir `last_point` como 128 cria 128 pontos vazios e a barra mostra 0 de 128.
2. Subir as 61 páginas de teste, em ordem aleatória, preenche exatamente os pontos 53 a 128, e
   nenhum outro.
3. Subir o mesmo lote sem as páginas dos pontos 84 a 88 faz a tela do livro listar esse buraco como
   páginas faltando.
4. Subir a mesma página duas vezes, em 519px e em 534px de largura, não duplica nenhum bloco.
5. As 13 caixas de tabela aparecem com `needs_review` verdadeiro e o recorte original ao lado.
6. Uma caixa larga com texto denso o bastante para partir em duas faixas é reconstituída como uma
   caixa só, com o conteúdo completo.
7. Um parágrafo justificado na coluna inteira vira bloco `explanation`, e nenhuma linha de
   pergunta e resposta vira bloco.
8. As 8 páginas de ditado produzem um bloco `dictation` cada, com as barras preservadas.
9. Uma página sem número na margem herda o ponto corrente da sequência de upload. Uma imagem
   sem número, sem caixa sombreada, sem cabeçalho de lição e sem parágrafo de ditado é recusada
   com mensagem e nada é gravado.
10. Aluna autenticada recebe zero linhas ao consultar `books`, `lessons_content`, `points` e
    `blocks`.
11. `prettier --check`, `lint`, `tsc --noEmit`, `test` e `build` passam.

## Dependência

O marcador de onde o professor parou precisa de uma tabela ligando a aula aos pontos cobertos. Não
entra aqui, entra na F2, mas o campo de referência é `points.id`.

## Decisões resolvidas

O que já foi decidido e implementado, com a medição que decidiu. Nada aqui está pendente: uma seção
que descreve o que o código faz hoje não é escopo futuro, e ficar sob "Fora de escopo" já fez o
`psm 6` ser lido como pendência meses depois de estar rodando.

### Formato da tabela de gramática

As caixas com `needs_review` são reescritas à mão e aparecem na tela compartilhada
durante a aula, então o que o professor digita é o que a aluna lê. São ~150 nos 12
livros, e sem convenção cada uma sai de um jeito.

Três regras:

- uma linha por linha da tabela
- colunas separadas por `|`
- linha em branco começa outro bloco, e linha sem `|` é o título do bloco seguinte

```
Present continuous (negative)
I | am not speaking
you | are not speaking
he, she, it | is not speaking
we, you, they | are not speaking
```

Cobre as três formas que o livro usa: grade de conjugação, comparação de duas
colunas com cabeçalho (`Possessive adjectives | Possessive pronouns`) e grade de
três (`many | more ... than | the most`).

O separador é `|` porque `/` é a pausa de leitura do ditado e colidiria, `;`
aparece dentro de texto normal, e tabulação é invisível num campo de texto.

A tela não pede essa sintaxe ao professor: o bloco é editado como **grade de
células**, e a convenção acima é só a forma gravada. Ver "Formato de
`blocks.content` numa tabela", junto do schema.

### Separação de termos do vocabulário, resolvida

Os termos de uma caixa são separados por **coluna**, não por espaço. Achatados em
texto, `a day` e `flower plant` ficam idênticos: duas palavras com um espaço. Um
é um termo, o outro são dois, e só a geometria distingue.

Medido nas caixas normais das 61 fixtures: **68 vãos entre 8 e 19px, 170 a partir
de 70px, e nenhum entre os dois**. O corte fica em 45, no meio de um vazio de
50px, e a separação acontece na extração, onde as posições ainda existem.

Um bloco de vocabulário passa a carregar os termos separados por vírgula, e a
tela mostra a vírgula como fronteira editável, para o professor corrigir onde ela
caiu errado.

Com isso morre o filtro de palavra de uma letra: o `a` do ponto 117 é termo por
ocupar coluna própria, não por tamanho, e `the fewest` deixa de virar `the` e
`fewest` soltos em `vocabulary_items`.

### Cabeçalho LESSON, medido e mantido como está

O cabeçalho `LESSON N` vale para a imagem inteira, e uma página carrega até dois pontos. Se ele
estivesse impresso abaixo do primeiro número da própria página, esse ponto pertenceria à lição
anterior e o `first_point` gravado ficaria um ponto baixo demais. Isso importa porque
`first_point` é a chave contra a qual todo outro ponto é resolvido.

Medido com `scripts/measure-lesson-headers.ts` nas 15 páginas das 61 fixtures que carregam
cabeçalho: **em nenhuma delas um número da própria página está acima do cabeçalho**. O cabeçalho fica
entre `y` 68 e 78, o primeiro número da página entre 228 e 269, e a menor folga entre os dois é de
**91px**; o segundo número, quando existe, fica entre 966 e 1464.

Duas consequências. A regra atual está certa: os dois pontos de uma página de cabeçalho pertencem
mesmo à lição que ela abre. E não há o que separar pela horizontal: cada imagem é **uma página**
retrato (519×778, normalizada para 1100 de largura), com os dois números empilhados na vertical, e
não uma folha dupla com uma página em cada metade. Uma foto de folha dupla não passaria pelo
extrator de qualquer forma, que lê a coluna de margem à esquerda de uma página só.

Fica anotado que a medição vale para o livro 2. Um livro em que uma lição comece no meio da página
mudaria a resposta, e aí o corte seria pela vertical, cabeçalho contra o `y` de cada número, e
não pela horizontal.

### Modo de segmentação na leitura das caixas

**Implementado:** `psm 6` nas caixas normais, modo automático nas altas. O corte é o `needs_review` que já existe, não um
limiar novo.

Medido nas 151 caixas das fixtures, separando pelas duas populações:

|                                    | idênticas | diferentes |
| ---------------------------------- | --------- | ---------- |
| Normais (139, aceitas sem revisão) | 136       | 3          |
| Altas (12, vão para revisão)       | 3         | 9          |

Nas normais, a única diferença de substância é o `psm 6` recuperar o `a` da caixa
`a some`, que o modo automático perde. As outras duas acrescentam um `|` solto no
fim, artefato de borda de tabela.

A assimetria é o que decide. Perder uma palavra é silencioso e permanente: ela
nunca entra em `vocabulary_items` e fica proibida para a geração de frases. Ganhar
um `|` é visível no campo de revisão e inofensivo. E toda a instabilidade de
verdade, 9 de 12, está nas caixas altas, que um humano vai reescrever de qualquer
jeito.

A fronteira não é escolhida por esses exemplos: as alturas medidas são 45 a 58px
nas normais e 265 a 613px nas altas, 207px de vazio entre as duas populações e
nada perto do corte. `needs_review` já significa "um humano vai olhar isto", que é
exatamente a condição em que um erro de OCR deixa de ser silencioso.

Fica anotado que o `|` solto é filtrável por si, mas isso é outra mudança e pede
a sua própria medição.

### Portão de agreement, medido, e a contradição que ele carrega

`reconcilePoints` só fixa uma leitura de margem se algo a corrobora, e a primeira das três
maneiras é `agreement >= 2`: dois dos três recortes de margem viram o mesmo número
(`src/lib/extraction/reconcile.ts:274`). Esse `2` é literal, não está em `constants.ts`, e não
tinha medição nenhuma ao lado. Pior: `src/lib/extraction/margin-numbers.ts:31-37` diz, com todas
as letras, que a contagem é "a diagnostic, not yet a decision: no rule uses it until there is a
measurement saying it separates signal from noise". As duas afirmações não podem ser verdadeiras
ao mesmo tempo. Esta seção é a medição que faltava, feita com
`scripts/measure-agreement-gate.ts` contra `fixtures/real/book1/truth.txt` e contra o
`manifest.json` do livro 2.

|                                 | livro 1 (1..52) | livro 2 (53..128) |
| ------------------------------- | --------------- | ----------------- |
| números verdadeiros lidos       | 51 de 52        | 78 de 78          |
| agreement 1 / 2 / 3             | 3 / 13 / 35     | 4 / 18 / 56       |
| verdadeiros que o portão recusa | 3 (5,9%)        | 4 (5,1%)          |
| ruído na faixa do livro         | 1               | 3                 |
| ruído que o portão deixa passar | 0               | 1                 |
| lote inteiro: pontos resolvidos | 48 de 52        | 76 de 78          |
| páginas que viram pergunta      | 1 de 31         | 0 de 61           |

**O dígito único não é o problema.** O portão separa sinal de ruído no livro 1 tão bem quanto no
livro 2, e recusa a mesma fatia de verdadeiros nos dois. O que muda é a **concentração**. No livro
2 as quatro recusas caem em quatro páginas diferentes, e em três delas o outro número da página
foi corroborado, então a regra (c) do `mayAssign` resolve as duas: "continua a sequência
crescente ao lado de um número já fixado na mesma página". No livro 1 as três recusas caem todas na
**mesma página**: a primeira do livro, a única com três pontos, `1@256 2@494 3@1208`, cada um visto
por um recorte só. Sem irmão corroborado, sem piso (o primeiro ponto do livro é 1, então
`boundedBelow` nunca liga) e sem teto, nada arranca, e a página inteira vai para a professora.

**Implementado.** A corroboração deixou de ser só `agreement >= 2` e passou a ser
`agreement >= MARGIN_AGREEMENT` **ou** a própria ordem impressa, exigindo cadeia de pelo menos
`MARGIN_CHAIN_MINIMUM` números: se, depois de `narrowByPageMonotonicity`, todos os grupos da página
tiverem exatamente um candidato e esses candidatos crescerem na ordem em que estão impressos, a
página se fixa. Os dois números estão em `constants.ts` com esta medição ao lado, e o `2` literal
saiu de `reconcile.ts`.

A ordem impressa é fato sobre o livro, não inferência, e a passagem que a lê já tinha feito a parte
perigosa: qualquer leitura que não caiba numa corrida crescente já foi apagada antes. A cadeia é
lida uma vez só, logo depois dessa passagem e antes de qualquer atribuição, para descrever o que os
recortes devolveram e não um estado que uma remoção entre páginas produziu depois.

O mínimo de dois é o que segura. Uma página de um número só não tem ordem impressa para corroborar
nada, e leitura solta com agreement 1 é justamente o formato do ruído: 29 das 31 leituras de
ruído do livro 2 têm agreement 1. Medido depois da mudança: dispara em uma das 31 páginas do livro 1,
levando o lote de 48 para 51 dos 52 pontos, e em nenhuma das 61 do livro 2, que continua em 76 de
76 sem nenhuma pergunta. Admite zero ruído nos dois. O único ruído dentro da faixa no livro 1 é um
`1` lido na mesma altura do `11` verdadeiro, que vira candidato rival no mesmo grupo e morre na
monotonicidade; os do livro 2 ou dividem posição com um número real ou são um grupo de dois
candidatos, e nenhum dos dois é cadeia.

O ponto que sobra no livro 1 é o `6` da terceira página, que nenhum recorte leu. Esse é pergunta
legítima, e continua sendo.

### Folga das constantes de painel, livro 1 contra livro 2

Todos os limiares de painel foram medidos no livro 2. O livro 1 tem densidade diferente, chegando
a três pontos numa página, então a folga de cada um foi medida de novo, com
`scripts/measure-agreement-gate.ts` e `scripts/measure-term-columns.ts`. Nenhum corte precisa
mudar. Dois encolheram o bastante para valer nota.

| constante                  | livro 1                                    | livro 2                                     |
| -------------------------- | ------------------------------------------ | ------------------------------------------- |
| `MERGE_GAP` 16             | 96 vãos: 11 unidos até 11px, 85 desde 28px | 106 vãos: 6 unidos até 11px, 100 desde 28px |
| `MIN_BOX_HEIGHT` 35        | 116 caixas, a mais baixa 45px              | 154 caixas, a mais baixa 45px               |
| `TABLE_HEIGHT` 250         | normais até **187px**, altas desde 267px   | normais até 58px, altas desde 265px         |
| `TERM_COLUMN_GAP` 45       | dentro até 15,5px, entre desde **51px**    | dentro até 11px, entre desde 75px           |
| `TABLE_COLUMN_GAP` 54      | dentro até 17,5px, entre desde 201,5px     | dentro até 39,5px, entre desde 68,5px       |
| `TABLE_LINE_TOLERANCE` .64 | 74 palavras a até 0,35, linhas a 1,72      | 211 palavras a até 0,39, linhas a 0,89      |

Os dois que encolheram:

- **`TABLE_HEIGHT`.** O livro 1 tem painéis de vocabulário de várias linhas que o livro 2 não tem,
  e eles chegam a 187px. O vazio entre painel normal e tabela cai de 207px para 80px. O corte
  continua no meio de um vazio, mas a folga é um terço da que foi medida.
- **`TERM_COLUMN_GAP`.** O menor vão entre termos cai de 75px para 51px, contra um corte de 45:
  6px de folga, contra 30px no livro 2. É a constante mais apertada das cinco, e a que erra em
  silêncio: dois termos colados viram uma entrada só em `vocabulary_items`.

Os números do livro 2 aqui foram medidos com o tesseract.js do projeto, e não com a baseline do
CLI que a `constants.ts` cita; as duas populações caem no mesmo lugar, com contagens próximas mas
não idênticas.

### Onde um bloco cai numa página, medido

`pointForBlock` diz que um bloco pertence ao último número impresso **acima** dele, e cai em
`placements[0]` quando não há nenhum (`src/lib/extraction/pipeline.ts:266-279`). Medido nas duas
coleções, as duas metades dessa frase erram.

**O número não fica acima do painel que ele nomeia, fica dentro dele.** Distância entre o `y` do
número e o topo do bloco que ele rotula: livro 1, 29 casos, de 2 a 23px; livro 2, 40 casos, de 2 a
20px. O bloco seguinte para cima começa a 92px no livro 1 e a 72px no livro 2. Vazio de 49px entre
as duas populações, nos dois livros juntos, e nada dentro dele. Como `placement.y <= blockTop`
exige o número acima do topo, o painel vai para o número **anterior**: 11 blocos em 11 páginas no
livro 1, e 11 blocos em 11 páginas no livro 2.

**Conteúdo acima do primeiro número da página pertence ao último ponto da página anterior**, e hoje
vai para `placements[0]`, que é o primeiro número desta: 29 blocos em 14 das 30 páginas medíveis do
livro 1, 51 blocos em 27 das 61 do livro 2.

Isto não é hipótese. Dos 22 blocos já gravados do livro 2, três estão no ponto errado:
`begin, end, last, how long` está no 114 e é do 115, `cheap, expensive, Rolls Royce` e `the fewest`
estão no 116 e são do 115, `whose` está no 117 e é do 118. Conferido nas imagens.

**Implementado**, nas duas metades. Um número impresso dentro da faixa `POINT_LABEL_REACH` a
partir do topo de um bloco rotula esse bloco; o corte é 47, no meio do vazio medido de 49px, e a
medição está ao lado da constante. E um bloco acima de todos os números da página cai no ponto em
que a página abre, que a reconciliação passou a calcular como `openingPoint`: o ponto em vigor
quando a página começa, tirado antes de contar os números da própria página. Não é o mesmo que
`inheritedPoint`, que só responde por uma página sem número nenhum, e que continua valendo
exatamente o que valia.

`pointForBlock` passou a poder devolver `null`, e quem chama carrega isso: significa que nada na
página decide. Acontece quando a página abre o envio, e quando falta um número entre o ponto de
abertura e o primeiro número da página. O que faltou foi impresso em algum lugar, e um bloco
acima do primeiro número pode ser dele ou do anterior. A tela segura a página, diz por quê e não grava
nada dela. Na `6 7` do livro 1, cujo `6` nenhum recorte leu, é exatamente o que acontece.

Com uma exceção que não é dúvida nenhuma: a página que carrega o **primeiro ponto do livro** abre
nele. Nada no livro o precede, então o que está impresso acima dele é dele. Sem isso a primeira
página de um livro nunca poderia ser confirmada enquanto tivesse qualquer coisa acima do primeiro
número, e a mensagem mandaria subir uma página anterior que não existe.

Duas consequências que vieram junto. O cabeçalho, o trilho e a pergunta de lição nomeiam agora
todos os pontos que a página grava, e não só os números que ela carrega, senão a página diria
"Ponto 116" enquanto grava 115 e 116. Pior: gravaria o 115 com uma lição que ninguém foi
perguntado sobre.

E o que pode ser **substituído** ficou mais estreito do que o que é gravado. `authoredPoints` são os
pontos que a página assina: os números dela, ou o ponto que ela herda. O ponto de abertura não é
um deles, porque quem o escreveu foi a página anterior, então confirmar esta página acrescenta
lá e nunca limpa. Sem essa distinção, uma página que grava no ponto da anterior apagaria o trabalho
dela.

O cabeçalho `LESSON` da página também deixou de responder pelo ponto de abertura, mas só onde há
de fato uma fronteira. Só quando a página **abre** a lição: aí o cabeçalho está impresso entre o
ponto de cima e os números da página, e o ponto de cima está do outro lado dele. Uma página que
apenas herdou a lição de outra página do mesmo envio não tem fronteira nenhuma, e a lição dela vale
para o ponto de abertura como vale para os próprios. E uma página sem número próprio não é este
caso: ela abre no ponto que herda, esse ponto é a página inteira, e a lição dela é a lição dele.

Onde a fronteira existe, a resposta digitada pela professora também não vale para o ponto de
abertura: ela está respondendo sobre a lição que esta página abre. A página espera a anterior ser
confirmada e diz isso.

Medido antes e depois com `scripts/dump-block-points.ts`, sobre as fixtures dos dois livros: 61
blocos mudaram de ponto no livro 1 e 62 no livro 2, e todos eles são de um destes três tipos: 22
painéis cujo número está impresso dentro deles, 91 blocos acima do primeiro número da página, e 10
blocos da primeira página do livro 1, que o portão não resolvia. Nenhum movimento de outra
natureza, nenhuma duplicata mudou de lado, e `inheritedPoint` não mudou em nenhuma página dos dois
livros.

#### As duas perguntas que o `openingPoint` respondia de uma vez

E a fronteira precisa de uma página do outro lado dela. Aqui o `openingPoint` estava respondendo
duas perguntas diferentes com o mesmo número, e na primeira página de um livro elas divergem: quem
é dono do que está impresso acima do primeiro número dela é o próprio ponto 1, mas o que vem antes
da página é nada. Lida como "o ponto acima está na página anterior", a primeira página do livro 1
segurava o próprio ponto 1 à espera de uma lição anterior à 1, e mandava subir uma página que não
existe. A reconciliação agora devolve as duas separadas, `precedingPoint` e `openingPoint`, e cada
consumidor escolhe pelo nome a pergunta que está fazendo em vez de lembrar da distinção: quem
arquiva bloco lê `openingPoint`, quem pergunta o que há do outro lado do topo da página lê
`precedingPoint`.

Medido com `scripts/dump-block-points.ts` sobre as fixtures dos dois livros antes e depois desta
separação: 361 blocos, nenhum mudou de ponto. Ela não move arquivamento nenhum, só destrava a
pergunta de lição. A única diferença de comportamento é fora das fixtures: uma primeira página de
livro cujo número mais baixo tivesse sido lido como `first + 2` ou mais era segurada pela checagem
de lacuna, e agora cai no primeiro ponto do livro, porque acima dele não há o que faltar.

### Exercícios de revisão, suporte completo

Fica para depois que as telas funcionarem ponta a ponta com página de lição. Por ora só existe o
desvio descrito no passo 10. O que vai ser preciso quando voltarmos:

- **A dificuldade é a mesma das tabelas.** O número do item fica numa coluna estreita à esquerda e o
  Tesseract separa os números do texto. O conserto é o `marginNumbers` aplicado a outra coluna:
  recorta a coluna de números com whitelist de dígitos pegando o `y`, recorta a coluna de texto,
  pareia por `y`.
- **Não cabem em `blocks`**, que guarda um `content` só. Pedem `revision_exercises`
  (`book_id`, `number`, `first_lesson`, `last_lesson`) e `revision_exercise_items`
  (`exercise_id`, `position`, `prompt`, `answer`).
- **O marcador `Do Revision Exercise N`** que já extraímos passa a apontar para a linha real em vez
  de ser só um lembrete.
