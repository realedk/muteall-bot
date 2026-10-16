import { PermissionFlagsBits, REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { loadConfig, safeError } from './config.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.token);
try {
  const user = await rest.get(Routes.user('@me'));
  if (user.id !== config.clientId) throw new Error('The token and DISCORD_CLIENT_ID belong to different applications.');
  await rest.get(Routes.guild(config.guildId));
  // Upsert our two commands individually; do not delete unrelated application commands.
  for (const body of commands) await rest.post(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  const permissions = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.MuteMembers;
  console.log('Registered /muteall and /unmuteall.');
  console.log(`Invite URL: https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=${permissions}&scope=bot%20applications.commands&guild_id=${config.guildId}&disable_guild_select=true`);
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
