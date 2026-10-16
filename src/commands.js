import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  ['muteall', 'Mute members without Manage Messages permission in a chosen voice channel.'],
  ['unmuteall', 'Undo this bot’s mutes for members in a chosen voice channel.'],
].map(([name, description]) => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers)
  .setDMPermission(false)
  .addChannelOption(option => option
    .setName('channel')
    .setDescription('The voice channel whose members to mute or unmute')
    .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setRequired(true))
  .toJSON());
