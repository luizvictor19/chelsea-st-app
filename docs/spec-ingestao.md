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

## Telas

**`/teacher/content`**: os 12 livros, cada um com barra de pontos preenchidos contra `last_point`, e
uma barra geral. Livro sem `last_point` aparece como não configurado.

**`/teacher/content/[book]`**: campo do último ponto do livro, área de upload, lista dos pontos
mostrando quais estão preenchidos, e destaque para buracos na sequência.

**Revisão da extração**: depois do upload, por ponto, mostra o que foi extraído com as linhas
editáveis e o `kind` trocável. As caixas com `needs_review` aparecem primeiro, com a imagem do
recorte original ao lado, para o professor reconstruir a tabela. Grava só ao confirmar.

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
de rotulada à mão. As 61 páginas reais ficam em `fixtures/real/`, fora do repositório, e
servem a um smoke test local que nenhum critério depende. O alvo desse smoke test é o
`manifest.json` que acompanha as páginas, nunca a saída anterior do próprio extrator.

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

## Fora de escopo

Geração das perguntas, que usa estes alvos como entrada. Exclusão de livro. Edição de ponto fora do
fluxo de upload.
