// Rank snapshots over time: one row per player, game and hour. Feeds the 30-day
// progress chart in /profile and the monthly recap.
// Scores use the same scale as the LP race: leagueScore() for League (1 point
// per LP across tiers) and Henrik's elo for VALORANT.

const KEEP_DAYS = 120;
const SPARK = '▁▂▃▄▅▆▇█';

// Start of the hour, so refreshes every 5 minutes write at most one row an hour.
function hourBucket(date = new Date()) {
    const bucket = new Date(date);
    bucket.setUTCMinutes(0, 0, 0);
    return bucket;
}

// Text chart that works everywhere (embeds, plain messages, phones).
function sparkline(values, width = 14) {
    const points = values.filter(value => Number.isFinite(value));
    if (points.length < 2) return '';
    // Squash long series to `width` points by taking evenly spaced samples.
    const sampled = points.length <= width
        ? points
        : Array.from({ length: width }, (_, i) => points[Math.round((i * (points.length - 1)) / (width - 1))]);
    const min = Math.min(...sampled), max = Math.max(...sampled);
    if (max === min) return SPARK[3].repeat(sampled.length);
    return sampled.map(value => SPARK[Math.round(((value - min) / (max - min)) * (SPARK.length - 1))]).join('');
}

function summarizeHistory(rows) {
    const values = rows.map(row => Number(row.score));
    if (values.length < 2) return null;
    return {
        values,
        first: values[0],
        last: values[values.length - 1],
        change: values[values.length - 1] - values[0],
        high: Math.max(...values),
        low: Math.min(...values),
        spark: sparkline(values)
    };
}

function createRankHistory({ db }) {
    const insert = db.prepare('INSERT IGNORE INTO rank_history (game, discord_id, recorded_at, score) VALUES (?, ?, ?, ?)');
    let lastPrune = 0;

    // `players` is [{ discord_id, score }], the same list the LP race records.
    async function record(game, players, now = new Date()) {
        const bucket = hourBucket(now);
        for (const { discord_id: discordId, score } of players) {
            if (score === null || score === undefined || !Number.isFinite(Number(score))) continue;
            await insert.run(game, discordId, bucket, Math.round(score));
        }
        if (now.getTime() - lastPrune > 24 * 60 * 60 * 1000) {
            lastPrune = now.getTime();
            await db.prepare('DELETE FROM rank_history WHERE recorded_at < ?')
                .run(new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000));
        }
    }

    async function history(game, discordId, days = 30, now = new Date()) {
        return db.prepare(`
            SELECT score, recorded_at FROM rank_history
            WHERE game = ? AND discord_id = ? AND recorded_at >= ?
            ORDER BY recorded_at
        `).all(game, discordId, new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
    }

    // First and last score of every player between `from` and `to`.
    async function changes(game, from, to) {
        const rows = await db.prepare(`
            SELECT discord_id, score, recorded_at FROM rank_history
            WHERE game = ? AND recorded_at >= ? AND recorded_at < ?
            ORDER BY discord_id, recorded_at
        `).all(game, from, to);
        const byPlayer = new Map();
        for (const row of rows) {
            const entry = byPlayer.get(row.discord_id) || { discord_id: row.discord_id, first: Number(row.score) };
            entry.last = Number(row.score);
            byPlayer.set(row.discord_id, entry);
        }
        return [...byPlayer.values()].map(entry => ({ ...entry, gain: entry.last - entry.first }));
    }

    return { record, history, changes };
}

module.exports = { createRankHistory, sparkline, summarizeHistory, hourBucket };
