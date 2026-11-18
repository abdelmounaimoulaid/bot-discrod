const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { buildValorantRoleSelectMenu, agentIcon } = require('./valorant-roles');
const { progressBar } = require('./ladder');
const { movementArrow, placeLabel } = require('./movement');

const VALORANT_RANK_ICONS = {
    Radiant: '🔥',
    Immortal: '🔴',
    Ascendant: '🟢',
    Diamond: '💎',
    Platinum: '💠',
    Gold: '🥇',
    Silver: '🥈',
    Bronze: '🥉',
    Iron: '⚙️',
    Unrated: '⚪',
    Unranked: '⚪'
};

function buildValorantLinkPanel(emojis) {
    const embed = new EmbedBuilder()
        .setTitle('🎯 Link your VALORANT Account')
        .setColor(0xFD4556)
        .setDescription([
            'Connect your Riot account to join the server competitive leaderboard.',
            '',
            '• Your **Competitive Rank, RR (Rank Rating), and Win Rate** are tracked automatically.',
            '• You will receive the **Valorant Gamer Role** and your **Rank Role**.',
            '• Select your **main Agent Role** below to receive your Agent Role icon.',
            '',
            'Click the button below to link your account, and choose your main agent class!'
        ].join('\n'))
        .setFooter({ text: 'VALORANT • Account Linking & Leaderboard' });

    const button = new ButtonBuilder()
        .setCustomId('link_valorant_account')
        .setLabel('Link Valorant Account')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder().addComponents(button);
    const selectRow = new ActionRowBuilder().addComponents(buildValorantRoleSelectMenu(emojis));

    return {
        embeds: [embed],
        components: [buttonRow, selectRow]
    };
}

// `movement` maps discord_id -> places moved since the previous refresh.
function buildValorantDashboardEmbed(players = [], emojis, movement = new Map()) {
    const embed = new EmbedBuilder()
        .setTitle('🔴 VALORANT • Competitive Leaderboard')
        .setColor(0xFD4556)
        .setDescription(players.length
            ? '**Competitive Mode** • Ordered by Rank & RR'
            : 'No linked Valorant players yet. Click Link Account above to join the leaderboard!')
        .setTimestamp();

    const columns = [
        { name: 'Role', value: '', inline: true },
        { name: 'Players', value: '', inline: true },
        { name: 'Rank & Win rate', value: '', inline: true }
    ];

    let shown = 0;
    for (const [index, player] of players.entries()) {
        const tierName = player.tier_name || 'Unrated';
        const baseTier = tierName.split(' ')[0];
        const rankEmoji = emojis?.find(item => item.available !== false &&
            [`${baseTier.toLowerCase()}_val`, `val_${baseTier.toLowerCase()}`].includes(item.name?.toLowerCase()));
        const icon = rankEmoji ? `<${rankEmoji.animated ? 'a' : ''}:${rankEmoji.name}:${rankEmoji.id}>` : VALORANT_RANK_ICONS[baseTier] || '⚪';
        const rr = player.ranking_in_tier ?? 0;

        const rankStr = tierName.toLowerCase() === 'unrated' || tierName.toLowerCase() === 'unranked'
            ? 'Unrated'
            : `${icon} ${tierName} – **${rr} RR**${baseTier === 'Radiant' || index > 2 ? '' : ` ${progressBar(rr)}`}`;

        const wins = player.wins || 0;
        const totalGames = player.number_of_games || 0;
        const winRate = totalGames > 0 ? `${((wins / totalGames) * 100).toFixed(1)}%` : '—';

        const roleKey = player.agent_role?.toUpperCase();
        const roleIcon = agentIcon(roleKey, emojis);

        const name = (player.riot_id || 'Unknown').replace(/[\r\n\t]/g, ' ');
        const shortName = name.length > 15 ? `${name.slice(0, 14)}…` : name;
        const row = [roleIcon, `${placeLabel(index)} ${escapeMarkdown(shortName)}${movementArrow(movement.get(player.discord_id))}`, `${rankStr} • **${winRate}**`];

        if (shown === 25 || columns.some((column, i) => column.value.length + row[i].length + (shown ? 1 : 0) > 1024)) break;
        columns.forEach((column, i) => { column.value += `${shown ? '\n' : ''}${row[i]}`; });
        shown++;
    }

    if (shown) embed.addFields(columns);
    embed.setFooter({
        text: `${players.length} linked player${players.length === 1 ? '' : 's'}${shown < players.length ? ` • Top ${shown} shown` : ''} • Refreshes every 5 min • Updated`
    });

    return embed;
}

function createValorantDashboardUpdater({ client, db, channelId, linkChannelId, getMovement = () => new Map() }) {
    let queue = Promise.resolve();

    async function syncLinkPanel(channel) {
        let message;
        try {
            const saved = await db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?').get('valorant_link_msg_id');
            if (saved?.setting_value) {
                message = await channel.messages.fetch(saved.setting_value).catch(() => null);
            }
        } catch {}

        const panelPayload = buildValorantLinkPanel(channel.guild?.emojis?.cache);
        if (message) {
            await message.edit(panelPayload);
            return message.id;
        } else {
            const sent = await channel.send(panelPayload);
            try {
                await db.prepare('INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value')
                    .run('valorant_link_msg_id', sent.id);
            } catch {}
            return sent.id;
        }
    }

    async function syncLeaderboard(channel, players) {
        let message;
        try {
            const saved = await db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?').get('valorant_board_msg_id');
            if (saved?.setting_value) {
                message = await channel.messages.fetch(saved.setting_value).catch(() => null);
            }
        } catch {}

        const embed = buildValorantDashboardEmbed(players, channel.guild?.emojis?.cache, getMovement(players));
        const payload = { embeds: [embed], allowedMentions: { parse: [] } };

        if (message) {
            await message.edit(payload);
            return message.id;
        } else {
            const sent = await channel.send(payload);
            try {
                await db.prepare('INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value')
                    .run('valorant_board_msg_id', sent.id);
            } catch {}
            return sent.id;
        }
    }

    async function update() {
        // Fetch leaderboard channel
        const lbChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!lbChannel) {
            console.warn(`[Valorant Dashboard] Leaderboard channel ${channelId} not found.`);
            return;
        }
        if (lbChannel.guild?.emojis?.fetch) {
            await lbChannel.guild.emojis.fetch().catch(error => console.warn('Could not refresh Valorant emojis:', error.message));
        }

        // Fetch link panel channel (separate from leaderboard if linkChannelId provided)
        const linkChannel = linkChannelId
            ? await client.channels.fetch(linkChannelId).catch(() => null)
            : lbChannel;

        if (linkChannelId && !linkChannel) {
            console.warn(`[Valorant Dashboard] Link panel channel ${linkChannelId} not found.`);
        }

        // 1. Maintain Link Panel (in its own channel)
        if (linkChannel) {
            await syncLinkPanel(linkChannel);
        }

        // 2. Maintain Leaderboard (in leaderboard channel)
        let players = [];
        try {
            players = await db.prepare('SELECT * FROM valorant_players ORDER BY elo DESC, ranking_in_tier DESC').all();
        } catch (err) {
            console.warn('[Valorant Dashboard] Could not read valorant_players table:', err.message);
        }

        await syncLeaderboard(lbChannel, players);
    }

    return function updateValorantDashboard() {
        const result = queue.then(update);
        const tail = result.catch(error => {
            console.error('[Valorant Dashboard] Failed to update dashboard:', error.message);
        });
        queue = tail;
        return result;
    };
}

module.exports = {
    VALORANT_RANK_ICONS,
    buildValorantLinkPanel,
    buildValorantDashboardEmbed,
    createValorantDashboardUpdater
};
