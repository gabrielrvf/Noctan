# Conectar o ChatGPT ao seu PC pelo Noctan

Com este conector, o ChatGPT (web ou app) usa as ferramentas do seu PC direto: ler e escrever arquivos, listar pastas, rodar PowerShell, usar o navegador, ver o git. A chamada vai do ChatGPT para o Noctan aberto no seu PC por um túnel seguro da OpenAI. **Não passa por nenhuma IA do Noctan e não gasta crédito da API da OpenAI nem da Anthropic.**

Leva uns 15 minutos, uma vez por PC.

## Como funciona

```txt
ChatGPT → conector "Noctan" na sua conta → Secure MCP Tunnel (OpenAI)
→ tunnel-client escondido no seu PC (o Noctan sobe sozinho) → Noctan → PC Controller
```

O conector oferece dois modos:

- `pc_controller_*` (cerca de 80 ferramentas): execução direta no PC, sem IA no meio.
- `handoff_to_noctan`: entrega uma tarefa inteira para a IA configurada no Noctan. Esse modo gasta a sua API. Use só quando quiser delegar.

O Noctan precisa estar aberto (pode ficar minimizado na bandeja).

## O que você precisa

- Noctan instalado: [Releases](https://github.com/yanoliveira16/Noctan/releases/latest).
- Conta no ChatGPT com permissão para criar app/conector por **Tunnel**. A disponibilidade varia por plano e workspace. Foi validado no ChatGPT Plus.
- Acesso à OpenAI Platform (https://platform.openai.com) para criar o túnel.

## Passo a passo

### 1. Criar o túnel na OpenAI Platform

1. Entre na OpenAI Platform e abra a área de **Secure MCP Tunnel** (Tunnels).
2. Crie um túnel novo. Dê um nome que identifique o PC, por exemplo `noctan-pc-casa`.
3. Copie o **Tunnel ID**. Ele começa com `tunnel_`.
4. Gere a **Runtime API Key** desse túnel e guarde-a só até o passo 3. Ela não é a chave da OpenAI API usada no chat.

Os nomes dos menus podem mudar. O que importa é sair com um `tunnel_...` e uma Runtime API Key.

### 2. Registrar o Tunnel ID no PC

Crie este arquivo com o Tunnel ID do passo 1. O arquivo não tem chave nenhuma: a chave fica com o Noctan.

- Windows: `%APPDATA%\tunnel-client\mcp-chatgpt-full-pc-dev.yaml`
- macOS: `~/.config/tunnel-client/mcp-chatgpt-full-pc-dev.yaml`

```yaml
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "tunnel_COLE_O_SEU_AQUI"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:8080"
```

O Noctan lê só o `tunnel_id` daqui e cria o perfil dele, apontando o túnel para o próprio Noctan.

### 3. Colar a Runtime API Key no Noctan

1. Abra o Noctan e clique em **Conectar tudo**.
2. Cole a Runtime API Key no campo **Runtime API Key do Secure Tunnel**.
3. Clique em **Conectar tudo**.

O Noctan guarda a chave criptografada (Windows: proteção do usuário; macOS: Keychain) e sobe o túnel escondido, sem janela de CMD. Se o túnel cair, o Noctan tenta de novo a cada minuto. Depois disso, apague a chave de onde você a tinha anotado.

### 4. Criar o conector no ChatGPT

1. No ChatGPT web: **Configurações → Apps/Conectores → Criar** (app ou conector personalizado).
2. Nome: `Noctan`. Conexão: **Tunnel**. Informe o mesmo Tunnel ID do passo 1.
3. Autenticação: sem autenticação. Quem protege o acesso é o túnel, que só existe na sua conta.
4. Se a tela pedir, marque a ciência do risco. Depois clique em **Scan Tools / Criar**.
5. Abra uma **conversa nova** e ative o conector Noctan.

### 5. Testar

Cole no ChatGPT:

```txt
Liste as ferramentas pc_controller_* do conector Noctan e rode
pc_controller_list_directory com targetPath igual à minha pasta Documentos.
Não use handoff_to_noctan.
```

Deve aparecer a lista de ferramentas e o conteúdo da pasta.

## Fazer com ajuda de uma IA

Os passos 1 e 4 são telas da sua conta (OpenAI Platform e ChatGPT) e você mesmo faz. O passo 2 pode ser feito pelo Noctan ou por outro agente local (Claude Code, Codex) com este pedido:

```txt
Crie o arquivo do perfil do Secure MCP Tunnel para o Noctan neste PC:
- Windows: %APPDATA%\tunnel-client\mcp-chatgpt-full-pc-dev.yaml
- macOS: ~/.config/tunnel-client/mcp-chatgpt-full-pc-dev.yaml
Conteúdo (troque só o tunnel_id):
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "tunnel_COLE_O_SEU_AQUI"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:8080"
Não escreva nenhuma chave nesse arquivo. Se ele já existir, faça backup antes.
Depois me lembre de colar a Runtime API Key no Noctan em "Conectar tudo".
```

Não cole a Runtime API Key em nenhum chat. Ela vai só no campo do Noctan.

Depois que o conector estiver ligado, cole isto no ChatGPT para ele usar as ferramentas do jeito certo:

```txt
Você tem o conector "Noctan" ligado ao meu PC.
- Para ler, escrever, listar, buscar, rodar PowerShell, git ou navegador no meu PC,
  use só as ferramentas pc_controller_*. Elas vão direto ao PC, sem IA e sem custo de API.
- Não use handoff_to_noctan, a não ser que eu escreva "delega pro Noctan".
- noctan_status só confirma se o Noctan está aberto.
- Nunca leia nem mostre .env, chaves, tokens ou senhas.
```

## Regras de segurança

- **Um túnel por PC.** Dois PCs no mesmo túnel deixam incerto qual PC atende cada chamada.
- **Nunca compartilhe** o Tunnel ID junto com a Runtime API Key. Quem tiver os dois controla o seu PC.
- Desconectar ou remover o conector no ChatGPT corta o acesso na hora. Revogar a Runtime API Key na Platform corta também.
- O endpoint local do Noctan só aceita chamadas do próprio PC. Páginas do navegador não conseguem acioná-lo.

## Problemas comuns

- **O ChatGPT só mostra `noctan_status` e `handoff_to_noctan`:** o Noctan está antigo (menos de 1.0.64) ou o ChatGPT guardou a lista antiga. Atualize o Noctan pelo botão **↻ Atualizações**. Depois, no ChatGPT, abra o conector e use **Atualizar/Scan Tools**. Se não tiver esse botão, desconecte e conecte de novo. Abra uma conversa nova.
- **"O túnel ainda não foi vinculado à conta do ChatGPT neste computador":** falta o arquivo do passo 2.
- **"PC Controller" vermelho no Noctan:** clique nele para reconectar e passe o mouse para ver o erro.
- **Porta 8080 ocupada:** troque `listen_addr` no arquivo do passo 2 para outra porta livre, por exemplo `127.0.0.1:8081`.
