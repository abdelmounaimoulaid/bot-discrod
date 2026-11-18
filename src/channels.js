// Channels for the bot's announcement features. Each feature has its own env var
// and falls back to ANNOUNCEMENTS_CHANNEL_ID, then to the server's announcement channel.
const DEFAULT_ANNOUNCEMENTS_CHANNEL_ID = '1545132839522017284';

const FEATURE_CHANNELS = {
    rankUps: 'RANK_UP_CHANNEL_ID',
    matchRecaps: 'MATCH_RECAP_CHANNEL_ID',
    liveGames: 'LIVE_GAMES_CHANNEL_ID',
    lpRace: 'LP_RACE_CHANNEL_ID',
    monthlyRecap: 'MONTHLY_RECAP_CHANNEL_ID',
    welcome: 'WELCOME_CHANNEL_ID'
};

// Channels chosen with /setchannel. They are saved in bot_settings and win over
// the env vars, so admins can move a feature without editing .env.
const overrides = new Map();
const SETTING_PREFIX = 'channel:';

function setChannelOverride(feature, channelId) {
    if (channelId) overrides.set(feature, channelId);
    else overrides.delete(feature);
}

async function loadChannelOverrides(db) {
    const rows = await db.prepare("SELECT setting_key, setting_value FROM bot_settings WHERE setting_key LIKE 'channel:%'").all();
    for (const row of rows) {
        const feature = row.setting_key.slice(SETTING_PREFIX.length);
        if (FEATURE_CHANNELS[feature] && row.setting_value) overrides.set(feature, row.setting_value);
    }
    return overrides.size;
}

async function saveChannelOverride(db, feature, channelId) {
    if (!FEATURE_CHANNELS[feature]) throw new Error(`Unknown feature: ${feature}`);
    if (channelId) {
        await db.prepare('INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value')
            .run(SETTING_PREFIX + feature, channelId);
    } else {
        await db.prepare('DELETE FROM bot_settings WHERE setting_key = ?').run(SETTING_PREFIX + feature);
    }
    setChannelOverride(feature, channelId);
}

function featureChannelId(feature, env = process.env) {
    return overrides.get(feature) || env[FEATURE_CHANNELS[feature]] || env.ANNOUNCEMENTS_CHANNEL_ID || DEFAULT_ANNOUNCEMENTS_CHANNEL_ID;
}

async function getFeatureChannel(client, feature, env = process.env) {
    const id = featureChannelId(feature, env);
    if (!id) return null;
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased?.()) {
        console.warn(`[Channels] ${FEATURE_CHANNELS[feature]} / ANNOUNCEMENTS_CHANNEL_ID points to ${id}, which is not a text channel the bot can see.`);
        return null;
    }
    return channel;
}

module.exports = {
    FEATURE_CHANNELS, DEFAULT_ANNOUNCEMENTS_CHANNEL_ID, featureChannelId, getFeatureChannel,
    setChannelOverride, loadChannelOverrides, saveChannelOverride
};
