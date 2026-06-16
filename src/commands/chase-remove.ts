import { MessageFlags } from 'discord.js';
import { listChases, removeChase } from '../services/chase-store.js';
import { errorEmbed, successEmbed } from '../ui/embeds.js';
import { displayGrade } from '../ui/style.js';

function chaseChoiceName(chase: ReturnType<typeof listChases>[number]): string {
  const details = [
    chase.maxPrice !== undefined ? `Max ${chase.maxPrice}` : undefined,
    chase.grade ? displayGrade(chase.grade) : undefined,
    chase.priority && chase.priority !== 'NORMAL' ? chase.priority : undefined
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : '';
  return `${chase.cardName}${suffix}`.slice(0, 100);
}

export async function handleChaseRemoveAutocomplete(interaction: any): Promise<boolean> {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName !== 'chase') return false;
  if (interaction.options.getSubcommand() !== 'remove') return false;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'chase') return false;

  const query = String(focused.value ?? '').trim().toLowerCase();
  const chases = listChases(interaction.user.id);
  const matches = chases
    .filter((chase, index) => {
      if (query.length === 0) return index < 25;
      return chase.cardName.toLowerCase().includes(query);
    })
    .slice(0, 25)
    .map((chase) => ({
      name: chaseChoiceName(chase),
      value: chase.id
    }));

  await interaction.respond(matches);
  return true;
}

export const chaseRemove = {
  async execute(interaction: any) {
    const chaseId = interaction.options.getString('chase');
    const chases = listChases(interaction.user.id);

    if (chases.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No Active Chases', 'There are no active chases to remove')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!chaseId) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Required', 'Pick a current chase from `/chase remove` and try again')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const target = chases.find((chase) => chase.id === chaseId);
    if (!target) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Not Found', 'Pick a current chase from `/chase remove` and try again')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const removed = removeChase(interaction.user.id, target.id);
    if (!removed) {
      await interaction.reply({
        embeds: [errorEmbed('Remove Failed', 'No chase was removed')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed('Chase Removed', `Removed **${target.cardName}**\n\n**Next:** Use \`/chase list\` to review active chases`).setTitle('✅ Chase Removed')
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
