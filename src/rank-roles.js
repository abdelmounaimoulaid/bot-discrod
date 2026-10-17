const RANK_ROLE_IDS = {
    CHALLENGER: '1547019143914463353',
    GRANDMASTER: '1547019144745066516',
    MASTER: '1547019145831252059',
    DIAMOND: '1547019148159094794',
    EMERALD: '1547019148930973776',
    PLATINUM: '1547019149090361446',
    GOLD: '1547019150097121281',
    SILVER: '1547019150814220390',
    BRONZE: '1547019151820726404',
    IRON: '1547019152537948290',
    UNRANKED: '1547019153250979850',
};

const RANK_TIERS = [
    'IRON',
    'BRONZE',
    'SILVER',
    'GOLD',
    'PLATINUM',
    'EMERALD',
    'DIAMOND',
    'MASTER',
    'GRANDMASTER',
    'CHALLENGER',
    'UNRANKED'
];

function getTierDisplayName(tier) {
    if (!tier) return '';
    const upper = tier.toUpperCase();
    return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function findRankRoleByName(guild, tier) {
    if (!guild || !guild.roles || !guild.roles.cache) return null;
    const upperTier = (tier || '').toUpperCase();
    if (!RANK_TIERS.includes(upperTier)) return null;

    const displayName = getTierDisplayName(upperTier);
    const tierPattern = new RegExp(`(^|[^a-zA-Z])${upperTier}([^a-zA-Z]|$)`, 'i');
    const labelled = guild.roles.cache.find(r =>
        /\b(?:lol|league)\b/i.test(r.name) &&
        !/\b(?:valorant|val|vaorant)\b/i.test(r.name) && tierPattern.test(r.name)
    );
    if (labelled) return labelled;

    // 1. Exact match with server's pattern: 'ʚ  : <Tier>' or 'ʚ : <Tier>'
    let role = guild.roles.cache.find(r => 
        r.name === `ʚ  : ${displayName}` || 
        r.name === `ʚ : ${displayName}`
    );
    if (role) return role;

    // 2. Contains 'ʚ' and the tier name (case-insensitive)
    role = guild.roles.cache.find(r => 
        !/\b(?:valorant|val|vaorant)\b/i.test(r.name) &&
        r.name.includes('ʚ') &&
        new RegExp(`(^|[^a-zA-Z])${upperTier}([^a-zA-Z]|$)`, 'i').test(r.name)
    );
    if (role) return role;

    // 3. Fallback: match standalone tier word (e.g., 'Emerald')
    role = guild.roles.cache.find(r => {
        const regex = new RegExp(`(^|[^a-zA-Z])${upperTier}([^a-zA-Z]|$)`, 'i');
        return !/\b(?:valorant|val|vaorant)\b/i.test(r.name) && regex.test(r.name);
    });

    return role || null;
}

function findRankRole(guild, tier) {
    if (!guild || !guild.roles || !guild.roles.cache) return null;
    const upperTier = (tier || 'UNRANKED').toUpperCase();

    const labelled = guild.roles.cache.find(r =>
        /\b(?:lol|league)\b/i.test(r.name) &&
        !/\b(?:valorant|val|vaorant)\b/i.test(r.name) &&
        new RegExp(`(^|[^a-zA-Z])${upperTier}([^a-zA-Z]|$)`, 'i').test(r.name)
    );
    if (labelled) return labelled;

    // Check ID map first
    const directId = RANK_ROLE_IDS[upperTier];
    if (directId && guild.roles.cache.has(directId) &&
        !/\b(?:valorant|val|vaorant)\b/i.test(guild.roles.cache.get(directId).name)) {
        return guild.roles.cache.get(directId);
    }

    // Fallback to name search
    return findRankRoleByName(guild, upperTier);
}

function getAllRankRoles(guild) {
    if (!guild || !guild.roles || !guild.roles.cache) return [];
    const rolesMap = new Map();

    // Collect from ID map
    for (const [tier, id] of Object.entries(RANK_ROLE_IDS)) {
        const role = guild.roles.cache.get(id);
        if (role && !/\b(?:valorant|val|vaorant)\b/i.test(role.name)) rolesMap.set(role.id, role);
    }

    // Also collect any roles found by name matching
    for (const tier of RANK_TIERS) {
        const role = findRankRole(guild, tier);
        if (role) rolesMap.set(role.id, role);
    }

    return Array.from(rolesMap.values());
}

async function syncRankRole(member, tier) {
    if (!member || !member.guild) return null;
    const guild = member.guild;

    if (guild.roles?.cache && guild.roles.cache.size <= 1 && typeof guild.roles.fetch === 'function') {
        try {
            await guild.roles.fetch();
        } catch (err) {
            console.error('Failed to fetch guild roles:', err.message);
        }
    }

    const upperTier = (tier || 'UNRANKED').toUpperCase();
    const targetRole = findRankRole(guild, upperTier);
    if (!targetRole) return null;
    const allRankRoles = getAllRankRoles(guild);

    const toRemove = allRankRoles.filter(
        role => member.roles.cache.has(role.id) && (!targetRole || role.id !== targetRole.id)
    );

    try {
        if (toRemove.length > 0) {
            await member.roles.remove(toRemove.map(r => r.id));
            console.log(`[Rank Roles] Removed [${toRemove.map(r => r.name).join(', ')}] from ${member.user?.tag || member.id}`);
        }

        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole.id);
            console.log(`[Rank Roles] Assigned [${targetRole.name}] to ${member.user?.tag || member.id}`);
        }
    } catch (error) {
        console.error(`[Rank Roles] Error updating roles for ${member.user?.tag || member.id}:`, error.message);
        if (error.code === 50013) {
            console.error('[Rank Roles] TIP: Ensure the bot has "Manage Roles" permission and its highest role is placed above the rank roles in Server Settings -> Roles.');
        }
    }

    return targetRole;
}

module.exports = {
    RANK_ROLE_IDS,
    RANK_TIERS,
    findRankRole,
    getAllRankRoles,
    syncRankRole,
};
