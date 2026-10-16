import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class MuteStore {
  constructor(file) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, guilds: {} };
    if (this.state?.version !== 1 || !this.state.guilds || typeof this.state.guilds !== 'object' || Array.isArray(this.state.guilds)) {
      throw new Error('The mute record is invalid. Restore it from a backup before starting.');
    }
    for (const [guildId, records] of Object.entries(this.state.guilds)) {
      if (!/^\d{17,20}$/.test(guildId) || !records || typeof records !== 'object' || Array.isArray(records)) {
        throw new Error('The mute record contains an invalid guild.');
      }
      for (const [userId, record] of Object.entries(records)) {
        if (!/^\d{17,20}$/.test(userId) || !['pending', 'muted'].includes(record?.status)) {
          throw new Error('The mute record contains an invalid member.');
        }
      }
    }
  }

  get(guildId, userId) { return this.state.guilds[guildId]?.[userId]; }
  entries(guildId) { return Object.entries(this.state.guilds[guildId] ?? {}); }

  put(guildId, userId, record) {
    const next = structuredClone(this.state);
    (next.guilds[guildId] ??= {})[userId] = record;
    this.save(next);
  }

  remove(guildId, userId) {
    if (!this.get(guildId, userId)) return;
    const next = structuredClone(this.state);
    delete next.guilds[guildId][userId];
    if (!Object.keys(next.guilds[guildId]).length) delete next.guilds[guildId];
    this.save(next);
  }

  save(next) {
    const temp = `${this.file}.tmp`;
    const descriptor = openSync(temp, 'w', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    renameSync(temp, this.file);
    this.state = next;
  }
}
