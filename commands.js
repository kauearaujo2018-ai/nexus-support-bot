import { SlashCommandBuilder } from 'discord.js';

// Definição dos comandos de barra registrados no servidor.
export const commandData = [
  new SlashCommandBuilder()
    .setName('postar-painel')
    .setDescription('Publica ou atualiza no canal a mensagem de um painel criado no site')
    .addStringOption((option) => option.setName('painel').setDescription('Nome ou parte do nome do painel').setRequired(true))
    .addChannelOption((option) => option.setName('canal').setDescription('Canal onde a mensagem será publicada').setRequired(false))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('fechar-ticket')
    .setDescription('Encerra o atendimento do canal atual')
    .addStringOption((option) => option.setName('motivo').setDescription('Motivo do encerramento').setRequired(false))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('reabrir-ticket')
    .setDescription('Reabre um atendimento encerrado neste canal')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('reivindicar')
    .setDescription('Assume o atendimento deste canal')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('transferir-ticket')
    .setDescription('Transfere o atendimento para outro membro da equipe')
    .addUserOption((option) => option.setName('membro').setDescription('Novo responsável').setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('adicionar-usuario')
    .setDescription('Dá acesso ao canal para outro usuário')
    .addUserOption((option) => option.setName('membro').setDescription('Usuário que receberá acesso').setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('remover-usuario')
    .setDescription('Remove o acesso de um usuário ao canal')
    .addUserOption((option) => option.setName('membro').setDescription('Usuário que perderá o acesso').setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('ticket-info')
    .setDescription('Mostra as informações do atendimento deste canal')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('transcricao')
    .setDescription('Gera a transcrição do atendimento deste canal')
    .addStringOption((option) =>
      option
        .setName('formato')
        .setDescription('Formato do arquivo')
        .setRequired(false)
        .addChoices({ name: 'HTML', value: 'html' }, { name: 'Texto (TXT)', value: 'txt' }),
    )
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sincroniza as configurações do bot com o site')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Mostra o estado do bot e os números de atendimento')
    .setDMPermission(false),
].map((command) => command.toJSON());