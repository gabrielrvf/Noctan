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

- Noctan instalado e atualizado: [Releases](https://github.com/yanoliveira16/Noctan/releases/latest). Se o campo **Tunnel ID** não aparecer em **Conectar tudo**, clique em **↻ Atualizações**.
- Conta no ChatGPT com permissão para criar app/conector por **Tunnel**. A disponibilidade varia por plano e workspace. Foi validado no ChatGPT Plus.
- Acesso à OpenAI Platform (https://platform.openai.com) para criar o túnel.

## Passo a passo

### 1. Criar o túnel na OpenAI Platform

1. Entre na OpenAI Platform e abra a área de **Secure MCP Tunnel** (Tunnels).
2. Crie um túnel novo. Dê um nome que identifique o PC, por exemplo `noctan-pc-casa`.
3. Copie o **Tunnel ID**. Ele começa com `tunnel_`.
4. Gere a **Runtime API Key** desse túnel. Ela não é a chave da OpenAI API usada no chat.

Os nomes dos menus podem mudar. O que importa é sair com um `tunnel_...` e uma Runtime API Key.

### 2. Colar o Tunnel ID e a Runtime API Key no Noctan

1. Abra o Noctan e clique em **Conectar tudo**.
2. Cole o Tunnel ID em **Tunnel ID do Secure Tunnel**.
3. Cole a Runtime API Key em **Runtime API Key do Secure Tunnel**.
4. Clique em **Conectar tudo**. Em alguns segundos o **PC Controller** fica verde.

![Tela Conectar tudo do Noctan, com os campos Tunnel ID e Runtime API Key](img/conectar-noctan.png)

O Noctan guarda a chave criptografada (Windows: proteção do usuário; macOS: Keychain) e sobe o túnel escondido, sem janela de CMD. Se o túnel cair, ele tenta de novo a cada minuto. Os dois campos só são preenchidos uma vez: nas próximas aberturas, o Noctan reconecta sozinho. Depois disso, apague a chave de onde você a tinha anotado.

### 3. Criar o conector no ChatGPT

1. No ChatGPT web: **Configurações → Apps/Conectores → Criar** (app ou conector personalizado).
2. Nome: `Noctan`. Conexão: **Tunnel**. Informe o mesmo Tunnel ID do passo 1.
3. Autenticação: sem autenticação. Quem protege o acesso é o túnel, que só existe na sua conta.
4. Se a tela pedir, marque a ciência do risco. Depois clique em **Scan Tools / Criar**.
5. Abra uma **conversa nova** e ative o conector Noctan.

### 4. Testar

Cole no ChatGPT:

```txt
Liste as ferramentas pc_controller_* do conector Noctan e rode
pc_controller_list_directory com targetPath igual à minha pasta Documentos.
Não use handoff_to_noctan.
```

Deve aparecer a lista de ferramentas e o conteúdo da pasta.

## Prompt para o ChatGPT usar as ferramentas do jeito certo

Depois que o conector estiver ligado, cole isto no ChatGPT (ou nas instruções personalizadas dele):

```txt
Você tem o conector "Noctan" ligado ao meu PC.
- Para ler, escrever, listar, buscar, rodar PowerShell, git ou navegador no meu PC,
  use só as ferramentas pc_controller_*. Elas vão direto ao PC, sem IA e sem custo de API.
- Não use handoff_to_noctan, a não ser que eu escreva "delega pro Noctan".
- noctan_status só confirma se o Noctan está aberto.
- Nunca leia nem mostre .env, chaves, tokens ou senhas.
```

Os passos 1 e 3 são telas da sua conta (OpenAI Platform e ChatGPT), então você mesmo faz. Nenhuma IA consegue fazer isso por você antes de o conector existir. **Nunca cole a Runtime API Key em chat nenhum.** Ela vai só no campo do Noctan.

## Regras de segurança

- **Um túnel por PC.** Dois PCs no mesmo túnel deixam incerto qual PC atende cada chamada.
- **Nunca compartilhe** o Tunnel ID junto com a Runtime API Key. Quem tiver os dois controla o seu PC.
- Desconectar ou remover o conector no ChatGPT corta o acesso na hora. Revogar a Runtime API Key na Platform corta também.
- O endpoint local do Noctan só aceita chamadas do próprio PC. Páginas do navegador não conseguem acioná-lo.

## Problemas comuns

- **O ChatGPT só mostra `noctan_status` e `handoff_to_noctan`:** o Noctan está antigo (menos de 1.0.64) ou o ChatGPT guardou a lista antiga. Atualize o Noctan pelo botão **↻ Atualizações**. Depois, no ChatGPT, abra o conector e use **Atualizar/Scan Tools**. Se não tiver esse botão, desconecte e conecte de novo. Abra uma conversa nova.
- **"Informe o Tunnel ID do Secure MCP Tunnel":** faltou o Tunnel ID no passo 2.
- **"Tunnel ID inválido":** confira se copiou o ID inteiro, começando com `tunnel_`.
- **"PC Controller" vermelho no Noctan:** clique nele para reconectar e passe o mouse para ver o erro. Se a Runtime Key foi revogada, gere outra e cole de novo no passo 2.
