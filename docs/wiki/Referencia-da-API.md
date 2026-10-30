# Referência da API

Base local: `http://localhost:4000`. Autenticação por **JWT** no cabeçalho
`Authorization: Bearer <token>`, obtido ao final do login pelo Microsoft Entra ID.

## Como as permissões são aplicadas

Dois grupos de rotas são protegidos no nível do roteador, não endpoint a endpoint:

```js
router.use(requireAuth, requireRole('ADMIN'));                  // /admin
router.use(requireAuth, requireRole('MANAGER', 'ADMIN'));       // /storage
```

Isso significa que **todo** endpoint sob `/admin` exige administrador e **todo** endpoint sob
`/storage` exige gestor ou administrador — não há exceção que alguém possa esquecer de declarar ao
adicionar uma rota nova. Em `/enterprises` a proteção é por endpoint, porque o grupo mistura rotas
públicas de catálogo com rotas de gestão.

## Formato de erro

Toda falha devolve o mesmo envelope, com **código** e não frase:

```json
{ "error": "cnpj_already_exists", "details": { "from": "pending", "to": "signed" } }
```

A tradução acontece no cliente (`client/src/lib/errors.ts`), nos dois idiomas. Código desconhecido
cai numa mensagem genérica e o erro completo vai para o log do servidor — o usuário nunca vê rastro
de pilha.

| Situação | HTTP | Código |
|---|---|---|
| Token ausente ou inválido | 401 | `unauthorized` |
| Perfil insuficiente | 403 | `forbidden` |
| Recurso não encontrado | 404 | `not_found` |
| Transição de estado inválida | 409 | `invalid_transition` |
| Arquivo acima de 25 MB | 413 | `file_too_large` |
| JSON malformado | 400 | `invalid_json` |
| Falha não prevista | 500 | `internal_error` |

## Saúde

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/health` | público | Confirma que a API responde **e** que o banco está acessível |

A verificação toca o banco de propósito: um `/health` que só responde "ok" sem consultar nada
reporta saudável um processo que perdeu a conexão.

## Autenticação — `/auth`

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/auth/microsoft` | público | Inicia o fluxo OAuth e redireciona ao Entra ID |
| GET | `/auth/microsoft/callback` | público | Recebe o retorno, cria a identidade e dispara o 2FA |
| POST | `/auth/2fa/verify` | público | Valida o código recebido por e-mail e emite o JWT |
| POST | `/auth/2fa/resend` | público | Reenvia o código |
| GET | `/auth/me` | autenticado | Devolve perfil, instituição e permissões da sessão |
| POST | `/auth/onboarding` | autenticado | Completa o cadastro de quem entra pela primeira vez |

Os domínios de e-mail aceitos vêm de `ALLOWED_EMAIL_DOMAINS`. O código de segundo fator **nunca é
escrito no log quando `NODE_ENV=production`** — fora de produção ele cai no log como último recurso,
para permitir desenvolver sem configurar e-mail.

## Empresas — `/enterprises`

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/enterprises` | autenticado | Catálogo paginado; aceita `search`, `city` e `page` |
| GET | `/enterprises/mine` | autenticado | Cadastros feitos pela pessoa da sessão |
| GET | `/enterprises/pending` | gestor | Fila de aprovação, **da mais antiga para a mais nova** |
| GET | `/enterprises/manage` | gestor | Todas as empresas; aceita `search`, `city`, `status`, `page` |
| GET | `/enterprises/all` | gestor | Lista enxuta para preencher seletores |
| GET | `/enterprises/cnpj/:cnpj` | autenticado | Consulta a Receita Federal e indica se já existe cadastro |
| POST | `/enterprises` | autenticado | Cria o cadastro (multipart, documento opcional) |
| PATCH | `/enterprises/:uuid/status` | gestor | Muda a situação; **exige `reason` para recusar** |

A fila é ordenada por data de cadastro porque a tela mostra há quantos dias cada empresa espera —
ordenar por nome deixaria o pedido mais atrasado escondido numa página adiante.

`PATCH /:uuid/status` recebe `{ "status": "...", "reason": "..." }`. O motivo é obrigatório quando
o destino é `inactive` (recusa) e tem entre 5 e 500 caracteres; nas demais transições é opcional.
O valor é gravado no `detail` da trilha de auditoria junto com `from` e `to`.

## Documentos e contratos — `/storage`

Todos exigem gestor ou administrador.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/storage/setup` | Cria a estrutura de pastas no OneDrive |
| GET | `/storage/templates` | Lista os modelos com as variáveis detectadas |
| POST | `/storage/templates` | Envia um `.docx` e extrai as variáveis |
| POST | `/storage/templates/sync` | Reconcilia os modelos com o que está no OneDrive |
| POST | `/storage/contracts` | **Enfileira** a geração e devolve o identificador do job |
| GET | `/storage/contracts/jobs/:uuid` | Consulta o andamento da geração |
| GET | `/storage/contracts` | Lista os contratos gerados |
| GET | `/storage/contracts/unlinked` | Contratos ainda sem empresa vinculada |
| POST | `/storage/contracts/link` | Vincula um contrato a uma empresa |
| PATCH | `/storage/contracts/status` | Atualiza a situação em lote |
| PATCH | `/storage/contracts/:documentUuid/status` | Atualiza a situação de um documento |
| GET | `/storage/seals` | Lista as chancelas disponíveis |
| POST | `/storage/seals` | Envia uma imagem de chancela |
| POST | `/storage/contracts/:itemId/stamp` | Aplica a chancela ao PDF na posição indicada |
| GET | `/storage/download/:itemId` | Baixa o arquivo pelo proxy da API |

O download passa pela API em vez de entregar um link direto do OneDrive: assim o acesso respeita o
perfil de quem pede e fica registrado, em vez de virar uma URL que circula por fora.

A geração é assíncrona. O cliente chama `POST /storage/contracts`, recebe `{ "uuid": "..." }` e
consulta `GET /storage/contracts/jobs/:uuid` até `status` virar `done` ou `failed`.

## Administração — `/admin`

Todos exigem administrador.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin/managers` | Lista os gestores |
| DELETE | `/admin/managers/:uuid` | Remove o acesso de gestão de alguém |
| GET | `/admin/manager-invites` | Convites pendentes |
| POST | `/admin/manager-invites` | Convida alguém a ser gestor |
| DELETE | `/admin/manager-invites/:email` | Revoga um convite |
| GET | `/admin/audit-logs` | Consulta a trilha; filtra por ator, alvo, ação e período |
| GET | `/admin/audit-logs/suggest` | Sugestões para os campos de filtro |

## Instituições — `/institutions`

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/institutions` | autenticado | Lista as unidades ativas, usada nos filtros de cidade |
