const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sparkline, summarizeHistory, hourBucket, createRankHistory } = require('./rank-history');
const { monthKey, previousMonthKey, monthRange, buildMonthlyRecapEmbed, createMonthlyRecap } = require('./monthly-recap');
const { insertStatement, maybeBackup, backupFileName } = require('./backup');
const { featureChannelId, setChannelOverride, saveChannelOverride } = require('./channels');
const { createServerCommands } = require('./server-commands');
const { buildProfileEmbed, leagueSummary } = require('./profile-card');

// Minimal stand-in for the db adapter: records SQL and returns canned rows.
function fakeDb(handlers = {}) {
    const calls = [];
    return {
        calls,
        prepare(sql) {
            const respond = params => {
                calls.push({ sql, params });
                const handler = Object.entries(handlers).find(([pattern]) => sql.includes(pattern));
                return handler ? handler[1](params) : [];
            };
            return {
                all: async (...params) => respond(params),
                get: async (...params) => respond(params)[0],
                run: async (...params) => respond(params)
            };
        }
    };
}

test('sparkline scales values and samples long series', () => {
    assert.equal(sparkline([1]), '');
    assert.equal(sparkline([0, 100]), '▁█');
    assert.equal(sparkline([5, 5, 5]), '▄▄▄');
    assert.equal(sparkline(Array.from({ length: 100 }, (_, i) => i), 10).length, 10);
});

test('history summary gives change, high and low', () => {
    const summary = summarizeHistory([{ score: 1200 }, { score: 1350 }, { score: 1300 }]);
    assert.equal(summary.change, 100);
    assert.equal(summary.high, 1350);
    assert.equal(summary.low, 1200);
    assert.equal(summarizeHistory([{ score: 1 }]), null);
});

test('rank history writes one row per hour and computes changes', async () => {
    assert.equal(hourBucket(new Date('2026-11-18T20:47:12Z')).toISOString(), '2026-11-18T20:00:00.000Z');
    const db = fakeDb({
        'FROM rank_history': () => [
            { discord_id: 'a', score: 1000 }, { discord_id: 'a', score: 1150 },
            { discord_id: 'b', score: 900 }, { discord_id: 'b', score: 850 }
        ]
    });
    const history = createRankHistory({ db });
    await history.record('LOL', [{ discord_id: 'a', score: 1200.4 }, { discord_id: 'b', score: null }], new Date('2026-11-18T20:47:12Z'));
    const inserts = db.calls.filter(call => call.sql.startsWith('INSERT IGNORE INTO rank_history'));
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0].params.slice(0, 2), ['LOL', 'a']);
    assert.equal(inserts[0].params[3], 1200);
    const changes = await history.changes('LOL', new Date('2026-11-01'), new Date('2026-12-01'));
    assert.deepEqual(changes.map(row => [row.discord_id, row.gain]), [['a', 150], ['b', -50]]);
});

test('month keys and ranges', () => {
    assert.equal(monthKey(new Date('2026-11-18T10:00:00Z')), '2026-11');
    assert.equal(previousMonthKey('2026-01'), '2025-12');
    const { from, to } = monthRange('2026-12');
    assert.equal(from.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(to.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('monthly recap embed lists climbers, wins and activity', () => {
    const embed = buildMonthlyRecapEmbed({
        game: 'LOL', month: '2026-10',
        climbs: [{ discord_id: '1', gain: 210 }, { discord_id: '2', gain: -30 }],
        games: [{ discord_id: '1', games: 40, wins: 24 }, { discord_id: '2', games: 55, wins: 25 }],
        names: new Map([['1', 'Alpha'], ['2', 'Beta']])
    }).toJSON();
    assert.match(embed.description, /October 2026/);
    assert.match(embed.fields[0].value, /<@1> Alpha — \*\*\+210 LP\*\*/);
    assert.doesNotMatch(embed.fields[0].value, /<@2>/);
    assert.match(embed.fields[1].value, /^🥇 <@2>/);
    assert.match(embed.fields[2].value, /^🥇 <@2> Beta — \*\*55 games\*\*/);
});

test('monthly recap posts only on the 1st and only once', async () => {
    const settings = new Map();
    const db = fakeDb({
        'SELECT setting_value': ([key]) => settings.has(key) ? [{ setting_value: settings.get(key) }] : [],
        'INSERT INTO bot_settings': ([key, value]) => { settings.set(key, value); return []; }
    });
    const sent = [];
    const channel = { isTextBased: () => true, send: async payload => sent.push(payload) };
    const client = { channels: { fetch: async () => channel } };
    const recap = createMonthlyRecap({ client, db, rankHistory: { changes: async () => [] } });
    assert.equal(await recap.maybePost(new Date('2026-11-18T12:00:00Z')), false);
    assert.equal(await recap.maybePost(new Date('2026-12-01T12:00:00Z')), true);
    assert.equal(settings.get('monthly_recap_posted'), '2026-12');
    assert.equal(await recap.maybePost(new Date('2026-12-01T13:00:00Z')), false);
    assert.equal(sent.length, 0); // nothing tracked, so nothing posted
});

test('backup writes escaped INSERT statements and one gzipped file per day', async () => {
    const sql = insertStatement('players', [{ discord_id: '1', riot_id: "O'Neil" }]);
    assert.match(sql, /INSERT INTO `players` \(`discord_id`, `riot_id`\) VALUES/);
    assert.match(sql, /'O\\'Neil'/);
    assert.equal(insertStatement('players', []), '');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-backup-'));
    try {
        const db = fakeDb({ 'FROM `players`': () => [{ discord_id: '1', riot_id: 'P' }] });
        const env = { BACKUP_DIR: dir };
        const now = new Date('2026-11-18T10:00:00Z');
        fs.writeFileSync(path.join(dir, 'bot-backup-2026-11-01.sql.gz'), 'old');
        const file = await maybeBackup(db, { env, now });
        assert.equal(path.basename(file), backupFileName(now));
        const text = zlib.gunzipSync(fs.readFileSync(file)).toString();
        assert.match(text, /-- players: 1 row\(s\)/);
        assert.equal(await maybeBackup(db, { env, now }), null);
        assert.ok(!fs.existsSync(path.join(dir, 'bot-backup-2026-11-01.sql.gz')), 'backups older than 7 days are pruned');
        assert.equal(await maybeBackup(db, { env: { ...env, BACKUP_ENABLED: 'false' }, now: new Date('2026-11-19T10:00:00Z') }), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('/setchannel overrides win over .env and can be reset', async () => {
    const db = fakeDb();
    await saveChannelOverride(db, 'lpRace', '999');
    assert.equal(featureChannelId('lpRace', { LP_RACE_CHANNEL_ID: 'env' }), '999');
    await saveChannelOverride(db, 'lpRace', null);
    assert.equal(featureChannelId('lpRace', { LP_RACE_CHANNEL_ID: 'env' }), 'env');
    assert.ok(db.calls.some(call => call.sql.startsWith('DELETE FROM bot_settings')));
    await assert.rejects(saveChannelOverride(db, 'nope', '1'));
    setChannelOverride('lpRace', null);
});

function fakeInteraction(commandName, options = {}) {
    const replies = [];
    return {
        replies,
        commandName,
        guild: null,
        user: { id: 'admin', tag: 'admin#0' },
        options: {
            getString: name => options[name] ?? null,
            getUser: name => options[name] ?? null,
            getChannel: name => options[name] ?? null
        },
        deferReply: async () => {},
        reply: async payload => replies.push(payload),
        editReply: async payload => replies.push(payload)
    };
}

test('/leaderboard picks the requested board', async () => {
    const seen = [];
    const commands = createServerCommands({
        db: fakeDb(),
        buildLeagueEmbed: async (guild, queue) => { seen.push(queue); return { queue }; },
        buildValorantEmbed: async () => { seen.push('VAL'); return { queue: 'VAL' }; },
        refreshAll: async () => {},
        updateDashboards: async () => {}
    });
    for (const board of [null, 'flex', 'valorant']) {
        assert.equal(await commands.handleCommand(fakeInteraction('leaderboard', { board })), true);
    }
    assert.deepEqual(seen, ['SOLO', 'FLEX', 'VAL']);
    assert.equal(await commands.handleCommand(fakeInteraction('other')), false);
});

test('/unlink removes the chosen accounts and refreshes the boards', async () => {
    const db = fakeDb({ 'DELETE FROM players': () => ({ affectedRows: 1 }), 'DELETE FROM valorant_players': () => ({ affectedRows: 0 }) });
    let updated = 0;
    const commands = createServerCommands({
        db, buildLeagueEmbed: async () => ({}), buildValorantEmbed: async () => ({}),
        refreshAll: async () => {}, updateDashboards: async () => { updated++; }
    });
    const interaction = fakeInteraction('unlink', { user: { id: '42' }, game: 'all' });
    await commands.handleCommand(interaction);
    assert.match(interaction.replies.at(-1).content, /Unlinked League for <@42>/);
    assert.equal(updated, 1);
    assert.ok(db.calls.some(call => call.sql.includes("DELETE FROM rank_history WHERE game = 'LOL'")));
});

test('/refresh has a cooldown', async () => {
    let runs = 0;
    const commands = createServerCommands({
        db: fakeDb(), buildLeagueEmbed: async () => ({}), buildValorantEmbed: async () => ({}),
        refreshAll: async () => { runs++; }, updateDashboards: async () => {}
    });
    await commands.handleCommand(fakeInteraction('refresh'));
    const second = fakeInteraction('refresh');
    await commands.handleCommand(second);
    assert.equal(runs, 1);
    assert.match(second.replies[0].content, /Try again in/);
});

test('profile embed shows the 30-day trend', () => {
    const lol = leagueSummary({ tier: 'GOLD', rank: 'II', league_points: 40, wins: 6, losses: 4, riot_id: 'P', tag: 'EUW' });
    const embed = buildProfileEmbed({
        user: { displayAvatarURL: () => 'https://example.com/a.png' }, displayName: 'P', lol, val: null,
        trends: [{ label: 'League', unit: 'LP', history: summarizeHistory([{ score: 1300 }, { score: 1440 }]) }]
    }).toJSON();
    const field = embed.fields.find(item => item.name.includes('30 days'));
    assert.match(field.value, /League ▁█ \*\*\+140 LP\*\*/);
});
