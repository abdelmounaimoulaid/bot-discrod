// Channels for the bot's announcement features. Each feature has its own env var
// and falls back to ANNOUNCEMENTS_CHANNEL_ID, then to the server's announcement channel.
const DEFAULT_ANNOUNCEMENTS_CHANNEL_ID = '1545132839522017284';

const FEATURE_CHANNELS = {
    rankUps: 'RANK_UP_CHANNEL_ID',
    matchRecaps: 'MATCH_RECAP_CHANNEL_ID',
    liveGames: 'LIVE_GAMES_CHANNEL_ID',
    lpRace: 'LP_RACE_CHANNEL_ID',
    welcome: 'WELCOME_CHANNEL_ID'
};

function featureChannelId(feature, env = process.env) {
    return env[FEATURE_CHANNELS[feature]] || env.ANNOUNCEMENTS_CHANNEL_ID || DEFAULT_ANNOUNCEMENTS_CHANNEL_ID;
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

module.exports = { FEATURE_CHANNELS, DEFAULT_ANNOUNCEMENTS_CHANNEL_ID, featureChannelId, getFeatureChannel };
