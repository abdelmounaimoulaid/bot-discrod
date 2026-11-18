// Node's built-in SQLite (node:sqlite) needs no native add-on, so it runs on
// hosts whose system libraries are too old for better-sqlite3's prebuilt binary.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

// Keep the file next to the project, whatever directory the host starts from.
const db = new DatabaseSync(path.join(__dirname, "..", "leaderboard.db"));

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
