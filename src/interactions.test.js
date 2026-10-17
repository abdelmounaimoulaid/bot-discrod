const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const discord = require('discord.js');

function loadBot() {
    let client;
    const errors = [];
    class TestClient extends EventEmitter { constructor() { super(); client = this; } }
    const db = { ready: new Promise(() => {}), prepare: () => ({ all: async () => [], get: async () => undefined, run: async () => {} }) };
    const context = {
        require: name => {
            if (name === 'dotenv') return { config() {} };
            if (name === './health-server') return { startHealthServer() {} };
            if (name === './database') return db;
            if (name === 'discord.js') return { ...discord, Client: TestClient };
            return require(name.startsWith('.') ? path.resolve(__dirname, name) : name);
        },
        console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
        process: { env: {} }, setTimeout, setInterval, clearInterval
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8'), context);
    return { client, errors };
}
for (const customId of ['link_league_account', 'link_valorant_account']) {
    test(`${customId}: failed modal and failed error reply do not stop subsequent clicks`, async () => {
        const { client, errors } = loadBot();
        const base = { customId, isButton: () => true, isModalSubmit: () => false, isStringSelectMenu: () => false };
        client.emit('interactionCreate', { ...base,
            showModal: async () => { throw Object.assign(new Error('Unknown interaction'), { code: 10062 }); },
            reply: async () => { throw new Error('Interaction expired'); }
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(errors.length, 1);
        let modal;
        client.emit('interactionCreate', { ...base, showModal: async value => { modal = value.toJSON(); } });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(modal.components.length, 3);
        assert.equal(modal.custom_id, customId.replace('_account', '_modal'));
    });
}
test('Discord client errors are handled without terminating the process', () => {
    const { client } = loadBot();
    assert.doesNotThrow(() => client.emit('error', Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' })));
});
