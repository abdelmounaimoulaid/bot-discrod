const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { weekKey, previousWeekKey } = require('./ladder');
const { getFeatureChannel } = require('./channels');

const CLIMBER_ROLE_NAME = '🧗 Climber of the Week';
const POST_HOUR_UTC = Number(process.env.LP_RACE_POST_HOUR_UTC ?? 10);
const GAMES = {
    LOL: { label: 'League of Legends', unit: 'LP', table: 'players' },
    VAL: { label: 'VALORANT', unit: 'RR', table: 'valorant_players' }
};

function longestWinStreaks(history) {
    const best = new Map();
    const current = new Map();
    for (const row of history) {
        const streak = row.win ? (current.get(row.discord_id) || 0) + 1 : 0;
        current.set(row.discord_id, streak);
        best.set(row.discord_id, Math.max(best.get(row.discord_id) || 0, streak));
    }
    return best;
}

function buildRaceEmbed({ game, results, streak, names, week }) {
    const { label, unit } = GAMES[game];
    const medals = ['🥇', '🥈', '🥉'];
    const line = (row, i) => `${medals[i] || `**${i + 1}.**`} <@${row.discord_id}> ${escapeMarkdown(names.get(row.discord_id) || '')} — **${row.gain > 0 ? '+' : ''}${row.gain} ${unit}**`;
    const climbers = results.filter(row => row.gain > 0).slice(0, 3);
    const loser = results.length > 1 && results[results.length - 1].gain < 0 ? results[results.length - 1] : null;
    const embed = new EmbedBuilder()
        .setColor(game === 'LOL' ? 0x5865F2 : 0xFD4556)
        .setTitle(`📈 Weekly ${unit} Race • ${label}`)
        .setDescription(`Results for the week of **${week}**`)
        .addFields({ name: '🧗 Biggest climbers', value: climbers.length ? climbers.map(line).join('\n') : 'Nobody climbed this week.' });
    if (loser) embed.addFields({ name: '📉 Biggest drop', value: `<@${loser.discord_id}> — **${loser.gain} ${unit}**` });
    if (streak) embed.addFields({ name: '🔥 Longest win streak', value: `<@${streak.discord_id}> — **${streak.length} wins in a row**` });
    return embed.setFooter({ text: 'Climber of the Week gets the role until next Monday' }).setTimestamp();
}

function createLpRace({ client, db }) {
    const saveBaseline = db.prepare('INSERT IGNORE INTO weekly_baseline (game, discord_id, week_key, score) VALUES (?, ?, ?, ?)');
    const getSetting = db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?');
    const setSetting = db.prepare('INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value');

    // Called after every refresh: the first score seen in a week is that week's
    // starting point, so a week's gain is next week's baseline minus this one.
    async function recordBaselines(game, players, now = new Date()) {
        const key = weekKey(now);
        for (const { discord_id: discordId, score } of players) {
            if (score === null || score === undefined) continue;
            await saveBaseline.run(game, discordId, key, Math.round(score));
        }
    }

    async function results(game, week, nextWeek) {
        return (await db.prepare(`
            SELECT c.discord_id, c.score - p.score AS gain
            FROM weekly_baseline c
            JOIN weekly_baseline p ON p.game = c.game AND p.discord_id = c.discord_id AND p.week_key = ?
            JOIN ${GAMES[game].table} t ON t.discord_id = c.discord_id
            WHERE c.game = ? AND c.week_key = ?
            ORDER BY gain DESC
        `).all(week, game, nextWeek)).map(row => ({ ...row, gain: Number(row.gain) }));
    }

    async function topStreak(game, week, nextWeek) {
        const history = await db.prepare(`
            SELECT discord_id, win FROM match_history
            WHERE game = ? AND played_at >= ? AND played_at < ?
            ORDER BY discord_id, played_at
        `).all(game, new Date(`${week}T00:00:00Z`), new Date(`${nextWeek}T00:00:00Z`));
        let best = null;
        for (const [discordId, length] of longestWinStreaks(history)) {
            if (length >= 2 && (!best || length > best.length)) best = { discord_id: discordId, length };
        }
        return best;
    }

    async function awardClimberRole(guild, winnerId) {
        if (!guild) return;
        let role = (process.env.CLIMBER_ROLE_ID && guild.roles.cache.get(process.env.CLIMBER_ROLE_ID)) ||
            guild.roles.cache.find(item => /climber of the week/i.test(item.name));
        if (!role) {
            role = await guild.roles.create({ name: CLIMBER_ROLE_NAME, color: 0xF1C40F, hoist: true, reason: 'Weekly LP race winner role' });
        }
        const previous = (await getSetting.get('climber_holder'))?.setting_value;
        if (previous && previous !== winnerId) {
            const member = await guild.members.fetch(previous).catch(() => null);
            await member?.roles.remove(role).catch(error => console.warn('[LP race] Could not remove climber role:', error.message));
        }
        const winner = await guild.members.fetch(winnerId).catch(() => null);
        await winner?.roles.add(role);
        await setSetting.run('climber_holder', winnerId);
    }

    // Posts last week's results once, on Monday after POST_HOUR_UTC.
    async function maybePost(now = new Date()) {
        if (now.getUTCDay() !== 1 || now.getUTCHours() < POST_HOUR_UTC) return false;
        const thisWeek = weekKey(now);
        if ((await getSetting.get('lp_race_posted'))?.setting_value === thisWeek) return false;
        const lastWeek = previousWeekKey(thisWeek);

        const channel = await getFeatureChannel(client, 'lpRace');
        let overall = null;
        if (channel) {
            for (const game of Object.keys(GAMES)) {
                const rows = await results(game, lastWeek, thisWeek);
                if (!rows.length) continue;
                const names = new Map((await db.prepare(`SELECT discord_id, riot_id FROM ${GAMES[game].table}`).all()).map(row => [row.discord_id, row.riot_id]));
                const streak = await topStreak(game, lastWeek, thisWeek);
                await channel.send({ embeds: [buildRaceEmbed({ game, results: rows, streak, names, week: lastWeek })], allowedMentions: { parse: [] } });
                if (rows[0].gain > 0 && (!overall || rows[0].gain > overall.gain)) overall = rows[0];
            }
            if (overall) {
                try {
                    await awardClimberRole(channel.guild, overall.discord_id);
                    await channel.send({ content: `🧗 <@${overall.discord_id}> is this week's **Climber of the Week**!`, allowedMentions: { users: [overall.discord_id] } });
                } catch (error) {
                    console.error('[LP race] Could not award Climber of the Week role:', error.message);
                }
            }
        }
        await setSetting.run('lp_race_posted', thisWeek);
        return true;
    }

    return { recordBaselines, maybePost };
}

module.exports = { createLpRace, longestWinStreaks, buildRaceEmbed };
