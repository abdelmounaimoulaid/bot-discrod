const { EmbedBuilder, escapeMarkdown } = require('discord.js');

const TITLE = '🏆 League of Legends • Leaderboard';
const LEGACY_TITLES = [TITLE, '🏆 LEAGUE OF LEGENDS', '🏆 LEAGUE OF LEGENDS — SERVER DASHBOARD'];

function buildDashboardEmbed(players, emojis) {
    const embed = new EmbedBuilder()
        .setTitle(TITLE)
        .setColor(0x5865F2)
        .setDescription(players.length
            ? '**Ranked Solo/Duo** • Ordered by rank and LP'
            : 'No linked players yet. Link your League account to join the leaderboard.')
        .setTimestamp();

    const columns = [
        { name: 'Summoners', value: '', inline: true },
        { name: 'Ranks', value: '', inline: true },
        { name: 'Win rate', value: '', inline: true }
    ];
    const icons = { IRON: '⚙️', BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💠', EMERALD: '🟢', DIAMOND: '💎', MASTER: '🟣', GRANDMASTER: '🔴', CHALLENGER: '🏆' };
    let shown = 0;
    for (const [index, player] of players.entries()) {
        const tierName = player.tier.toLowerCase();
        const emoji = emojis?.find(item =>
            item.available !== false && [tierName, `rank_${tierName}`].includes(item.name?.toLowerCase())
        );
        const icon = emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : icons[player.tier] || '';
        const rank = player.tier === 'UNRANKED' ? 'Unranked'
            : `${icon} ${player.tier}${['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(player.tier) ? '' : ` ${player.rank}`} – **${player.league_points} LP**`;
        const games = player.wins + player.losses;
        const winRate = games ? `${((player.wins / games) * 100).toFixed(1)}%` : '—';
        const name = player.riot_id.replace(/[\r\n\t]/g, ' ');
        const shortName = name.length > 16 ? `${name.slice(0, 15)}…` : name;
        const row = [`**#${index + 1}** ${escapeMarkdown(shortName)}`, rank, `**${winRate}**`];
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
    const savedMessage = db.prepare('SELECT message_id FROM dashboard_messages WHERE channel_id = ?');
    const saveMessage = db.prepare('INSERT INTO dashboard_messages (channel_id, message_id) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET message_id = excluded.message_id');

    async function update() {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error('Dashboard channel not found.');
        let message;
        const saved = savedMessage.get(channelId);
        if (saved) {
            try {
                message = await channel.messages.fetch(saved.message_id);
            } catch (error) {
                // Only a confirmed deleted message permits recovery. Permission/network
                // failures must not cause a new message to be posted.
                if (error.code !== 10008) throw error;
            }
        }
        if (!message) {
            let before;
            do {
                const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
                message = messages.find(item => item.author.id === client.user.id && LEGACY_TITLES.includes(item.embeds[0]?.title));
                if (message || messages.size < 100) break;
                before = messages.last().id;
            } while (before);
        }
        const payload = { embeds: [await buildEmbed(channel.guild)], allowedMentions: { parse: [] } };
        if (message) {
            // Save recovered legacy IDs before editing, so retries use the same message.
            saveMessage.run(channelId, message.id);
            await message.edit(payload);
        } else {
            message = await channel.send(payload);
            saveMessage.run(channelId, message.id);
        }
    }

    return function updateDashboard() {
        const result = queue.then(update);
        queue = result.catch(() => {});
        return result;
    };
}

module.exports = { buildDashboardEmbed, createDashboardUpdater };
