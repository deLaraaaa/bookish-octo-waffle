# Arquitetura C4

Os três primeiros níveis do [modelo C4](https://c4model.com/): contexto, contêineres e componentes.
Cada nível aumenta o zoom sobre o mesmo sistema — o nível 1 cabe numa conversa com a coordenação, o
nível 3 cabe numa conversa com quem vai mexer no código.

## Nível 1 — Contexto

Quem usa o sistema e com que sistemas externos ele conversa.

```mermaid
flowchart TB
    aluno["<b>Aluno ou professor</b><br/>STUDENT ou TEACHER<br/>Consulta, cadastra e acompanha"]
    gestor["<b>Gestor</b><br/>MANAGER<br/>Aprova cadastros e gera contratos"]
    admin["<b>Administrador</b><br/>ADMIN<br/>Gere acessos e audita o sistema"]

    sistema["<b>Parcerias Católica SC</b><br/><br/>Centraliza o cadastro de empresas,<br/>gera contratos a partir de modelos<br/>e registra toda alteração"]

    entra["<b>Microsoft Entra ID</b><br/>Sistema externo<br/>Login institucional"]
    msgraph["<b>Microsoft Graph</b><br/>Sistema externo<br/>OneDrive e envio de e-mail"]
    receita["<b>BrasilAPI</b><br/>Sistema externo<br/>Dados de CNPJ da Receita Federal"]

    aluno -->|"consulta, cadastra<br/>e acompanha"| sistema
    gestor -->|"aprova e gera contratos"| sistema
    admin -->|"administra e audita"| sistema

    sistema -->|"autentica a pessoa<br/>OAuth 2.0"| entra
    sistema -->|"guarda documentos<br/>e envia o código 2FA"| msgraph
    sistema -->|"consulta dados cadastrais<br/>pelo CNPJ"| receita

    classDef pessoa fill:#0B4884,stroke:#073B6F,color:#fff
    classDef interno fill:#1168BD,stroke:#0B4884,color:#fff
    classDef externo fill:#999999,stroke:#6B6B6B,color:#fff
    class aluno,gestor,admin pessoa
    class sistema interno
    class entra,msgraph,receita externo
```

**Não há ator anônimo neste diagrama, e isso é proposital.** Todo acesso exige conta institucional
válida — inclusive o catálogo. As únicas rotas abertas são as quatro do fluxo de autenticação e a
verificação de saúde. A lista de parcerias traz dados de contato de empresas conveniadas, que são
dados cadastrais de terceiros e não material de divulgação.

**Por que três sistemas externos e não um banco de usuários próprio.** A instituição já tem
identidade centralizada no Entra ID e armazenamento no OneDrive corporativo. Reimplementar login e
guardar contrato em disco próprio criaria duas cópias da verdade e jogaria no TCC a responsabilidade
de proteger senha e documento jurídico. A consulta de CNPJ existe para que ninguém digite endereço
à mão — é o que transforma um formulário de doze campos em um campo mais conferência.

## Nível 2 — Contêineres

As partes que o sistema tem e como se falam.

```mermaid
flowchart TB
    pessoa["<b>Usuário</b>"]

    subgraph sistema["Parcerias Católica SC"]
        caddy["<b>Caddy</b><br/>Proxy reverso<br/>TLS automático e roteamento"]
        spa["<b>Interface web</b><br/>React 18 + Vite + TypeScript<br/>Catálogo, cadastro e gestão"]
        api["<b>API</b><br/>Node 20 + Express 4<br/>Regra de negócio e integrações"]
        banco[("<b>Banco de dados</b><br/>PostgreSQL 16<br/>Cadastros, documentos e auditoria")]
        logs["<b>Observabilidade</b><br/>Promtail, Loki e Grafana<br/>Logs estruturados"]
    end

    entra["<b>Microsoft Entra ID</b>"]
    msgraph["<b>Microsoft Graph</b>"]
    receita["<b>BrasilAPI</b>"]

    pessoa -->|HTTPS| caddy
    caddy -->|"serve os arquivos"| spa
    caddy -->|"encaminha /api"| api
    spa -->|"JSON sobre HTTPS<br/>com token JWT"| api
    api -->|"SQL parametrizado"| banco
    api -->|"escreve JSON<br/>em stdout"| logs
    api --> entra
    api --> msgraph
    api --> receita

    classDef pessoa fill:#0B4884,stroke:#073B6F,color:#fff
    classDef container fill:#438DD5,stroke:#2E6295,color:#fff
    classDef dados fill:#438DD5,stroke:#2E6295,color:#fff
    classDef externo fill:#999999,stroke:#6B6B6B,color:#fff
    class pessoa pessoa
    class caddy,spa,api,logs container
    class banco dados
    class entra,msgraph,receita externo
```

**Por que a interface e a API são contêineres separados.** A interface é um conjunto de arquivos
estáticos: pode ser servida por qualquer coisa, escala sem estado e não precisa de Node em produção.
A API tem estado de conexão, segredos e integrações. Separar permite publicar uma correção visual
sem reiniciar a API — e foi o que permitiu, no deploy, reaproveitar a mesma composição de
contêineres para produção e homologação, mudando só o arquivo de variáveis.

## Nível 3 — Componentes da API

O interior do contêiner da API. As setas descem sempre: rota nunca fala com o banco, serviço nunca
monta SQL à mão.

```mermaid
flowchart TB
    spa["<b>Interface web</b>"]

    subgraph apiBox["API — Node 20 / Express 4"]
        direction TB

        subgraph rotas["Rotas — recebem HTTP, validam entrada"]
            rAuth["/auth<br/>login, 2FA, onboarding"]
            rEnt["/enterprises<br/>catálogo, cadastro, situação"]
            rSto["/storage<br/>modelos, contratos, chancelas"]
            rAdm["/admin<br/>gestores, convites, auditoria"]
            rIns["/institutions"]
        end

        subgraph mid["Middleware"]
            auth["requireAuth / requireRole<br/>valida o JWT e o perfil"]
            erros["http_errors<br/>envelope único de erro"]
            hlogs["http_logs<br/>log por requisição"]
        end

        subgraph servicos["Serviços — regra de negócio"]
            sEnt["enterprise<br/>cadastro, aprovação, CNPJ"]
            sCon["contracts + contractJobs<br/>geração assíncrona"]
            sTpl["template + stamp + seals<br/>modelos e chancela"]
            sLif["lifecycle<br/>máquina de estados"]
            sAud["audit<br/>trilha de auditoria"]
            sGra["graph + graphToken<br/>OneDrive e e-mail"]
        end

        crud["<b>crud</b><br/>acesso a dados parametrizado<br/>allowlist de tabelas e colunas"]
        db["<b>db</b><br/>pool de conexões"]
    end

    banco[("PostgreSQL 16")]
    externos["Entra ID · Graph · BrasilAPI"]

    spa --> rotas
    rotas --> mid
    mid --> servicos
    servicos --> sLif
    servicos --> sAud
    servicos --> crud
    sGra --> externos
    rAuth --> externos
    crud --> db
    db --> banco

    classDef comp fill:#85BBF0,stroke:#5D82A8,color:#000
    classDef nucleo fill:#438DD5,stroke:#2E6295,color:#fff
    classDef externo fill:#999999,stroke:#6B6B6B,color:#fff
    class rAuth,rEnt,rSto,rAdm,rIns,auth,erros,hlogs,sEnt,sCon,sTpl,sLif,sAud,sGra comp
    class crud,db nucleo
    class banco,externos,spa externo
```

**Por que `crud` é um gargalo proposital.** Toda consulta passa por um único módulo, que valida a
tabela e as colunas contra um allowlist, parametriza todos os valores e **recusa `UPDATE` ou
`DELETE` sem `WHERE`**. É uma restrição incômoda quando se quer uma consulta exótica, e foi
deliberada: um ponto único de passagem é o que torna possível afirmar que não há injeção de SQL em
lugar nenhum, em vez de auditar cada chamada. A regra do `WHERE` nasceu de um defeito real —
um valor `undefined` no filtro fazia a cláusula sumir e a operação atingir a tabela inteira.

**Por que `lifecycle` fica ao lado dos serviços e não dentro de cada um.** As transições válidas de
empresa, documento e assinatura são declaradas em tabelas num módulo só. Serviço que muda situação
chama `assertTransition` antes de escrever. Se a regra vivesse espalhada, cada caso de uso teria sua
própria ideia do que é permitido — e foi assim que um documento arquivado chegou a ser projetado
como assinado.

## Fluxo: do cadastro ao contrato assinado

```mermaid
sequenceDiagram
    actor A as Aluno
    participant W as Interface
    participant API as API
    participant R as BrasilAPI
    participant DB as PostgreSQL
    actor G as Gestor
    participant OD as OneDrive

    A->>W: digita o CNPJ
    W->>API: GET /enterprises/cnpj/:cnpj
    API->>R: consulta os dados cadastrais
    R-->>API: razão social e endereço
    API-->>W: dados normalizados
    Note over W: endereço preenchido<br/>a pessoa só confere

    A->>W: envia o cadastro
    W->>API: POST /enterprises
    API->>DB: grava a empresa como "pendente"
    API->>DB: registra na trilha de auditoria

    G->>W: abre a fila, ordenada da mais antiga
    G->>W: aprova
    W->>API: PATCH /enterprises/:uuid/status
    API->>API: lifecycle valida pendente a ativa
    API->>DB: atualiza e audita

    G->>W: gera o contrato a partir de um modelo
    W->>API: POST /storage/contracts
    API->>DB: cria o job e devolve o identificador
    API->>OD: lê o modelo, preenche e salva o contrato
    API->>DB: conclui o job e vincula à empresa
    W->>API: GET /storage/contracts/jobs/:uuid
    API-->>W: pronto
```

A geração é assíncrona porque envolve várias idas ao OneDrive: ler o modelo, preencher, converter
para PDF e arquivar. Segurar a requisição aberta durante isso quebraria a cada rede lenta.
