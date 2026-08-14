import { EmbedBuilder, MessageFlags } from 'discord.js';
import { successEmbed, warningEmbed } from '../ui/embeds.js';

const ALERTS_TEST_DM_TIMEOUT_MS = 10_000;

export function buildAlertsTestDmEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('🧪 Vaultr DM Test')
    .setDescription(
      [
        'This is a delivery test from Vaultr.',
        'It is not a real listing and will not affect your alerts, Vault, or Weekly Shelf.'
      ].join('\n')
    )
    .setFooter({ text: 'Vaultr • Alerts Test' })
    .setTimestamp();
}

async function sendAlertsTestDm(user: { send: (payload: any) => Promise<unknown> }): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('ALERTS_TEST_DM_TIMEOUT')), ALERTS_TEST_DM_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      user.send({ embeds: [buildAlertsTestDmEmbed()] }),
      timeoutPromise
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function blockedDmMessage(): string {
  return 'Vaultr could not deliver a test DM. Enable direct messages for this server or allow Vaultr to DM you, then retry `/alerts test`.';
}

export const alertsTest = {
  async execute(interaction: any) {
    try {
      await sendAlertsTestDm(interaction.user);
      await interaction.reply({
        embeds: [
          successEmbed('DM Test Sent', 'Vaultr can reach you by DM. This was only a delivery test, not a real listing.')
            .setTitle('✅ DM Test Sent')
        ],
        flags: MessageFlags.Ephemeral
      });
    } catch {
      await interaction.reply({
        embeds: [
          warningEmbed('DM Test Failed', blockedDmMessage())
        ],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
