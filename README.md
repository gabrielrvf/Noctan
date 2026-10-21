<p align="center">
  <img src="public/noctan-mark.png" alt="Logotipo espiral do Noctan" width="108">
</p>

<h1 align="center">Noctan</h1>

<p align="center">
  <strong>Workspace de IA local para Windows, com PC Controller integrado e aplicativo Android.</strong>
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

A **Runtime API Key do Secure Tunnel** é opcional e diferente da chave OpenAI usada pelo GPT. Ela só é necessária para conectar o PC Controller a uma sessão externa compatível do ChatGPT. Para usar o Noctan como aplicativo standalone no próprio PC, a Runtime Key não é obrigatória.

As chaves salvas pelo Noctan ficam em arquivos protegidos pela criptografia vinculada ao usuário do Windows. Nunca publique chaves no GitHub, no README, no Vault ou em conversas compartilhadas.

## PC Controller integrado

No Desktop, o botão **PC Controller** mostra o estado do controlador local:

- girando: conectando ou tentando recuperar a conexão;
- verde: controlador local disponível;
- vermelho: desconectado ou com erro; clique para tentar reconectar.

O pacote do controlador é fixado no `package-lock.json` para que uma instalação reproduzível leve junto as ferramentas compatíveis. Configurações MCP adicionais continuam opcionais.

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

Requisitos de desenvolvimento: Windows e Node.js 20 ou superior.

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

No macOS, as chaves são cifradas com AES-256-GCM e a chave-mestra fica no Keychain do usuário (item `Noctan`). Os dados ficam em `~/Library/Application Support/Noctan/data`. O PC Controller usa o shell de login (`$SHELL -lc`) e o Chrome, configuráveis em `pc-controller-settings.json` nessa pasta. O build é assinado ad-hoc: não há atualização automática no macOS até existir assinatura Developer ID com notarização, e um `.dmg` baixado da internet precisa de `xattr -cr /Applications/Noctan.app` na primeira abertura. O Secure Tunnel (`tunnel-client.exe`) continua exclusivo do Windows.

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
