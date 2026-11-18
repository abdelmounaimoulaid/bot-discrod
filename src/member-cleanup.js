// Removes linked accounts of people who left the server, so they drop off the
// leaderboards and stop costing API calls.
const UNKNOWN_MEMBER = 10007;

// Returns { member } or { gone: true }. Only Discord's "Unknown Member" error
// counts as gone: a network blip must never delete someone's link.
async function fetchMemberState(guild, discordId) {
    try {
        return { member: await guild.members.fetch({ user: discordId, force: true }) };
    } catch (error) {
        return error.code === UNKNOWN_MEMBER ? { gone: true } : { member: null };
    }
}

async function removeDeparted(db, discordId, reason) {
    await db.prepare('DELETE FROM players WHERE discord_id = ?').run(discordId);
    await db.prepare('DELETE FROM valorant_players WHERE discord_id = ?').run(discordId);
    await db.prepare('DELETE FROM rank_history WHERE discord_id = ?').run(discordId).catch(() => {});
    console.log(`🧹 Removed linked accounts for ${discordId} (${reason}).`);
}

// Deleting is only safe in the server the bot manages: with no DISCORD_GUILD_ID and
// several servers, "not in this guild" may just mean "lives in the other one".
function isManagedGuild(client, guild, env = process.env) {
    if (!guild) return false;
    return env.DISCORD_GUILD_ID ? guild.id === env.DISCORD_GUILD_ID : client.guilds.cache.size === 1;
}

module.exports = { fetchMemberState, removeDeparted, isManagedGuild, UNKNOWN_MEMBER };
