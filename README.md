# Chelsea St — plataforma

Plataforma de apoio às aulas particulares de inglês da Chelsea St: desafio
falado diário para o aluno, painel de correção para o professor.

## Requisitos

- Node 22
- Uma conta Supabase e um projeto dedicado a esta aplicação

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencha com as chaves do seu projeto Supabase
npm run dev
```

## Banco

As migrations ficam em `supabase/migrations`, aplicadas em ordem. A primeira
cria todas as tabelas já com Row Level Security ligada.

Para aplicar, cole o conteúdo no SQL Editor do painel do Supabase ou use a CLI:

```bash
npx supabase db push
```

## Teste de gravação

`/spike/audio` grava e reproduz áudio no próprio navegador, sem enviar nada.
Serve para confirmar que o microfone funciona no aparelho do aluno, sobretudo
no Safari do iPhone, antes de o desafio do dia depender disso.

## Verificação

```bash
npx prettier --check .
npm run lint
npx tsc --noEmit
npm run build
```
