const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { ChannelType } = require('discord.js');
const { setupJoinToCreate, isHub } = require('./voice');

function setup() {
    const client = new EventEmitter();
    const db = new DatabaseSync(':memory:');
    const channels = new Map();
    let nextId = 1;

    const guild = {
        id: 'guild',
        channels: {
            cache: channels,
            create: async options => {
                const channel = {
                    id: `temp${nextId++}`,
                    name: options.name,
                    type: options.type,
                    parentId: options.parent,
                    members: new Map(),
                    delete: async () => { channels.delete(channel.id); }
                };
                channels.set(channel.id, channel);
                return channel;
            }
        }
    };

    const hub = {
        id: 'hub', name: '| Join To Create', type: ChannelType.GuildVoice,
        parentId: 'category', bitrate: 64000, userLimit: 0,
        parent: { permissionOverwrites: { cache: [] } }, members: new Map()
    };

    function member(id, name) {
        const m = {
            id, displayName: name, guild, user: { tag: `${name}#0001` },
            voice: {
                setChannel: async channel => {
                    for (const c of [hub, ...channels.values()]) c.members.delete(id);
                    channel.members.set(id, m);
                    m.channel = channel;
                }
            }
        };
        return m;
    }

    async function move(m, from, to) {
        from?.members.delete(m.id);
        to?.members.set(m.id, m);
        const listeners = client.listeners('voiceStateUpdate');
        for (const listener of listeners) {
            await listener(
                { channelId: from?.id ?? null, channel: from ?? null, member: m },
                { channelId: to?.id ?? null, channel: to ?? null, member: m }
            );
        }
    }

    client.channels = { fetch: async id => channels.get(id) ?? null };
    setupJoinToCreate({ client, db });
    return { client, db, channels, hub, member, move };
}

test('finds the hub by name when no channel ID is configured', () => {
    delete process.env.JOIN_TO_CREATE_CHANNEL_ID;
    assert.equal(isHub({ type: ChannelType.GuildVoice, name: '| Join To Create' }), true);
    assert.equal(isHub({ type: ChannelType.GuildVoice, name: 'VC 1' }), false);
    assert.equal(isHub({ type: ChannelType.GuildText, name: 'join to create' }), false);
});

test('joining the hub creates a channel named after the member and moves them', async () => {
    const { channels, hub, member, move } = setup();
    const caps = member('1', 'Jumia Caps');
    await move(caps, null, hub);

    assert.equal(channels.size, 1);
    const [channel] = channels.values();
    assert.equal(channel.name, '🔊 Jumia Caps');
    assert.equal(channel.parentId, 'category');
    assert.equal(caps.channel, channel);
});

test('the channel is deleted once the last member leaves', async () => {
    const { channels, db, hub, member, move } = setup();
    const caps = member('1', 'Jumia Caps');
    const friend = member('2', 'Friend');
    await move(caps, null, hub);
    const [channel] = channels.values();
    await move(friend, null, channel);

    await move(caps, channel, null);
    assert.equal(channels.size, 1, 'still has a member');

    await move(friend, channel, null);
    assert.equal(channels.size, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM temp_voice_channels').get().n, 0);
});

test('rejoining the hub reuses the member\'s existing channel', async () => {
    const { channels, hub, member, move } = setup();
    const caps = member('1', 'Jumia Caps');
    const friend = member('2', 'Friend');
    await move(caps, null, hub);
    const [channel] = channels.values();
    await move(friend, null, channel);

    await move(caps, channel, hub);
    assert.equal(channels.size, 1);
    assert.equal(caps.channel, channel);
});

test('cleans up channels that emptied while the bot was offline', async () => {
    const { client, channels, db } = setup();
    channels.set('old', { id: 'old', name: 'old', members: new Map(), delete: async () => channels.delete('old') });
    db.prepare('INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)').run('old', 'guild', '1');
    db.prepare('INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)').run('gone', 'guild', '2');

    for (const listener of client.listeners('clientReady')) await listener();

    assert.equal(channels.has('old'), false);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM temp_voice_channels').get().n, 0);
});
