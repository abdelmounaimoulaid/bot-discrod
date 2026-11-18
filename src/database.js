// Node's built-in SQLite (node:sqlite) needs no native add-on, so it runs on
// hosts whose system libraries are too old for better-sqlite3's prebuilt binary.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const fs = require("fs");
const os = require("os");

// Hostinger deploys every build into a fresh folder, so a database stored
// next to the code is lost (or reset to the copy in git) on each deploy.
// Store it in the home directory instead, or wherever DB_PATH points.
const DB_PATH = process.env.DB_PATH ||
    path.join(os.homedir(), "bot-data", "leaderboard.db");

// The copy that used to live next to the code (and is still in git).
const LEGACY_DB_PATH = path.join(__dirname, "..", "leaderboard.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// First start with the new location: carry the existing players over.
// VACUUM INTO also folds in any data still sitting in the -wal file.
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH) &&
    path.resolve(DB_PATH) !== path.resolve(LEGACY_DB_PATH)) {
    const legacy = new DatabaseSync(LEGACY_DB_PATH);
    legacy.prepare("VACUUM INTO ?").run(DB_PATH);
    legacy.close();
    console.log(`📦 Copied existing players from ${LEGACY_DB_PATH}`);
}

const db = new DatabaseSync(DB_PATH);
console.log(`🗄️ Database: ${DB_PATH}`);

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_messages (
        channel_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        discord_id TEXT UNIQUE NOT NULL,

        puuid TEXT UNIQUE NOT NULL,

        riot_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        region TEXT NOT NULL,

        summoner_level INTEGER DEFAULT 0,

        tier TEXT DEFAULT 'UNRANKED',
        rank TEXT DEFAULT '',
        league_points INTEGER DEFAULT 0,

        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,

        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

module.exports = db;
