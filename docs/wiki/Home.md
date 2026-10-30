# Parcerias Católica SC

Documentação técnica do sistema de centralização e automação de convênios com empresas parceiras,
Trabalho de Conclusão de Curso em Engenharia de Software — Católica SC, Jaraguá do Sul.

Para instalar e rodar, veja o [README](https://github.com/deLaraaaa/bookish-octo-waffle#readme).
Esta Wiki responde o **porquê**: como o sistema está organizado e que decisões sustentam o código.

## Páginas

| Página | O que responde |
|---|---|
| [Requisitos funcionais](Requisitos-funcionais) | O que o sistema faz, por perfil, com o ponto no código |
| [Casos de uso](Casos-de-uso) | Os três fluxos de negócio completos, do início ao fim |
| [Arquitetura C4](Arquitetura-C4) | Quem usa, de que partes é feito e como as partes conversam |
| [Modelo de dados](Modelo-de-Dados) | As 17 tabelas, seus vínculos e os estados de cada entidade |
| [Referência da API](Referencia-da-API) | Todos os endpoints, quem pode chamar e o que devolvem |
| [Decisões técnicas](Decisoes-tecnicas) | Por que as escolhas difíceis foram feitas assim |
| [Ambiente e deploy](Ambiente-e-Deploy) | Variáveis, ambientes e o caminho até produção |

## O problema em uma frase

Hoje o convênio com uma empresa parceira vive em planilhas, e-mails e documentos preenchidos à mão:
ninguém sabe ao certo quais parcerias estão vigentes, e cada contrato novo repete a digitação dos
mesmos dados cadastrais, com o risco de erro que isso carrega.

## A solução em três movimentos

1. **Cadastro único.** A empresa entra uma vez, com o endereço preenchido automaticamente a partir
   do CNPJ na Receita Federal. A gestão aprova ou recusa, e a recusa exige motivo.
2. **Contrato gerado, não digitado.** Um modelo `.docx` com variáveis vira contrato preenchido com
   os dados que já estão no cadastro, arquivado no OneDrive da instituição.
3. **Tudo rastreável.** Cada mudança de situação grava quem fez, quando, o que mudou e por quê.

## Perfis de usuário

**Não há acesso anônimo.** Toda tela e todo endpoint de negócio exigem login — as únicas rotas
abertas são as quatro do próprio fluxo de autenticação e a verificação de saúde. Quem não tem conta
institucional não vê nem o catálogo.

| Perfil | Valor em `role` | O que pode fazer |
|---|---|---|
| Aluno | `STUDENT` | Consultar o catálogo; cadastrar uma empresa e acompanhar os próprios cadastros |
| Professor ou servidor | `TEACHER` | O mesmo que o aluno |
| Gestor | `MANAGER` | Tudo do anterior, mais aprovar, recusar e suspender cadastros; gerar, vincular e chancelar contratos |
| Administrador | `ADMIN` | Tudo do gestor, mais convidar e remover gestores e consultar a trilha de auditoria |

**O perfil inicial vem do domínio do e-mail**, em `roleForDomain`: domínio terminado em `edu.br`
entra como `TEACHER`, qualquer outro domínio permitido entra como `STUDENT`. Ninguém escolhe o
próprio perfil no cadastro.

`STUDENT` e `TEACHER` **têm hoje exatamente as mesmas permissões** — a separação existe para
distinguir os dois públicos nos relatórios e para permitir diferenciar o acesso no futuro sem
migration. Promover alguém a `MANAGER` é ato de um administrador, por convite.

O login passa pelo Microsoft Entra ID e os domínios aceitos são definidos em
`ALLOWED_EMAIL_DOMAINS`. Não há cadastro de senha no sistema.

**Por que o catálogo é fechado.** A lista de parcerias expõe o nome e os dados de contato de
empresas que firmaram convênio com a instituição — é informação cadastral de terceiros, não
divulgação institucional. Abrir isso a qualquer visitante transformaria o sistema numa fonte de
dados de contato corporativo. Existiu uma função de leitura pública durante o desenvolvimento
(`readPublic`); ela foi removida justamente por não ter uso legítimo.
