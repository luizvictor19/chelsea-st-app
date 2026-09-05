# Chelsea St

Plataforma de apoio às aulas particulares de inglês da Chelsea St: desafio
falado diário para o aluno, painel de correção para o professor, e a ingestão
do conteúdo dos livros do método.

## Requisitos

- Node na versão do `.nvmrc`, que `nvm use` resolve sozinho
- Uma conta Supabase e um projeto dedicado a esta aplicação

## Como rodar

```bash
nvm use
npm install
cp .env.example .env.local   # preencha com as chaves do seu projeto Supabase
npm run dev
```

## Ingestão de conteúdo

Em `/teacher/content`, e é a maior parte do que existe hoje.

O professor abre um livro, diz de que ponto a que ponto ele vai, e sobe as
fotos das páginas. A leitura acontece no próprio navegador: as imagens não saem
da máquina dele em momento nenhum. Depois ele revisa página por página, com o
recorte original ao lado de cada bloco que a extração marcou como duvidoso, e
só o que ele confirma é gravado.

O que a extração não consegue decidir sozinha vira pergunta, nunca palpite. Uma
página cujo número de margem ficou ambíguo, ou que tem conteúdo pertencente a
uma página que não está no envio, fica retida até o professor responder.

## Banco

As migrations ficam em `supabase/migrations`, aplicadas em ordem. A primeira
cria todas as tabelas já com Row Level Security ligada.

```bash
npx supabase db push
```

Schema entra só por migration. O SQL Editor do painel serve para consultar,
promover alguém a professor e criar dado de teste. DDL colado lá não fica
registrado em arquivo nenhum, e a próxima pessoa a rodar as migrations recebe
um banco diferente do que elas descrevem.

## Fixtures

`fixtures/` não é versionado. Página de livro publicado não entra neste
repositório, então um clone limpo não tem `fixtures/real/book1/` nem
`fixtures/real/book2/`, e os scripts de medição em `scripts/` falham por
arquivo ausente. Isso é o comportamento correto, não um defeito.

Os testes não dependem disso: as fixtures que eles usam são sintéticas e
geradas em tempo de execução.

## Teste de gravação

`/spike/audio` grava e reproduz áudio no próprio navegador, sem enviar nada.
Serve para confirmar que o microfone funciona antes de o desafio do dia
depender disso. Vale a mesma checagem em cada aparelho que o aluno for usar:
Android, desktop e iPhone.

## Verificação

A mesma sequência que o CI roda, na mesma ordem:

```bash
npx prettier --check .
npm run lint
npx tsc --noEmit
npm test
npm run build
```
