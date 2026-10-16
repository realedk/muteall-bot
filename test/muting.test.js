import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { commands } from '../src/commands.js';
import { MuteStore } from '../src/store.js';
import { BusyError, VoiceMuter } from '../src/operations.js';

const gid = '1187577964418846770';
const botId = '1550000000000000000';
const ownerId = '1187577964418846777';
const actorId = '1290000000000000000';
const uid = n => String(1550000000000000000n + BigInt(n));
const quiet = { info() {}, warn() {} };

function setup(t, specs = [], permissions = [P.ViewChannel, P.MuteMembers]) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-mute-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new MuteStore(join(dir, 'mutes.json'));
  const calls = [];
  const members = new Map();
  const bot = { id: botId };
  const guild = {
    id: gid, ownerId,
    client: { rest: { async get(route) {
      const member = members.get(route.split('/').at(-1));
      return { mute: member.actualMuted };
    } } },
    roles: { async fetch() {} },
    channels: { async fetch() {} },
    voiceStates: { cache: new Map() },
    members: {
      async fetchMe() { return bot; },
      async fetch({ user }) {
        if (!members.has(user)) throw Object.assign(new Error('Unknown Member'), { code: 10007, status: 404 });
        return members.get(user);
      },
    },
  };
  for (const spec of specs) {
    const id = spec.id ?? uid(spec.n);
    const member = {
      id, guild,
      actualMuted: spec.actualMuted ?? spec.muted ?? false,
      permissions: new PermissionsBitField(spec.permissions ?? []),
      voice: {
        id, channelId: spec.disconnected ? null : `channel-${spec.channel ?? 1}`,
        serverMute: spec.muted ?? false,
        selfMute: spec.selfMuted ?? false,
        channel: spec.disconnected ? null : {
          permissionsFor(who) {
            return new PermissionsBitField(who.id === botId ? (spec.botPermissions ?? permissions) : (spec.channelPermissions ?? []));
          },
        },
        async setMute(value) {
          calls.push({ id, value });
          if (spec.onMute) await spec.onMute(value);
          if (spec.error) throw spec.error;
          member.actualMuted = value;
          if (!spec.staleCache) this.serverMute = value;
        },
      },
    };
    members.set(id, member);
    guild.voiceStates.cache.set(id, member.voice);
  }
  return { store, calls, members, guild, muter: new VoiceMuter(store, quiet), dir };
}

test('protects staff and owner and preserves pre-existing mutes in the chosen channel', async t => {
  const s = setup(t, [
    { n: 1, channel: 1 },
    { n: 2, channel: 1, selfMuted: true },
    { n: 3, permissions: [P.ManageMessages] },
    { n: 4, permissions: [P.Administrator] },
    { n: 5, channelPermissions: [P.ManageMessages] },
    { n: 6, muted: true },
    { id: ownerId },
    { n: 7, disconnected: true },
  ]);
  const muted = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(muted.changed, 2);
  assert.equal(muted.protected, 4);
  assert.equal(muted.already, 1);
  assert.deepEqual(s.calls, [{ id: uid(1), value: true }, { id: uid(2), value: true }]);
  const unmuted = await s.muter.run('unmute', s.guild, actorId, 'channel-1');
  assert.equal(unmuted.changed, 2);
  assert.equal(s.members.get(uid(6)).voice.serverMute, true);
  assert.equal(s.members.get(uid(2)).voice.selfMute, true);
  assert.equal(s.store.entries(gid).length, 0);
});

test('only restores tracked mutes, including after a restart', async t => {
  const s = setup(t, [{ n: 1 }, { n: 2, muted: true }]);
  await s.muter.run('mute', s.guild, actorId, 'channel-1');
  const restored = new VoiceMuter(new MuteStore(s.store.file), quiet);
  assert.equal((await restored.run('unmute', s.guild, actorId, 'channel-1')).changed, 1);
  assert.equal(s.members.get(uid(2)).voice.serverMute, true);
  assert.equal(statSync(s.store.file).mode & 0o777, 0o600);
});

test('handles channel permission failures without affecting another channel', async t => {
  const s = setup(t, [{ n: 1, botPermissions: [P.ViewChannel] }, { n: 2, channel: 2 }]);
  const result = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(result.unavailable, 1);
  assert.equal(result.changed, 0);
  assert.deepEqual(s.calls, []);
});

test('records a request before muting and does not retain rejected requests', async t => {
  let checked = false;
  const s = setup(t, [{ n: 1, error: { status: 403, code: 50013 }, onMute() {
    checked = new MuteStore(s.store.file).get(gid, uid(1)).status === 'pending';
  } }, { n: 2 }]);
  const result = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.ok(checked);
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 1);
  assert.equal(s.store.get(gid, uid(1)), undefined);
});

test('retains uncertain requests for recovery after a connection error', async t => {
  const s = setup(t, [{ n: 1, error: new Error('Connection closed') }]);
  const result = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(result.failed, 1);
  assert.equal(s.store.get(gid, uid(1)).status, 'pending');
});

test('disconnected tracked members remain eligible for a later unmute', async t => {
  const s = setup(t, [{ n: 1, disconnected: true, muted: true }]);
  s.store.put(gid, uid(1), { status: 'muted' });
  const result = await s.muter.run('unmute', s.guild, actorId, 'channel-1');
  assert.equal(result.total, 0);
  assert.ok(s.store.get(gid, uid(1)));
  assert.equal(s.calls.length, 0);
  const voice = s.members.get(uid(1)).voice;
  voice.channelId = 'channel-1';
  voice.channel = { permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.MuteMembers]) };
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-1')).changed, 1);
});

test('a manual unmute clears tracking and a later mute can be owned again', async t => {
  const s = setup(t, [{ n: 1 }]);
  await s.muter.run('mute', s.guild, actorId, 'channel-1');
  s.members.get(uid(1)).voice.serverMute = false;
  s.members.get(uid(1)).actualMuted = false;
  const restored = await s.muter.run('unmute', s.guild, actorId, 'channel-1');
  assert.equal(restored.changed, 0);
  assert.equal(s.store.entries(gid).length, 0);
  assert.equal((await s.muter.run('mute', s.guild, actorId, 'channel-1')).changed, 1);
});

test('prevents concurrent operations and releases the lock after completion', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup(t, [{ n: 1, onMute: () => gate }]);
  const running = s.muter.run('mute', s.guild, actorId, 'channel-1');
  await assert.rejects(s.muter.run('unmute', s.guild, actorId, 'channel-1'), BusyError);
  release();
  await running;
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-1')).changed, 1);
});

test('an immediate unmute uses Discord state even before the voice event arrives', async t => {
  const s = setup(t, [{ n: 1, staleCache: true }]);
  await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(s.members.get(uid(1)).voice.serverMute, false);
  assert.equal(s.members.get(uid(1)).actualMuted, true);
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-1')).changed, 1);
  assert.equal(s.members.get(uid(1)).actualMuted, false);
});

test('a pre-existing mute is protected even if the voice event is stale', async t => {
  const s = setup(t, [{ n: 1, actualMuted: true, muted: false }]);
  const result = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(result.already, 1);
  assert.equal(s.calls.length, 0);
  assert.equal(s.store.entries(gid).length, 0);
});

test('aborts before applying mutes when the record cannot be saved', async t => {
  const s = setup(t, [{ n: 1 }, { n: 2 }]);
  s.store.save = () => { throw new Error('Disk full'); };
  await assert.rejects(s.muter.run('mute', s.guild, actorId, 'channel-1'), /Disk full/);
  assert.deepEqual(s.calls, []);
  assert.equal(s.store.entries(gid).length, 0);
  assert.equal(s.muter.running.size, 0);
});

test('rejects a corrupt record instead of silently losing mute ownership', t => {
  const s = setup(t);
  writeFileSync(s.store.file, '{invalid json');
  assert.throws(() => new MuteStore(s.store.file));
  writeFileSync(s.store.file, JSON.stringify({ version: 1, guilds: { bad: {} } }));
  assert.throws(() => new MuteStore(s.store.file), /invalid guild/);
});

test('legacy records without channel IDs can be restored in the selected channel', async t => {
  const s = setup(t, [{ n: 1, muted: true }]);
  s.store.put(gid, uid(1), { status: 'muted' });
  const result = await s.muter.run('unmute', s.guild, actorId, 'channel-1');
  assert.equal(result.changed, 1);
  assert.deepEqual(JSON.parse(readFileSync(s.store.file, 'utf8')).guilds, {});
});

test('mutes members only in the selected channel', async t => {
  const s = setup(t, [{ n: 1 }, { n: 2, channel: 2 }, { n: 3 }]);
  const result = await s.muter.run('mute', s.guild, actorId, 'channel-1');
  assert.equal(result.changed, 2);
  assert.equal(s.members.get(uid(2)).actualMuted, false);
  assert.equal(s.store.get(gid, uid(2)), undefined);
  assert.deepEqual(s.calls, [{ id: uid(1), value: true }, { id: uid(3), value: true }]);
});

test('unmutes only tracked members in the selected channel and retains other records', async t => {
  const s = setup(t, [{ n: 1, muted: true }, { n: 2, channel: 2, muted: true }, { n: 3, muted: true }]);
  s.store.put(gid, uid(1), { status: 'muted' });
  s.store.put(gid, uid(2), { status: 'muted' });
  const result = await s.muter.run('unmute', s.guild, actorId, 'channel-1');
  assert.equal(result.changed, 1);
  assert.equal(result.remaining, 0);
  assert.equal(s.members.get(uid(2)).actualMuted, true);
  assert.equal(s.members.get(uid(3)).actualMuted, true);
  assert.ok(s.store.get(gid, uid(2)));
});

test('selecting an empty channel does not affect other channels or their mute records', async t => {
  const s = setup(t, [{ n: 1, muted: true }]);
  s.store.put(gid, uid(1), { status: 'muted' });
  assert.equal((await s.muter.run('mute', s.guild, actorId, 'channel-2')).changed, 0);
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-2')).changed, 0);
  assert.ok(s.store.get(gid, uid(1)));
  assert.deepEqual(s.calls, []);
});

for (const mode of ['mute', 'unmute']) {
  test(`skips a member who moves out of the selected channel during ${mode}`, async t => {
    const s = setup(t, [{ n: 1, muted: mode === 'unmute' }]);
    if (mode === 'unmute') s.store.put(gid, uid(1), { status: 'muted' });
    const fetch = s.guild.members.fetch;
    s.guild.members.fetch = async options => {
      const member = await fetch(options);
      member.voice.channelId = 'channel-2';
      return member;
    };
    const result = await s.muter.run(mode, s.guild, actorId, 'channel-1');
    assert.equal(result.moved, 1);
    assert.deepEqual(s.calls, []);
    if (mode === 'unmute') assert.ok(s.store.get(gid, uid(1)));
  });
}

test('tracked mutes follow members who move and can be restored in their current channel', async t => {
  const s = setup(t, [{ n: 1 }]);
  await s.muter.run('mute', s.guild, actorId, 'channel-1');
  s.members.get(uid(1)).voice.channelId = 'channel-2';
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-1')).changed, 0);
  assert.equal((await s.muter.run('unmute', s.guild, actorId, 'channel-2')).changed, 1);
  assert.equal(s.members.get(uid(1)).actualMuted, false);
});

test('missing channel cannot fall back to muting the entire server', async t => {
  const s = setup(t, [{ n: 1 }, { n: 2, channel: 2 }]);
  await assert.rejects(s.muter.run('mute', s.guild, actorId), /voice channel must be selected/);
  assert.deepEqual(s.calls, []);
});

test('both Discord commands require a voice-only channel picker', () => {
  for (const command of commands) {
    const channel = command.options.find(o => o.name === 'channel');
    assert.equal(channel.type, ApplicationCommandOptionType.Channel);
    assert.equal(channel.required, true);
    assert.deepEqual(channel.channel_types, [ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
    assert.equal(command.default_member_permissions, String(P.MuteMembers));
  }
});
