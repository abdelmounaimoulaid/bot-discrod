const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

function isValorantRankRole(role) {
    return !/\b(?:lol|league)\b/i.test(role.name) &&
        /\b(?:valorant|val|vaorant)\b/i.test(role.name);
}

const VALORANT_GAME_ROLE_ID = '1545477995979087915'; // ʚ  :  Vaorant

const VALORANT_AGENT_ROLES = {
    DUELIST: {
        id: 'DUELIST',
        label: 'Duelist',
        emoji: '⚔️',
        description: 'Offensive fragger (Jett, Reyna, Raze, Phoenix, Yoru, Neon, Iso)'
    },
    INITIATOR: {
        id: 'INITIATOR',
        label: 'Initiator',
        emoji: '🏹',
        description: 'Info & setup (Sova, Fade, Breach, Skye, KAY/O, Gekko, Tejo)'
    },
    CONTROLLER: {
        id: 'CONTROLLER',
        label: 'Controller',
        emoji: '☁️',
        description: 'Smoke expert (Omen, Viper, Brimstone, Astra, Harbor, Clove)'
    },
    SENTINEL: {
        id: 'SENTINEL',
        label: 'Sentinel',
        emoji: '🛡️',
        description: 'Defense & lock down (Killjoy, Cypher, Sage, Chamber, Deadlock, Vyse)'
    }
};

const VALORANT_TIERS = [
    'Radiant',
    'Immortal',
    'Ascendant',
    'Diamond',
    'Platinum',
    'Gold',
    'Silver',
    'Bronze',
    'Iron',
    'Unranked',
    'Unrated'
];

function agentIcon(roleKey, emojis) {
    const emoji = emojis?.find(item => item.available !== false && item.name?.toLowerCase() === roleKey?.toLowerCase());
    return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : VALORANT_AGENT_ROLES[roleKey]?.emoji || '—';
}

function buildValorantRoleSelectMenu(emojis) {
    const options = Object.values(VALORANT_AGENT_ROLES).map(role => ({
        label: role.label,
        value: role.id,
        description: role.description,
        emoji: agentIcon(role.id, emojis)
    }));

    const select = new StringSelectMenuBuilder()
        .setCustomId('select_valorant_role')
        .setPlaceholder('🎯 Choose your main Valorant Agent Role...')
        .addOptions(options);

    return select;
}

function findValorantRole(guild, roleKey) {
    if (!guild || !roleKey) return null;
    const targetName = VALORANT_AGENT_ROLES[roleKey.toUpperCase()]?.label?.toLowerCase() || roleKey.toLowerCase();
    return guild.roles.cache.find(r => r.name.toLowerCase().includes(targetName));
}

function findValorantRankRole(guild, tierName) {
    if (!guild || !tierName) return null;
    const cleanTier = tierName.split(' ')[0].toLowerCase(); // e.g. "Gold 3" -> "gold"
    return guild.roles.cache.find(r => {
        if (!isValorantRankRole(r)) return false;
        const name = r.name.toLowerCase();
        if (cleanTier === 'unrated' || cleanTier === 'unranked') {
            return name.includes('unranked') || name.includes('unrated');
        }
        return new RegExp(`\\b${cleanTier}\\b`, 'i').test(name);
    });
}

async function syncValorantGameRole(member) {
    if (!member) return;
    try {
        const gameRole = member.guild.roles.cache.get(process.env.VALORANT_GAME_ROLE_ID || VALORANT_GAME_ROLE_ID) ||
            member.guild.roles.cache.find(r => ['vaorant', 'valorant', 'val'].includes(r.name.toLowerCase().replace(/[^a-z]/g, '')));
        if (gameRole && !member.roles.cache.has(gameRole.id)) {
            await member.roles.add(gameRole);
            console.log(`[Valorant Roles] Added Valorant game role to ${member.user?.tag || member.id}`);
        }
    } catch (err) {
        console.error(`[Valorant Roles] Failed to assign game role:`, err.message);
    }
}

async function syncValorantRankRole(member, tierName) {
    if (!member) return;
    await syncValorantGameRole(member);

    const targetRole = findValorantRankRole(member.guild, tierName);
    if (!targetRole) return;
    const allRankRoles = member.guild.roles.cache.filter(r => {
        if (!isValorantRankRole(r)) return false;
        const name = r.name.toLowerCase();
        return VALORANT_TIERS.some(tier => new RegExp(`\\b${tier}\\b`, 'i').test(name));
    });

    const rolesToRemove = allRankRoles.filter(r =>
        member.roles.cache.has(r.id) && (!targetRole || r.id !== targetRole.id)
    );

    const rankList = rolesToRemove.values ? Array.from(rolesToRemove.values()) : Array.from(rolesToRemove);
    for (const role of rankList) {
        try {
            await member.roles.remove(role);
            console.log(`[Valorant Roles] Removed [${role.name}] from ${member.user?.tag || member.id}`);
        } catch (err) {
            console.error(`[Valorant Roles] Could not remove rank role [${role.name}]:`, err.message);
        }
    }

    if (targetRole && !member.roles.cache.has(targetRole.id)) {
        try {
            await member.roles.add(targetRole);
            console.log(`[Valorant Roles] Assigned [${targetRole.name}] to ${member.user?.tag || member.id}`);
        } catch (err) {
            console.error(`[Valorant Roles] Could not assign rank role [${targetRole.name}]:`, err.message);
        }
    }
}

async function syncValorantAgentRole(member, roleKey) {
    if (!member || !roleKey) return;
    const targetRole = findValorantRole(member.guild, roleKey);
    const allAgentRoles = member.guild.roles.cache.filter(r => {
        const name = r.name.toLowerCase();
        return Object.values(VALORANT_AGENT_ROLES).some(role => name.includes(role.label.toLowerCase()));
    });

    const rolesToRemove = allAgentRoles.filter(r =>
        member.roles.cache.has(r.id) && (!targetRole || r.id !== targetRole.id)
    );

    const agentList = rolesToRemove.values ? Array.from(rolesToRemove.values()) : Array.from(rolesToRemove);
    for (const role of agentList) {
        try {
            await member.roles.remove(role);
            console.log(`[Valorant Roles] Removed Agent Role [${role.name}] from ${member.user?.tag || member.id}`);
        } catch (err) {
            console.error(`[Valorant Roles] Could not remove agent role [${role.name}]:`, err.message);
        }
    }

    if (targetRole && !member.roles.cache.has(targetRole.id)) {
        try {
            await member.roles.add(targetRole);
            console.log(`[Valorant Roles] Assigned Agent Role [${targetRole.name}] to ${member.user?.tag || member.id}`);
        } catch (err) {
            console.error(`[Valorant Roles] Could not assign agent role [${targetRole.name}]:`, err.message);
        }
    }
}

module.exports = {
    agentIcon,
    VALORANT_GAME_ROLE_ID,
    VALORANT_AGENT_ROLES,
    VALORANT_TIERS,
    buildValorantRoleSelectMenu,
    findValorantRole,
    findValorantRankRole,
    syncValorantGameRole,
    syncValorantRankRole,
    syncValorantAgentRole
};
