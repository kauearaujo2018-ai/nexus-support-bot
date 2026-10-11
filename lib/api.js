// Cliente da API do painel (função bot-sync na Base44).
const API_URL = process.env.API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;

export async function api(action, payload = {}) {
  if (!API_URL) throw new Error('API_URL não configurada no .env');
  if (!BOT_API_KEY) throw new Error('BOT_API_KEY não configurada no .env');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-key': BOT_API_KEY,
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(25000),
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { error: `Resposta inválida do painel: ${text.slice(0, 200)}` };
  }

  if (!response.ok) {
    const failure = new Error(data.error || `Erro HTTP ${response.status}`);
    failure.status = response.status;
    failure.payload = data;
    throw failure;
  }
  return data;
}