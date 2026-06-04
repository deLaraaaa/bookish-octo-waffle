# Centralização e Automação de Empresas Parceiras da Católica SC

Trabalho de Conclusão de Curso — Centro Universitário Católica de Santa Catarina (Católica SC), Jaraguá do Sul, SC.

**Autor:** Rafael Drozdek de Lara Cardoso
**Orientador:** Andrei Carniel

## Resumo

Este repositório contém o protótipo de um sistema web para centralização e automação dos processos de convênio entre a Católica SC e suas empresas parceiras. O trabalho parte do problema da descentralização das informações e do preenchimento manual de contratos, que geram ineficiência e risco de erros cadastrais. A solução proposta unifica o cadastro de empresas parceiras a um motor de templates dinâmicos para geração de documentos e a um módulo de log de auditoria, de modo que toda alteração nos dados seja rastreável.

## 1. Objetivos

**Geral:** desenvolver um aplicativo web para a centralização, automação e auditoria do fluxo de gestão de empresas parceiras da Católica SC.

**Específicos:**

- Cadastro de empresas parceiras, com upload e armazenamento de documentos;
- Automação de contratos por meio de templates com variáveis dinâmicas (nome, CNPJ, endereço);
- Log de auditoria das alterações realizadas (quem, quando e o que foi modificado);
- Interface de consulta para acompanhamento de parcerias ativas e documentos pendentes.

## 2. Arquitetura

O sistema segue uma arquitetura em três camadas: cliente (React), API (Node.js/Express) e banco de dados relacional (PostgreSQL). A observabilidade é provida por uma pipeline de logs separada (Promtail, Loki e Grafana).

```
Cliente (React)  ──HTTP──>  API (Node/Express)  ──pg──>  PostgreSQL
                                   │
                                   └── logs (JSON) ──> Promtail ──> Loki ──> Grafana
```

A camada de acesso a dados ([server/crud.js](server/crud.js)) implementa operações CRUD genéricas com as seguintes restrições de segurança:

- valores sempre parametrizados (`$1..$n`), evitando injeção de SQL;
- tabelas e colunas validadas contra um allowlist sincronizado com o schema;
- conjunto restrito de operadores em filtros;
- `UPDATE` e `DELETE` obrigatoriamente com cláusula `WHERE`;
- exigência de identificação de usuário em todas as operações, base para o log de auditoria.

## 3. Modelo de Dados

O esquema relacional está definido em [server/schema.sql](server/schema.sql). As principais entidades são:

| Tabela | Descrição |
|---|---|
| `role` | Perfis de permissão. |
| `institution` | Instituições (campus/unidade). |
| `account` | Usuários, vinculados a `role` e `institution`. |
| `enterprise` | Empresas parceiras. |
| `document` | Documentos de negócio (contratos, anexos). |
| `file_resource` | Arquivo físico (caminho ou binário). |
| `signature` | Entidade de assinatura. |
| `enterprise_document` | Ligação 1:N entre empresa e documentos. |
| `seal` | Chancelas/selos. |

O ciclo de vida dos registros é controlado por tipos enumerados (`enterprise_status`, `document_status`, `signature_status`, entre outros), adotando a lógica de Máquinas de Estados Finitos (FSM) para garantir transições consistentes entre submissão, análise e vigência dos termos.

## 4. Tecnologias

- **Frontend:** React 18
- **Backend:** Node.js 20 e Express 5
- **Banco de dados:** PostgreSQL 16
- **Infraestrutura:** Docker e Docker Compose
- **Observabilidade:** Grafana, Loki e Promtail

## 5. Execução

**Pré-requisitos:** Docker e Docker Compose; Node.js 20+ para o frontend em modo de desenvolvimento.

Defina as variáveis de ambiente em um arquivo `.env` na raiz:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5433/tcc
PORT=4000
```

Suba a infraestrutura e aplique o schema:

```bash
docker compose up -d
docker exec -i tcc-postgres psql -U postgres -d tcc < server/schema.sql
```

Serviços disponíveis: API em `http://localhost:4000`, PostgreSQL em `localhost:5433` e Grafana em `http://localhost:3001`. Para verificar a API:

```bash
curl http://localhost:4000/health
```

Para executar o frontend em modo de desenvolvimento:

```bash
cd client && npm install && npm start
```

## 6. Estrutura do Repositório

```
client/                # Frontend React
  src/App.js           # Upload, leitura de placeholders e geração de documento
server/                # Backend Node/Express
  server.js            # Bootstrap da API e rota /health
  crud.js              # Camada de acesso a dados (CRUD parametrizado)
  db.js                # Pool de conexão PostgreSQL
  http_logs.js         # Middleware de logging de requisições
  logger.js            # Logger estruturado (JSON)
  schema.sql           # Definição do banco de dados
ops/                   # Configuração de Loki, Promtail e Grafana
docker-compose.yml     # Orquestração dos serviços
Dockerfile             # Imagem da API
```

## 7. Estado Atual

Concluído: modelagem do banco de dados, camada de acesso a dados, API base com logging e a infraestrutura de execução e observabilidade. Em desenvolvimento: endpoints de upload e substituição de variáveis, persistência do log de auditoria, geração assíncrona de documentos e a interface de gestão de parcerias.

## Referências

- COSTA, F. *Processamento assíncrono e motores de templates em Node.js para sistemas corporativos.* Tecfoco Journal, 2024.
- FLANAGAN, D. *JavaScript: O Guia Definitivo.* 7. ed. Porto Alegre: Bookman, 2021.
- SOUZA, M.; LIMA, R. *Desenvolvimento de Aplicações Web Modernas com a Stack MERN.* Revista de Sistemas de Informação, 2023.
- SOMMERVILLE, I. *Engenharia de Software.* 10. ed. São Paulo: Pearson Education, 2019.
- RODRIGUES, G. O. *Modelagem de Ciclo de Vida e Aplicação de Máquina de Estados no Gerenciamento de Processos em Instituições de Ensino.* Journal of Software Engineering and BPM, v. 7, n. 1, p. 112-128, 2021.
