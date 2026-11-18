const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const { LANES, buildLaneSelectMenu, findLaneRole, getAllLaneRoles, syncLaneRole } = require('./lane-roles');

function mockRole(id, name) {
    return { id, name };
}

function mockGuild() {
    const roles = new Collection();
    roles.set('1545132838700187658', mockRole('1545132838700187658', 'ʚ  :  Top'));
    roles.set('1545132838620373028', mockRole('1545132838620373028', 'ʚ  :  Jungle'));
    roles.set('1545132838620373031', mockRole('1545132838620373031', 'ʚ  :  Mid'));
    roles.set('1545132838620373030', mockRole('1545132838620373030', 'ʚ  :  Bottom'));
    roles.set('1545132838620373029', mockRole('1545132838620373029', 'ʚ  :  Support'));

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
        id: 'user-456',
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

test('buildLaneSelectMenu builds select menu with 5 lanes and custom emojis', () => {
    const menu = buildLaneSelectMenu();
    const json = menu.toJSON();
    assert.equal(json.custom_id, 'select_lane');
    assert.equal(json.options.length, 5);

    const values = json.options.map(o => o.value);
    assert.deepEqual(values, ['TOP', 'JUNGLE', 'MID', 'BOT', 'SUPPORT']);

    const emojis = json.options.map(o => o.emoji?.id);
    assert.deepEqual(emojis, [
        '1547625738302136330',
        '1547625771668082759',
        '1547625796993286326',
        '1547625824822231110',
        '1547625847022682243'
    ]);
});

test('findLaneRole finds exact lane role by ID', () => {
    const guild = mockGuild();
    const topRole = findLaneRole(guild, 'TOP');
    assert.equal(topRole?.id, '1545132838700187658');

    const jungleRole = findLaneRole(guild, 'JUNGLE');
    assert.equal(jungleRole?.id, '1545132838620373028');
});

test('getAllLaneRoles returns all 5 lane roles', () => {
    const guild = mockGuild();
    const all = getAllLaneRoles(guild);
    assert.equal(all.length, 5);
});

test('syncLaneRole assigns lane role and removes previous lane role', async () => {
    const guild = mockGuild();
    // User already has Mid role
    const member = mockMember(guild, ['1545132838620373031']);

    // User switches to Jungle
    const assigned = await syncLaneRole(member, 'JUNGLE');
    assert.equal(assigned?.id, '1545132838620373028');
    assert.deepEqual(member._getRemoved(), ['1545132838620373031']);
    assert.deepEqual(member._getAdded(), ['1545132838620373028']);
    assert.equal(member.roles.cache.has('1545132838620373028'), true);
    assert.equal(member.roles.cache.has('1545132838620373031'), false);
});
