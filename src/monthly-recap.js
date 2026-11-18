// Monthly recap: on the 1st of each month, posts last month's biggest climber,
// most wins and most games for League and VALORANT. Uses rank_history for the
// climb and match_history for wins and games.
const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { getFeatureChannel } = require('./channels');

const POST_HOUR_UTC = Number(process.env.MONTHLY_RECAP_POST_HOUR_UTC ?? process.env.LP_RACE_POST_HOUR_UTC ?? 10);
const GAMES = {
    LOL: { label: 'League of Legends', unit: 'LP', table: 'players', color: 0x5865F2 },
    VAL: { label: 'VALORANT', unit: 'RR', table: 'valorant_players', color: 0xFD4556 }
};

// "2026-11" for any date in November 2026 (UTC).
function monthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function monthRange(key) {
    const [year, month] = key.split('-').map(Number);
    return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

function previousMonthKey(key) {
    const { from } = monthRange(key);
    from.setUTCMonth(from.getUTCMonth() - 1);
    return monthKey(from);
}

function monthLabel(key) {
    const { from } = monthRange(key);
    return from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// `climbs` is [{ discord_id, gain }]; `games` is [{ discord_id, games, wins }].
function buildMonthlyRecapEmbed({ game, month, climbs, games, names }) {
    const { label, unit, color } = GAMES[game];
    const medals = ['🥇', '🥈', '🥉'];
    const who = id => `<@${id}>${names.get(id) ? ` ${escapeMarkdown(names.get(id))}` : ''}`;
    const climbers = climbs.filter(row => row.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
    const byWins = [...games].sort((a, b) => b.wins - a.wins || b.games - a.games).slice(0, 3).filter(row => row.wins > 0);
    const byGames = [...games].sort((a, b) => b.games - a.games).slice(0, 3).filter(row => row.games > 0);
    const totalGames = games.reduce((sum, row) => sum + row.games, 0);
    const totalWins = games.reduce((sum, row) => sum + row.wins, 0);

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`🗓️ Monthly recap • ${label}`)
        .setDescription(`Highlights for **${monthLabel(month)}**${totalGames ? ` • ${totalGames} ranked games tracked, ${Math.round((totalWins / totalGames) * 100)}% won` : ''}`)
        .addFields(
            { name: `🧗 Biggest climbers`, value: climbers.length ? climbers.map((row, i) => `${medals[i]} ${who(row.discord_id)} — **+${row.gain} ${unit}**`).join('\n') : 'Nobody climbed this month.' },
            { name: '🏆 Most wins', value: byWins.length ? byWins.map((row, i) => `${medals[i]} ${who(row.discord_id)} — **${row.wins}W** / ${row.games}G`).join('\n') : 'No games tracked.', inline: true },
            { name: '🎮 Most active', value: byGames.length ? byGames.map((row, i) => `${medals[i]} ${who(row.discord_id)} — **${row.games} games**`).join('\n') : 'No games tracked.', inline: true }
        )
        .setTimestamp();
    return embed;
}

function createMonthlyRecap({ client, db, rankHistory }) {
    const getSetting = db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?');
    const setSetting = db.prepare('INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value');

    async function gamesPlayed(game, from, to) {
        const rows = await db.prepare(`
            SELECT h.discord_id, COUNT(*) AS games, SUM(h.win) AS wins
            FROM match_history h
            JOIN ${GAMES[game].table} t ON t.discord_id = h.discord_id
            WHERE h.game = ? AND h.played_at >= ? AND h.played_at < ?
            GROUP BY h.discord_id
        `).all(game, from, to);
        return rows.map(row => ({ discord_id: row.discord_id, games: Number(row.games), wins: Number(row.wins || 0) }));
    }

    async function buildEmbeds(month) {
        const { from, to } = monthRange(month);
        const embeds = [];
        for (const game of Object.keys(GAMES)) {
            const linked = await db.prepare(`SELECT discord_id, riot_id FROM ${GAMES[game].table}`).all();
            const names = new Map(linked.map(row => [row.discord_id, row.riot_id]));
            const climbs = (await rankHistory.changes(game, from, to)).filter(row => names.has(row.discord_id));
            const games = await gamesPlayed(game, from, to);
            if (!climbs.length && !games.length) continue;
            embeds.push(buildMonthlyRecapEmbed({ game, month, climbs, games, names }));
        }
        return embeds;
    }

    // Posts last month's recap once, on the 1st after POST_HOUR_UTC.
    async function maybePost(now = new Date()) {
        if (now.getUTCDate() !== 1 || now.getUTCHours() < POST_HOUR_UTC) return false;
        const thisMonth = monthKey(now);
        if ((await getSetting.get('monthly_recap_posted'))?.setting_value === thisMonth) return false;
        const lastMonth = previousMonthKey(thisMonth);
        const channel = await getFeatureChannel(client, 'monthlyRecap');
        if (channel) {
            const embeds = await buildEmbeds(lastMonth);
            if (embeds.length) await channel.send({ embeds, allowedMentions: { parse: [] } });
        }
        await setSetting.run('monthly_recap_posted', thisMonth);
        return true;
    }

    return { maybePost, buildEmbeds };
}

module.exports = { createMonthlyRecap, buildMonthlyRecapEmbed, monthKey, previousMonthKey, monthRange };
