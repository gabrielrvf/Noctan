<p align="center">
  <img src="public/noctan-mark.png" alt="Logotipo espiral do Noctan" width="108">
</p>

<h1 align="center">Noctan</h1>

<p align="center">
  <strong>Seu workspace de IA local para continuar projetos, executar tarefas e preservar contexto.</strong>
</p>

<p align="center">
  <a href="https://github.com/yanoliveira16/noctan">Repositório</a> · Windows · Electron · Claude Agent SDK
</p>

---

## O que é o Noctan?

O **Noctan** é um cliente desktop independente para trabalhar com o Claude através da **API da Anthropic**. Ele reúne conversas, acesso autorizado a arquivos do computador, workspaces, `CLAUDE.md`, MCPs, plugins e arquivos de memória em uma interface própria.

Não é um produto oficial da Anthropic. Usa créditos da **API**, separados dos limites de assinatura do claude.ai. Cada chamada à API pode ter cobrança por uso.

## Recursos

- Conversas com histórico persistente por sessão e recuperação de contexto do projeto.
- Claude Agent SDK com execução de ferramentas, aprovação quando necessária e botão **Parar**.
- Painel de execução temporário na conversa, com espiral animado, frases de espera e eventos reais expansíveis; somente mensagens e respostas permanecem no histórico.
- Envio com **Enter**, nova linha com **Shift+Enter** e imagens anexadas.
- Transcrição de voz local e progressiva com **sherpa-onnx / Nemotron**; microfone selecionado salvo entre sessões.
- Integração com ferramentas e MCPs disponíveis na máquina.
- Consulta a Vault, diretórios adicionais e instruções autorizadas.
- Indicador de consumo local estimado em dólares, **sem limite de turnos ou orçamento por tarefa imposto pelo Noctan**. O provedor ainda pode aplicar limites próprios.
- API Key protegida por criptografia associada ao usuário do Windows; nunca é enviada ao repositório ou ao Vault.

## Começar no Windows

Requisitos: Windows, Node.js 20 ou superior e uma API Key válida da Anthropic.

```powershell
npm install
npm start
```

Abra o endereço local exibido no terminal. Para executar na janela desktop do Electron:

```powershell
npm run desktop
```

Para validar o projeto antes de gerar um instalador:

```powershell
npm run check
```

O comando `npm run dist:win` constrói o instalador **somente quando você decidir publicar uma versão validada**.

## Dados e privacidade

O Noctan usa um serviço HTTP restrito a `127.0.0.1`. No Windows, preferências, sessões e anexos são armazenados na pasta de dados do aplicativo, dentro de `%APPDATA%\Noctan\data`.

A API Key é persistida em arquivo criptografado com proteção do usuário Windows. Não cole chaves no Git, em arquivos `README.md`, no Vault ou em conversas compartilhadas.

O Noctan não acessa automaticamente sessões privadas do Chrome/claude.ai nem transfere a autenticação do Google para o WebView do Electron. O painel de créditos oficial pode exigir autenticação separada.

## MCP local

O projeto inclui `bridge.mjs`, que expõe ferramentas de integração para clientes MCP compatíveis. Conecte essa ponte apenas a aplicativos em que você confia e confira as permissões de arquivos e execução.

## Desenvolvimento

Tecnologias principais: **JavaScript, HTML, CSS, Node.js, Electron, Claude Agent SDK, WebSocket e sherpa-onnx**.

A logo do projeto está em `public/noctan-mark.png`.

**Repositório:** https://github.com/yanoliveira16/noctan

---

Feito para trabalhar em projetos locais mantendo o controle sobre arquivos, histórico e ferramentas.
