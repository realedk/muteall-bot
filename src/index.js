import { ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadConfig, safeError } from './config.js';
import { MuteStore } from './store.js';
import { BusyError, VoiceMuter, formatResult } from './operations.js';

const config = loadConfig();
const muter = new VoiceMuter(new MuteStore(config.stateFile));
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, ready => {
  if (ready.user.id !== config.clientId) {
    console.error('The token belongs to a different application than DISCORD_CLIENT_ID.');
    client.destroy();
    process.exitCode = 1;
    return;
  }
  if (!ready.guilds.cache.has(config.guildId)) {
    console.error('The bot has not been invited to DISCORD_GUILD_ID.');
    client.destroy();
    process.exitCode = 1;
    return;
  }
  console.log(`Ready: ${ready.user.tag}; guild=${config.guildId}; channel selection required.`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !['muteall', 'unmuteall'].includes(interaction.commandName)) return;
  try {
    if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
      await interaction.reply({ content: 'This command is only enabled in the configured server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild ?? await client.guilds.fetch(config.guildId);
    const actor = await guild.members.fetch({ user: interaction.user.id, force: true });
    if (!actor.permissions.has(PermissionFlagsBits.MuteMembers)) {
      await interaction.editReply('You need the server-level Mute Members permission to use this command.');
      return;
    }
    const selected = interaction.options.getChannel('channel');
    if (!selected || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(selected.type)) {
      await interaction.editReply('Choose a voice channel using the channel option.');
      return;
    }
    const channel = await guild.channels.fetch(selected.id);
    if (!channel || channel.guildId !== guild.id || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
      await interaction.editReply('That voice channel is no longer available in this server.');
      return;
    }
    const mode = interaction.commandName === 'muteall' ? 'mute' : 'unmute';
    const report = async result => {
      // Expired interaction tokens or a deleted reply must not abort the server operation.
      try { await interaction.editReply(formatResult(result, false)); }
      catch { /* The final totals are also written to the service log. */ }
    };
    const result = await muter.run(mode, guild, actor.id, channel.id, report);
    await interaction.editReply(formatResult(result));
  } catch (error) {
    console.error(safeError(error));
    const content = error instanceof BusyError ? error.message
      : 'The operation could not finish. Check the service logs. Any recorded mutes can be restored with /unmuteall.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(content);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch { /* Discord may have expired the interaction. */ }
  }
});

client.on(Events.Error, error => console.error(safeError(error)));
process.on('SIGTERM', () => client.destroy());
process.on('SIGINT', () => client.destroy());
await client.login(config.token);
