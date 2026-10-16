<div align="center">

# 🔇 Mute All

**Simple voice moderation for your Discord server.**

**Disclaimer: This bot was made with the help of on-device AI.**

Mute or unmute members in a selected voice channel with one slash command.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-24+-339933?logo=nodedotjs&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)

</div>

---

## ✨ Features

- **Voice-channel dropdown** — select a voice or Stage channel directly in Discord.
- **Bulk mute** — server-mute eligible members in the selected channel.
- **Staff exemptions** — skip the server owner, administrators, and members with Manage Messages.
- **Controlled unmute** — restore only the server mutes recorded by this bot.
- **Persistent records** — keep track of mutes across bot and server restarts.
- **Channel isolation** — leave members in other voice channels untouched.
- **Docker support** — run continuously without keeping an SSH connection open.
- **Private replies** — command results are visible only to the person running the command.

## 🎮 Commands

| Command | Description |
| --- | --- |
| `/muteall channel:` | Mute eligible members currently in the selected voice channel. |
| `/unmuteall channel:` | Restore this bot’s recorded mutes for members currently in the selected voice channel. |

Choose a channel from Discord’s searchable dropdown. No channel IDs are needed.

### How mute protection works

Members are excluded from `/muteall` if they:

- Own the server.
- Have Administrator permission.
- Have Manage Messages permission at server level or in their current voice channel.

`/unmuteall` preserves server mutes that existed before this bot muted members. It also leaves members’ own microphone mute settings unchanged.

> Commands affect members present when the operation starts. Members who join afterward are not automatically muted. Members who move out of the selected channel before being processed are skipped. I may add a feature to mute members that join while the mute is active later idk.

## 🔑 Permissions

### Bot permissions

Give the bot these permissions in every voice channel where it will be used:

- **View Channels**
- **Mute Members**

For private channels, check the channel or category permission overrides.

**Administrator permission is not required.**

### Command permissions

Members running either command need **Mute Members** permission at server level.

The bot uses the `Guilds` and `GuildVoiceStates` Gateway intents. It does not require Message Content Intent or Server Members Intent.

## 🚀 Getting Started

### 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application and configure its bot.
3. Copy its **Application ID** and **bot token**.
4. Invite the bot to your server with these OAuth2 scopes:
   - `bot`
   - `applications.commands`
5. Grant **View Channels** and **Mute Members**.

Keep your bot token private.

### 2. Configure the bot

From the project directory, copy the example configuration:

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
STATE_FILE=./data/mutes.json
```

To copy your Server ID, enable **Developer Mode** in Discord, then right-click your server and select **Copy Server ID**.

### 3. Build and start with Docker

Install Docker and Docker Compose, then run:

```sh
docker compose build
docker compose run --rm --no-deps bot node src/register.js
docker compose up -d
```

If your Docker installation requires elevated permissions, add `sudo` before each command.

The bot runs in the background. Closing your terminal or SSH connection will not stop it.

## 🐳 Docker Management

### View live logs

```sh
docker compose logs --follow --tail=30 bot
```

### Check status

```sh
docker compose ps
```

### Restart

```sh
docker compose restart bot
```

### Stop

```sh
docker compose stop
```

### Start again

```sh
docker compose up -d
```

The service uses `restart: unless-stopped`. Make sure Docker itself starts automatically at boot if you want the bot to return after a server reboot.

## 💾 Persistent Mute Records

Docker stores mute records in the `mute-data` volume.

These records let `/unmuteall` distinguish this bot’s mutes from pre-existing server mutes.

- Preserve the volume when updating or moving the bot.
- Run only one bot instance against the same volume.
- If a muted member disconnects, run `/unmuteall` with their current channel selected after they reconnect.
- Records from the earlier version that muted across all channels remain compatible.

> Do not delete the volume while you still need the bot to restore recorded mutes. Avoid `docker compose down -v`, which removes the volume.

## 🧪 Local Development

Requires **Node.js 24.17.0 or newer**.

```sh
npm ci --ignore-scripts
npm test
npm run register
npm start
```

Use this setting in `.env` for local storage:

```env
STATE_FILE=./data/mutes.json
```

The automated tests cover:

- Voice-channel selection and isolation.
- Staff exemptions and channel permissions.
- Preservation of pre-existing mutes.
- Members moving or disconnecting during operations.
- Restart recovery and older mute records.
- Concurrent commands and persistence failures.

Tests use simulated Discord members and do not mute anyone in a live server.

## 🛠️ Troubleshooting

| Problem | What to check |
| --- | --- |
| Commands do not appear | Run command registration and confirm the Application ID and Server ID. |
| Discord reports `Unknown Guild` | Confirm the bot is invited to the configured server and that you copied the Server ID. |
| Members are skipped | Check their Manage Messages permission and the bot’s voice-channel permissions. |
| Some members remain muted | They may have been muted before the bot’s command, moved channels, or disconnected. |
| Another operation is running | Wait for the current mute or unmute operation to finish. |

## 🔒 Configuration Security

Never commit your `.env` file, bot token, or SSH keys.

The included `.gitignore` excludes `.env`, local mute records, and installed dependencies.
