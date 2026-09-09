const Database = require("better-sqlite3");

const db = new Database("leaderboard.db");

db.pragma("journal_mode = WAL");

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
