const { ChannelType } = require('discord.js');

const EMPTY_GRACE = 10 * 60 * 1000;

// Creates a voice channel tracked in voice_rooms, so the existing voice-room
// code deletes it once the last person leaves. A channel nobody ever joins
// would never trigger that, so it is also deleted after a grace period.
async function createTempVoice({ guild, db, name, parentId, ownerId, userLimit = 0, reason }) {
    const channel = await guild.channels.create({
        name: name.slice(0, 100), type: ChannelType.GuildVoice, parent: parentId || null, userLimit, reason
    });
    await db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run(channel.id, guild.id, ownerId);
    const timer = setTimeout(async () => {
        try {
            const fresh = await guild.channels.fetch(channel.id).catch(() => null);
            if (fresh && fresh.members.size === 0) {
                await fresh.delete('Temporary voice channel was never used');
                await db.prepare('DELETE FROM voice_rooms WHERE channel_id = ?').run(channel.id);
            }
        } catch (error) {
            console.error('[Temp voice] Cleanup failed:', error.message);
        }
    }, EMPTY_GRACE);
    timer.unref?.();
    return channel;
}

// Moves a member into `channel` if they are currently in any voice channel.
async function moveIfInVoice(guild, userId, channel) {
    const state = guild.voiceStates.cache.get(userId);
    if (!state?.channelId) return false;
    try {
        await state.setChannel(channel);
        return true;
    } catch {
        return false;
    }
}

module.exports = { createTempVoice, moveIfInVoice };
