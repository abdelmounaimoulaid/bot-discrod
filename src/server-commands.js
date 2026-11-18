// /leaderboard (everyone) and the admin commands /unlink, /refresh, /setchannel.
const { MessageFlags, ChannelType } = require('discord.js');
const { FEATURE_CHANNELS, featureChannelId, saveChannelOverride } = require('./channels');

const FEATURE_LABELS = {
    rankUps: 'Rank-ups',
    matchRecaps: 'Match recaps',
    liveGames: 'Live games',
    lpRace: 'Weekly LP race',
    monthlyRecap: 'Monthly recap',
    welcome: 'Welcome messages'
};

// The cooldown keeps /refresh from burning the Riot rate limit.
const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;

function createServerCommands({ db, buildLeagueEmbed, buildValorantEmbed, refreshAll, updateDashboards }) {
    let lastManualRefresh = 0;

    async function leaderboard(interaction) {
        const board = interaction.options.getString('board') || 'solo';
        await interaction.deferReply();
        const embed = board === 'valorant'
            ? await buildValorantEmbed(interaction.guild)
            : await buildLeagueEmbed(interaction.guild, board === 'flex' ? 'FLEX' : 'SOLO');
        await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    async function unlink(interaction) {
        const user = interaction.options.getUser('user', true);
        const game = interaction.options.getString('game') || 'all';
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const removed = [];
        if (game === 'all' || game === 'lol') {
            const result = await db.prepare('DELETE FROM players WHERE discord_id = ?').run(user.id);
            if (result?.affectedRows) removed.push('League');
            if (result?.affectedRows) await db.prepare("DELETE FROM rank_history WHERE game = 'LOL' AND discord_id = ?").run(user.id);
        }
        if (game === 'all' || game === 'valorant') {
            const result = await db.prepare('DELETE FROM valorant_players WHERE discord_id = ?').run(user.id);
            if (result?.affectedRows) removed.push('VALORANT');
            if (result?.affectedRows) await db.prepare("DELETE FROM rank_history WHERE game = 'VAL' AND discord_id = ?").run(user.id);
        }
        if (!removed.length) {
            await interaction.editReply({ content: `<@${user.id}> had no linked ${game === 'all' ? '' : `${game === 'lol' ? 'League' : 'VALORANT'} `}account.`, allowedMentions: { parse: [] } });
            return;
        }
        console.log(`🔓 ${interaction.user.tag} unlinked ${removed.join(' + ')} for ${user.id}.`);
        await updateDashboards().catch(error => console.error('Could not update dashboards after unlink:', error.message));
        await interaction.editReply({ content: `✅ Unlinked ${removed.join(' and ')} for <@${user.id}>. They are off the leaderboard. Their rank roles stay until you remove them.`, allowedMentions: { parse: [] } });
    }

    async function refresh(interaction) {
        const wait = lastManualRefresh + REFRESH_COOLDOWN_MS - Date.now();
        if (wait > 0) {
            await interaction.reply({ content: `⏳ A refresh ran recently. Try again in ${Math.ceil(wait / 1000)}s.`, flags: MessageFlags.Ephemeral });
            return;
        }
        lastManualRefresh = Date.now();
        await interaction.reply({ content: '🔄 Refreshing every player from Riot and HenrikDev. The leaderboards update when it finishes (about 2s per player).', flags: MessageFlags.Ephemeral });
        const startedAt = Date.now();
        await refreshAll('Manual');
        await interaction.editReply({ content: `✅ Refresh finished in ${Math.round((Date.now() - startedAt) / 1000)}s.` }).catch(() => {});
    }

    async function setChannel(interaction) {
        const feature = interaction.options.getString('feature', true);
        const channel = interaction.options.getChannel('channel');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (channel && !channel.isTextBased?.()) {
            await interaction.editReply('❌ Pick a text or announcement channel.');
            return;
        }
        await saveChannelOverride(db, feature, channel?.id || null);
        const now = featureChannelId(feature);
        await interaction.editReply(channel
            ? `✅ **${FEATURE_LABELS[feature]}** now posts in <#${channel.id}>.`
            : `✅ **${FEATURE_LABELS[feature]}** is back to the default channel <#${now}> (from .env).`);
    }

    async function handleCommand(interaction) {
        switch (interaction.commandName) {
            case 'leaderboard': await leaderboard(interaction); return true;
            case 'unlink': await unlink(interaction); return true;
            case 'refresh': await refresh(interaction); return true;
            case 'setchannel': await setChannel(interaction); return true;
            default: return false;
        }
    }

    return { handleCommand };
}

const FEATURE_CHOICES = Object.keys(FEATURE_CHANNELS).map(value => ({ name: FEATURE_LABELS[value] || value, value }));
const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = { createServerCommands, FEATURE_CHOICES, FEATURE_LABELS, CHANNEL_TYPES };
