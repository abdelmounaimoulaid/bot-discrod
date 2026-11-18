const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRegion } = require('./services/valorant');
const {
    VALORANT_AGENT_ROLES,
    buildValorantRoleSelectMenu,
    findValorantRankRole,
    syncValorantRankRole,
    syncValorantAgentRole
} = require('./valorant-roles');
const {
    buildValorantLinkPanel,
    buildValorantDashboardEmbed
} = require('./valorant-dashboard');

test('normalizeRegion maps regions correctly', () => {
    assert.equal(normalizeRegion('euw'), 'eu');
    assert.equal(normalizeRegion('EU'), 'eu');
    assert.equal(normalizeRegion('na'), 'na');
    assert.equal(normalizeRegion('kr'), 'kr');
    assert.equal(normalizeRegion('oce'), 'ap');
    assert.equal(normalizeRegion('unknown'), 'eu');
});

test('buildValorantRoleSelectMenu contains 4 agent roles', () => {
    const menu = buildValorantRoleSelectMenu().toJSON();
    assert.equal(menu.custom_id, 'select_valorant_role');
    assert.equal(menu.options.length, 4);
    assert.deepEqual(menu.options.map(o => o.value), ['DUELIST', 'INITIATOR', 'CONTROLLER', 'SENTINEL']);
});

test('buildValorantLinkPanel builds panel with link button and role menu', () => {
    const panel = buildValorantLinkPanel();
    assert.equal(panel.embeds.length, 1);
    assert.match(panel.embeds[0].data.title, /Link your VALORANT Account/i);
    assert.equal(panel.components.length, 2);
    assert.equal(panel.components[0].components[0].data.custom_id, 'link_valorant_account');
    assert.equal(panel.components[1].components[0].data.custom_id, 'select_valorant_role');
});

test('buildValorantDashboardEmbed formats players into 3 columns', () => {
    const players = [
        {
            discord_id: '123',
            riot_id: 'Jumia Caps',
            tag: '9929',
            tier_name: 'Gold 3',
            ranking_in_tier: 10,
            elo: 1110,
            wins: 21,
            number_of_games: 39,
            agent_role: 'DUELIST'
        }
    ];

    const embed = buildValorantDashboardEmbed(players).toJSON();
    assert.equal(embed.color, 0xFD4556);
    assert.equal(embed.fields.length, 3);
    assert.equal(embed.fields[0].name, 'Role');
    assert.equal(embed.fields[1].name, 'Players');
    assert.equal(embed.fields[2].name, 'Rank & Win rate');

    assert.equal(embed.fields[0].value, '⚔️');
    assert.match(embed.fields[1].value, /🥇 Jumia Caps/);
    assert.match(embed.fields[2].value, /Gold 3 – \*\*10 RR\*\*/);
    assert.match(embed.fields[2].value, /53\.8%/);
});

test('findValorantRankRole matches rank role from guild cache', () => {
    const roles = [
        { id: '1', name: 'Valorant : Gold' },
        { id: '2', name: 'Valorant : Diamond' }
    ];
    const guild = { roles: { cache: { find: fn => roles.find(fn) } } };
    assert.equal(findValorantRankRole(guild, 'Gold 3')?.id, '1');
    assert.equal(findValorantRankRole(guild, 'Diamond 2')?.id, '2');
    assert.equal(findValorantRankRole(guild, 'Iron 1'), undefined);
});

test('syncValorantRankRole removes previous rank and assigns new rank', async () => {
    const assigned = [];
    const removed = [];
    const oldRole = { id: 'old-role', name: 'Valorant : Silver' };
    const newRole = { id: 'new-role', name: 'Valorant : Gold' };
    const gameRole = { id: 'game-role', name: 'ʚ : Vaorant' };

    const guildRoles = [oldRole, newRole, gameRole];
    const memberRoles = new Set([oldRole.id]);

    const member = {
        id: 'user-1',
        guild: {
            roles: {
                cache: {
                    get: id => guildRoles.find(r => r.id === id),
                    find: fn => guildRoles.find(fn),
                    filter: fn => guildRoles.filter(fn)
                }
            }
        },
        roles: {
            cache: {
                has: id => memberRoles.has(id)
            },
            add: async r => { assigned.push(r.name); memberRoles.add(r.id); },
            remove: async r => { removed.push(r.name); memberRoles.delete(r.id); }
        }
    };

    await syncValorantRankRole(member, 'Gold 2');

    assert.ok(removed.includes('Valorant : Silver'));
    assert.ok(assigned.includes('Valorant : Gold'));
});

test('fetchValorantPlayerData throws instead of reporting Unrated when the MMR API fails', async () => {
    const axios = require('axios');
    const originalGet = axios.get;
    const originalKey = process.env.VALORANT_API_KEY;
    process.env.VALORANT_API_KEY = 'test-only';
    axios.get = async url => {
        if (url.includes('/v2/mmr/')) throw Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
        return { data: { data: { puuid: 'p1', name: 'Player', tag: 'EUW', account_level: 10 } } };
    };
    try {
        const { fetchValorantPlayerData } = require('./services/valorant');
        await assert.rejects(fetchValorantPlayerData('Player', 'EUW', 'eu'), /API 429/);
    } finally {
        axios.get = originalGet;
        process.env.VALORANT_API_KEY = originalKey;
    }
});

test('fetchValorantPlayerData still reports Unrated when the player has no MMR (404)', async () => {
    const axios = require('axios');
    const originalGet = axios.get;
    const originalKey = process.env.VALORANT_API_KEY;
    process.env.VALORANT_API_KEY = 'test-only';
    axios.get = async url => {
        if (url.includes('/v2/mmr/')) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
        return { data: { data: { puuid: 'p1', name: 'Player', tag: 'EUW', account_level: 10 } } };
    };
    try {
        const { fetchValorantPlayerData } = require('./services/valorant');
        assert.equal((await fetchValorantPlayerData('Player', 'EUW', 'eu')).tier_name, 'Unrated');
    } finally {
        axios.get = originalGet;
        process.env.VALORANT_API_KEY = originalKey;
    }
});
