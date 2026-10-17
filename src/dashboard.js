const { EmbedBuilder, escapeMarkdown } = require('discord.js');

const TITLES = {
    SOLO: '🏆 League of Legends • Solo/Duo Leaderboard',
    FLEX: '🛡️ League of Legends • Flex Leaderboard'
};

const LEGACY_TITLES = [
    TITLES.SOLO,
    TITLES.FLEX,
    '🏆 League of Legends • Leaderboard',
    '🏆 LEAGUE OF LEGENDS',
    '🏆 LEAGUE OF LEGENDS — SERVER DASHBOARD'
];

function buildDashboardEmbed(players, emojis, queueType = 'SOLO') {
    const isFlex = queueType === 'FLEX';
    const title = isFlex ? TITLES.FLEX : TITLES.SOLO;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(isFlex ? 0x9B59B6 : 0x5865F2)
        .setDescription(players.length
            ? (isFlex ? '**Ranked Flex 5v5** • Ordered by rank and LP' : '**Ranked Solo/Duo** • Ordered by rank and LP')
            : 'No linked players yet. Link your League account to join the leaderboard.')
        .setTimestamp();

    const columns = [
        { name: 'Lane', value: '', inline: true },
        { name: 'Summoners', value: '', inline: true },
        { name: 'Rank & Win rate', value: '', inline: true }
    ];
    const icons = { IRON: '⚙️', BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💠', EMERALD: '🟢', DIAMOND: '💎', MASTER: '🟣', GRANDMASTER: '🔴', CHALLENGER: '🏆' };
    const defaultLaneIcons = {
        TOP: '<:top:1547625738302136330>',
        JUNGLE: '<:jungle:1547625771668082759>',
        MID: '<:middle:1547625796993286326>',
        BOT: '<:bottom:1547625824822231110>',
        SUPPORT: '<:support:1547625847022682243>'
    };
    let shown = 0;
    for (const [index, player] of players.entries()) {
        const tier = isFlex ? (player.flex_tier || 'UNRANKED') : (player.tier || 'UNRANKED');
        const rank = isFlex ? (player.flex_rank || '') : (player.rank || '');
        const lp = isFlex ? (player.flex_league_points || 0) : (player.league_points || 0);
        const wins = isFlex ? (player.flex_wins || 0) : (player.wins || 0);
        const losses = isFlex ? (player.flex_losses || 0) : (player.losses || 0);

        const tierName = tier.toLowerCase();
        const emoji = emojis?.find(item =>
            item.available !== false && [tierName, `rank_${tierName}`].includes(item.name?.toLowerCase())
        );
        const icon = emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : icons[tier] || '';
        const rankStr = tier === 'UNRANKED' ? 'Unranked'
            : `${icon} ${tier}${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? '' : ` ${rank}`} – **${lp} LP**`;
        const games = wins + losses;
        const winRate = games ? `${((wins / games) * 100).toFixed(1)}%` : '—';

        const laneEmojiName = player.lane === 'MID' ? 'middle' : player.lane?.toLowerCase();
        const laneEmoji = emojis?.find(item =>
            item.available !== false && item.name?.toLowerCase() === laneEmojiName
        );
        const laneIcon = laneEmoji ? `<${laneEmoji.animated ? 'a' : ''}:${laneEmoji.name}:${laneEmoji.id}>` : (player.lane ? defaultLaneIcons[player.lane.toUpperCase()] || '—' : '—');

        const name = player.riot_id.replace(/[\r\n\t]/g, ' ');
        const shortName = name.length > 15 ? `${name.slice(0, 14)}…` : name;
        const row = [laneIcon, `**#${index + 1}** ${escapeMarkdown(shortName)}`, `${rankStr} • **${winRate}**`];

        // Keep all three columns in sync and within Discord's field limit.
        if (shown === 25 || columns.some((column, i) => column.value.length + row[i].length + (shown ? 1 : 0) > 1024)) break;
        columns.forEach((column, i) => { column.value += `${shown ? '\n' : ''}${row[i]}`; });
        shown++;
    }
    if (shown) embed.addFields(columns);
    embed.setFooter({ text: `${players.length} linked player${players.length === 1 ? '' : 's'}${shown < players.length ? ` • Top ${shown} shown` : ''} • Refreshes every 5 min • Updated` });
    return embed;
}

function createDashboardUpdater({ client, db, channelId, buildEmbed }) {
    let queue = Promise.resolve();
    const savedMessage = db.prepare('SELECT message_id, flex_message_id FROM dashboard_messages WHERE channel_id = ?');
    const saveMessage = db.prepare('INSERT INTO dashboard_messages (channel_id, message_id, flex_message_id) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET message_id = excluded.message_id, flex_message_id = excluded.flex_message_id');

    async function syncSingleMessage(channel, savedId, embed, legacyFilter) {
        let message;
        if (savedId) {
            try {
                message = await channel.messages.fetch(savedId);
            } catch (error) {
                if (error.code !== 10008) throw error;
            }
        }
        if (!message && legacyFilter) {
            let before;
            do {
                const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
                message = messages.find(item => item.author.id === client.user.id && legacyFilter(item));
                if (message || messages.size < 100) break;
                before = messages.last().id;
            } while (before);
        }
        const payload = { embeds: [embed], allowedMentions: { parse: [] } };
        if (message) {
            await message.edit(payload);
            return message.id;
        } else {
            const sent = await channel.send(payload);
            return sent.id;
        }
    }

    async function update() {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error('Dashboard channel not found.');

        const saved = (await savedMessage.get(channelId)) || {};

        const soloEmbed = await buildEmbed(channel.guild, 'SOLO');
        const soloId = await syncSingleMessage(
            channel,
            saved.message_id,
            soloEmbed,
            item => LEGACY_TITLES.includes(item.embeds[0]?.title) && !item.embeds[0]?.title?.includes('Flex')
        );

        const flexEmbed = await buildEmbed(channel.guild, 'FLEX');
        const flexId = await syncSingleMessage(
            channel,
            saved.flex_message_id,
            flexEmbed,
            item => item.embeds[0]?.title?.includes('Flex')
        );

        if (soloId !== saved.message_id || flexId !== saved.flex_message_id) {
            await saveMessage.run(channelId, soloId, flexId);
        }
    }

    return function updateDashboard() {
        const result = queue.then(update);
        const tail = result.catch(error => {
            console.error('Failed to update dashboard:', error.message);
        });
        queue = tail;
        return result;
    };
}

module.exports = { buildDashboardEmbed, createDashboardUpdater };
