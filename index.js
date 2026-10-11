import 'dotenv/config';
import { ActivityType, Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { api } from './lib/api.js';
import { log } from './lib/log.js';
import { state } from './lib/state.js';
import { commandData } from './commands.js';
import { handleInteraction } from './interactions.js';

const VERSION = '1.0.0';
const SYNC_INTERVAL = Math.max(15, Number(process.env.SYNC_INTERVAL_SECONDS || 60));

for (const required of ['BOT_TOKEN', 'BOT_API_KEY', 'API_URL']) {
  if (!process.env[required]) {
    console.error(`[erro] A variável ${required} não está definida no .env`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

let guildDataDirty = true;
let heartbeatRunning = false;
let missedHeartbeats = 0;

function presencePayload() {
  const types = {
    playing: ActivityType.Playing,
    watching: ActivityType.Watching,
    listening: ActivityType.Listening,
    competing: ActivityType.Competing,
  };
  return {
    status: 'online',
    activities: [
      {
        name: state.config?.bot_activity_text || 'os tickets do servidor',
        type: types[state.config?.bot_activity_type] ?? ActivityType.Watching,
      },
    ],
  };
}

async function collectGuildData() {
  if (!process.env.GUILD_ID) return {};
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const [channels, roles] = await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  return {
    guild_name: guild.name,
    channels: [...channels.values()]
      .filter(Boolean)
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, parent_id: channel.parentId || '' })),
    roles: [...roles.values()]
      .filter(Boolean)
      .map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position, managed: role.managed })),
  };
}

async function registerCommands() {
  if (!process.env.GUILD_ID || !client.application?.id) return 'GUILD_ID ou aplicação indisponível';
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.application.id, process.env.GUILD_ID), { body: commandData });
  return `${commandData.length} comandos registrados`;
}

async function runRemoteCommand(command) {
  try {
    let result = '';
    if (command.type === 'set_presence') {
      await client.user.setPresence(presencePayload());
      result = 'presença atualizada';
    } else if (command.type === 'sync_commands') {
      result = await registerCommands();
    } else if (command.type === 'refresh_guild_data') {
      guildDataDirty = true;
      result = 'dados do servidor serão reenviados na próxima sincronização';
    } else if (command.type === 'ping') {
      result = 'bot ativo';
    } else {
      result = `comando ${command.type} não executado pelo bot (ação do painel)`;
    }
    await api('command_result', { command_id: command.id, status: 'done', result });
  } catch (error) {
    await api('command_result', { command_id: command.id, status: 'failed', error: error.message }).catch(() => null);
    await log('error', `Falha ao executar ${command.type}`, error.message);
  }
}

async function heartbeat() {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    const payload = {
      bot_tag: client.user?.tag,
      bot_version: VERSION,
      guild_id: process.env.GUILD_ID,
      application_id: client.application?.id,
      guild_count: client.guilds.cache.size,
      ping: Math.round(client.ws.ping),
    };
    if (guildDataDirty) {
      Object.assign(payload, await collectGuildData().catch(() => ({})));
    }
    const data = await api('heartbeat', payload);
    guildDataDirty = false;
    missedHeartbeats = 0;
    state.applyConfig(data.config, data.panels);
    await client.user?.setPresence(presencePayload()).catch(() => null);

    for (const command of data.commands || []) {
      await runRemoteCommand(command);
    }

    for (const item of data.auto_close || []) {
      await api('ticket_close', {
        ticket_id: item.ticket_id,
        automatic: true,
        reason: 'Encerrado automaticamente por inatividade',
      }).catch((error) => log('error', `Falha ao fechar o ticket #${item.ticket_number}`, error.message));
    }

    if (!state.ticketsLoaded) {
      await state.refreshTicketChannels().catch(() => null);
    }

    if (!state.onlineLogged) {
      state.onlineLogged = true;
      await log('info', `Atendimento conectado como ${client.user?.tag}`, `${state.panels.length} painel(is) ativo(s)`);
    }
  } catch (error) {
    missedHeartbeats += 1;
    if (missedHeartbeats === 1 || missedHeartbeats % 5 === 0) {
      await log(
        'error',
        `Falha na sincronização com o painel (${missedHeartbeats}x)`,
        error.status === 401 ? 'Chave BOT_API_KEY incorreta.' : error.message,
      );
    }
  } finally {
    heartbeatRunning = false;
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`[info] Bot conectado como ${client.user.tag}`);
  await registerCommands().then((info) => console.log(`[info] ${info}`)).catch((error) => console.error(`[erro] Comandos: ${error.message}`));
  await heartbeat();
  setInterval(heartbeat, SYNC_INTERVAL * 1000);
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, client);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || !message.channel) return;
    if (message.author?.id === client.user?.id) return;
    if (!state.ticketsLoaded) return;

    const ticket = await state.ticketForChannel(message.channel.id);
    if (!ticket) return;

    const isStaff = state.isStaffMember(message.member);
    await api('ticket_messages', {
      channel_id: message.channel.id,
      messages: [
        {
          discord_message_id: message.id,
          author_name: message.member?.displayName || message.author.username,
          author_discord_id: message.author.id,
          author_avatar: message.author.displayAvatarURL?.() || '',
          author_kind: isStaff ? 'staff' : 'user',
          content: message.content || '',
          attachment_urls: [...message.attachments.values()].map((attachment) => attachment.url),
          sent_at: message.createdAt.toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error(`[erro] Registrar mensagem: ${error.message}`);
  }
});

client.on(Events.ChannelCreate, () => {
  guildDataDirty = true;
});
client.on(Events.ChannelDelete, (channel) => {
  guildDataDirty = true;
  state.forgetChannel(channel.id);
});
client.on(Events.ChannelUpdate, () => {
  guildDataDirty = true;
});
client.on(Events.GuildRoleCreate, () => {
  guildDataDirty = true;
});
client.on(Events.GuildRoleDelete, () => {
  guildDataDirty = true;
});

client.on(Events.Error, (error) => console.error(`[erro] Cliente Discord: ${error.message}`));
client.on(Events.Warn, (message) => console.warn(`[aviso] ${message}`));

process.on('unhandledRejection', (error) => {
  console.error(`[erro] Promise rejeitada: ${error?.message || error}`);
});
process.on('uncaughtException', (error) => {
  console.error(`[erro] Exceção não tratada: ${error?.message || error}`);
});
process.on('SIGTERM', async () => {
  await log('info', 'Bot encerrando (SIGTERM)');
  await client.destroy();
  process.exit(0);
});

client.login(process.env.BOT_TOKEN).catch((error) => {
  console.error(`[erro] Falha ao conectar ao Discord: ${error.message}`);
  process.exit(1);
});