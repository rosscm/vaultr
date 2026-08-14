import 'dotenv/config';
import { REST } from 'discord.js';
import { commands } from './commands/index.js';
import {
  describeDiscordCommandRegistrationTarget,
  discordCommandRegistrationRoute,
  resolveDiscordCommandRegistrationConfig
} from './services/discord-command-registration.js';

const config = resolveDiscordCommandRegistrationConfig(process.env);

const rest = new REST({ version: '10' }).setToken(config.token);

await rest.put(discordCommandRegistrationRoute(config), {
  body: commands.map((c) => c.data.toJSON())
});

console.log(
  `Registered ${commands.length} command(s) to ${describeDiscordCommandRegistrationTarget(config)} ` +
  `(scope=${config.scope}${config.guildId ? ` guildId=${config.guildId}` : ''})`
);
