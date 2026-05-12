import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in environment');
}

const rest = new REST({ version: '10' }).setToken(token);

await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
  body: commands.map((c) => c.data.toJSON())
});

console.log(`Registered ${commands.length} command(s) to guild ${guildId}`);
