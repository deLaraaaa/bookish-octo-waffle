# Decisões técnicas

Registro das escolhas que não são óbvias pelo código — o que foi decidido, contra o quê, e por quê.
Quando uma decisão nasceu de um defeito real, o defeito está descrito: é o que impede que alguém
"simplifique" a solução e reintroduza o problema.

## 1. Login exclusivamente institucional

**Decisão.** Não existe cadastro de senha. Toda autenticação passa pelo Microsoft Entra ID, com um
segundo fator por e-mail emitido pelo próprio sistema.

**Alternativa descartada.** Tabela de usuários com senha hasheada.

**Por quê.** A instituição já tem identidade centralizada. Manter senha própria criaria uma segunda
fonte de verdade sobre quem é quem, e colocaria sobre um TCC a responsabilidade de proteger
credenciais, implementar recuperação de senha e política de expiração. O custo de integrar OAuth
foi menor que o de fazer isso bem. O segundo fator é nosso porque o fluxo precisa de um ponto de
controle próprio antes de emitir o JWT.

## 2. Documentos no OneDrive, não em disco próprio

**Decisão.** Modelos e contratos ficam no OneDrive corporativo, acessados pelo Microsoft Graph. O
banco guarda apenas a referência.

**Alternativa descartada.** Volume no servidor ou armazenamento de objetos.

**Por quê.** Contrato assinado é documento jurídico da instituição; ele precisa sobreviver ao
sistema que o gerou. No OneDrive, a área administrativa continua acessando os arquivos pelas
ferramentas que já usa, com o backup e a retenção que a instituição já contrata.

**Consequência aceita.** O download passa pela API em vez de link direto, para que o acesso respeite
o perfil de quem pede e fique registrado. Isso custa banda do servidor, e é o preço do controle.

## 3. Um único ponto de acesso ao banco

**Decisão.** Toda consulta passa por `server/crud.js`, que valida tabela e colunas contra um
allowlist, parametriza todos os valores, restringe os operadores de filtro e **recusa `UPDATE` ou
`DELETE` sem `WHERE`**.

**Por quê.** É incômodo quando se quer uma consulta exótica, e deliberado: com um ponto único de
passagem, dá para afirmar que não há injeção de SQL em lugar nenhum, em vez de auditar cada chamada.

**O defeito que originou a regra do `WHERE`.** Um valor `undefined` chegando ao filtro fazia a
cláusula desaparecer silenciosamente, e a operação atingia a tabela inteira. Hoje isso é um erro
lançado antes de a consulta sair.

## 4. Ciclo de vida numa máquina de estados

**Decisão.** As transições válidas de empresa, documento e assinatura são declaradas em tabelas num
módulo só (`server/services/lifecycle.js`). Quem muda situação chama `assertTransition` antes de
escrever; transição não prevista vira HTTP 409 com o par origem/destino.

**Alternativa descartada.** Cada caso de uso validando o que lhe parece razoável.

**O defeito que originou.** A projeção de assinatura tratava um documento **arquivado** como
assinado. O rascunho que fosse arquivado aparecia para o gestor como contrato fechado. Com a regra
espalhada, cada caso de uso tinha a sua própria ideia do que era permitido; com a tabela declarada,
o estado inválido deixou de ser representável.

**Detalhe importante.** Permanecer no mesmo estado é sempre permitido, para que reenviar a mesma
ação não quebre nada.

## 5. Erro tem código, a frase é do cliente

**Decisão.** A API responde `{ "error": "cnpj_already_exists" }`. A tradução para linguagem humana
acontece no frontend, nos dois idiomas.

**Por quê.** Mensagem no backend significa texto duplicado quando aparece um segundo idioma, e
significa mudar a API para corrigir uma vírgula. Com código, o contrato fica estável e o texto fica
onde o contexto existe — a mesma falha pode merecer frases diferentes em telas diferentes.

**Regra que vem junto.** Código novo no servidor exige mensagem nova nos dois arquivos de tradução.
Sem isso o usuário vê o código cru, que é pior que uma mensagem genérica.

## 6. Geração de contrato assíncrona

**Decisão.** `POST /storage/contracts` enfileira o trabalho em `contract_job` e devolve um
identificador; o cliente acompanha por consulta.

**Por quê.** Montar um contrato envolve ler o modelo no OneDrive, preencher, converter para PDF e
arquivar. Segurar a requisição aberta durante isso falha a cada rede lenta, e o usuário não tem como
saber se deve esperar ou tentar de novo.

## 7. Migrations em Knex, sem SQL solto no repositório

**Decisão.** O schema é construído por código Knex versionado, com `up` e `down`. Não há arquivo
`.sql` no repositório.

**Por quê.** Um `schema.sql` que precisa ser aplicado à mão diverge do banco real no primeiro
descuido — e não há como saber qual dos dois está certo. Com migration, o estado do banco é
derivável do histórico, e o CI prova isso aplicando tudo num banco limpo a cada PR.

**Consequência vivida.** Durante o desenvolvimento, o único `schema.sql` existente foi perdido por
não estar versionado. A recuperação foi feita por `pg_dump` do banco vivo — e confirmou que depender
de um arquivo fora do controle de versão era exatamente o risco que a migration elimina.

## 8. Dois idiomas desde o começo

**Decisão.** Nenhum texto fixo em componente. Tudo em `pt.json` e `en.json`, com as mesmas chaves.

**Por quê.** Além de ser diferencial na avaliação, a disciplina evita o texto espalhado pelo código
que depois ninguém consegue inventariar. O efeito colateral útil é que fica trivial listar toda
mensagem que o sistema mostra.

## 9. Gates de cobertura assimétricos

**Decisão.** Backend exige 75% de linhas; frontend exige 25%.

**Por quê.** A regra de negócio vive no backend: aprovação, transição de estado, auditoria, geração
de contrato. Errar ali corrompe dado. O frontend é majoritariamente composição de componentes, onde
teste de unidade rende menos que abrir a tela. Exigir o mesmo número dos dois produziria teste
escrito para satisfazer a métrica.

## 10. Código sem comentários

**Decisão.** O código não leva comentários. Explicações de *por quê* vão para esta Wiki ou para a
mensagem do commit.

**Por quê.** Comentário envelhece em silêncio: o código muda, ele fica. Um comentário desatualizado
é pior que nenhum, porque é confiável à primeira vista. Se um trecho precisa de explicação, ou o
nome está errado ou a função está grande demais.

**Exceção.** `client/src/vite-env.d.ts` mantém a diretiva `///`, que o build exige.

## 11. Gestor de qualquer unidade aprova qualquer empresa

**Decisão.** A aprovação de cadastro não é restrita ao campus do gestor.

**Isto não é uma lacuna.** Foi verificado com o cliente do trabalho: um gestor de Jaraguá do Sul
pode aprovar uma empresa de qualquer unidade. O convênio é institucional, não do campus, e exigir
que cada unidade tenha gestor próprio travaria a fila sempre que alguém saísse de férias.

O vínculo com a instituição continua registrado na empresa — serve para filtrar e relatar, não para
restringir quem decide.

## 12. Mesma composição de contêineres para produção e homologação

**Decisão.** Os dois ambientes usam o mesmo `docker-compose`, diferenciados por nome de projeto
(`-p`) e arquivo de variáveis (`--env-file`).

**Por quê.** Dois arquivos de composição divergem: a correção entra em um e esquece o outro, e
homologação deixa de testar o que vai para produção. Um arquivo só, com as diferenças isoladas em
variáveis, garante que validar em homologação significa alguma coisa.

## 13. Publicação por runner no próprio servidor

**Decisão.** O GitHub Actions publica através de um runner instalado na máquina, puxando imagens do
ghcr.io — não por SSH a partir do runner da nuvem.

**Por quê.** Deploy por SSH exige guardar chave privada nos segredos do repositório e expor a porta
22 à internet. Com runner local, a máquina busca o que precisa e nada de fora precisa de credencial
de acesso ao servidor.
