import { SlashCommandBuilder } from 'discord.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { CONDITION_CHOICES, GRADE_VALUE_CHOICES, GRADING_TYPE_CHOICES } from './chase-options.js';

export const chase = {
  data: new SlashCommandBuilder()
    .setName('chase')
    .setDescription('Build your Vault chase list')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a card to your Vault')
        .addStringOption((opt) =>
          opt
            .setName('card')
            .setDescription('Card name or number, e.g. Umbreon VMAX 215/203')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('Highest total price to surface (default: Any)').setMinValue(0.01))
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
            .setDescription('[PRO] Minimum raw condition (default: Any)')
            .addChoices(...CONDITION_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('[PRO] Auction or Buy It Now preference (default: Any)')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('tune_out_terms')
            .setDescription('[PRO] Extra terms to exclude (default: None)')
            .setMaxLength(240)
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('[PRO] Chase importance (default: Casual)')
            .addChoices(
              { name: 'Casual', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription('[PRO] Short note for this chase (default: None)').setMaxLength(120)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Show your Vault chases')
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription('Refine a Vault chase')
        .addStringOption((opt) =>
          opt
            .setName('chase')
            .setDescription('Start typing, then pick the chase to edit')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt.setName('card').setDescription('New card name or set number').setMinLength(3).setMaxLength(100)
        )
        .addNumberOption((opt) => opt.setName('max_price').setDescription('New highest total price to surface').setMinValue(0.01))
        .addStringOption((opt) =>
          opt
            .setName('grading_type')
            .setDescription('New slab/raw preference')
            .addChoices(...GRADING_TYPE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('grade_value')
            .setDescription('New numeric grade preference')
            .addChoices(...GRADE_VALUE_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('condition')
            .setDescription('[PRO] New minimum raw condition')
            .addChoices(...CONDITION_CHOICES)
        )
        .addStringOption((opt) =>
          opt
            .setName('listing_type')
            .setDescription('[PRO] New Auction or Buy It Now preference')
            .addChoices(
              { name: 'Any', value: 'ANY' },
              { name: 'Auction', value: 'AUCTION' },
              { name: 'Buy It Now', value: 'BUY_IT_NOW' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('[PRO] New chase importance')
            .addChoices(
              { name: 'Casual', value: 'NORMAL' },
              { name: 'High', value: 'HIGH' },
              { name: 'Grail', value: 'GRAIL' }
            )
        )
        .addStringOption((opt) =>
          opt.setName('target_note').setDescription("[PRO] New note. Type the word 'clear' to remove the saved note").setMaxLength(120)
        )
        .addStringOption((opt) =>
          opt.setName('tune_out_terms').setDescription("[PRO] Replace tune-outs. Type the word 'clear' to remove custom terms").setMaxLength(240)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a Vault chase')
        .addStringOption((opt) =>
          opt
            .setName('chase')
            .setDescription('Start typing, then pick the chase to remove')
            .setRequired(true)
            .setAutocomplete(true)
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
