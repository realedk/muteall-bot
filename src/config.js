import { existsSync } from 'node:fs';

export function loadConfig() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const token = process.env.DISCORD_TOKEN?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!token) throw new Error('Set DISCORD_TOKEN in .env.');
  for (const [name, value] of [['DISCORD_CLIENT_ID', clientId], ['DISCORD_GUILD_ID', guildId]]) {
    if (!/^\d{17,20}$/.test(value ?? '')) throw new Error(`Set a valid ${name} in .env.`);
  }
  return { token, clientId, guildId, stateFile: process.env.STATE_FILE || 'data/mutes.json' };
}

export function safeError(error) {
  // Do not print request bodies, headers, or the token-bearing client object.
  return `${error?.name ?? 'Error'}${error?.code ? ` (${error.code})` : ''}: ${error?.message ?? 'Unknown error'}`
    .replaceAll(process.env.DISCORD_TOKEN || '\0', '[redacted]');
}
