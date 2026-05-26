import { SlashCommandBuilder } from 'discord.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { CONDITION_CHOICES, GRADE_VALUE_CHOICES, GRADING_TYPE_CHOICES } from './chase-options.js';

export const chase = {
  data: new SlashCommandBuilder()
    .setName('chase')
    .setDescription('Manage the cards your Vault is watching')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a card for Vaultr to watch')
        .addStringOption((opt) =>
          opt
            .setName('card')
            .setDescription('Card to chase, e.g. Umbreon VMAX 215/203')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('Highest total price you want surfaced').setMinValue(0.01))
        .addStringOption((opt) =>
          opt
            .setName('grading_type')
            .setDescription('Slab/raw preference (default: Any)')
            .addChoices(...GRADING_TYPE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('grade_value')
            .setDescription('Numeric grade preference (default: Any)')
            .addChoices(...GRADE_VALUE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('condition')
            .setDescription('Pro: minimum raw condition to surface')
            .addChoices(...CONDITION_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('Pro: auction or Buy It Now preference')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('negative_keywords')
            .setDescription('Pro: terms to keep out of this chase')
            .setMaxLength(240)
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('Pro: how important this chase is')
            .addChoices(
              { name: 'Normal', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription('Pro: short note about what makes this one special').setMaxLength(120)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Show the cards your Vault is watching')
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Tune an active chase by list entry number')
        .addIntegerOption((opt) => opt.setName('entry').setDescription('Entry number from /chase list').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('card').setDescription('Updated card name or set number').setMinLength(3).setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('Updated highest total price to surface').setMinValue(0.01))
        .addStringOption((opt) =>
          opt
            .setName('grading_type')
            .setDescription('Updated slab/raw preference')
            .addChoices(...GRADING_TYPE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('grade_value')
            .setDescription('Updated numeric grade preference')
            .addChoices(...GRADE_VALUE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('condition')
            .setDescription('Pro: updated minimum raw condition')
            .addChoices(...CONDITION_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('Pro: updated auction or Buy It Now preference')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('negative_keywords')
            .setDescription('Pro: updated terms to keep out')
            .setMaxLength(240)
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('Pro: updated chase importance')
            .addChoices(
              { name: 'Normal', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription('Pro: updated note about this chase').setMaxLength(120)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop watching one or more chases')
        .addStringOption((opt) =>
          opt
            .setName('entries')
            .setDescription('Entry numbers from /chase list, e.g. 1 or 1,3,5')
            .setMaxLength(120)
        )
        .addStringOption((opt) =>
          opt
            .setName('all')
            .setDescription('Stop watching every active chase')
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
