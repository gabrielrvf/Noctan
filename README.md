<p align="center">
  <img src="public/noctan-mark.png" alt="Logotipo espiral do Noctan" width="108">
</p>

<h1 align="center">Noctan</h1>

<p align="center">
  <strong>Workspace de IA local com PC Controller integrado e aplicativo Android.</strong>
</p>

<p align="center">
  <a href="https://github.com/yanoliveira16/noctan/releases/latest">Baixar a versão mais recente</a> ·
  <a href="https://github.com/yanoliveira16/noctan">Código-fonte</a>
</p>

## O que é

O Noctan é um aplicativo desktop independente que reúne chat com IA, histórico local, workspaces, arquivos, comandos, agentes e automação do computador em uma única interface.

O instalador já inclui o **PC Controller**. O usuário final não precisa instalar separadamente o repositório `mcp-chatgpt`, Node.js, Claude Code ou arquivos MCP para usar as ferramentas locais incluídas. Atualmente o PC Controller integrado expõe cerca de 80 ferramentas; a quantidade pode variar entre versões.

O chat pode usar:

- **OpenAI**, através de uma chave da OpenAI API e da Responses API.
- **Anthropic**, através de uma chave da Anthropic API e do Claude Agent SDK.

O Noctan não é um produto oficial da OpenAI nem da Anthropic.

## Instalação rápida no Windows

1. Abra a página de [Releases](https://github.com/yanoliveira16/Noctan/releases/latest).
2. Baixe `Noctan-Setup-<versão>.exe` e conclua a instalação.
3. Abra o Noctan e clique em **Conectar tudo**.
4. Escolha **OpenAI (GPT)** ou **Anthropic (Claude)** como provedor principal.
5. Cole a chave do provedor escolhido.
6. Em **Personalização**, selecione uma pasta existente como workspace.
7. Envie uma mensagem. O PC Controller local inicia com o Noctan e fica disponível para o provedor escolhido.

O instalador preserva configurações e conversas armazenadas em `%APPDATA%\Noctan\data`. Atualizar o aplicativo não deve apagar essa pasta.

## Onde obter as chaves

### OpenAI

Crie uma chave padrão de projeto em:

https://platform.openai.com/api-keys

Essa é a chave usada pelo chat GPT dentro do Noctan. Uso da API é separado de uma assinatura do ChatGPT e depende do faturamento e dos limites configurados na OpenAI Platform.

### Anthropic

Crie ou gerencie uma chave em:

https://console.anthropic.com/settings/keys

Essa chave é usada pelo chat Claude dentro do Noctan. Consulte diretamente a Anthropic para preços, créditos e elegibilidade atuais.

### Runtime API Key do Secure Tunnel

A **Runtime API Key do Secure Tunnel** é opcional e diferente da chave OpenAI usada pelo GPT. Ela só é necessária para entregar tarefas de uma sessão externa compatível do ChatGPT ao Noctan. Para usar o chat do próprio Noctan, a Runtime Key não é obrigatória.

O Desktop empacota o runtime oficial do Secure MCP Tunnel correspondente à plataforma. Quando existe um túnel previamente vinculado à conta, o Noctan cria um perfil próprio, sem copiar a chave, preserva o perfil antigo e passa a expor pelo túnel dois modos separados:

- **Direto (`pc_controller_*`):** cada ferramenta do PC Controller integrado (ler/escrever arquivos, listar pastas, PowerShell, navegador etc.), com o mesmo nome após o prefixo, a mesma descrição e o mesmo JSON Schema. A chamada vai direto ao processo local do controlador: não passa por modelo de IA nem consome créditos do provedor.
- **Delegação (`handoff_to_noctan`):** só quando o usuário pede para entregar a tarefa ao Noctan. A tarefa entra no histórico do Noctan e é executada pelo provedor de IA e pelas ferramentas locais configuradas no aplicativo.

O endpoint `/mcp` aceita somente chamadas locais sem cabeçalho `Origin` e com `Host` igual a `127.0.0.1`/`localhost` na porta do Noctan; páginas do navegador não conseguem acioná-lo. Depois de atualizar o Noctan, atualize o conector no ChatGPT para ele reler a lista de ferramentas.

Passo a passo para ligar o conector num PC novo (túnel, Runtime Key e prompts prontos): [docs/CONECTOR_CHATGPT.md](docs/CONECTOR_CHATGPT.md).

O ChatGPT não descobre aplicativos locais apenas por uma instrução escrita no prompt. Para receber tarefas originadas no ChatGPT, a conta precisa autorizar uma vez o app/conector **Noctan**. Depois desse vínculo, não é necessário instalar o repositório PC Controller, Node.js ou manter PowerShell aberto. O Noctan Desktop precisa estar aberto (pode ficar minimizado), pois ele mantém o servidor local e o Secure MCP Tunnel ativos. Remover ou desconectar o app Noctan no ChatGPT remove esse canal e exige uma nova autorização. Uma distribuição pública sem configuração manual exigirá publicar o Noctan como App do ChatGPT com autenticação e roteamento por usuário; não é seguro compartilhar um único Tunnel ID ou uma Runtime Key entre usuários.

As chaves salvas pelo Noctan ficam em arquivos protegidos pela criptografia vinculada ao usuário do Windows. Nunca publique chaves no GitHub, no README, no Vault ou em conversas compartilhadas.

## PC Controller integrado

No Desktop, o botão **PC Controller** mostra o estado do controlador local:

- girando: conectando ou tentando recuperar a conexão;
- verde: controlador local disponível;
- vermelho: desconectado ou com erro; clique para tentar reconectar.

Fechar a janela pelo **X** apenas recolhe o Noctan para a bandeja do sistema, mantendo o servidor, o túnel, o APK e o PC Controller ativos em segundo plano. Clique no ícone da bandeja para reabrir; use **Sair** no menu do ícone quando quiser encerrar tudo de verdade.

O pacote do controlador é fixado no `package-lock.json` para que uma instalação reproduzível leve junto as ferramentas compatíveis. O chat interno usa esse controlador diretamente. O túnel externo aponta para o endpoint MCP HTTP do Noctan, e não para uma instalação separada do PC Controller. Configurações MCP adicionais continuam opcionais.

Imagens geradas pelas ferramentas são importadas automaticamente para os anexos da conversa e aparecem dentro da resposta no Desktop e no Android. O Noctan preserva uma cópia privada no armazenamento do aplicativo para que a imagem continue disponível no histórico.

## Android

Cada Release publica o Desktop e o APK com a mesma versão. Baixe `Noctan-Mobile-<versão>.apk` na mesma página de [Releases](https://github.com/yanoliveira16/Noctan/releases/latest).

O APK é um controle remoto do Noctan Desktop: ele não executa sozinho o servidor de IA nem o PC Controller. Para funcionar:

1. mantenha o Noctan aberto no PC;
2. conecte PC e celular à mesma rede;
3. no APK, informe o endereço do PC e o token de pairing quando necessário;
4. puxe a conversa para baixo para atualizar e tentar reencontrar o PC.

O aplicativo móvel usa o mesmo provedor, modelo, sessões e ferramentas configurados no Desktop.

## Dados, histórico e privacidade

- Configurações, sessões e anexos ficam em `%APPDATA%\Noctan\data`.
- O serviço principal do Desktop escuta somente em `127.0.0.1`.
- O gateway móvel usa autenticação por token e expõe apenas rotas permitidas.
- Não apague nem substitua `sessions.json` durante uma atualização.
- Antes de uma reinstalação manual, faça backup de `%APPDATA%\Noctan\data`.

## Atualizações e releases

O Desktop verifica atualizações pelo `latest.yml`. Uma Release completa contém, com a mesma versão:

- `Noctan-Setup-<versão>.exe`;
- `Noctan-Setup-<versão>.exe.blockmap`;
- `latest.yml`;
- `Noctan-Mobile-<versão>.apk`;
- `Noctan-<versão>-mac-arm64.dmg` e `Noctan-<versão>-mac-arm64.zip` (macOS Apple Silicon, sem atualização automática).

A Release só sai do rascunho depois que os builds de Windows, Android e macOS terminam. Desktop e APK são construídos pelo mesmo workflow de release. O APK não é commitado como binário no histórico do Git; ele é publicado nos assets da Release.

## Desenvolvimento

Requisitos de desenvolvimento: Windows ou macOS e Node.js 20 ou superior.

```powershell
npm install
npm start
```

Para abrir a janela Electron:

```powershell
npm run desktop
```

Para verificar o projeto:

```powershell
npm run check
```

Para gerar o instalador local:

```powershell
npm run dist:win
```

### macOS

Requisitos: macOS em Apple Silicon (arm64) e Node.js 20 ou superior. Os mesmos comandos `npm install`, `npm start`, `npm run desktop` e `npm run check` funcionam. Para gerar `.dmg` e `.zip` em `dist/`:

```bash
npm run dist:mac
```

Os comandos de distribuição baixam o runtime oficial do Secure MCP Tunnel para a plataforma, verificam o SHA-256 publicado pela OpenAI e o incluem no pacote.

No macOS, as chaves são cifradas com AES-256-GCM e a chave-mestra fica no Keychain do usuário (item `Noctan`). Os dados ficam em `~/Library/Application Support/Noctan/data`. O PC Controller usa o shell de login (`$SHELL -lc`) e o Chrome, configuráveis em `pc-controller-settings.json` nessa pasta. As ferramentas do PC Controller ainda devem ser validadas individualmente no macOS; conexão verde confirma transporte, não compatibilidade de todos os comandos específicos do sistema operacional. O build é assinado ad-hoc: não há atualização automática no macOS até existir assinatura Developer ID com notarização, e um `.dmg` baixado da internet precisa de `xattr -cr /Applications/Noctan.app` na primeira abertura.

Tecnologias principais: JavaScript, HTML, CSS, Node.js, Electron, OpenAI Responses API, Claude Agent SDK, WebSocket e Android WebView.

## Diagnóstico rápido

- **“Configure um workspace”**: abra **Personalização** e escolha uma pasta existente.
- **PC Controller vermelho**: clique no botão para reconectar e confira o texto exibido ao passar o mouse.
- **APK não encontra o PC**: confirme a mesma rede, mantenha o Desktop aberto e puxe para baixo no APK.
- **Chave recusada**: gere uma nova chave no painel oficial do provedor e substitua a anterior no Noctan.
- **Atualização repetida**: confira se o instalador, `latest.yml` e a Release possuem exatamente a mesma versão.

## Para assistentes de IA e suporte

Ao orientar um usuário novo, use esta sequência:

1. instalar a versão mais recente do Desktop;
2. criar uma chave em `https://platform.openai.com/api-keys` ou no console da Anthropic;
3. abrir **Conectar tudo**, escolher o provedor e salvar a chave;
4. escolher um workspace existente;
5. confirmar que o PC Controller ficou verde;
6. instalar o APK da mesma Release somente se o usuário quiser acesso pelo celular.

Não peça ao usuário para instalar um PC Controller separado. Não confunda a chave OpenAI de inferência com a Runtime API Key opcional do Secure Tunnel. Nunca recomende apagar a pasta de dados para corrigir atualização ou conexão.
