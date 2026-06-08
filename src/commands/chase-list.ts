import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserAlertSettings, getUserPlan, listChases } from '../services/chase-store.js';
import { activePlanChases, activePlanLimits, pausedPlanChases } from '../services/plans.js';
import { infoEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';

const PAGE_SIZE = 10;
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
  const settings = getUserAlertSettings(userId);
  const plan = getUserPlan(userId);
  const limits = activePlanLimits(plan);
  const activeChaseIds = new Set(activePlanChases(chases, plan).map((chase) => chase.id));
  const pausedCount = pausedPlanChases(chases, plan).length;
  const currency = settings.alertCurrency;
  const total = chases.length;
  if (total === 0) {
    return {
      empty: true as const,
      embeds: [infoEmbed('📭 No Active Chases', 'Clean slate. Use `/chase add` to start the Vault; your chases shape what `/discover` finds next.')],
      components: []
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = clampPage(page, totalPages);
  const start = currentPage * PAGE_SIZE;
  const pageItems = chases.slice(start, start + PAGE_SIZE);
  const entryById = new Map<string, number>(chases.map((c, idx) => [c.id, idx + 1]));

  const priorityLabel = (priority: string | undefined): string => {
    if (priority === 'GRAIL') return 'Grail';
    if (priority === 'HIGH') return 'High';
    return 'Normal';
  };

  const renderGroup = (title: string, items: Array<(typeof pageItems)[number]>, options: { includePriority?: boolean; paused?: boolean } = {}): string => {
    if (items.length === 0) return '';
    const { includePriority = false, paused = false } = options;
    const rows = items.map((c) => {
      const absoluteIndex = entryById.get(c.id) ?? 0;
      const summary = [
        `**#${absoluteIndex} — ${c.cardName}**`,
        ...(includePriority ? [`Priority: ${priorityLabel(c.priority)}`] : []),
        `Max: ${c.maxPrice !== undefined ? `${c.maxPrice} ${currency}` : OUTPUT_STYLE.any}`,
        `Grade: ${displayGrade(c.grade)}`,
        `Condition: ${displayCondition(c.condition)}`,
        `Listing: ${displayAny(c.listingType)}`
      ].join(' | ');

      const extras: string[] = [];
      if (c.targetNote) extras.push(`Note: ${orNone(c.targetNote)}`);
      if (c.negativeKeywords && c.negativeKeywords.length > 0) {
        extras.push(`Blocked: ${c.negativeKeywords.join(', ')}`);
      }
      if (paused) extras.push('Status: Paused until Pro');

      return extras.length > 0 ? `${summary}\n${extras.join(' | ')}` : summary;
    });

    return `**${title}**\n${rows.join('\n')}`;
  };

  const activePageItems = pageItems.filter((chase) => activeChaseIds.has(chase.id));
  const pausedPageItems = pageItems.filter((chase) => !activeChaseIds.has(chase.id));
  const activeGrail = activePageItems.filter((chase) => (chase.priority ?? 'NORMAL') === 'GRAIL');
  const activeHigh = activePageItems.filter((chase) => (chase.priority ?? 'NORMAL') === 'HIGH');
  const activeNormal = activePageItems.filter((chase) => (chase.priority ?? 'NORMAL') === 'NORMAL');

  const groupedSections = [
    renderGroup('🏆 Grail', activeGrail),
    renderGroup('🔥 High Priority', activeHigh),
    renderGroup('🟢 Normal', activeNormal),
    renderGroup('⏸️ Paused Until Pro', pausedPageItems, { includePriority: true, paused: true })
  ].filter(Boolean);

  const description = [
    `**Active Chases:** ${activeChaseIds.size}/${limits.maxActiveChases}`,
    ...(pausedCount > 0 ? [`**Paused Chases:** ${pausedCount} saved, not checked while on Free`] : []),
    `**Page:** ${currentPage + 1}/${totalPages}`,
    '',
    groupedSections.join('\n\n'),
    '',
    '---',
    '**Next Actions**',
    '✏️ Refine with `/chase edit`',
    '🗑️ Remove with `/chase remove`',
    '✨ Explore a side quest with `/discover`'
  ].join('\n');

  return {
    empty: false as const,
    embeds: [infoEmbed('📚 Vault Chases', description)],
    components: [makePaginationRow(userId, currentPage, totalPages)]
  };
}

export const chaseList = {
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
      content: 'Only the original requester can change this page',
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
