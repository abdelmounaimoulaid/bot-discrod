const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, mysqlSql } = require('./mysql-database');
const env = { MYSQL_HOST: 'example', MYSQL_USER: 'bot', MYSQL_PASSWORD: 'test-only', MYSQL_DATABASE: 'bot' };

test('converts both SQLite upserts and quotes MySQL reserved rank column', () => {
    assert.equal(mysqlSql('INSERT INTO players (rank) VALUES (?) ON CONFLICT(discord_id) DO UPDATE SET rank = excluded.rank'),
        'INSERT INTO players (`rank`) VALUES (?) ON DUPLICATE KEY UPDATE `rank` = VALUES(`rank`)');
});

test('missing credentials fail without creating a replacement database', async () => {
    let opened = false;
    const db = createDatabase({}, { createPool: () => { opened = true; } });
    await assert.rejects(db.ready, /MYSQL_HOST/);
    assert.equal(opened, false);
});

test('queries wait for schema initialization and keep values parameterized', async () => {
    const events = [];
    const driver = { createPool: () => ({
        query: async sql => { events.push('schema'); },
        execute: async (sql, params) => { events.push('query'); assert.equal(params[0], "name' OR 1=1"); return [[{ discord_id: '123' }]]; },
        end: async () => {}
    }) };
    const db = createDatabase(env, driver);
    assert.equal((await db.prepare('SELECT discord_id FROM players WHERE riot_id = ?').get("name' OR 1=1")).discord_id, '123');
    assert.equal(events.at(-1), 'query');
    assert.ok(events.slice(0, -1).length > 1 && events.slice(0, -1).every(event => event === 'schema'));
    await db.close();
});

test('Riot account collision rolls back instead of reassigning a different user', async () => {
    const events = [];
    const connection = {
        beginTransaction: async () => events.push('begin'),
        execute: async () => [[{ discord_id: 'other-user' }]],
        rollback: async () => events.push('rollback'),
        commit: async () => events.push('commit'),
        release: () => events.push('release')
    };
    const db = createDatabase(env, { createPool: () => ({ query: async () => {}, getConnection: async () => connection, end: async () => {} }) });
    await assert.rejects(db.prepare('INSERT INTO players (discord_id, puuid) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET puuid = excluded.puuid').run('new-user', 'same-riot-account'), /already linked/);
    assert.deepEqual(events, ['begin', 'rollback', 'release']);
    await db.close();
});

test('instance lock waits while another bot instance holds it', async () => {
    const answers = [0, 1];
    const connection = { query: async () => [[{ got: answers.shift() }]], release: () => {}, destroy: () => {} };
    const db = createDatabase(env, { createPool: () => ({ query: async () => {}, getConnection: async () => connection, end: async () => {} }) });
    await db.acquireInstanceLock({ retryMs: 1, pingMs: 60000 });
    assert.equal(answers.length, 0);
    await db.close();
});

test('startup retries when MySQL is briefly unreachable', async () => {
    let failures = 2;
    const db = createDatabase(env, { createPool: () => ({
        query: async sql => { if (sql === 'SELECT 1' && failures-- > 0) throw new Error('ECONNREFUSED'); },
        end: async () => {}
    }) }, { retryDelayMs: 1 });
    await db.ready;
    assert.equal(failures, -1);
    await db.close();
});
