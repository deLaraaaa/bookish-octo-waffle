# Requisitos funcionais

O que o sistema faz, organizado por perfil de usuário. Cada requisito aponta para onde ele vive
no código, para que a documentação possa ser conferida contra a implementação em vez de acreditada.

Os requisitos não funcionais e as decisões de arquitetura estão em
[Decisões técnicas](Decisoes-tecnicas); os contratos de API, em [Referência da API](Referencia-da-API).

## Perfis

| Perfil | Valor em `role` | Como é atribuído |
|---|---|---|
| Aluno | `STUDENT` | automático, domínio `@catolicasc.edu.br` |
| Professor ou servidor | `TEACHER` | automático, domínio `@catolicasc.org.br` |
| Gestor | `MANAGER` | por convite de um administrador |
| Administrador | `ADMIN` | definido no banco |

**Não existe acesso anônimo.** Toda tela e todo endpoint de negócio exigem autenticação. `STUDENT`
e `TEACHER` têm hoje as mesmas permissões; a distinção existe para separar os públicos em relatório.

---

## RF01 — Autenticar pela conta institucional

Entrar usando a conta Microsoft da instituição, sem cadastro de senha.

- O login redireciona ao Microsoft Entra ID (OAuth 2.0).
- Apenas domínios listados em `ALLOWED_EMAIL_DOMAINS` são aceitos; os demais recebem `domain_not_allowed`.
- Após o retorno do provedor, o sistema envia um **código de segundo fator por e-mail** e só emite a sessão depois da validação.
- O reenvio tem intervalo mínimo e teto de 10 códigos por hora, impostos no servidor.

**Onde:** `server/services/auth.js`, `server/auth/twofactor.js`, telas `Login`, `TwoFactor`, `AuthCallback`.

## RF02 — Completar o cadastro no primeiro acesso

Quem entra pela primeira vez informa a unidade a que pertence antes de usar o sistema.

- Enquanto `onboarding_completed` for falso, o acesso é redirecionado para a tela de conclusão.
- O perfil não é escolhido pela pessoa: vem do domínio do e-mail.

**Onde:** `POST /auth/onboarding`, tela `Onboarding`.

---

## RF03 — Consultar o catálogo de parcerias

Ver as empresas com convênio vigente.

- Lista apenas empresas `active` **e com contrato assinado dentro da validade** — contrato vencido retira a empresa do catálogo automaticamente.
- Busca por nome e filtro por unidade.
- Cada empresa mostra endereço, responsável e telefone.
- Resultado paginado, com estado vazio distinguindo "não há nada" de "a busca não encontrou".

**Onde:** `GET /enterprises`, `hasActiveContract` em `server/services/enterprise.js`, tela `Home`.

## RF04 — Exportar o catálogo

Baixar a lista de parcerias vigentes em planilha.

- Formato `.xlsx`, respeitando os filtros aplicados na tela.
- **Não inclui CNPJ nem e-mail de contato** — o catálogo é visível a toda a comunidade e esses são dados de terceiros.
- A exportação fica registrada na trilha de auditoria.

**Onde:** `GET /enterprises/export`, `server/services/exports.js`.

---

## RF05 — Cadastrar uma empresa parceira

Qualquer pessoa autenticada pode propor uma empresa.

- Informando o CNPJ, o sistema **consulta a Receita Federal** e preenche razão social e endereço.
- O retorno é normalizado: caixa de título no endereço, UF em maiúsculas, CEP só com dígitos.
- CNPJ é validado por dígito verificador antes da consulta; duplicado é recusado com mensagem específica.
- É possível anexar um documento no cadastro (até 10 MB).
- A empresa nasce com situação **pendente**.

**Onde:** `POST /enterprises`, `GET /enterprises/cnpj/:cnpj`, componente `enterprise-form-modal`.

## RF06 — Acompanhar os próprios cadastros

Ver a situação das empresas que a pessoa cadastrou, com os contratos de cada uma.

**Onde:** `GET /enterprises/mine`, tela `Home`.

---

## RF07 — Analisar a fila de aprovação

O gestor decide sobre os cadastros propostos.

- A fila vem ordenada **da mais antiga para a mais nova**, e cada item mostra há quantos dias espera, com destaque crescente conforme o tempo passa.
- Aprovar e recusar são ações diretas; **recusar exige motivo** escrito, gravado na auditoria junto com a transição.
- É possível selecionar vários cadastros e aprová-los de uma vez.
- Qualquer gestor pode decidir sobre qualquer unidade — o convênio é institucional, não do campus.

**Onde:** `GET /enterprises/pending`, `PATCH /enterprises/:uuid/status`, tela `Manage`.

## RF08 — Gerir todas as empresas

Consultar e alterar a situação de qualquer empresa, inclusive inativas e suspensas.

- Busca por nome, filtro por unidade e por situação.
- As transições de situação obedecem à [máquina de estados](Modelo-de-Dados#máquinas-de-estado); transição inválida é recusada com HTTP 409.

**Onde:** `GET /enterprises/manage`, tela `Manage`.

## RF09 — Exportar a gestão

Planilha com duas abas: empresas (com CNPJ, contato, contratos pendentes e vencimento mais próximo)
e uma linha por contrato, com a pendência descrita em linguagem corrente.

**Onde:** `GET /enterprises/manage/export`.

---

## RF10 — Manter modelos de contrato

Enviar modelos `.docx` com variáveis e mantê-los sincronizados com o OneDrive.

- Ao receber o arquivo, o sistema **detecta sozinho as variáveis** do modelo.
- O gestor não cadastra campos: o modelo é a fonte da verdade.

**Onde:** `POST /storage/templates`, `server/services/template.js`.

## RF11 — Gerar contrato a partir de modelo

Preencher um modelo e produzir o documento final.

- As variáveis aparecem com **rótulo legível**, não com a sintaxe do modelo.
- Escolhendo a empresa, os campos que o cadastro já conhece são preenchidos automaticamente.
- O **vencimento** é definido na geração, com 12 meses como padrão.
- Conversão opcional para PDF.
- A geração é **assíncrona**: o pedido entra numa fila e o cliente acompanha por identificador.

**Onde:** `POST /storage/contracts`, `GET /storage/contracts/jobs/:uuid`, `server/services/contractJobs.js`.

## RF12 — Vincular contrato a empresa

Associar um documento do OneDrive a uma empresa, inclusive os que já existiam antes do sistema.

**Onde:** `POST /storage/contracts/link`, `GET /storage/contracts/unlinked`.

## RF13 — Aplicar chancela institucional

Carimbar a imagem da chancela em um PDF, na posição escolhida.

- A posição é definida em frações da página, o que mantém o resultado correto em qualquer tamanho de papel.

**Onde:** `POST /storage/contracts/:itemId/stamp`, `server/services/stamp.js`.

## RF14 — Ser avisado do vencimento

A gestão é alertada quando um contrato se aproxima do fim.

- Avisos em **3 meses, 1 mês e 1 semana** antes do vencimento.
- Aparecem num sino no cabeçalho, com contagem de não lidos **por pessoa**.
- A varredura é diária e o mesmo aviso nunca é criado duas vezes.

**Onde:** `GET /notifications`, `server/services/notifications.js`, `scan-vencimentos.js`.

---

## RF15 — Convidar e remover gestores

O administrador controla quem tem acesso à gestão.

- Convite por e-mail institucional; o papel é concedido quando a pessoa entra.
- Remoção devolve a pessoa ao perfil comum, com confirmação explícita.

**Onde:** `POST /admin/manager-invites`, `DELETE /admin/managers/:uuid`, tela `Admin`.

## RF16 — Consultar a trilha de auditoria

Ver quem fez o quê, quando e por quê.

- Filtros por autor, alvo, ação e período.
- Cada registro guarda o estado anterior e o novo, e o motivo quando houver.
- O `request_id` do registro permite localizar o log completo daquela requisição no Grafana.

**Onde:** `GET /admin/audit-logs`, `server/services/audit.js`.

---

## Requisitos de sistema

| | |
|---|---|
| **RS01** | Toda alteração de dado registra autor, momento e conteúdo na trilha de auditoria |
| **RS02** | Transições de situação são validadas contra máquinas de estado declaradas |
| **RS03** | Erros respondem com código estável; o texto é responsabilidade do cliente, nos dois idiomas |
| **RS04** | Toda consulta ao banco é parametrizada e validada contra lista fechada de tabelas e colunas |
| **RS05** | Documentos ficam no OneDrive institucional; o banco guarda apenas a referência |
| **RS06** | A interface está disponível em português e inglês, sem texto fixo em componente |
