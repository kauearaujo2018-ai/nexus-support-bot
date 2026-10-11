import {
  ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { api } from './lib/api.js';
import { log } from './lib/log.js';
import { state } from './lib/state.js';

const NO_PERMISSION = 'Você não tem permissão para usar esta ação. Fale com a administração do servidor.';
const NOT_A_TICKET = 'Este canal não está ligado a um atendimento registrado no painel.';

async function memberOf(interaction) {
  try {
    return await interaction.guild.members.fetch(interaction.user.id);
  } catch (error) {
    return interaction.member;
  }
}

async function permissionOf(interaction) {
  const member = await memberOf(interaction);
  const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  const data = await api('staff_check', { discord_id: interaction.user.id, role_ids: roleIds });
  return { ...data, displayName: member?.displayName || interaction.user.username };
}

function actorFrom(interaction, displayName) {
  return { id: interaction.user.id, name: displayName || interaction.member?.displayName || interaction.user.username };
}

function ticketEmbed(ticket, messageCount) {
  return new EmbedBuilder()
    .setTitle(`Ticket #${ticket.ticket_number}`)
    .setColor(0x7c5cff)
    .addFields(
      { name: 'Assunto', value: ticket.subject || '—', inline: false },
      { name: 'Categoria', value: ticket.category || '—', inline: true },
      { name: 'Status', value: ticket.status || '—', inline: true },
      { name: 'Prioridade', value: ticket.priority || '—', inline: true },
      { name: 'Solicitante', value: ticket.opened_by_name || '—', inline: true },
      { name: 'Responsável', value: ticket.assigned_to_name || 'sem responsável', inline: true },
      { name: 'Mensagens', value: String(messageCount ?? ticket.message_count ?? 0), inline: true },
      { name: 'Aberto em', value: ticket.created_date ? new Date(ticket.created_date).toLocaleString('pt-BR') : '—', inline: false },
    )
    .setFooter({ text: 'Painel de atendimento' });
}

async function reply(interaction, content, options = {}) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content, ...options });
  return interaction.reply({ content, flags: MessageFlags.Ephemeral, ...options });
}

async function reportError(interaction, error, prefix = 'Não foi possível concluir a ação') {
  const detail = error?.message || 'erro inesperado';
  await reply(interaction, `⚠️ ${prefix}: ${detail}`);
  if (error?.status && error.status >= 500) log('error', prefix, detail);
}

export async function handleInteraction(interaction, client) {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('p:')) return await handlePanelButton(interaction);
      if (interaction.customId.startsWith('tk:')) return await handleTicketButton(interaction, interaction.customId.slice(3));
      return undefined;
    }
    if (interaction.isModalSubmit()) return await handleModal(interaction);
    if (interaction.isChatInputCommand()) return await handleCommand(interaction, client);
    return undefined;
  } catch (error) {
    try {
      await reportError(interaction, error, 'Erro ao processar a interação');
    } catch (inner) {
      log('error', 'Falha ao responder a interação', inner.message);
    }
    return undefined;
  }
}

async function handlePanelButton(interaction) {
  const entry = state.buttonMap.get(interaction.customId);
  if (!entry) {
    return interaction.reply({
      content: 'Este painel foi atualizado recentemente. Peça para a equipe republicar a mensagem.',
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const data = await api('ticket_create', {
      panel_id: entry.panel.id,
      button_custom_id: entry.button.custom_id,
      guild_id: interaction.guildId,
      user: {
        id: interaction.user.id,
        name: (await memberOf(interaction))?.displayName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL?.() || '',
      },
    });
    if (data.deduped) {
      await interaction.editReply({
        content: `Você já tem um atendimento aberto: <#${data.ticket.discord_channel_id}>. Continue por lá ou peça o encerramento para a equipe.`,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.editReply({
      content: `Atendimento aberto em <#${data.channel?.id || data.ticket.discord_channel_id}> — nossa equipe já foi avisada.`,
      allowedMentions: { parse: [] },
    });
    await state.refreshTicketChannels().catch(() => null);
  } catch (error) {
    await reportError(interaction, error, 'Não foi possível abrir o atendimento');
  }
}

async function handleTicketButton(interaction, action) {
  const ticket = await state.ticketForChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ content: NOT_A_TICKET, flags: MessageFlags.Ephemeral });

  if (['close', 'add', 'remove', 'delete'].includes(action)) {
    return openModal(interaction, action);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const permission = await permissionOf(interaction);
    if (!permission.is_staff) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }
    const actor = actorFrom(interaction, permission.displayName);

    if (action === 'claim') {
      await api('ticket_claim', { channel_id: interaction.channelId, actor });
      await interaction.editReply({ content: 'Você assumiu este atendimento.' });
    } else if (action === 'reopen') {
      await api('ticket_reopen', { channel_id: interaction.channelId, actor });
      await interaction.editReply({ content: 'Ticket reaberto.' });
    } else if (action === 'info') {
      const data = await api('ticket_info', { channel_id: interaction.channelId });
      await interaction.editReply({ embeds: [ticketEmbed(data.ticket, data.message_count)] });
    } else if (action === 'transcript') {
      const data = await api('transcript', { channel_id: interaction.channelId });
      const format = data.ticket?.transcript_format === 'txt' ? 'txt' : 'html';
      const content = format === 'html' ? data.html : data.text;
      const file = new AttachmentBuilder(Buffer.from(content || '', 'utf-8'), { name: `ticket-${data.ticket.ticket_number}-transcricao.${format}` });
      await interaction.editReply({ content: `Transcrição com ${data.message_count} mensagens:`, files: [file] });
    } else {
      await interaction.editReply({ content: 'Ação não reconhecida.' });
    }
    await state.refreshTicketChannels().catch(() => null);
  } catch (error) {
    await reportError(interaction, error);
  }
}

async function openModal(interaction, action) {
  const modal = new ModalBuilder();
  if (action === 'close') {
    const required = Boolean(state.config?.close_reason_required);
    modal
      .setCustomId('modal:close')
      .setTitle('Encerrar atendimento')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel(required ? 'Motivo do encerramento (obrigatório)' : 'Motivo do encerramento (opcional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(required)
            .setMaxLength(500),
        ),
      );
  } else if (action === 'add' || action === 'remove') {
    modal
      .setCustomId(`modal:${action}`)
      .setTitle(action === 'add' ? 'Adicionar usuário ao atendimento' : 'Remover usuário do atendimento')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('target')
            .setLabel('ID do usuário do Discord')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30),
        ),
      );
  } else {
    modal
      .setCustomId('modal:delete')
      .setTitle('Excluir ticket')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('confirm')
            .setLabel('Digite EXCLUIR para confirmar')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10),
        ),
      );
  }
  return interaction.showModal(modal);
}

async function handleModal(interaction) {
  const action = interaction.customId.replace('modal:', '');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const permission = await permissionOf(interaction);
    if (!permission.is_staff) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }
    const actor = actorFrom(interaction, permission.displayName);
    const channelId = interaction.channelId;

    if (action === 'close') {
      const reason = interaction.fields.getTextInputValue('reason') || '';
      const data = await api('ticket_close', { channel_id: channelId, actor, reason });
      await interaction.editReply({ content: `Ticket #${data.ticket.ticket_number} encerrado. A transcrição está no canal de logs e no painel.` });
      await state.refreshTicketChannels().catch(() => null);
      return;
    }

    const raw = interaction.fields.getTextInputValue(action === 'delete' ? 'confirm' : 'target').trim();

    if (action === 'delete') {
      if (raw.toUpperCase() !== 'EXCLUIR') {
        await interaction.editReply({ content: 'Exclusão cancelada: era preciso digitar EXCLUIR.' });
        return;
      }
      if (permission.role !== 'admin') {
        await interaction.editReply({ content: 'Somente administradores podem excluir tickets.' });
        return;
      }
      const data = await api('ticket_delete', { channel_id: channelId, actor });
      state.forgetChannel(channelId);
      await interaction.editReply({ content: `Ticket #${data.ticket.ticket_number} excluído. O canal será apagado.` });
      return;
    }

    const idMatch = raw.match(/\d{15,25}/);
    if (!idMatch) {
      await interaction.editReply({ content: 'Informe o ID numérico do usuário do Discord.' });
      return;
    }
    const targetId = idMatch[0];
    let targetName = targetId;
    try {
      const fetched = await interaction.guild.members.fetch(targetId);
      targetName = fetched.displayName || fetched.user.username;
    } catch (error) {
      targetName = targetId;
    }

    if (action === 'add') {
      await api('ticket_add_user', { channel_id: channelId, actor, target: { id: targetId, name: targetName } });
      await interaction.editReply({ content: `${targetName} agora tem acesso a este atendimento.` });
    } else {
      await api('ticket_remove_user', { channel_id: channelId, actor, target: { id: targetId, name: targetName } });
      await interaction.editReply({ content: `O acesso de ${targetName} a este atendimento foi removido.` });
    }
  } catch (error) {
    await reportError(interaction, error);
  }
}

async function requireTicket(interaction) {
  const ticket = await state.ticketForChannel(interaction.channelId);
  if (!ticket) {
    await interaction.editReply({ content: NOT_A_TICKET });
    return null;
  }
  return ticket;
}

async function handleCommand(interaction, client) {
  const name = interaction.commandName;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const permission = await permissionOf(interaction);
    const actor = actorFrom(interaction, permission.displayName);

    if (name === 'bot-status') {
      const data = await api('stats');
      const config = data.config || {};
      const stats = data.stats || {};
      const embed = new EmbedBuilder()
        .setTitle('Estado do atendimento')
        .setColor(0x7c5cff)
        .addFields(
          { name: 'Bot', value: config.bot_online ? 'online' : 'offline', inline: true },
          { name: 'Último sinal', value: config.bot_last_heartbeat ? new Date(config.bot_last_heartbeat).toLocaleString('pt-BR') : '—', inline: true },
          { name: 'Sincronizações', value: String(config.sync_count || 0), inline: true },
          { name: 'Tickets abertos', value: String(stats.open || 0), inline: true },
          { name: 'Com responsável', value: String(stats.claimed || 0), inline: true },
          { name: 'Encerrados', value: String(stats.closed || 0), inline: true },
          { name: 'Tempo médio de resolução', value: `${stats.avg_resolution_minutes || 0} min`, inline: true },
        )
        .setFooter({ text: client.user?.tag || 'bot' });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (name === 'sync') {
      if (permission.role !== 'admin' && permission.role !== 'supervisor') {
        await interaction.editReply({ content: 'Apenas administradores podem sincronizar as configurações.' });
        return;
      }
      const data = await api('config');
      state.applyConfig(data.config, data.panels);
      await state.refreshTicketChannels().catch(() => null);
      await interaction.editReply({
        content: `Configurações sincronizadas: ${(data.panels || []).length} painel(is) ativo(s) e ${state.ticketChannels.size} atendimento(s) abertos.`,
      });
      return;
    }

    if (name === 'postar-painel') {
      if (!permission.is_staff) {
        await interaction.editReply({ content: NO_PERMISSION });
        return;
      }
      const search = interaction.options.getString('painel').toLowerCase();
      const panel = state.panels.find((item) => item.name.toLowerCase().includes(search));
      if (!panel) {
        await interaction.editReply({ content: `Nenhum painel ativo encontrado com "${search}". Confira o nome no painel web.` });
        return;
      }
      const channel = interaction.options.getChannel('canal');
      const data = await api('panel_publish', { panel_id: panel.id, channel_id: channel?.id });
      await interaction.editReply({
        content: `Painel **${panel.name}** publicado em <#${channel?.id || data.panel.channel_id}>.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    // Demais comandos agem sobre o canal atual.
    const ticket = await requireTicket(interaction);
    if (!ticket) return;

    if (name === 'ticket-info') {
      const data = await api('ticket_info', { channel_id: interaction.channelId });
      await interaction.editReply({ embeds: [ticketEmbed(data.ticket, data.message_count)] });
      return;
    }

    if (!permission.is_staff) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    if (name === 'transcricao') {
      const data = await api('transcript', { channel_id: interaction.channelId });
      const format = interaction.options.getString('formato') || (data.ticket?.transcript_format === 'txt' ? 'txt' : 'html');
      const content = format === 'html' ? data.html : data.text;
      const file = new AttachmentBuilder(Buffer.from(content || '', 'utf-8'), { name: `ticket-${data.ticket.ticket_number}-transcricao.${format}` });
      await interaction.editReply({ content: `Transcrição com ${data.message_count} mensagens:`, files: [file] });
      return;
    }

    if (name === 'reivindicar') {
      await api('ticket_claim', { channel_id: interaction.channelId, actor });
      await interaction.editReply({ content: 'Você assumiu este atendimento.' });
      return;
    }

    if (name === 'fechar-ticket') {
      const reason = interaction.options.getString('motivo') || '';
      const data = await api('ticket_close', { channel_id: interaction.channelId, actor, reason });
      await interaction.editReply({ content: `Ticket #${data.ticket.ticket_number} encerrado.` });
      await state.refreshTicketChannels().catch(() => null);
      return;
    }

    if (name === 'reabrir-ticket') {
      await api('ticket_reopen', { channel_id: interaction.channelId, actor });
      await interaction.editReply({ content: 'Ticket reaberto.' });
      return;
    }

    if (name === 'transferir-ticket') {
      const target = interaction.options.getUser('membro');
      await api('ticket_transfer', {
        channel_id: interaction.channelId,
        actor,
        target: { id: target.id, name: target.username },
      });
      await interaction.editReply({ content: `Atendimento transferido para <@${target.id}>.`, allowedMentions: { parse: ['users'] } });
      return;
    }

    if (name === 'adicionar-usuario' || name === 'remover-usuario') {
      const target = interaction.options.getUser('membro');
      const payload = { channel_id: interaction.channelId, actor, target: { id: target.id, name: target.username } };
      if (name === 'adicionar-usuario') {
        await api('ticket_add_user', payload);
        await interaction.editReply({ content: `<@${target.id}> agora tem acesso a este atendimento.`, allowedMentions: { parse: [] } });
      } else {
        await api('ticket_remove_user', payload);
        await interaction.editReply({ content: `<@${target.id}> não tem mais acesso a este atendimento.`, allowedMentions: { parse: [] } });
      }
      return;
    }

    await interaction.editReply({ content: 'Comando não reconhecido.' });
  } catch (error) {
    await reportError(interaction, error, 'Erro ao executar o comando');
  }
}