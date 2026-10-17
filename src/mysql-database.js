const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');

// This adapter keeps the existing parameterized statement interface, asynchronously.
function mysqlSql(sql) {
    return sql.replace(/ON CONFLICT\(\w+\)\s*DO UPDATE SET/gi, 'ON DUPLICATE KEY UPDATE')
        .replace(/excluded\.(\w+)/gi, 'VALUES($1)')
        .replace(/\brank\b/gi, '`rank`');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createDatabase(env = process.env, driver = mysql, { startupAttempts = 5, retryDelayMs = 5000 } = {}) {
    let pool;
    const ready = (async () => {
        for (const name of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']) {
            if (!env[name]) throw new Error(`Missing ${name}. Configure MySQL environment variables before starting the bot.`);
        }
        pool = driver.createPool({
            host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER,
            password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE,
            charset: 'utf8mb4', connectionLimit: 5, waitForConnections: true,
            connectTimeout: 10000,
            // Shared hosts drop idle connections; keep-alive and short idle reuse
            // avoid "connection lost" errors on the first query after a quiet spell.
            enableKeepAlive: true, keepAliveInitialDelay: 10000, maxIdle: 2, idleTimeout: 60000,
            ...(env.MYSQL_SSL === 'true' ? { ssl: env.MYSQL_SSL_CA ? { ca: fs.readFileSync(env.MYSQL_SSL_CA) } : {} } : {})
        });
        const schema = fs.readFileSync(path.join(__dirname, 'mysql-schema.sql'), 'utf8');
        // A brief MySQL outage at boot should not take the bot offline for good.
        for (let attempt = 1; ; attempt++) {
            try {
                await pool.query('SELECT 1');
                break;
            } catch (error) {
                if (attempt >= startupAttempts) throw error;
                console.error(`MySQL not reachable (attempt ${attempt}/${startupAttempts}): ${error.message}. Retrying...`);
                await sleep(retryDelayMs * attempt);
            }
        }
        for (const statement of schema.split(';').filter(value => value.trim())) await pool.query(statement);
        for (const col of [
            "ALTER TABLE players ADD COLUMN lane VARCHAR(20) DEFAULT NULL",
            "ALTER TABLE players ADD COLUMN flex_tier VARCHAR(20) NOT NULL DEFAULT 'UNRANKED'",
            "ALTER TABLE players ADD COLUMN flex_rank VARCHAR(8) NOT NULL DEFAULT ''",
            "ALTER TABLE players ADD COLUMN flex_league_points INT NOT NULL DEFAULT 0",
            "ALTER TABLE players ADD COLUMN flex_wins INT NOT NULL DEFAULT 0",
            "ALTER TABLE players ADD COLUMN flex_losses INT NOT NULL DEFAULT 0",
            "ALTER TABLE dashboard_messages ADD COLUMN flex_message_id VARCHAR(20) DEFAULT NULL",
            "ALTER TABLE players ADD COLUMN last_match_id VARCHAR(64) DEFAULT NULL",
            "ALTER TABLE valorant_players ADD COLUMN last_match_id VARCHAR(64) DEFAULT NULL",
        ]) {
            try { await pool.query(col); } catch (e) { /* ignore errno 1060 — column already exists */ }
        }
        console.log('MySQL connected; persistent database ready.');
    })();
    async function execute(sql, params) {
        await ready;
        const [rows] = await pool.execute(mysqlSql(sql), params);
        return rows;
    }
    return {
        ready,
        prepare(sql) {
            return {
                all: (...params) => execute(sql, params),
                get: async (...params) => (await execute(sql, params))[0],
                run: async (...params) => {
                    // MySQL upserts match ANY unique key. Prevent a Riot-account
                    // collision from updating a different Discord user's row.
                    if (/INSERT INTO (players|valorant_players)/i.test(sql) && /ON CONFLICT/i.test(sql)) {
                        const targetTable = /valorant_players/i.test(sql) ? 'valorant_players' : 'players';
                        await ready;
                        const connection = await pool.getConnection();
                        try {
                            await connection.beginTransaction();
                            const [owners] = await connection.execute(`SELECT discord_id FROM ${targetTable} WHERE puuid = ? FOR UPDATE`, [params[1]]);
                            if (owners.length && owners[0].discord_id !== params[0]) throw new Error('This Riot account is already linked to another Discord user.');
                            const [result] = await connection.execute(mysqlSql(sql), params);
                            await connection.commit();
                            return result;
                        } catch (error) {
                            await connection.rollback();
                            throw error;
                        } finally { connection.release(); }
                    }
                    return execute(sql, params);
                }
            };
        },
        // Only one bot process may manage roles: two copies (e.g. an old deploy that
        // never stopped) undo each other's role changes and both answer interactions.
        // MySQL named locks belong to one connection, so it is held for the process
        // lifetime and pinged; if it is lost and another process takes over, onLost runs.
        async acquireInstanceLock({ name = `discord-bot:${env.MYSQL_DATABASE}`, retryMs = 15000, pingMs = 60000, onLost = () => {} } = {}) {
            await ready;
            let connection;
            const tryLock = async timeoutSeconds => {
                connection = await pool.getConnection();
                const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS got', [name, timeoutSeconds]);
                if (rows[0]?.got === 1) return true;
                connection.release();
                connection = null;
                return false;
            };
            while (!(await tryLock(0))) {
                console.warn(`Another bot instance holds the "${name}" lock. Waiting ${retryMs / 1000}s before retrying...`);
                await sleep(retryMs);
            }
            console.log('Single-instance lock acquired.');
            const timer = setInterval(async () => {
                try {
                    const [rows] = await connection.query('SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS mine', [name]);
                    if (rows[0]?.mine === 1) return;
                    throw new Error('lock no longer held');
                } catch (error) {
                    try { connection?.destroy(); } catch {}
                    connection = null;
                    try {
                        if (await tryLock(5)) { console.warn('Single-instance lock re-acquired after:', error.message); return; }
                    } catch {}
                    clearInterval(timer);
                    onLost(error);
                }
            }, pingMs);
            timer.unref?.();
        },
        close: async () => { if (pool) await pool.end(); }
    };
}

module.exports = { createDatabase, mysqlSql };
