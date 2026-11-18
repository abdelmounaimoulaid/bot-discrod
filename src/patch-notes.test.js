const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildPatchNotesEmbed,
    buildPatchNotesButton,
    checkAndPostPatchNotes
} = require('./patch-notes');

test('buildPatchNotesEmbed builds embed with patch info', () => {
    const patch = {
        version: '14.20',
        url: 'https://example.com/patch-14-20',
        title: 'League Patch 14.20 Notes',
        description: 'New champion balance and skins',
        imageUrl: 'https://example.com/banner.jpg'
    };
    const embed = buildPatchNotesEmbed(patch).toJSON();
    assert.equal(embed.title, '📢 League Patch 14.20 Notes');
    assert.equal(embed.url, 'https://example.com/patch-14-20');
    assert.equal(embed.description, 'New champion balance and skins');
    assert.equal(embed.image.url, 'https://example.com/banner.jpg');
    assert.equal(embed.color, 0xC89B3C);
    assert.equal(embed.fields[0].name, '🔖 Version');
    assert.equal(embed.fields[0].value, '`Patch 14.20`');
});

test('buildPatchNotesButton creates button with patch URL', () => {
    const patch = { url: 'https://example.com/patch-14-20' };
    const row = buildPatchNotesButton(patch).toJSON();
    assert.equal(row.components.length, 1);
    assert.equal(row.components[0].url, 'https://example.com/patch-14-20');
    assert.equal(row.components[0].label, 'Read Full Patch Notes');
});

test('checkAndPostPatchNotes posts when new and saves to database', async () => {
    let savedKey = null;
    let savedVal = null;
    let sentPayload = null;

    const db = {
        prepare: (sql) => {
            if (sql.startsWith('SELECT')) {
                return { get: async () => null }; // No previous patch
            }
            return {
                run: async (key, val) => {
                    savedKey = key;
                    savedVal = val;
                }
            };
        }
    };

    const channel = {
        send: async (payload) => {
            sentPayload = payload;
            return { id: 'msg-1' };
        }
    };

    const client = {
        channels: {
            fetch: async (id) => {
                if (id === 'channel-123') return channel;
                return null;
            }
        }
    };

    const mockFetch = async () => ({
        version: '14.20',
        url: 'https://example.com/patch-14-20',
        title: 'Patch 14.20',
        description: 'Test summary',
        imageUrl: 'https://example.com/image.png'
    });

    await checkAndPostPatchNotes({
        client,
        db,
        channelId: 'channel-123',
        fetchFn: mockFetch
    });

    assert.ok(sentPayload !== null);
    assert.equal(savedKey, 'last_patch_url');
    assert.equal(savedVal, 'https://example.com/patch-14-20');
});

test('checkAndPostPatchNotes skips when already posted', async () => {
    let sent = false;

    const db = {
        prepare: (sql) => {
            if (sql.startsWith('SELECT')) {
                return { get: async () => ({ setting_value: 'https://example.com/patch-14-20' }) };
            }
            return { run: async () => {} };
        }
    };

    const channel = {
        send: async () => {
            sent = true;
        }
    };

    const client = {
        channels: {
            fetch: async () => channel
        }
    };

    const mockFetch = async () => ({
        version: '14.20',
        url: 'https://example.com/patch-14-20',
        title: 'Patch 14.20'
    });

    await checkAndPostPatchNotes({
        client,
        db,
        channelId: 'channel-123',
        fetchFn: mockFetch
    });

    assert.equal(sent, false);
});
