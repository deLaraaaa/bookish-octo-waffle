# Modelo de dados

Dezessete tabelas em PostgreSQL 16, criadas pela migration inicial em `server/migrations/`.
Toda alteração de schema passa por migration — nunca por DDL aplicado à mão.

## Visão geral

```mermaid
erDiagram
    role ||--o{ person : "define o perfil de"
    role ||--o{ role_invite : "é oferecido em"
    institution ||--o{ person : "lotada em"
    institution ||--o{ enterprise : "atendida por"
    person ||--o{ identity : "autentica por"
    person ||--o{ enterprise : "cadastrou"
    identity ||--o{ two_factor_code : "recebe"
    enterprise ||--o{ enterprise_document : "possui"
    document ||--o{ enterprise_document : "vinculado em"
    signature ||--o| document : "estado de assinatura de"
    file_resource ||--o| document : "arquivo de"
    file_resource ||--o{ seal : "imagem de"
    template ||--o{ contract_job : "origem de"

    role { int id string name }
    institution { int id string name string city bool active }
    person { int id uuid uuid string name int role_id int institution_id }
    identity { int id int person_id string provider string subject }
    two_factor_code { int id int identity_id string code timestamp expires_at }
    enterprise { int id uuid uuid string name string cnpj enum status timestamp insert_date }
    document { int id uuid uuid string name enum status int signature_id }
    file_resource { int id string path enum status }
    signature { int id enum status }
    seal { int id uuid uuid int file_resource_id }
    template { int id uuid uuid string name jsonb variables }
    contract_job { int id uuid uuid enum status int attempts }
    audit_log { int id string actor_email string action string entity jsonb detail }
    ms_oauth_token { int id text access_token text refresh_token }
    role_invite { int id string email int role_id }
    enterprise_document { int enterprise_id int document_id }
```

## Por que `person` e `identity` são tabelas diferentes

`person` é quem a instituição conhece: nome, perfil, lotação. `identity` é como essa pessoa se
autentica: provedor e identificador no provedor. Separar permite que a mesma pessoa tenha mais de
uma forma de entrar, e permite trocar de provedor de identidade sem reescrever a tabela de pessoas.
Também mantém o segundo fator (`two_factor_code`) preso à identidade usada no login, não à pessoa.

## Por que `document`, `file_resource` e `signature` são três tabelas

São três perguntas diferentes sobre a mesma coisa:

- **`document`** — o documento como objeto de negócio: é um contrato, tem nome e situação.
- **`file_resource`** — o arquivo: onde ele está e se o upload terminou.
- **`signature`** — o estado de assinatura: aguardando envio, aguardando assinatura, assinado.

Um documento pode existir antes do arquivo (rascunho) e o arquivo pode ser substituído sem que o
documento mude de identidade. Juntar os três numa tabela só obrigaria a inventar situações híbridas
do tipo "arquivo pronto mas assinatura pendente" dentro de uma coluna.

## Máquinas de estado

As transições válidas estão declaradas em `server/services/lifecycle.js`. Qualquer transição fora
destes diagramas vira **HTTP 409** com o par origem/destino na resposta, em vez de um registro
inconsistente. Permanecer no mesmo estado é sempre permitido, para que reenviar a mesma ação não
quebre nada.

### Empresa

```mermaid
stateDiagram-v2
    [*] --> pending : cadastro enviado
    pending --> active : gestor aprova
    pending --> inactive : gestor recusa (exige motivo)
    active --> suspended : parceria pausada
    active --> inactive : encerrada
    suspended --> active : reativada
    suspended --> inactive : encerrada
    inactive --> pending : cadastrada de novo
```

Só `active` aparece no catálogo. Recusar leva a `inactive`, de onde só se volta por um novo
cadastro — é a ação mais irreversível da tela de gestão, e por isso é a única que exige motivo
escrito, gravado na trilha de auditoria junto com a transição.

### Documento

```mermaid
stateDiagram-v2
    [*] --> draft : gerado a partir do modelo
    draft --> pending : enviado para assinatura
    draft --> archived
    pending --> signed : assinado
    pending --> refused : recusado
    pending --> expired : prazo vencido
    pending --> draft : devolvido para ajuste
    pending --> archived
    signed --> expired : vigência encerrada
    signed --> archived
    refused --> draft : corrigido
    refused --> archived
    expired --> archived
    archived --> [*]
```

`archived` é terminal de propósito: documento arquivado não volta a circular. Antes disso existia um
defeito em que arquivar um rascunho o projetava como assinado — a máquina de estados foi o que
tornou esse caso impossível de representar.

### Assinatura

```mermaid
stateDiagram-v2
    [*] --> pending_submission : documento criado
    pending_submission --> waiting_signature : enviado ao signatário
    pending_submission --> expired
    waiting_signature --> signed : assinatura recebida
    waiting_signature --> expired : prazo vencido
    waiting_signature --> pending_submission : reenviado
    signed --> expired : vigência encerrada
    expired --> pending_submission : novo ciclo
```

## Trilha de auditoria

`audit_log` guarda quem (`actor_uuid`, `actor_email`), o quê (`action`, `entity`, `entity_ref`),
quando (`insert_date`) e os detalhes em JSON (`detail`), além do `request_id` que liga o registro à
linha de log daquela requisição.

O campo `detail` é JSON justamente para absorver o que cada ação precisa sem migration nova. Uma
mudança de situação de empresa grava:

```json
{ "uuid": "…", "from": "pending", "to": "inactive", "reason": "CNPJ sem atividade na Receita Federal" }
```

Guardar `from` e `to` — e não só o valor final — é o que transforma a tabela de "o que mudou" em
"o que mudou, a partir de quê e por quê", que é o argumento central do trabalho.

## Enumerações

| Tipo | Valores |
|---|---|
| `enterprise_status` | `pending`, `active`, `suspended`, `inactive` |
| `document_status` | `draft`, `pending`, `signed`, `refused`, `expired`, `archived` |
| `signature_status` | `pending_submission`, `waiting_signature`, `signed`, `expired` |
| `file_status` | `uploaded`, `processing`, `ready`, `deleted` |
| `account_status` | `active`, `inactive`, `blocked`, `pending` |
| `job_status` | `queued`, `processing`, `done`, `failed` |

São tipos nativos do PostgreSQL, não `varchar` com convenção: valor fora da lista é recusado pelo
banco, não apenas pela aplicação.
