const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildLaneSelectMenu } = require('./lane-roles');
const { getFeatureChannel } = require('./channels');

// The buttons reuse the existing link_* custom ids, so they open the same modals
// as the link panels and need no handler of their own.
function buildWelcomeMessage(member) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription([
            `Hey <@${member.id}>, glad you're here! Get set up in 3 steps:`,
            '',
            '**1.** 🔗 Link your **League** and/or **VALORANT** account below',
            '**2.** 🏅 You automatically get your **rank role** and join the leaderboards',
            '**3.** 🛡️ Pick your **main lane** so teammates can find you (`/lfg`)',
            '',
            'Then try `/profile` to see your rank card!'
        ].join('\n'))
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: `Member #${member.guild.memberCount}` })
        .setTimestamp();
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('link_league_account').setLabel('Link League').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('link_valorant_account').setLabel('Link VALORANT').setEmoji('🔴').setStyle(ButtonStyle.Danger)
    );
    const lanes = new ActionRowBuilder().addComponents(buildLaneSelectMenu());
    return { content: `<@${member.id}>`, embeds: [embed], components: [buttons, lanes], allowedMentions: { users: [member.id] } };
}

async function sendWelcome(client, member) {
    if (member.user.bot) return;
    const channel = await getFeatureChannel(client, 'welcome');
    if (channel) await channel.send(buildWelcomeMessage(member));
}

module.exports = { buildWelcomeMessage, sendWelcome };
