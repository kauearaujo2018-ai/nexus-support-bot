import { api } from './api.js';

// Registra no painel (e no console) os eventos importantes do bot.
export async function log(level, message, details = '') {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] [${level}] ${message}${details ? ` — ${details}` : ''}`;
  if (level === 'error') console.error(line);
  else console.log(line);

  try {
    await api('log', {
      category: level === 'error' ? 'error' : 'bot',
      action_name: 'bot.evento',
      description: message,
      status: level === 'error' ? 'error' : 'success',
      details,
      actor_name: 'Bot',
    });
  } catch (error) {
    console.error(`[${stamp}] [warn] Não foi possível registrar no painel: ${error.message}`);
  }
}