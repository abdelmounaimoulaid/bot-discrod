async function syncLeagueGameRole(member) {
    if (!member?.guild) return null;
    const roles = member.guild.roles.cache;
    const id = process.env.LOL_GAME_ROLE_ID;
    const role = id ? roles.get(id) : roles.find(item =>
        ['leagueoflegends', 'lol'].includes(item.name.toLowerCase().replace(/[^a-z]/g, ''))
    );
    if (!role) {
        console.warn('[League game role] Not found. Set LOL_GAME_ROLE_ID to the League of Legends game role ID.');
        return null;
    }
    try {
        if (!member.roles.cache.has(role.id)) await member.roles.add(role.id);
        return role;
    } catch (error) {
        console.error('[League game role] Assignment failed:', error.message);
        return null;
    }
}
module.exports = { syncLeagueGameRole };
