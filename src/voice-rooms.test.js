const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { registerVoiceRooms, parseLimit, TRIGGERS } = require('./voice-rooms');

function fixture() {
    const handlers = {};
    const rooms = new Map();
    const client = { user: { id: 'bot' }, on: (name, fn) => { handlers[name] = fn; }, once: (name, fn) => { handlers[name] = fn; }, guilds: { cache: new Collection() } };
    const asyncDb = {
        prepare(sql) {
            return {
                get: async (id) => rooms.get(id),
                all: async (guildId, ownerId) => {
                    const list = Array.from(rooms.values());
                    if (guildId !== undefined && ownerId !== undefined) {
                        return list.filter(r => r.guild_id === guildId && r.owner_id === ownerId);
                    }
                    return list;
                },
                run: async (...args) => {
                    if (/INSERT INTO voice_rooms/i.test(sql)) {
                        rooms.set(args[0], { channel_id: args[0], guild_id: args[1], owner_id: args[2] });
                    } else if (/DELETE FROM voice_rooms/i.test(sql)) {
                        rooms.delete(args[0]);
                    }
                }
            };
        },
        close: async () => {}
    };
    registerVoiceRooms(client, asyncDb);
    const syncDb = {
        prepare(sql) {
            return {
                run: (...args) => {
                    if (/INSERT INTO voice_rooms/i.test(sql)) {
                        rooms.set(args[0], { channel_id: args[0], guild_id: args[1], owner_id: args[2] });
                    } else if (/DELETE FROM voice_rooms/i.test(sql)) {
                        rooms.delete(args[0]);
                    }
                },
                get: (id) => rooms.get(id),
                all: () => Array.from(rooms.values())
            };
        },
        close: () => {}
    };
    return { handlers, db: syncDb, client };
}

test('limits accept only whole numbers 0–99', () => {
    for (const n of ['0', '2', '99']) assert.equal(parseLimit(n), Number(n));
    for (const n of ['', '-1', '100', '1.5', 'abc']) assert.equal(parseLimit(n), null);
});

test('non-owners cannot change room controls', async () => {
    const { handlers, db } = fixture();
    db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run('room', 'guild', 'owner');
    let reply;
    await handlers.interactionCreate({ customId: 'voice:lock', channelId: 'room', user: { id: 'visitor' }, reply: async p => { reply = p; } });
    assert.match(reply.content, /Only the owner/);
    db.close();
});

test('owner locking clears role Connect grants and preserves invitations', async () => {
    const { handlers, db } = fixture();
    db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run('room', 'guild', 'owner');
    let saved;
    const channel = { permissionOverwrites: { cache: new Collection([
        ['role', { id: 'role', type: 0, allow: { bitfield: P.Connect }, deny: { bitfield: 0n } }],
        ['friend', { id: 'friend', type: 1, allow: { bitfield: P.Connect }, deny: { bitfield: 0n } }]
    ]), set: async items => { saved = items; } } };
    await handlers.interactionCreate({ customId: 'voice:lock', channelId: 'room', user: { id: 'owner' },
        guild: { id: 'guild', channels: { fetch: async () => channel } }, isButton: () => true, isModalSubmit: () => false,
        deferReply: async () => {}, editReply: async () => {} });
    assert.equal(saved.find(o => o.id === 'role').allow & P.Connect, 0n);
    assert.equal(saved.find(o => o.id === 'guild').deny & P.Connect, P.Connect);
    assert.equal(saved.find(o => o.id === 'friend').allow & P.Connect, P.Connect);
    db.close();
});

for (const occupied of [false, true]) test(`joining another trigger creates a new room below it; previous room occupied=${occupied}`, async () => {
    const { handlers, db, client } = fixture();
    db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run('previous', 'guild', 'owner');
    let previousDeleted = false;
    const previous = { members: new Collection(occupied ? [['guest', {}]] : []), delete: async () => { previousDeleted = true; } };
    const trigger = [...TRIGGERS][0];
    let options, posted, moved, applied;
    const steps = [];
    let newRoomDeleted = false;
    const room = { id: 'created', members: new Collection(),
        delete: async () => { newRoomDeleted = true; },
        setPosition: async position => { assert.equal(position, 5); steps.push('position'); },
        permissionOverwrites: { set: async entries => { applied = entries; steps.push('permissions'); } },
        send: async payload => { posted = payload; steps.push('panel'); } };
    client.channels = { fetch: async id => id === 'previous' ? previous : room };
    const guild = { id: 'guild', channels: { create: async opts => {
        assert.equal(opts.permissionOverwrites, undefined, 'creation must inherit category permissions');
        options = opts; steps.push('create'); return room;
    } } };
    handlers.voiceStateUpdate({ channelId: null }, { channelId: trigger, id: 'owner', guild,
        channel: { id: trigger, parentId: 'category', position: 4, permissionOverwrites: { cache: new Collection() } },
        member: { displayName: 'Alex', user: { bot: false }, voice: { channelId: trigger, setChannel: async target => { moved = target.id; steps.push('move'); } } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(options.name, "Alex's room");
    assert.equal(options.parent, 'category');
    assert.equal(moved, 'created');
    assert.equal(previousDeleted, !occupied);
    assert.deepEqual(steps, ['create', 'permissions', 'panel', 'move', 'position']);
    assert.equal(newRoomDeleted, false, 'a delayed voice-state event must not delete the newly joined room');
    assert.equal(new PermissionsBitField(applied.find(item => item.id === 'bot').allow).has(P.ManageRoles), false);
    assert.equal(posted.components[0].components.length, 5);
    assert.equal(db.prepare('SELECT owner_id FROM voice_rooms WHERE channel_id = ?').get('created').owner_id, 'owner');
    db.close();
});

test('leaving deletes an empty tracked room', async () => {
    const { handlers, db, client } = fixture();
    db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run('room', 'guild', 'owner');
    let deleted = false;
    client.channels = { fetch: async () => ({ members: new Collection(), delete: async () => { deleted = true; } }) };
    handlers.voiceStateUpdate({ channelId: 'room' }, { channelId: null, guild: { id: 'guild' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deleted, true);
    assert.equal(db.prepare('SELECT * FROM voice_rooms').all().length, 0);
    db.close();
});
