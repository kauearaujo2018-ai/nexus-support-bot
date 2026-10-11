import { api } from './api.js';

// Cache em memória: configuração, painéis/botões e canais de ticket.
export const state = {
  config: null,
  panels: [],
  buttonMap: new Map(),
  ticketChannels: new Map(),
  negativeLookups: new Map(),
  ticketsLoaded: false,
  onlineLogged: false,

  applyConfig(config, panels) {
    this.config = config || null;
    this.panels = panels || [];
    this.buttonMap = new Map();
    for (const panel of this.panels) {
      for (const button of panel.buttons || []) {
        this.buttonMap.set(`p:${button.custom_id}`, { panel, button });
      }
    }
  },

  staffRoleIds() {
    return this.config?.staff_role_ids || [];
  },

  isStaffMember(member) {
    if (!member || !member.roles) return false;
    const roles = this.staffRoleIds();
    return roles.some((roleId) => member.roles.cache?.has(roleId));
  },

  isAdminMember(member) {
    if (!member || !member.roles) return false;
    const roles = this.config?.admin_role_ids || [];
    return roles.some((roleId) => member.roles.cache?.has(roleId));
  },

  async refreshTicketChannels() {
    const data = await api('tickets_open');
    this.ticketChannels = new Map((data.tickets || []).map((ticket) => [ticket.channel_id, ticket]));
    this.ticketsLoaded = true;
    return this.ticketChannels.size;
  },

  // Descobre (e memoriza) o ticket de um canal, com cache negativo de 5 minutos.
  async ticketForChannel(channelId) {
    if (this.ticketChannels.has(channelId)) return this.ticketChannels.get(channelId);
    const missed = this.negativeLookups.get(channelId);
    if (missed && Date.now() - missed < 300000) return null;
    try {
      const data = await api('ticket_info', { channel_id: channelId });
      if (data && data.ticket) {
        const entry = { ticket_id: data.ticket.id, ticket_number: data.ticket.ticket_number, status: data.ticket.status, channel_id: channelId };
        this.ticketChannels.set(channelId, entry);
        return entry;
      }
      this.negativeLookups.set(channelId, Date.now());
      return null;
    } catch (error) {
      if (error.status === 404) this.negativeLookups.set(channelId, Date.now());
      return null;
    }
  },

  forgetChannel(channelId) {
    this.ticketChannels.delete(channelId);
    this.negativeLookups.set(channelId, Date.now());
  },
};