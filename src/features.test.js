const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    leagueScore, isLeaguePromotion, scoreToLabel, isValorantPromotion, progressBar, weekKey, previousWeekKey
} = require('./ladder');
const { balanceTeams } = require('./inhouse');
const { longestWinStreaks } = require('./lp-race');
const { fetchMemberState, isManagedGuild } = require('./member-cleanup');
const { createRateLimiter } = require('./services/rate-limiter');
const { buildLeagueRecapEmbed, buildRankUpEmbed } = require('./game-events');
const { countAgents } = require('./mastery');
const { featureChannelId } = require('./channels');
const { leagueSummary, valorantSummary, buildProfileEmbed } = require('./profile-card');
const { COMMANDS } = require('./commands');

test('league score is continuous across divisions and tiers', () => {
    assert.equal(leagueScore('IRON', 'IV', 0), 0);
    assert.equal(leagueScore('GOLD', 'IV', 0), 1200);
    assert.equal(leagueScore('GOLD', 'I', 99), 1599);
    assert.equal(leagueScore('PLATINUM', 'IV', 0), 1600);
    assert.equal(leagueScore('MASTER', 'I', 150), 2950);
    assert.equal(leagueScore('UNRANKED', '', 0), null);
    assert.equal(scoreToLabel(1250), 'Gold IV • 50 LP');
});

test('promotions are detected only when the division goes up', () => {
    assert.equal(isLeaguePromotion('GOLD', 'I', 'PLATINUM', 'IV'), true);
    assert.equal(isLeaguePromotion('GOLD', 'II', 'GOLD', 'I'), true);
    assert.equal(isLeaguePromotion('GOLD', 'I', 'GOLD', 'I'), false);
    assert.equal(isLeaguePromotion('PLATINUM', 'IV', 'GOLD', 'I'), false);
    // First placement from unranked is not a "rank up".
    assert.equal(isLeaguePromotion('UNRANKED', '', 'GOLD', 'IV'), false);
    assert.equal(isLeaguePromotion('MASTER', 'I', 'GRANDMASTER', 'I'), true);
    assert.equal(isValorantPromotion(12, 13), true);
    assert.equal(isValorantPromotion(0, 13), false);
});

test('progress bar and week keys', () => {
    assert.equal(progressBar(0), '▱▱▱▱▱');
    assert.equal(progressBar(100), '▰▰▰▰▰');
    assert.equal(progressBar(250), '▰▰▰▰▰');
    // 2026-10-17 is a Saturday; its week starts Monday 2026-10-12.
    assert.equal(weekKey(new Date('2026-10-17T15:00:00Z')), '2026-10-12');
    assert.equal(weekKey(new Date('2026-10-12T00:00:00Z')), '2026-10-12');
    assert.equal(previousWeekKey('2026-10-12'), '2026-10-05');
});

test('inhouse balancing finds the fairest split and spreads lanes', () => {
    const scores = [2800, 2000, 1600, 1500, 1400, 1300, 1200, 1100, 800, 500]; // total 14200 → a 7100/7100 split exists
    const entries = scores.map((score, i) => ({ id: String(i), score, lane: null }));
    const best = balanceTeams(entries, 5);
    const sum = team => team.reduce((total, entry) => total + entry.score, 0);
    assert.equal(best.teamA.length, 5);
    assert.equal(best.teamB.length, 5);
    assert.equal(Math.abs(sum(best.teamA) - sum(best.teamB)), 0);

    const laned = [
        { id: 'a', score: 1000, lane: 'MID' }, { id: 'b', score: 1000, lane: 'MID' },
        { id: 'c', score: 1000, lane: 'TOP' }, { id: 'd', score: 1000, lane: 'TOP' }
    ];
    const split = balanceTeams(laned, 2);
    assert.deepEqual(split.teamA.map(entry => entry.lane).sort(), ['MID', 'TOP']);
});

test('win streaks count consecutive wins per player', () => {
    const history = [
        { discord_id: 'a', win: 1 }, { discord_id: 'a', win: 1 }, { discord_id: 'a', win: 0 },
        { discord_id: 'a', win: 1 }, { discord_id: 'b', win: 1 }, { discord_id: 'b', win: 1 }, { discord_id: 'b', win: 1 }
    ];
    const streaks = longestWinStreaks(history);
    assert.equal(streaks.get('a'), 2);
    assert.equal(streaks.get('b'), 3);
});

test('only Unknown Member counts as having left the server', async () => {
    const guild = error => ({ members: { fetch: async () => { throw error; } } });
    assert.deepEqual(await fetchMemberState(guild(Object.assign(new Error('Unknown Member'), { code: 10007 })), '1'), { gone: true });
    assert.deepEqual(await fetchMemberState(guild(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), '1'), { member: null });
    const client = { guilds: { cache: { size: 2 } } };
    assert.equal(isManagedGuild(client, { id: 'x' }, {}), false);
    assert.equal(isManagedGuild(client, { id: 'x' }, { DISCORD_GUILD_ID: 'x' }), true);
});

test('rate limiter runs urgent work before queued background work', async () => {
    const schedule = createRateLimiter(() => 5);
    const order = [];
    const jobs = [
        schedule(async () => order.push('bg1')),
        schedule(async () => order.push('bg2')),
        schedule(async () => order.push('bg3')),
        schedule(async () => order.push('urgent'), { priority: true })
    ];
    await Promise.all(jobs);
    assert.equal(order[0], 'bg1');
    assert.equal(order[1], 'urgent');
});

test('recap and rank-up embeds show the key numbers without pinging', () => {
    const match = { info: { queueId: 420, gameDuration: 1800, gameEndTimestamp: Date.now() } };
    const participant = { win: true, kills: 10, deaths: 2, assists: 8, totalMinionsKilled: 200, neutralMinionsKilled: 10, teamPosition: 'BOTTOM', totalDamageDealtToChampions: 25000, visionScore: 20 };
    const recap = buildLeagueRecapEmbed({ discordId: '1', riotId: 'P#EUW', match, participant, champion: { name: 'Jinx', icon: null }, lpChange: 21 }).toJSON();
    assert.match(recap.title, /Victory • Ranked Solo\/Duo/);
    const fields = Object.fromEntries(recap.fields.map(field => [field.name, field.value]));
    assert.equal(fields.KDA, '**10/2/8** (9.00)');
    assert.equal(fields.CS, '210 (7.0/min)');
    assert.equal(fields.LP, '**+21 LP**');
    const pending = buildLeagueRecapEmbed({ discordId: '1', riotId: 'P#EUW', match, participant, champion: { name: 'Jinx', icon: null }, lpChange: null }).toJSON();
    assert.match(pending.fields.find(field => field.name === 'LP').value, /Updating/);

    const rankUp = buildRankUpEmbed({ discordId: '1', riotId: 'P#EUW', game: 'LOL', from: 'Gold I', to: 'Platinum IV', iconUrl: null }).toJSON();
    assert.match(rankUp.description, /<@1> just reached \*\*Platinum IV\*\*/);
});

test('agent counts come from the player in each match', () => {
    const match = agent => ({ players: { all_players: [{ puuid: 'me', character: agent }, { puuid: 'other', character: 'Sage' }] } });
    assert.deepEqual(countAgents([match('Jett'), match('Jett'), match('Omen')], 'me', 'n', 't'), [['Jett', 2], ['Omen', 1]]);
});

test('feature channels fall back to ANNOUNCEMENTS_CHANNEL_ID, then the server default', () => {
    assert.equal(featureChannelId('rankUps', {}), '1545132839522017284');
    assert.equal(featureChannelId('rankUps', { ANNOUNCEMENTS_CHANNEL_ID: 'a' }), 'a');
    assert.equal(featureChannelId('rankUps', { ANNOUNCEMENTS_CHANNEL_ID: 'a', RANK_UP_CHANNEL_ID: 'r' }), 'r');
});

test('profile summaries and fallback embed', () => {
    const lol = leagueSummary({ tier: 'GOLD', rank: 'II', league_points: 40, wins: 6, losses: 4, lane: 'MID', riot_id: 'P', tag: 'EUW' });
    assert.equal(lol.rank, 'Gold II');
    assert.equal(lol.progress, 0.4);
    assert.match(lol.record, /60\.0% WR/);
    const val = valorantSummary({ current_tier: 0, tier_name: 'Unrated', ranking_in_tier: 0, wins: 0, number_of_games: 0, riot_id: 'P', tag: '1' });
    assert.equal(val.rank, 'Unrated');
    const embed = buildProfileEmbed({ user: { displayAvatarURL: () => null }, displayName: 'Player', lol, val }).toJSON();
    assert.equal(embed.fields.length, 2);
});

test('profile card renders a PNG when canvas is available', async t => {
    let canvas;
    try { canvas = require('@napi-rs/canvas'); } catch { return t.skip('canvas not installed'); }
    const profile = require('./profile-card');
    if (!profile.canDraw()) return t.skip('no fonts');
    // Icons set to null so the test needs no network.
    const lol = { ...leagueSummary({ tier: 'GOLD', rank: 'II', league_points: 40, wins: 6, losses: 4, lane: 'MID', riot_id: 'P', tag: 'EUW' }), icon: null };
    const png = await profile.renderCard({ user: { displayAvatarURL: () => null }, displayName: 'Player', lol, val: null });
    assert.ok(png.length > 1000);
    assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from('PNG')]);
    assert.ok(canvas);
});

test('slash command definitions are valid for registration', () => {
    assert.deepEqual(COMMANDS.map(command => command.name), ['profile', 'mastery', 'inhouse', 'lfg', 'status', 'welcome-preview']);
    for (const command of COMMANDS) assert.ok(command.description.length <= 100);
});
