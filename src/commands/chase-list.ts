import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserAlertSettings, getUserPlan, listChases } from '../services/chase-store.js';
import { activePlanChases, activePlanLimits, pausedPlanChases } from '../services/plans.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';

const PAGE_SIZE = 8;
const PAGE_ID_PREFIX = 'chase-list';
const DEFAULT_BLOCKED_TERMS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica', 'fan art', 'novelty', 'keychain', 'extended art', 'acrylic case', 'magnetic case'];
const FIELD_VALUE_LIMIT = 1000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normalizedTerm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function chaseSpecificBlockedTerms(terms: string[] | undefined): string[] {
  if (!terms || terms.length === 0) return [];
  const defaults = new Set(DEFAULT_BLOCKED_TERMS.map(normalizedTerm));
  return terms.filter((term) => !defaults.has(normalizedTerm(term)));
}

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

export function buildChaseListEmbed(userId: string, page: number) {
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
      embeds: [infoEmbed('📭 No Active Chases', 'Use `/chase add` to start your Vault; active chases shape alerts and Discovery recommendations.')],
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

  const renderGroup = (title: string, items: Array<(typeof pageItems)[number]>, options: { includePriority?: boolean; paused?: boolean } = {}) => {
    if (items.length === 0) return null;
    const { includePriority = false, paused = false } = options;
    const rows = items.map((c) => {
      const absoluteIndex = entryById.get(c.id) ?? 0;
      const titleLine = `**#${absoluteIndex}** · **${truncate(c.cardName, 72)}**`;
      const summary = [
        c.maxPrice !== undefined ? `${c.maxPrice} ${currency} max` : `${OUTPUT_STYLE.any} price`,
        displayGrade(c.grade),
        displayCondition(c.condition),
        displayAny(c.listingType)
      ].join(' · ');

      const extras: string[] = [];
      if (includePriority) extras.push(`Priority: ${priorityLabel(c.priority)}`);
      if (c.targetNote) extras.push(`Note: ${orNone(c.targetNote)}`);
      const customBlockedTerms = chaseSpecificBlockedTerms(c.negativeKeywords);
      if (customBlockedTerms.length > 0) extras.push(`Tuning: ${customBlockedTerms.join(', ')}`);
      if (paused) extras.push('Status: Paused until Pro');

      return extras.length > 0 ? `${titleLine}\n${summary}\n${extras.join(' · ')}` : `${titleLine}\n${summary}`;
    });

    return keyValue(title, truncate(rows.join('\n\n'), FIELD_VALUE_LIMIT));
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
  ].filter((field): field is { name: string; value: string; inline: false } => field !== null);

  const description = [
    `**${activeChaseIds.size}/${limits.maxActiveChases} active** · **${total} saved** · **Page ${currentPage + 1}/${totalPages}**`,
    ...(pausedCount > 0 ? [`**Paused Chases:** ${pausedCount} saved, not checked while on Free`] : []),
    'Active order follows priority, then oldest chase first.'
  ].join('\n');

  const embed = infoEmbed('📚 Vault Chases', description);
  embed.addFields(
    ...groupedSections,
    keyValue('Default Exclusions', DEFAULT_BLOCKED_TERMS.join(', ')),
    keyValue('Next Actions', 'Refine with `/chase edit` · Remove with `/chase remove` · Discovery uses active chases as taste signals')
  );

  return {
    empty: false as const,
    embeds: [embed],
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
