# Robin: o tutor de voz

Escrita em 12/11/2026 (#247), a partir de quatro fontes. Quando duas divergem, vale a mais recente:

- o ADR 0006 (12/11/2026);
- as notas de 11/11/2026 na #71, #248, #250 e #255;
- o plano da #71 (07/11/2026);
- a spec consolidada pelo Luiz em 06/11/2026, que fica fora do repositório porque tem preço e
  oferta.

Este arquivo é só a parte técnica. Não traz preço, oferta, plano por nome nem nome de aluna. O
schema é das migrations: onde este texto e uma migration divergirem, vale a migration.

Uma sub-issue que muda uma regra daqui atualiza este arquivo na mesma PR.

## O que o Robin é

Uma sessão diária curta, por voz, que segue a trilha do livro ponto por ponto. A pessoa segura o
botão para falar e solta para ouvir. Não existe conversa livre.

É o nível 1 do ADR 0006, a trilha. Não gasta crédito e é limitado por minutos por dia. A voz ao
vivo (#277) e o vídeo (#278) são outros níveis, sobre o mesmo motor, e ficam fora da v1.

**Um motor, duas marcas.** A sessão, as regras, o juiz, o conteúdo e a fila por pessoa são os
mesmos nas duas marcas. Muda só a cara: Robin no Chelsea St e Grifo na GrifoAI (nome, mascote, cor e
voz), tudo em `src/lib/brand.ts` (#217).

**O Robin sempre conduz a trilha.** O modo revisor de 07/11, em que quem tinha aula ao vivo recebia
um Robin limitado pelo último "Parei aqui", foi retirado em 11/11 (ADR 0006). Motivo: a aula com
professor passou a ser reservada e paga com créditos (#276), e o professor segue a trilha. O
`lesson_schedules` não muda o comportamento do tutor.

## Regras

Valem para tudo abaixo.

- **Nunca traduz.** O método não traduz. A única exceção é a pergunta de tradução (ver "A pergunta
  de tradução").
- **Só usa palavra que a trilha já apresentou.**
- **O estado é por pessoa** e nunca é compartilhado.
- **Na dúvida, encerra a vez e registra,** em vez de inventar.

## A sessão de conteúdo novo

1. **Abertura.** Continua exatamente de onde a sessão anterior parou.
2. **Revisão curta.** Primeiro as perguntas descartadas na sessão anterior (ver "A vez da pessoa"),
   depois as vencidas na revisão espaçada. Ditas no ritmo normal.
3. **Conteúdo novo, ponto por ponto:**
   - **Apresentação.** A imagem aparece e o tutor diz a palavra.
     - Um conjunto de contraste é apresentado inteiro, de uma vez, no ponto do membro mais tardio
       (derivado na leitura).
     - Palavra sem imagem segue a regra de apresentação do tipo dela (`spec-imagens.md`).
   - **Perguntas.** Cada pergunta é dita duas vezes, rápido. A resposta esperada é uma frase
     completa, com a gramática da pergunta e com contração.
   - **Modelagem.** Numa pergunta nova, o tutor primeiro pergunta e ele mesmo responde ("Is this a
     pen? Yes, it's a pen."). A pessoa repete a resposta, e só então ele pergunta de novo para ela
     responder sozinha.
   - **Texto da pergunta na tela.** Para quem começa, aparece sempre. Conforme a pessoa acerta de
     primeira, ele some, pelo menos nas revisões, e volta se ela errar de novo.
     - A modelagem some e volta pelo mesmo critério.
     - Os dois são derivados do histórico de acerto, não guardados.
   - **Texto de explicação.** O tutor lê em voz alta e depois pede que a pessoa leia.
     - A leitura dela passa pelo mesmo juiz, com o texto como resposta esperada, e é a medida de
       leitura.
     - Texto longo é dividido por frase.
4. **Fim.** No teto do dia, o tutor termina a pergunta atual e para. A próxima sessão continua
   dali.

Quantas perguntas cada ponto tem é decisão de conteúdo, tomada ponto a ponto quando a pergunta é
aprovada. Não é regra global.

## A vez da pessoa

| Situação                              | O que acontece                                                  | Conta como resposta? |
| ------------------------------------- | --------------------------------------------------------------- | -------------------- |
| Toque de menos de 300 ms              | ignorado, nada é gravado                                        | não                  |
| Segurou e soltou sem falar            | "Segure enquanto fala.", e a espera de 5 s recomeça             | não                  |
| 5 s sem apertar depois da pergunta    | o tutor dá o começo da frase, uma vez por pergunta              | não                  |
| Resposta certa                        | segue para a próxima pergunta                                   | sim                  |
| Resposta errada                       | correção por imitação: ela repete e segue                       | sim, uma tentativa   |
| Terceiro erro na mesma pergunta       | a pergunta sai da sessão e volta na próxima, junto com as novas | sim                  |
| Juiz incerto                          | "Again, please", sem veredito                                   | não                  |
| Silêncio ou ruído                     | "Again, please", e a vez continua dela                          | não                  |
| Só português, numa pergunta em inglês | "In English, please.", e a vez continua dela                    | não                  |
| Falha do juiz ou da rede              | "Não consegui ouvir agora. Tente de novo."                      | não                  |

**Correção por imitação.** A correção é o áudio pronto da resposta esperada ("Listen:" e a frase
certa), e a pessoa repete. Citar o erro dela ("Not _stand_, _stands_") pediria voz gerada na hora,
mais cara e mais lenta. Fica para depois, se o beta mostrar que faz falta.

Os avisos em português ("Segure enquanto fala.") são só texto na tela, sem áudio.

## O dia de revisão e a revisão espaçada

- **Gatilho:** um número de pontos novos desde a última revisão.
  - O valor é por livro (e por trilha, quando houver mais de uma), definido no conteúdo, não fixo no
    código.
  - O valor inicial é provisório.
- **Aviso:** o dia de revisão é obrigatório e é avisado no fim da sessão anterior ("amanhã é dia de
  revisão").
- **Conteúdo:** a sessão inteira é de revisão. Entra tudo o que foi visto desde a última revisão,
  mais as perguntas antigas que a pessoa errou.
- **Formato:** só perguntas, ditas uma vez, sem apresentar a palavra e sem pedir repetição. A imagem
  aparece sem a palavra escrita; a palavra só surge se ela travar.
- **Revisão maior que o teto:** continua no dia seguinte.
- **Ao terminar:** volta exatamente onde parou no conteúdo novo.
- **Revisão geral de fim de livro:** na marca `revision_exercise` do livro. O livro 1 tem uma só, no
  ponto 52.
- **Revisão espaçada:** usa o `review_schedule`.

## O juiz

Transcrever e comparar texto não basta. Medido em 25/09 com três transcritores (gpt-4o-mini-transcribe,
gpt-4o-transcribe e Deepgram nova-3): eles corrigem a gramática da pessoa e trocam palavras, e
preservaram o erro em só 8 a 10 de 20 casos.

O juiz recebe o áudio, a pergunta e a resposta esperada. Devolve o que a pessoa disse, literal, e as
diferenças. O código fica em `src/lib/judge`, atrás de uma interface própria, como todo fornecedor do
projeto.

- **Três vereditos:** bate, não bate, incerto. Incerto nunca vale como acerto.
- **Pontuação e maiúscula:** a diferença só disso é descartada no código, não pelo modelo
  (`substantiveDifferences`).
- **A língua da resposta:** cada pergunta tem `answer_language` (`en` ou `pt`), e o juiz recebe essa
  informação. Na pergunta de tradução, o "In English, please" não vale.
- **Falha do fornecedor:** vira "Não consegui ouvir agora. Tente de novo.". Não conta como resposta.
- **O áudio:** o navegador grava em WAV, 24 kHz, mono, porque os modelos de áudio aceitam só wav ou
  mp3 e a função da Vercel não tem ffmpeg. Uma vez é de até 15 s, uns 720 KB.
- **O modelo de hoje:** `gpt-audio-1.5`, com o prompt curto e chamada de função forçada (os modelos
  de áudio recusam `response_format`). O Gemini 3.8 Flash é um candidato mais barato, a medir.
- **A medição de 25/09:** 30 casos gravados pelo Luiz.
  - 0 de 24 respostas certas recusadas, 3 de 24 incertas.
  - 2 de 20 erros aceitos, os dois no mesmo "close/closed", que seis sistemas ouviram igual.
  - Uns US$ 2,32 por mil respostas e latência mediana de cerca de 1,1 s.
- **O limite dessa medição:** 30 casos, um falante fluente imitando. Ajustar o prompt além disso é
  ajustar para a voz do Luiz. O próximo dado que conta é gravação de quem está aprendendo de verdade.
- **Trocar de modelo ou de prompt só com medição nova.** Um prompt mudado é outra medição
  (`promptFingerprint`).
- **A avaliação é 100% automática,** nas duas marcas. Ninguém ouve amostra semanal: não pode dar
  trabalho ao professor.
- **O erro do juiz com gente de verdade:** toda vez fica gravada com o áudio. O Luiz faz sessões de
  teste e marca, numa tela do admin da plataforma, se o juiz acertou (#256).

### A pergunta de tradução

Alguns livros pedem a tradução de uma frase. Quem traduz é a pessoa, não o tutor.

- O juiz compara a fala dela com a resposta esperada em português.
- Quando ela erra, o tutor fala a resposta certa em português (áudio pré-gerado, na mesma voz), e ela
  repete. É a única vez que o tutor fala português.
- Antes de o juiz julgar perguntas de tradução, os casos de medição ganham perguntas de tradução
  (#249).
- O Luiz confere cada pergunta de tradução contra o livro na aprovação.

## O áudio do tutor

- **Todo pré-gerado,** servido do bucket. Sem voz gerada na hora na v1.
- **O que é gerado,** por sotaque:
  - cada pergunta e cada resposta esperada;
  - a apresentação de cada palavra;
  - as frases fixas ("Again, please", "Listen:"...);
  - a resposta em português da pergunta de tradução.
- **O caminho no bucket leva o hash do texto e da voz:** texto mudado, áudio novo. Uma lista mostra o
  que ainda não tem áudio.
- **A voz:** uma voz masculina fixa por sotaque, britânico e americano. A escolha do fornecedor é da
  #216.
- **O script que gera é pago,** e grava cada resultado num JSONL em append (#252).

## Britânico ou americano

Cada pessoa escolhe a variedade, e ela vale para o sotaque e para as palavras que mudam entre as
duas (flat e apartment, lift e elevator).

- O conteúdo do livro é britânico.
- A ingestão marca o que tem variante, e uma lista mostra o conteúdo que ainda precisa da versão
  americana.
- Sotaque nunca é erro: o juiz aceita os dois sempre.
- Detalhes na #215.

## O que se grava

Esboço. O schema é da #248, onde as perguntas sobre a tabela da vez, quem grava e como quem pratica
lê o conteúdo continuam abertas.

- **Posição:** livro, ponto e pergunta onde parou.
- **Variedade:** britânico ou americano.
- **Sessão:** pessoa, organização, tipo (conteúdo ou revisão), início e fim. Os minutos do dia são o
  que o teto do servidor lê, e o `team_practice` (#198) lê os minutos do mês.
- **Vez:**
  - a pergunta e a tentativa;
  - o que o juiz ouviu, o veredito e as diferenças;
  - se teve ajuda;
  - o tempo até apertar e a duração da fala;
  - a latência, o custo e o áudio.
- **Fila de revisão:** as perguntas descartadas e as vencidas na revisão espaçada.
- **Estado da revisão:** pontos novos desde a última revisão, e dia de revisão pendente ou em
  andamento.
- **Áudio da pessoa:** guardado por 30 dias, como diz a política de privacidade, e apagado depois
  (#256).

Toda tabela nova nomeia a organização e tem RLS na mesma migration.

## O teto diário

- **Aplicado no servidor:** no teto, o tutor termina a pergunta atual e para.
- **É limite, não promessa.**
- **O valor vem do plano** da pessoa (#274), lido pelo `daily-cap.ts`. Até o plano existir, o padrão
  é 15 min (`DAILY_PRACTICE_MINUTES`).
- **Na GrifoAI,** o plano é o da organização.

## Nivelamento

- **No beta:** o ponto inicial é marcado à mão, por quem ensina ou pelo admin da plataforma numa
  organização sem professor.
- **Depois:** um teste oral automático, com o mesmo juiz.
  - Uma ou duas perguntas por lição, em ordem.
  - O teste para depois de alguns erros seguidos, e o ponto inicial é a última lição dominada.
  - A pessoa começa por um dia de revisão de tudo que ficou para trás, que confirma ou corrige o
    nivelamento.
- **O apoio dinâmico ajuda nos dois casos.** Quem já sabe acerta de primeira, perde o texto e a
  modelagem logo e passa rápido pelos pontos fáceis.

## Progresso

Sai dos registros acima, sem tabela própria na v1:

- onde a pessoa está na trilha e o ritmo por semana;
- quanto ela fala por sessão;
- o acerto de primeira, por ponto, e o que ela mais erra;
- o tempo de resposta;
- o acerto de primeira nos dias de revisão (retenção).

**Quem vê o quê:**

- A pessoa e quem ensina veem tudo isso.
- O admin da empresa vê só o que o `team_practice` mostra: dias e minutos, nunca o que foi dito
  (#198).
- Robin e Grifo mudam só a marca do painel.

## Os números provisórios

Cada um fica numa constante nomeada, num lugar só, marcada "provisório, ajustar no beta":

- 300 ms: o toque mais curto que conta como vez (`MIN_HOLD_MS`);
- 5 s sem apertar até a ajuda (`NUDGE_AFTER_MS`);
- 15 s: a vez mais longa (`MAX_SPEAKING_MS`);
- três erros até a pergunta sair da sessão;
- o gatilho inicial do dia de revisão;
- o limiar de acerto que esconde o texto na tela e a modelagem.

## As decisões de 06/11, hoje

As 13 decisões do topo da spec consolidada de 06/11, com a situação em 12/11:

1. **Um motor só para as duas marcas,** Robin e Grifo. Valendo.
2. **Nivelamento automático,** ao menos na organização sem professor. Valendo; no beta, à mão.
3. **Avaliação 100% automática,** sem amostra ouvida pelo professor. Valendo.
4. **Teto de 15 min nas duas marcas.** Mudou: o teto vem do plano (ADR 0006, #250), com 15 min como
   padrão até o plano existir.
5. **Sotaque britânico e americano,** com as diferenças de vocabulário. Valendo (#215).
6. **Piloto definido pelo Luiz.** Em aberto, do Luiz.
7. **Acertos que já valiam** (teste grátis, "escola" virou "organização", conteúdo só comum).
   - O conteúdo comum e a "organização" valem.
   - O teste grátis é termo comercial e fica fora do repositório (ADR 0006).
8. **Precisão do juiz medida nas aulas de teste do Luiz,** com toda vez gravada com o áudio. Valendo
   (#256).
9. **Variedade do inglês por pessoa,** com a lista do que falta na versão americana. Valendo (#215).
10. **Conteúdo até 30/11,** livros 1 e 2, e a sugestão de perguntas no prazo. A sugestão entrou (#67);
    a ingestão é do Luiz.
11. **Uma voz masculina fixa por sotaque,** ElevenLabs preferida. Valendo, a confirmar na #216.
12. **Pergunta de tradução:** o tutor fala a resposta certa em português, em áudio pré-gerado.
    Fechada.
13. **A cena dos charts ("See Chart") sai do produto.** Fechada.

## Pendências abertas

- **LGPD:** onde cada fornecedor (juiz e voz) processa e guarda o áudio da pessoa. Conferir com quem
  entende antes de fixar os dois.
- **iPhone Safari:** a gravação ainda não foi testada lá. Não trava o resto.

## Fora da v1

- ditado;
- conversa livre e voz ao vivo (#277);
- vídeo (#278);
- painel completo de quem ensina;
- correção que cita o erro da pessoa com voz gerada na hora;
- qualquer voz gerada na hora.

## Onde cada parte é feita

| Issue | O quê                                               |
| ----- | --------------------------------------------------- |
| #247  | esta spec                                           |
| #248  | a sessão do tutor no banco                          |
| #249  | o juiz no app e a gravação em WAV                   |
| #250  | o motor de verdade e o teto no servidor             |
| #251  | o dia de revisão e a revisão espaçada               |
| #252  | o áudio pré-gerado do tutor                         |
| #253  | a tela da prática                                   |
| #254  | o nivelamento                                       |
| #255  | o progresso                                         |
| #256  | o áudio por 30 dias e a escuta das sessões de teste |
| #215  | britânico ou americano                              |
| #216  | as vozes                                            |
| #217  | o Grifo                                             |
