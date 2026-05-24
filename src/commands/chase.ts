import { SlashCommandBuilder } from 'discord.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';

export const chase = {
  data: new SlashCommandBuilder()
    .setName('chase')
    .setDescription('Manage your vault chases')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a new chase card')
        .addStringOption((opt) =>
          opt
            .setName('card')
            .setDescription('Card name (3-100 chars, casing ignored)')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('Max price (must be > 0)').setMinValue(0.01))
        .addStringOption((opt) => opt.setName('grade').setDescription('Grade preference, e.g. PSA 10 or ungraded/raw (default: Any)').setMaxLength(24))
        .addStringOption((opt) =>
          opt
            .setName('condition')
            .setDescription('Condition(s): NM,LP,MP,HP,DMG (default: Any)')
            .setMaxLength(40)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('Listing type (default: Any)')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('negative_keywords')
            .setDescription('Blocked terms (comma-separated, max 15) (default: proxy,custom,reprint,lot,orica,replica)')
            .setMaxLength(240)
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('Priority for this chase (default: Normal)')
            .addChoices(
              { name: 'Normal', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription('Optional chase note').setMaxLength(120)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List your active chases')
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Edit an active chase by list entry number')
        .addIntegerOption((opt) => opt.setName('entry').setDescription('Entry number from /chase list').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('card').setDescription('Updated card name (3-100 chars, casing ignored; default: keep current)').setMinLength(3).setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('Updated max price (> 0) (default: keep current)').setMinValue(0.01))
        .addStringOption((opt) => opt.setName('grade').setDescription('Updated grade, e.g. PSA 10 or ungraded/raw (default: keep current)').setMaxLength(24))
        .addStringOption((opt) =>
          opt
            .setName('condition')
            .setDescription('Updated condition(s): NM,LP,MP,HP,DMG (default: keep current)')
            .setMaxLength(40)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('Updated listing type (default: keep current)')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('negative_keywords')
            .setDescription('Blocked terms (comma-separated, max 15) (default: keep current)')
            .setMaxLength(240)
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('Updated priority (default: keep current)')
            .addChoices(
              { name: 'Normal', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription('Updated chase note (default: keep current)').setMaxLength(120)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove one or more active chases, or remove all')
        .addStringOption((opt) =>
          opt
            .setName('entries')
            .setDescription('Entry numbers from /chase list (comma-separated), e.g. 1 or 1,3,5')
            .setMaxLength(120)
        )
        .addStringOption((opt) =>
          opt
            .setName('all')
            .setDescription('Remove all active chases (optional; default: No)')
            .addChoices(
              { name: 'No', value: 'NO' },
              { name: 'Yes, remove all', value: 'YES' }
            )
        )
    ),
  async execute(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') return chaseAdd.execute(interaction);
    if (subcommand === 'list') return chaseList.execute(interaction);
    if (subcommand === 'edit') return chaseEdit.execute(interaction);
    if (subcommand === 'remove') return chaseRemove.execute(interaction);
  }
};
