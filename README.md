# Centralização e Automação de Empresas Parceiras da Católica SC

Trabalho de Conclusão de Curso — Centro Universitário Católica de Santa Catarina (Católica SC), Jaraguá do Sul, SC.

**Autor:** Rafael Drozdek de Lara Cardoso
**Orientador:** Andrei Carniel

[![SonarCloud](https://github.com/deLaraaaa/bookish-octo-waffle/actions/workflows/sonar.yml/badge.svg)](https://github.com/deLaraaaa/bookish-octo-waffle/actions/workflows/sonar.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=deLaraaaa_bookish-octo-waffle&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=deLaraaaa_bookish-octo-waffle)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=deLaraaaa_bookish-octo-waffle&metric=coverage)](https://sonarcloud.io/summary/new_code?id=deLaraaaa_bookish-octo-waffle)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Resumo

Sistema web para centralização e automação dos processos de convênio entre a Católica SC e suas
empresas parceiras. O trabalho parte do problema da descentralização das informações e do
preenchimento manual de contratos, que geram ineficiência e risco de erros cadastrais. A solução
unifica o cadastro de empresas a um motor de templates dinâmicos para geração de documentos e a um
log de auditoria, de modo que toda alteração nos dados seja rastreável.

## 1. Objetivos

**Geral:** desenvolver um aplicativo web para a centralização, automação e auditoria do fluxo de
gestão de empresas parceiras da Católica SC.

**Específicos:**

- Cadastro de empresas parceiras, com upload e armazenamento de documentos;
- Automação de contratos por meio de templates com variáveis dinâmicas (nome, CNPJ, endereço);
- Log de auditoria das alterações realizadas (quem, quando e o que foi modificado);
- Interface de consulta para acompanhamento de parcerias ativas e documentos pendentes.

## 2. Como executar localmente

### Pré-requisitos

- Node.js 20
- Docker e Docker Compose
- Uma aplicação registrada no **Microsoft Entra ID** (o login é exclusivamente institucional)

> **Não há acesso anônimo.** Toda tela e todo endpoint de negócio exigem login. As únicas rotas
> abertas são as quatro do fluxo de autenticação e `/health`. O perfil inicial é atribuído pelo
> domínio do e-mail: `edu.br` entra como `TEACHER`, os demais domínios permitidos como `STUDENT`.

### Passo a passo

```bash
git clone https://github.com/deLaraaaa/bookish-octo-waffle.git
cd bookish-octo-waffle

npm install
npm install --prefix server
npm install --prefix client

cp .env.example .env
```

Preencha o `.env`. Dois segredos precisam ser gerados, e a API **se recusa a subir** sem eles:

```bash
openssl rand -base64 48   # JWT_SECRET — mínimo de 32 caracteres
openssl rand -base64 32   # TOKEN_ENC_KEY — exatamente 32 bytes
```

As credenciais `AZURE_*` vêm do registro de aplicativo no Entra ID. Sem elas o login não funciona,
mas o restante da API sobe normalmente.

```bash
npm start                      # sobe api + postgres (Docker) em :4000 e :5433
npm run migration:latest       # cria o schema
npm run dev --prefix client    # interface em http://localhost:3000
```

Verifique com `curl http://localhost:4000/health` — a resposta confirma que a API responde **e** que
o banco está acessível.

### Comandos úteis

| Comando | O que faz |
|---|---|
| `npm start` | Sobe API e banco via Docker Compose |
| `npm run logs` | Acompanha o log da API |
| `npm run stop` | Derruba os contêineres |
| `npm run migration:make <nome>` | Cria uma migration nova |
| `npm run migration:status` | Mostra o que já foi aplicado |
| `npm run migration:rollback` | Desfaz o último lote |
| `npm test` | Testes do backend |
| `npm run test:coverage:gate` | Backend com o gate de 75% |
| `npm run test:coverage:gate --prefix client` | Frontend com o gate de 25% |
| `npm run build --prefix client` | Checagem de tipos e build de produção |

### Sobre o e-mail em desenvolvimento

O segundo fator chega por e-mail. `MAIL_TRANSPORT=auto` tenta o Microsoft Graph, cai para SMTP e,
em último caso, **escreve o código no log** — o que serve para desenvolver sem configurar nada.
Esse último degrau é desligado quando `NODE_ENV=production`: em produção o código nunca é logado.

## 3. Arquitetura

Três camadas — cliente React, API Node/Express e PostgreSQL — com uma pipeline de logs separada e
três integrações externas da Microsoft e da Receita Federal.

```
Navegador ──> Caddy ──> SPA (React + Vite)
                 │
                 └────> API (Node 20 / Express 4) ──> PostgreSQL 16
                              │
                              ├──> Microsoft Entra ID     (login institucional + 2FA)
                              ├──> Microsoft Graph        (OneDrive: modelos e contratos; envio de e-mail)
                              ├──> BrasilAPI              (consulta de CNPJ na Receita Federal)
                              │
                              └──> logs JSON ──> Promtail ──> Loki ──> Grafana
```

Os diagramas C4 completos (contexto, contêineres e componentes) estão na
**[Wiki → Arquitetura C4](../../wiki/Arquitetura-C4)**.

### Decisões que explicam o código

**Acesso a dados centralizado.** Toda consulta passa por [`server/crud.js`](server/crud.js), que
impõe: valores sempre parametrizados (`$1..$n`); tabelas e colunas validadas contra um allowlist;
conjunto restrito de operadores; `UPDATE` e `DELETE` obrigatoriamente com `WHERE`; e identificação
de usuário em toda operação, que é a base do log de auditoria.

**Ciclo de vida por máquina de estados.** Empresa, documento e assinatura só mudam de situação
através de transições declaradas em [`server/services/lifecycle.js`](server/services/lifecycle.js).
Transição não prevista vira HTTP 409 com o par origem/destino na resposta, em vez de um registro
silenciosamente inconsistente.

**Erro tem código, não frase.** A API responde `{ "error": "cnpj_already_exists" }`; a tradução
acontece no cliente, nos dois idiomas. Isso mantém a API estável e o texto sob controle do frontend.

**Geração de documento é assíncrona.** Montar um contrato envolve várias idas ao OneDrive, então o
pedido entra na tabela `contract_job` e o cliente acompanha por identificador, em vez de segurar a
requisição aberta.

## 4. Modelo de dados

Dezessete tabelas, criadas pela migration inicial em [`server/migrations/`](server/migrations/).

| Tabela | Descrição |
|---|---|
| `role` | Perfis de permissão: `STUDENT`, `TEACHER`, `MANAGER`, `ADMIN` |
| `role_invite` | Convites pendentes para promover alguém a gestor |
| `institution` | Campus ou unidade |
| `person` | Pessoa, vinculada a perfil e instituição |
| `identity` | Vínculo da pessoa com o provedor de identidade (Entra ID) |
| `two_factor_code` | Códigos de segundo fator, com validade |
| `enterprise` | Empresa parceira |
| `enterprise_document` | Ligação entre empresa e seus documentos |
| `document` | Documento de negócio (contrato, anexo) |
| `file_resource` | Arquivo físico correspondente |
| `signature` | Estado de assinatura de um documento |
| `seal` | Chancelas aplicadas aos PDFs |
| `template` | Modelos `.docx` com variáveis |
| `contract_job` | Fila de geração de contratos |
| `audit_log` | Trilha de auditoria (quem, quando, o quê, por quê) |
| `ms_oauth_token` | Tokens da Microsoft, cifrados em repouso |

## 5. Tecnologias

| Camada | Stack |
|---|---|
| Frontend | React 18, Vite 5, TypeScript 5.5, Tailwind 3.4, i18next (pt/en) |
| Backend | Node 20, Express 4.22, Knex 3 (migrations), pg 8 |
| Banco | PostgreSQL 16 |
| Documentos | docxtemplater (templates), pdf-lib (chancela), multer (upload) |
| Identidade | Microsoft Entra ID (OAuth 2.0) + segundo fator por e-mail |
| Armazenamento | OneDrive via Microsoft Graph |
| Testes | Vitest, Testing Library, cobertura v8 |
| Infraestrutura | Docker, Docker Compose, Caddy |
| Observabilidade | Grafana, Loki, Promtail |
| Qualidade | GitHub Actions, SonarCloud |

## 6. Estrutura do repositório

```
client/                      Frontend React + Vite
  src/pages/                 Telas (Home, Manage, Admin, Login, TwoFactor, Onboarding)
  src/components/            Componentes e modais
  src/lib/                   api, auth, errors, variables, time
  src/i18n/locales/          pt.json e en.json (mesmas chaves nos dois)
server/
  routes/                    auth, enterprises, institutions, admin, storage
  services/                  Regra de negócio (enterprise, contracts, lifecycle, audit, graph…)
  migrations/                Schema versionado (Knex)
  tests/                     Suíte do backend
  crud.js                    Acesso a dados parametrizado
  http_errors.js             Envelope único de erro
  server.js                  Bootstrap e /health
ops/                         Loki, Promtail e Grafana
docs/wiki/                   Fonte das páginas da Wiki
.github/workflows/           CI e análise do SonarCloud
```

## 7. Qualidade

| Verificação | Limite | Situação |
|---|---|---|
| Testes do backend | 75% de linhas | 600 testes, 78,9% |
| Testes do frontend | 25% de linhas | 152 testes, 29,0% |
| Build e tipos do cliente | sem erro | passa |
| Migrations em banco limpo | aplicam e revertem | passa |

Os limites são diferentes de propósito: a regra de negócio vive no backend e precisa de cobertura
alta; o frontend é majoritariamente composição de componentes.

## 8. Documentação

- **[Wiki](../../wiki)** — arquitetura C4, modelo de dados, referência da API, decisões técnicas
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — convenções de código, branches e gates
- **[LICENSE](LICENSE)** — MIT

## Referências

- COSTA, F. *Processamento assíncrono e motores de templates em Node.js para sistemas corporativos.* Tecfoco Journal, 2024.
- FLANAGAN, D. *JavaScript: O Guia Definitivo.* 7. ed. Porto Alegre: Bookman, 2021.
- SOUZA, M.; LIMA, R. *Desenvolvimento de Aplicações Web Modernas com a Stack MERN.* Revista de Sistemas de Informação, 2023.
- SOMMERVILLE, I. *Engenharia de Software.* 10. ed. São Paulo: Pearson Education, 2019.
- RODRIGUES, G. O. *Modelagem de Ciclo de Vida e Aplicação de Máquina de Estados no Gerenciamento de Processos em Instituições de Ensino.* Journal of Software Engineering and BPM, v. 7, n. 1, p. 112-128, 2021.
