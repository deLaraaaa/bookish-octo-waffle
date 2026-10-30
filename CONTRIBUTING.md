# Como contribuir

Este repositório é o Trabalho de Conclusão de Curso de Rafael de Lara Cardoso
(Engenharia de Software — Católica de Santa Catarina). Contribuições externas são
bem-vindas como sugestão, mas as decisões de escopo cabem ao autor e ao orientador.

## Antes de começar

Leia a [Wiki](../../wiki) — especialmente **Arquitetura (C4)** e **Decisões técnicas**.
O que parece estranho no código quase sempre tem um motivo registrado lá.

## Preparar o ambiente

Requisitos: Node 20, Docker e Docker Compose.

```bash
git clone https://github.com/deLaraaaa/bookish-octo-waffle.git
cd bookish-octo-waffle

npm install
npm install --prefix server
npm install --prefix client

cp .env.example .env          # preencha as credenciais (veja a Wiki)
npm run migration:latest      # cria o schema
npm start                     # sobe api + banco via Docker
npm run dev --prefix client   # sobe a interface em :3000
```

## Fluxo de trabalho

1. Crie uma branch temática a partir de `master` (`feat/busca-por-cidade`, `fix/cnpj-duplicado`).
2. Faça commits pequenos no padrão [Conventional Commits](https://www.conventionalcommits.org/pt-br/):
   `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
3. Garanta que os gates passam localmente (abaixo).
4. Abra um Pull Request descrevendo **o problema**, não só a solução.

Nunca faça commit direto na `master`.

## Gates obrigatórios

O CI reprova o PR se qualquer um falhar. Rode antes de abrir:

```bash
npm run test:coverage:gate                # backend — mínimo 75% de linhas
npm run test:coverage:gate --prefix client  # frontend — mínimo 25% de linhas
npm run build --prefix client             # tipos + build de produção
```

Os limites são diferentes de propósito: a regra de negócio vive no backend e precisa de
cobertura alta; o frontend é majoritariamente composição de componentes, onde teste de
unidade rende menos que teste manual da tela.

## Convenções do código

**Sem comentários.** O código deste projeto não leva comentários — nem os existentes nem
novos. Se um trecho precisa de explicação, ou o nome está errado ou a função está grande
demais. Explicações de *por quê* vão para a Wiki ou para a mensagem do commit.
A única exceção é `client/src/vite-env.d.ts`, cuja diretiva `///` o build exige.

**Toda string visível é traduzida.** Nada de texto fixo em componente. Adicione a chave em
`client/src/i18n/locales/pt.json` **e** em `en.json` — os dois arquivos têm exatamente as
mesmas chaves, e isso é verificável:

```bash
node -e "const a=require('./client/src/i18n/locales/pt.json'),b=require('./client/src/i18n/locales/en.json');const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const A=new Set(f(a)),B=new Set(f(b));console.log([...A].filter(k=>!B.has(k)),[...B].filter(k=>!A.has(k)))"
```

**Mudança de situação passa pela máquina de estados.** Empresa, documento e assinatura têm
transições declaradas em `server/services/lifecycle.js`. Não escreva `status` direto no banco:
chame `lifecycle.assertTransition` e deixe a transição inválida virar HTTP 409. Transição nova
se declara na tabela, não no caso de uso.

**Erro tem código, não frase.** O backend responde `{ "error": "cnpj_already_exists" }`; quem
traduz é o frontend, em `client/src/lib/errors.ts` com as mensagens em `errors.*`. Código novo
no servidor exige mensagem nova nos dois idiomas — senão o usuário vê o código cru.

**Quem escreve a feature escreve o teste.** Backend em `server/tests/`, frontend ao lado do
arquivo (`componente.test.tsx`). Os testes são descritos em português, no comportamento
observável: `it('exige motivo para recusar um cadastro')`, não `it('testa updateStatus')`.

**Banco muda por migration.** Nunca aplique DDL à mão. Crie com
`npm run migration:make nome_da_mudanca`, escreva `up` e `down`, e confirme que o `down`
desfaz de verdade — o CI aplica as migrations num banco limpo a cada PR.

## Reportar um problema

Abra uma issue com: o que você esperava, o que aconteceu, e como reproduzir. Se for erro de
interface, diga qual perfil estava usando (visitante, gestor ou administrador) — boa parte do
comportamento depende disso.
