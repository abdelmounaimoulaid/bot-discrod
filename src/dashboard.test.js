const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { buildDashboardEmbed, createDashboardUpdater } = require('./dashboard');

function setup({ legacy = false, failure } = {}) {
    let saved;
    let sends = 0;
    let edits = 0;
    const message = { id: 'message', author: { id: 'bot' }, embeds: [{ title: '🏆 LEAGUE OF LEGENDS' }], edit: async () => { edits++; } };
    const db = { prepare: sql => sql.startsWith('SELECT')
        ? { get: () => saved && { message_id: saved } }
        : { run: (channel, id) => { saved = id; } } };
    const channel = {
        messages: { fetch: async arg => {
            if (typeof arg === 'string') {
                if (failure) throw Object.assign(new Error('Fetch failed'), { code: failure });
                return message;
            }
            return new Collection(legacy ? [[message.id, message]] : []);
        } },
        send: async () => { sends++; return message; }
    };
    const options = { client: { user: { id: 'bot' }, channels: { fetch: async () => channel } }, db, channelId: 'channel', buildEmbed: () => buildDashboardEmbed([]) };
    return { options, counts: () => ({ sends, edits }) };
}

test('concurrent refreshes create once and continue editing after restart', async () => {
    const fixture = setup();
    const update = createDashboardUpdater(fixture.options);
    await Promise.all([update(), update(), update()]);
    await createDashboardUpdater(fixture.options)();
    assert.deepEqual(fixture.counts(), { sends: 1, edits: 3 });
});

test('recovers the existing dashboard title without posting', async () => {
    const fixture = setup({ legacy: true });
    await createDashboardUpdater(fixture.options)();
    assert.deepEqual(fixture.counts(), { sends: 0, edits: 1 });
});

test('permission errors do not produce replacement messages', async () => {
    const fixture = setup({ failure: 50013 });
    const update = createDashboardUpdater(fixture.options);
    await update();
    await assert.rejects(update(), { code: 50013 });
    assert.equal(fixture.counts().sends, 1);
});

test('confirmed deletion permits a replacement', async () => {
    const fixture = setup({ failure: 10008 });
    const update = createDashboardUpdater(fixture.options);
    await update();
    await update();
    assert.equal(fixture.counts().sends, 2);
});

test('table keeps summoners, ranks and win rates in matching columns', () => {
    const player = { discord_id: '123', riot_id: 'Player', tag: 'EUW', tier: 'DIAMOND', rank: 'IV', league_points: 98, wins: 192, losses: 168 };
    const embed = buildDashboardEmbed([player]).toJSON();
    assert.deepEqual(embed.fields.map(field => field.name), ['Summoners', 'Ranks', 'Win rate']);
    assert.ok(embed.fields.every(field => field.inline));
    assert.match(embed.fields[0].value, /\*\*#1\*\* Player/);
    assert.match(embed.fields[1].value, /DIAMOND IV – \*\*98 LP\*\*/);
    assert.match(embed.fields[2].value, /53.3%/);
    assert.equal(buildDashboardEmbed([{ ...player, wins: 0, losses: 0 }]).toJSON().fields[2].value, '**—**');
    const large = buildDashboardEmbed(Array.from({ length: 100 }, () => player));
    assert.ok(large.length <= 6000);
    assert.equal(large.toJSON().fields.length, 3);
    assert.ok(large.toJSON().fields.every(field => field.value.split('\n').length === 25 && field.value.length <= 1024));
    assert.match(large.toJSON().footer.text, /Top 25 shown/);
    buildDashboardEmbed([]).toJSON();
});
