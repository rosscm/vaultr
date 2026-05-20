import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, orAny, orNone } from '../ui/style.js';

const PAGE_SIZE = 5;
const PAGE_ID_PREFIX = 'chase-list';

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

function clampPage(page: number, totalPages: number): number {
  return Math.max(0, Math.min(page, totalPages - 1));
}

function makePaginationRow(userId: string, page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  const prevPage = Math.max(0, page - 1);
  const nextPage = Math.min(totalPages - 1, page + 1);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PAGE_ID_PREFIX}:${userId}:prev:${prevPage}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${PAGE_ID_PREFIX}:${userId}:next:${nextPage}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

function buildChaseListEmbed(userId: string, page: number) {
  const chases = listChases(userId);
  const total = chases.length;
  if (total === 0) {
    return {
      empty: true as const,
      embeds: [infoEmbed('📭 No Active Chases', 'Use `/chase-add` to start one.')],
      components: []
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * PAGE_SIZE;
  const pageItems = chases.slice(start, start + PAGE_SIZE);

  const lines = pageItems.map((c, i) => {
    const priorityBadge = c.priority === 'GRAIL' ? '🏆 GRAIL' : c.priority === 'HIGH' ? '🔥 HIGH' : '🟢 NORMAL';
    const header = `**#${start + i + 1} — ${c.cardName}**`;
    const details = [
      `**Priority:** ${priorityBadge}`,
      `**Max:** ${c.maxPrice ?? OUTPUT_STYLE.any}`,
      `**Grade:** ${orAny(c.grade)}`,
      `**Condition:** ${orAny(c.condition)}`,
      `**Listing:** ${displayAny(c.listingType)}`,
      `**Blocked:** ${c.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`,
      `**Note:** ${orNone(c.targetNote)}`
    ].join('\n');
    return `${header}\n${details}`;
  });

  const description = [
    `**Total Active Chases:** ${total}`,
    `**Page:** ${currentPage + 1}/${totalPages}`,
    '',
    lines.join('\n\n---\n\n'),
    '',
    '---',
    '**Quick Actions:** /chase-edit entry:<n> or /chase-remove entry:<n>'
  ].join('\n');

  return {
    empty: false as const,
    embeds: [infoEmbed('🎯 Your Chases', description)],
    components: [makePaginationRow(userId, currentPage, totalPages)]
  };
}

export const chaseList = {
  data: new SlashCommandBuilder().setName('chase-list').setDescription('List your active chases'),
  async execute(interaction: any) {
    const payload = buildChaseListEmbed(interaction.user.id, 0);
    await interaction.reply({
      embeds: payload.embeds,
      components: payload.components,
      flags: MessageFlags.Ephemeral
    });
  }
};

export async function handleChaseListPagination(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${PAGE_ID_PREFIX}:`)) return false;

  const [, ownerUserId, direction, pageRaw] = interaction.customId.split(':');
  if (!ownerUserId || !direction || pageRaw === undefined) return false;

  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can change this page.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const page = Number(pageRaw);
  const safePage = Number.isFinite(page) ? page : 0;
  const payload = buildChaseListEmbed(ownerUserId, safePage);
  await interaction.update({
    embeds: payload.embeds,
    components: payload.components
  });
  return true;
}
