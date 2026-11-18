// Daily MySQL backup written by the bot itself, so it works on hosts without
// mysqldump. Each backup is a gzipped .sql file of INSERT statements, one per
// day, kept for BACKUP_KEEP_DAYS (default 7). Restore with:
//   gunzip -c bot-backup-YYYY-MM-DD.sql.gz | mysql -u USER -p DATABASE
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { escape, escapeId } = require('mysql2');

// Same order as mysql-schema.sql; the schema itself is recreated by the bot at boot.
const TABLES = [
    'players', 'valorant_players', 'dashboard_messages', 'voice_rooms',
    'bot_settings', 'match_history', 'weekly_baseline', 'rank_history'
];

// Outside the deploy folder by default, so a redeploy never wipes the backups.
function backupDir(env = process.env) {
    return env.BACKUP_DIR || path.join(os.homedir(), 'discord-bot-backups');
}

function backupFileName(date = new Date()) {
    return `bot-backup-${date.toISOString().slice(0, 10)}.sql.gz`;
}

function insertStatement(table, rows) {
    if (!rows.length) return '';
    const columns = Object.keys(rows[0]);
    const values = rows.map(row => `(${columns.map(column => escape(row[column])).join(', ')})`);
    return `INSERT INTO ${escapeId(table)} (${columns.map(column => escapeId(column)).join(', ')}) VALUES\n${values.join(',\n')}\nON DUPLICATE KEY UPDATE ${escapeId(columns[0])} = ${escapeId(columns[0])};\n`;
}

async function dumpDatabase(db, now = new Date()) {
    const parts = [`-- Discord bot backup, ${now.toISOString()}\n-- Tables: ${TABLES.join(', ')}\n`];
    for (const table of TABLES) {
        try {
            const rows = await db.prepare(`SELECT * FROM ${escapeId(table)}`).all();
            parts.push(`\n-- ${table}: ${rows.length} row(s)\n`, insertStatement(table, rows));
        } catch (error) {
            parts.push(`\n-- ${table}: skipped (${error.message})\n`);
        }
    }
    return parts.join('');
}

function pruneOld(dir, keepDays, now = new Date()) {
    const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(dir)) {
        const match = /^bot-backup-(\d{4}-\d{2}-\d{2})\.sql\.gz$/.exec(file);
        if (match && new Date(`${match[1]}T00:00:00Z`).getTime() < cutoff) fs.unlinkSync(path.join(dir, file));
    }
}

// Writes today's backup if it does not exist yet. Safe to call on every refresh.
async function maybeBackup(db, { env = process.env, now = new Date() } = {}) {
    if (env.BACKUP_ENABLED === 'false') return null;
    const dir = backupDir(env);
    const file = path.join(dir, backupFileName(now));
    if (fs.existsSync(file)) return null;
    fs.mkdirSync(dir, { recursive: true });
    const sql = await dumpDatabase(db, now);
    // Write to a temp name first so a crash never leaves a half-written backup.
    fs.writeFileSync(`${file}.tmp`, zlib.gzipSync(sql));
    fs.renameSync(`${file}.tmp`, file);
    pruneOld(dir, Number(env.BACKUP_KEEP_DAYS || 7), now);
    console.log(`💾 Database backup written: ${file}`);
    return file;
}

module.exports = { maybeBackup, dumpDatabase, insertStatement, backupDir, backupFileName, TABLES };
