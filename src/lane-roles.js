const { StringSelectMenuBuilder } = require('discord.js');

const LANES = {
    TOP: {
        id: 'TOP',
        label: 'Top',
        emojiId: '1547625738302136330',
        emojiName: 'top',
        roleId: '1545132838700187658',
        roleName: 'ʚ  :  Top'
    },
    JUNGLE: {
        id: 'JUNGLE',
        label: 'Jungle',
        emojiId: '1547625771668082759',
        emojiName: 'jungle',
        roleId: '1545132838620373028',
        roleName: 'ʚ  :  Jungle'
    },
    MID: {
        id: 'MID',
        label: 'Mid',
        emojiId: '1547625796993286326',
        emojiName: 'middle',
        roleId: '1545132838620373031',
        roleName: 'ʚ  :  Mid'
    },
    BOT: {
        id: 'BOT',
        label: 'Bottom',
        emojiId: '1547625824822231110',
        emojiName: 'bottom',
        roleId: '1545132838620373030',
        roleName: 'ʚ  :  Bottom'
    },
    SUPPORT: {
        id: 'SUPPORT',
        label: 'Support',
        emojiId: '1547625847022682243',
        emojiName: 'support',
        roleId: '1545132838620373029',
        roleName: 'ʚ  :  Support'
    }
};

function buildLaneSelectMenu(customId = 'select_lane', placeholder = '🛡️ Select which lane you play') {
    return new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .addOptions(
            Object.values(LANES).map(lane => ({
                label: lane.label,
                value: lane.id,
                description: `${lane.label} lane`,
                emoji: {
                    id: lane.emojiId,
                    name: lane.emojiName
                }
            }))
        );
}

function findLaneRole(guild, laneId) {
    if (!guild || !guild.roles || !guild.roles.cache) return null;
    const lane = LANES[laneId?.toUpperCase()];
    if (!lane) return null;

    if (guild.roles.cache.has(lane.roleId)) {
        return guild.roles.cache.get(lane.roleId);
    }

    return guild.roles.cache.find(r => 
        r.name === lane.roleName ||
        (r.name.includes('ʚ') && r.name.toLowerCase().includes(lane.label.toLowerCase()))
    ) || null;
}

function getAllLaneRoles(guild) {
    if (!guild || !guild.roles || !guild.roles.cache) return [];
    const rolesMap = new Map();
    for (const lane of Object.values(LANES)) {
        const role = findLaneRole(guild, lane.id);
        if (role) rolesMap.set(role.id, role);
    }
    return Array.from(rolesMap.values());
}

async function syncLaneRole(member, laneId) {
    if (!member || !member.guild) return null;
    const guild = member.guild;

    if (guild.roles?.cache && guild.roles.cache.size <= 1 && typeof guild.roles.fetch === 'function') {
        try {
            await guild.roles.fetch();
        } catch (err) {
            console.error('Failed to fetch guild roles:', err.message);
        }
    }

    const targetRole = findLaneRole(guild, laneId);
    const allLaneRoles = getAllLaneRoles(guild);

    const toRemove = allLaneRoles.filter(
        role => member.roles.cache.has(role.id) && (!targetRole || role.id !== targetRole.id)
    );

    try {
        if (toRemove.length > 0) {
            await member.roles.remove(toRemove.map(r => r.id));
            console.log(`[Lane Roles] Removed [${toRemove.map(r => r.name).join(', ')}] from ${member.user?.tag || member.id}`);
        }

        if (targetRole && !member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole.id);
            console.log(`[Lane Roles] Assigned [${targetRole.name}] to ${member.user?.tag || member.id}`);
        }
    } catch (error) {
        console.error(`[Lane Roles] Error updating lane roles for ${member.user?.tag || member.id}:`, error.message);
    }

    return targetRole;
}

module.exports = {
    LANES,
    buildLaneSelectMenu,
    findLaneRole,
    getAllLaneRoles,
    syncLaneRole
};
