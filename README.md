# Claude X

Cliente desktop comunitário e genérico para usar o Claude Agent SDK pela API como alternativa quando o limite do Claude Pro ou Max acabar. Ele roda localmente e permite continuar qualquer trabalho usando `CLAUDE.md`, pastas de memória, MCPs, plugins e skills.

> Projeto independente e não oficial. Não é afiliado nem endossado pela Anthropic.

## Recursos

- conversa com o Claude pela API;
- Agent SDK com streaming, sessões e aprovação de ferramentas;
- detecção de configurações locais, MCPs e plugins compatíveis;
- acesso autorizado ao workspace, Vault e diretórios adicionais;
- leitura de `CLAUDE.md` e cadernos vivos;
- custo local e limite de orçamento por tarefa;
- seleção de modelo e esforço por sessão;
- respostas formatadas em Markdown;
- API key mantida somente na memória do processo.

O Claude X não depende de caminhos, contas ou projetos do autor. Cada instalação detecta os recursos existentes no computador do usuário e pede autorização antes de acessá-los.

O Claude X não usa cookies nem endpoints privados para ler conversas do `claude.ai`. Para retomar contexto, use arquivos locais, um Vault, sessões do Claude Code ou um pacote de projeto exportado pelo próprio usuário.

## Usar com o Claude normal

O objetivo do bridge é permitir que qualquer instalação do Claude entregue uma tarefa ao Claude X pelo comando:

```text
/claude-x
```

O comando será fornecido pelo MCP local `claude-x-bridge`, cuja ferramenta pública será `handoff_to_claude_x`. O bridge deverá criar um pacote local contendo contexto, arquivos citados, decisões e pendências, abrir o Claude X no projeto correto e nunca incluir cookies, tokens ou credenciais.

Se o limite do Claude normal já estiver esgotado, abra o Claude X diretamente e use **Continuar projeto**. O projeto e o último handoff permanecem locais.

> O bridge ainda está no roadmap e não deve ser anunciado como concluído.

## Projeto portátil

Um projeto importável do Claude X será composto por:

- instruções do projeto;
- arquivos de conhecimento autorizados;
- histórico ou resumos exportados pelo usuário;
- referência opcional a um Vault;
- último handoff e pendências;
- configuração de ferramentas sem segredos.

O agente trabalha sozinho por padrão: planeja, executa e revisa a tarefa sem depender de subagentes. O contexto é recuperado seletivamente para evitar enviar o projeto inteiro à API em cada mensagem.

## Modelo padrão

O padrão é `sonnet`, atualmente resolvido pelo Agent SDK como Claude Sonnet 5.5. O modelo pode ser alterado no rodapé ou nas configurações.

## Instalação

1. Baixe `Claude-X-Setup-<versão>.exe` na página de Releases.
2. Instale e abra **Claude X** pelo menu Iniciar ou atalho da área de trabalho.
3. Crie uma chave em [Claude Console → API keys](https://platform.claude.com/settings/keys).
4. Clique em **Conectar tudo**, cole a chave e confirme.
5. Abra **Personalização**, escolha o workspace e revise Vault, MCPs e plugins detectados.
6. Revise o limite por tarefa. O padrão recomendado é US$ 1; a execução para ao atingir o teto e nunca aumenta o limite sozinha.

Claude Pro/Max e API são cobrados separadamente. Confira o uso no [Claude Console](https://platform.claude.com/usage).

## Créditos da Claude API

O Claude X utiliza a **Claude API**, não a franquia normal de mensagens do site ou aplicativo Claude. A assinatura, os limites do chat e a cobrança da API são sistemas diferentes.

Segundo a documentação atual da Anthropic:

| Plano | Crédito mensal para Claude Platform/API |
| --- | ---: |
| Free | Não incluído |
| Pro | Não incluído |
| Max 5x | US$ 100 por ciclo mensal |
| Max 20x | US$ 200 por ciclo mensal |
| Team | Depende do tipo e da quantidade de assentos |

Os créditos dos planos elegíveis precisam ser **resgatados e vinculados a uma organização do Claude Console**. Eles não aparecem automaticamente em qualquer organização e não aumentam os limites do chat normal. Créditos não utilizados expiram no final do ciclo e não acumulam para o mês seguinte.

### Preparar a API

1. Entre em [Claude → Configurações de cobrança](https://claude.ai/settings/billing).
2. Se o plano for Max ou Team elegível, localize a seção de créditos da API e selecione **Vincular organização**. Novos assinantes precisam cumprir o período de elegibilidade indicado pela Anthropic.
3. Escolha ou crie uma organização no [Claude Console](https://platform.claude.com/).
4. No Console, abra [API keys](https://platform.claude.com/settings/keys) e crie uma chave.
5. Abra o Claude X, clique em **Conectar tudo**, cole a chave no campo protegido e confirme.
6. Confira saldo, consumo, validade e eventual recarga automática na área de cobrança/uso do Console.

A chave começa normalmente com `sk-ant-`. Ela deve ser colada somente na instalação local do Claude X. Nunca publique a chave no GitHub, em prints, no Vault ou em arquivos do projeto.

Quando o crédito mensal acabar, as chamadas param se não houver outro saldo. Caso existam créditos comprados ou recarga automática ativa, o uso pode continuar e gerar cobrança conforme os preços da API. O limite por tarefa do Claude X é uma proteção local adicional; ele não compra créditos nem ativa recarga automática.

Fontes oficiais: [créditos mensais para planos Max e Team](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans), [cobrança da API](https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage) e [diferença entre assinatura e API](https://support.anthropic.com/pt/articles/9876003-eu-tenho-uma-assinatura-de-um-plano-pago-do-claude-ai-por-que-tenho-que-pagar-separadamente-pelo-uso-da-api-no-console).

## Desenvolvimento

Requisitos: Node.js 20+ e Windows 10/11.

```powershell
npm install
npm run check
npm run desktop
```

Para gerar o instalador:

```powershell
npm run dist:win
```

O instalador será criado em `dist/`. Configuração pessoal e sessões ficam na pasta de dados do aplicativo e não entram no Git.

## Segurança

- servidor restrito a `127.0.0.1`;
- Electron com sandbox, isolamento de contexto e Node.js desativado na interface;
- chave recebida somente pelo servidor local e mantida na memória;
- `data/`, `.env`, logs, builds e dependências fora do Git;
- ferramentas com aprovação e sem `bypassPermissions`;
- sem deploy automático ou exposição da porta na rede.

## Roadmap antes da primeira versão pública

- colar imagens com `Ctrl+V`;
- selecionar e arrastar imagens ou arquivos para o compositor;
- visualizar e remover anexos antes de enviar;
- entrada de voz com transcrição local e revisão antes do envio;
- leitura opcional das respostas em voz alta;
- modos Chat, Projeto, Controle do PC e Automação;
- PC Controller como controlador padrão e Remote Desktop Commander como fallback opcional;
- RTK preferencial para comandos compatíveis;
- importação segura de projetos, exportações e sessões locais;
- MCP `claude-x-bridge` e comando `/claude-x`.

O roadmap descreve intenção de produto. Funcionalidades não marcadas como prontas não devem ser apresentadas ao usuário como implementadas.

## Publicação no Git

Antes de publicar:

1. rode `npm run check` e `npm audit --omit=dev`;
2. confirme que `data/`, `.env`, chaves, sessões e caminhos pessoais não estão versionados;
3. escolha e adicione uma licença;
4. crie uma Release e anexe apenas o instalador gerado em `dist/`.
