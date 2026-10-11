# Bot de atendimento do Discord

Bot em Node.js (discord.js) que executa os tickets privados, os botões e os comandos de barra, conversando com o painel web hospedado na Base44.

O site guarda todos os dados (tickets, painéis, embeds, transcrições, logs) e faz as chamadas à API do Discord (publicar painéis, criar canais, ler canais e cargos). Este processo cuida da parte que exige conexão contínua ao Gateway: receber cliques, comandos e mensagens.

## 1. O que você precisa

- Node.js 18.17 ou superior (ou Docker).
- Uma hospedagem que mantenha o processo ligado: Railway, Render (plano pago ou "always on"), Fly.io, uma VPS com pm2, ou até sua máquina para testes.
- O token do bot e a chave da API já cadastrados nos Secrets da Base44.

## 2. Configurar o bot no Discord Developer Portal

1. Acesse <https://discord.com/developers/applications> → **New Application**.
2. Em **General Information**, copie o **Application ID** e cole no painel web (Configurações → ID da aplicação).
3. Em **Bot** → **Reset Token** → copie o token. Se você gerar um token novo, atualize o Secret `DISCORD_BOT_TOKEN` na Base44.
4. Ainda em **Bot**, ative **SERVER MEMBERS INTENT** e **MESSAGE CONTENT INTENT**.
5. Em **OAuth2 → URL Generator**, marque os escopos `bot` e `applications.commands` e as permissões:
   View Channels, Send Messages, Manage Channels, Manage Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Mention Everyone.
6. Abra a URL gerada e autorize o bot no seu servidor.

URL manual (troque o client_id):

```
https://discord.com/oauth2/authorize?client_id=SEU_APPLICATION_ID&permissions=257104&scope=bot%20applications.commands
```

## 3. Instalar e rodar

```bash
cd bot
npm install
cp .env.example .env   # preencha os valores
npm start
```

Variáveis do `.env`:

| Variável | O que é |
| --- | --- |
| `BOT_TOKEN` | Token do bot (Developer Portal). |
| `BOT_API_KEY` | A mesma chave dos Secrets da Base44. |
| `API_URL` | Endereço da função `bot-sync` (painel da Base44 → Código → Funções → bot-sync). |
| `GUILD_ID` | ID do seu servidor (ative o Modo de desenvolvedor para copiar). |
| `SYNC_INTERVAL_SECONDS` | Intervalo da sincronização (padrão 60). |

Ao iniciar, o bot registra os comandos de barra e começa a enviar o sinal de vida para o painel. Em **Integrações** o estado muda para “bot online”.

## 4. Hospedagem

**Docker**

```bash
docker build -t bot-tickets .
docker run -d --name bot-tickets --restart unless-stopped --env-file .env bot-tickets
```

**Railway / Render / Fly.io**

- Crie um serviço Node.js apontando para esta pasta.
- Build: `npm install` · Start: `npm start`.
- Cadastre as variáveis de ambiente (as mesmas do `.env`).
- Mantenha o serviço sem hibernação para o bot não cair.

**VPS com pm2**

```bash
npm install -g pm2
pm2 start index.js --name bot-discord
pm2 save
pm2 startup
```

## 5. Comandos disponíveis

| Comando | Quem usa | O que faz |
| --- | --- | --- |
| `/postar-painel` | Equipe | Publica ou atualiza um painel criado no site. |
| `/fechar-ticket` | Equipe | Encerra o atendimento do canal atual. |
| `/reabrir-ticket` | Equipe | Reabre um atendimento encerrado. |
| `/reivindicar` | Equipe | Assume o atendimento. |
| `/transferir-ticket` | Equipe | Transfere para outro membro. |
| `/adicionar-usuario` | Equipe | Dá acesso ao canal para outro usuário. |
| `/remover-usuario` | Equipe | Remove o acesso de um usuário. |
| `/ticket-info` | Equipe | Mostra os dados do atendimento. |
| `/transcricao` | Equipe | Gera o arquivo HTML ou TXT da conversa. |
| `/sync` | Administração | Sincroniza as configurações com o site. |
| `/bot-status` | Administração | Mostra o estado do bot e os números de atendimento. |

Nos canais de ticket também existem botões: assumir, encerrar, adicionar usuário, informações, transcrição, reabrir, remover usuário e excluir (somente administradores, com confirmação).

Todos os comandos e botões validam os cargos do membro antes de executar qualquer operação — inclusive no servidor, não apenas na interface.

## 6. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| Comandos não aparecem | Escopo `applications.commands` ausente ou `GUILD_ID` errado. |
| Bot não responde aos botões | Intents desativados no Developer Portal ou o bot está offline. |
| “Chave do bot inválida” no console | `BOT_API_KEY` diferente entre a hospedagem e os Secrets da Base44. |
| Painel não publica | `DISCORD_BOT_TOKEN` inválido nos Secrets ou permissão Send Messages/Embed Links faltando no canal. |
| Canais de ticket não são criados | Permissão Manage Channels faltando ou categoria inexistente. |
| Bot cai de tempo em tempo | Hospedagem hibernando: use um plano always on ou pm2 na VPS. |

Os registros de erro também aparecem em **Logs e auditoria** no painel web.