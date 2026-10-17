const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { buildDashboardEmbed, createDashboardUpdater } = require('./dashboard');

function setup({ legacy = false, failure } = {}) {
    let savedSolo, savedFlex;
    let sends = 0;
    let edits = 0;
    const soloMessage = { id: 'solo-msg', author: { id: 'bot' }, embeds: [{ title: '🏆 LEAGUE OF LEGENDS' }], edit: async () => { edits++; } };
    const flexMessage = { id: 'flex-msg', author: { id: 'bot' }, embeds: [{ title: '🛡️ League of Legends • Flex Leaderboard' }], edit: async () => { edits++; } };
    const db = {
        prepare: sql => sql.startsWith('SELECT')
            ? { get: async () => (savedSolo || savedFlex) ? { message_id: savedSolo, flex_message_id: savedFlex } : undefined }
            : { run: async (channel, soloId, flexId) => { savedSolo = soloId; savedFlex = flexId; } }
    };
    const channel = {
        messages: {
            fetch: async arg => {
                if (typeof arg === 'string') {
                    if (failure) throw Object.assign(new Error('Fetch failed'), { code: failure });
                    if (arg === 'solo-msg') return soloMessage;
                    if (arg === 'flex-msg') return flexMessage;
                    return soloMessage;
                }
                return new Collection(legacy ? [[soloMessage.id, soloMessage]] : []);
            }
        },
        send: async () => { sends++; return { id: `sent-${sends}`, author: { id: 'bot' }, embeds: [{ title: '' }], edit: async () => { edits++; } }; }
    };
    const options = {
        client: { user: { id: 'bot' }, channels: { fetch: async () => channel } },
        db,
        channelId: 'channel',
        buildEmbed: () => buildDashboardEmbed([])
    };
    return { options, counts: () => ({ sends, edits }) };
}

test('concurrent refreshes create once and continue editing after restart', async () => {
    const fixture = setup();
    const update = createDashboardUpdater(fixture.options);
    await Promise.all([update(), update(), update()]);
    await createDashboardUpdater(fixture.options)();
    // 2 sends (solo+flex) on first call, then edits for remaining 3 calls (3*2=6)
    assert.equal(fixture.counts().sends, 2);
    assert.equal(fixture.counts().edits, 6);
});

test('recovers the existing dashboard title without posting', async () => {
    const fixture = setup({ legacy: true });
    await createDashboardUpdater(fixture.options)();
    // legacy scan only picks up solo by title; flex sends 1 new message
    assert.equal(fixture.counts().edits, 1);
});

test('permission errors do not produce replacement messages', async () => {
    const fixture = setup({ failure: 50013 });
    const update = createDashboardUpdater(fixture.options);
    await update();
    await assert.rejects(update(), { code: 50013 });
    assert.equal(fixture.counts().sends, 2);
});

test('confirmed deletion permits a replacement', async () => {
    const fixture = setup({ failure: 10008 });
    const update = createDashboardUpdater(fixture.options);
    await update();
    await update();
    assert.equal(fixture.counts().sends, 4);
});

test('table keeps lane, summoners, and rank & win rate in matching columns', () => {
    const player = { discord_id: '123', riot_id: 'Player', tag: 'EUW', tier: 'DIAMOND', rank: 'IV', league_points: 98, wins: 192, losses: 168, lane: 'MID' };
    const embed = buildDashboardEmbed([player]).toJSON();
    assert.deepEqual(embed.fields.map(field => field.name), ['Lane', 'Summoners', 'Rank & Win rate']);
    assert.ok(embed.fields.every(field => field.inline));
    assert.match(embed.fields[1].value, /\*\*#1\*\* Player/);
    assert.match(embed.fields[2].value, /DIAMOND IV – \*\*98 LP\*\*/);
    assert.match(embed.fields[2].value, /53\.3%/);
    assert.equal(buildDashboardEmbed([{ ...player, wins: 0, losses: 0 }]).toJSON().fields[2].value.includes('—'), true);
    const large = buildDashboardEmbed(Array.from({ length: 100 }, () => player));
    assert.ok(large.length <= 6000);
    assert.equal(large.toJSON().fields.length, 3);
    assert.ok(large.toJSON().fields.every(field => field.value.split('\n').length === 25 && field.value.length <= 1024));
    assert.match(large.toJSON().footer.text, /Top 25 shown/);
    buildDashboardEmbed([]).toJSON();
});

test('flex embed uses flex columns and purple colour', () => {
    const player = { discord_id: '123', riot_id: 'Player', tag: 'EUW', tier: 'IRON', rank: 'I', league_points: 0, wins: 1, losses: 1, flex_tier: 'GOLD', flex_rank: 'II', flex_league_points: 50, flex_wins: 10, flex_losses: 5, lane: 'TOP' };
    const embed = buildDashboardEmbed([player], null, 'FLEX').toJSON();
    assert.equal(embed.color, 0x9B59B6);
    assert.match(embed.fields[2].value, /GOLD II/);
    assert.match(embed.fields[2].value, /50 LP/);
});
