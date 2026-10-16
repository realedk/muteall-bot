import { PermissionFlagsBits, Routes } from 'discord.js';

export class BusyError extends Error {
  constructor() { super('Another mute or unmute operation is already running.'); }
}

export function isProtected(member, channel) {
  return member.id === member.guild.ownerId
    || member.permissions.has(PermissionFlagsBits.ManageMessages)
    || Boolean(channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages));
}

function definiteRejection(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

export class VoiceMuter {
  constructor(store, logger = console) {
    this.store = store;
    this.logger = logger;
    this.running = new Set();
  }

  async run(mode, guild, actorId, channelId, report = async () => {}) {
    if (!channelId) throw new Error('A voice channel must be selected.');
    if (this.running.has(guild.id)) throw new BusyError();
    this.running.add(guild.id);
    try {
      await guild.roles.fetch();
      await guild.channels.fetch();
      const bot = await guild.members.fetchMe({ force: true });
      const ids = [...guild.voiceStates.cache.values()]
        .filter(v => v.channelId === channelId && v.id !== bot.id
          && (mode === 'mute' || this.store.get(guild.id, v.id)))
        .map(v => v.id);
      const result = { mode, channelId, total: ids.length, processed: 0, changed: 0, protected: 0, already: 0, disconnected: 0, moved: 0, unavailable: 0, failed: 0, remaining: 0 };
      let lastProgress = Date.now();
      await report({ ...result });

      for (const id of ids) {
        let member;
        let serverMute;
        try {
          const fetched = await guild.members.fetch({ user: id, force: true });
          // Member.voice is a Gateway cache. Read mute from REST too, so an immediate
          // /unmuteall cannot discard a just-applied mute before its event arrives.
          const raw = await guild.client.rest.get(Routes.guildMember(guild.id, id));
          serverMute = raw.mute;
          member = fetched;
        }
        catch (error) {
          if (mode === 'unmute' && Number(error.code) === 10007) this.store.remove(guild.id, id);
          result.failed++;
          this.logger.warn(`Could not fetch member ${id}; code=${error.code ?? 'unknown'}.`);
        }
        if (member) {
          const voice = member.voice;
          const channel = voice.channel;
          if (!voice.channelId || !channel) {
            // Disconnected members remain recorded so they can be restored when back in voice.
            result.disconnected++;
          } else if (voice.channelId !== channelId) {
            // A member may have moved since the command took its initial snapshot.
            result.moved++;
          } else if (mode === 'mute' && isProtected(member, channel)) {
            result.protected++;
          } else if (!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.MuteMembers])) {
            result.unavailable++;
          } else if (mode === 'mute' && serverMute === true) {
            // Never take ownership of a mute that was in place before this command.
            result.already++;
          } else if (mode === 'unmute' && serverMute === false) {
            this.store.remove(guild.id, id);
            result.already++;
          } else if (typeof serverMute !== 'boolean') {
            result.unavailable++;
          } else {
            const record = { status: 'pending', actorId, channelId, requestedAt: new Date().toISOString() };
            if (mode === 'mute') this.store.put(guild.id, id, record);
            let succeeded = false;
            try {
              await voice.setMute(mode === 'mute', `${mode === 'mute' ? 'muteall' : 'unmuteall'} requested by ${actorId}`);
              succeeded = true;
            } catch (error) {
              result.failed++;
              // Keep uncertain requests in the record in case Discord processed them before a disconnect.
              if (mode === 'mute' && definiteRejection(error)) this.store.remove(guild.id, id);
              this.logger.warn(`Voice operation failed for member ${id}; code=${error.code ?? 'unknown'}, status=${error.status ?? 'unknown'}.`);
            }
            if (succeeded) {
              // A persistence failure aborts the job instead of muting further users without records.
              if (mode === 'mute') this.store.put(guild.id, id, { ...record, status: 'muted' });
              else this.store.remove(guild.id, id);
              result.changed++;
            }
          }
        }
        result.processed++;
        if (Date.now() - lastProgress >= 5000) {
          await report({ ...result });
          lastProgress = Date.now();
        }
      }
      result.remaining = this.store.entries(guild.id)
        .filter(([id]) => guild.voiceStates.cache.get(id)?.channelId === channelId).length;
      this.logger.info(`${mode}: guild=${guild.id} channel=${channelId} actor=${actorId} changed=${result.changed} failed=${result.failed} recordedInChannel=${result.remaining}`);
      return result;
    } finally { this.running.delete(guild.id); }
  }
}

export function formatResult(result, complete = true) {
  const verb = result.mode === 'mute' ? 'Muted' : 'Unmuted';
  const lines = [complete ? `${verb} **${result.changed}** member(s) in <#${result.channelId}>.` : `Working in <#${result.channelId}>: **${result.processed}/${result.total}** checked, **${result.changed}** changed.`];
  if (result.protected) lines.push(`Skipped ${result.protected} member(s) with Manage Messages or server-owner access.`);
  if (result.already) lines.push(`Already ${result.mode === 'mute' ? 'muted' : 'unmuted'}: ${result.already}.`);
  if (result.disconnected) lines.push(`Not connected to voice: ${result.disconnected}.`);
  if (result.moved) lines.push(`Skipped ${result.moved} member(s) who moved to another channel.`);
  if (result.unavailable) lines.push(`Missing channel permissions or unavailable voice state: ${result.unavailable}.`);
  if (result.failed) lines.push(`Failed requests: ${result.failed}. Check the bot logs and retry.`);
  if (complete && result.mode === 'unmute' && result.remaining) lines.push(`${result.remaining} record(s) remain in this channel. Run /unmuteall for this channel again to retry.`);
  return lines.join('\n');
}
