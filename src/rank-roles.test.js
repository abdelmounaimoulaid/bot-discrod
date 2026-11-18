const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { RANK_ROLE_IDS, findRankRole, getAllRankRoles, syncRankRole } = require('./rank-roles');

function mockRole(id, name) {
    return { id, name };
}

function mockGuild() {
    const roles = new Collection();
    // Add roles matching the user's server
    roles.set('1547019143914463353', mockRole('1547019143914463353', 'ʚ  : Challenger'));
    roles.set('1547019148159094794', mockRole('1547019148159094794', 'ʚ  : Diamond'));
    roles.set('1547019148930973776', mockRole('1547019148930973776', 'ʚ  : Emerald'));
    roles.set('1547019150097121281', mockRole('1547019150097121281', 'ʚ  : Gold'));
    roles.set('1547019153250979850', mockRole('1547019153250979850', 'ʚ  : Unranked'));

    return {
        roles: {
            cache: roles,
            fetch: async () => roles
        }
    };
}

function mockMember(guild, currentRoleIds = []) {
    const memberRoles = new Collection();
    for (const id of currentRoleIds) {
        const r = guild.roles.cache.get(id);
        if (r) memberRoles.set(id, r);
    }
    const added = [];
    const removed = [];

    return {
        id: 'test-user-123',
        guild,
        roles: {
            cache: memberRoles,
            add: async (id) => {
                added.push(id);
                const r = guild.roles.cache.get(id);
                if (r) memberRoles.set(id, r);
            },
            remove: async (ids) => {
                const list = Array.isArray(ids) ? ids : [ids];
                for (const id of list) {
                    removed.push(id);
                    memberRoles.delete(id);
                }
            }
        },
        _getAdded: () => added,
        _getRemoved: () => removed
    };
}

test('findRankRole finds exact role by ID and tier name', () => {
    const guild = mockGuild();
    const emeraldRole = findRankRole(guild, 'EMERALD');
    assert.equal(emeraldRole?.id, '1547019148930973776');
    assert.equal(emeraldRole?.name, 'ʚ  : Emerald');

    const unrankedRole = findRankRole(guild, 'UNRANKED');
    assert.equal(unrankedRole?.id, '1547019153250979850');
});

test('findRankRole finds role dynamically when ID is not present', () => {
    const customGuild = {
        roles: {
            cache: new Collection([
                ['custom-1', mockRole('custom-1', 'ʚ : Iron')],
                ['custom-2', mockRole('custom-2', 'ʚ : Platinum')]
            ])
        }
    };
    const ironRole = findRankRole(customGuild, 'IRON');
    assert.equal(ironRole?.id, 'custom-1');
    assert.equal(ironRole?.name, 'ʚ : Iron');

    const platRole = findRankRole(customGuild, 'PLATINUM');
    assert.equal(platRole?.id, 'custom-2');
});

test('getAllRankRoles returns all matching rank roles in guild', () => {
    const guild = mockGuild();
    const all = getAllRankRoles(guild);
    assert.equal(all.length, 5);
});

test('syncRankRole assigns new role and removes old rank role on promotion', async () => {
    const guild = mockGuild();
    // User currently has Emerald role
    const member = mockMember(guild, ['1547019148930973776']);

    // Promoted to Diamond!
    const assigned = await syncRankRole(member, 'DIAMOND');
    assert.equal(assigned?.id, '1547019148159094794');
    assert.deepEqual(member._getRemoved(), ['1547019148930973776']);
    assert.deepEqual(member._getAdded(), ['1547019148159094794']);
    assert.equal(member.roles.cache.has('1547019148159094794'), true);
    assert.equal(member.roles.cache.has('1547019148930973776'), false);
});

test('syncRankRole does not re-add role if member already has it', async () => {
    const guild = mockGuild();
    const member = mockMember(guild, ['1547019148930973776']);

    const assigned = await syncRankRole(member, 'EMERALD');
    assert.equal(assigned?.id, '1547019148930973776');
    assert.equal(member._getAdded().length, 0);
    assert.equal(member._getRemoved().length, 0);
});

test('syncRankRole assigns Unranked role if user has no ranked tier', async () => {
    const guild = mockGuild();
    const member = mockMember(guild, []);

    const assigned = await syncRankRole(member, 'UNRANKED');
    assert.equal(assigned?.id, '1547019153250979850');
    assert.deepEqual(member._getAdded(), ['1547019153250979850']);
});

test('League and Valorant refreshes preserve each other and unchanged roles', async () => {
    const { syncValorantRankRole } = require('./valorant-roles');
    const guild = mockGuild();
    guild.roles.cache.set('val-gold', mockRole('val-gold', 'Valorant Gold'));
    guild.roles.cache.set('val-diamond', mockRole('val-diamond', 'Valorant Diamond'));
    const member = mockMember(guild, [RANK_ROLE_IDS.DIAMOND, 'val-gold']);
    for (let i = 0; i < 3; i++) {
        await syncValorantRankRole(member, 'Gold 2');
        await syncRankRole(member, 'DIAMOND');
    }
    assert.deepEqual(member._getAdded(), []);
    assert.deepEqual(member._getRemoved(), []);
    assert.ok(member.roles.cache.has(RANK_ROLE_IDS.DIAMOND));
    assert.ok(member.roles.cache.has('val-gold'));
});

test('Valorant cannot select an unlabelled League rank role', async () => {
    const { findValorantRankRole, syncValorantRankRole } = require('./valorant-roles');
    const guild = mockGuild();
    const member = mockMember(guild, [RANK_ROLE_IDS.DIAMOND]);
    assert.equal(findValorantRankRole(guild, 'Gold 1'), undefined);
    await syncValorantRankRole(member, 'Gold 1');
    assert.deepEqual(member._getRemoved(), []);
    assert.deepEqual(member._getAdded(), []);
});

test('League fallback does not match Master to Grandmaster or Valorant roles', () => {
    const guild = { roles: { cache: new Collection([
        ['grand', mockRole('grand', 'ʚ : Grandmaster')],
        ['val', mockRole('val', 'Valorant Diamond')]
    ]) } };
    assert.equal(findRankRole(guild, 'MASTER'), null);
    assert.equal(findRankRole(guild, 'DIAMOND'), null);
});

test('LOL and VAL suffixes override old IDs without cross-game removals', async () => {
    const { findValorantRankRole, syncValorantRankRole } = require('./valorant-roles');
    const guild = mockGuild();
    guild.roles.cache.get(RANK_ROLE_IDS.GOLD).name = 'ʚ : Gold VAL';
    guild.roles.cache.set('gold-lol', mockRole('gold-lol', 'ʚ : Gold LOL'));
    assert.equal(findRankRole(guild, 'GOLD').id, 'gold-lol');
    assert.equal(findValorantRankRole(guild, 'Gold 2').id, RANK_ROLE_IDS.GOLD);
    assert.ok(!getAllRankRoles(guild).some(role => role.id === RANK_ROLE_IDS.GOLD));
    const member = mockMember(guild, ['gold-lol', RANK_ROLE_IDS.GOLD]);
    await syncRankRole(member, 'GOLD');
    await syncValorantRankRole(member, 'Gold 2');
    assert.deepEqual(member._getRemoved(), []);
    assert.deepEqual(member._getAdded(), []);
});
