const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { getTopMastery, getChampion } = require('./services/riot');
const { getValorantRecentMatches } = require('./services/valorant');

const SERVER_CACHE_MS = 60 * 60 * 1000;
const MEDALS = ['🥇', '🥈', '🥉'];

function formatPoints(points) {
    if (points >= 1000000) return `${(points / 1000000).toFixed(1)}M`;
    if (points >= 1000) return `${Math.round(points / 1000)}k`;
    return String(points);
}

// Counts agents played in recent competitive matches (HenrikDev has no mastery endpoint).
function countAgents(matches, puuid, name, tag) {
    const counts = new Map();
    for (const match of matches) {
        const players = match.players?.all_players || [];
        const me = players.find(item => puuid && item.puuid === puuid) ||
            players.find(item => item.name?.toLowerCase() === name.toLowerCase() && item.tag?.toLowerCase() === tag.toLowerCase());
        if (me?.character) counts.set(me.character, (counts.get(me.character) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function createMastery({ db }) {
    let serverCache = null;

    async function playerMastery(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        await interaction.deferReply();
        const [lol, val] = await Promise.all([
            db.prepare('SELECT puuid, region, riot_id, tag FROM players WHERE discord_id = ?').get(user.id),
            db.prepare('SELECT puuid, region, riot_id, tag FROM valorant_players WHERE discord_id = ?').get(user.id)
        ]);
        if (!lol && !val) {
            await interaction.editReply(`${user.id === interaction.user.id ? 'You have' : `<@${user.id}> has`} not linked a League or VALORANT account yet.`);
            return;
        }
        const embed = new EmbedBuilder().setColor(0xC8AA6E).setTitle(`🏅 Mastery • ${user.globalName || user.username}`);
        if (lol) {
            try {
                const top = await getTopMastery(lol.puuid, lol.region, 3, { priority: true });
                const lines = [];
                for (const [i, entry] of top.entries()) {
                    const champion = await getChampion(entry.championId);
                    if (i === 0 && champion.icon) embed.setThumbnail(champion.icon);
                    lines.push(`${MEDALS[i]} **${champion.name}** — Level ${entry.championLevel} • ${formatPoints(entry.championPoints)} pts`);
                }
                embed.addFields({ name: `⚔️ League • ${escapeMarkdown(`${lol.riot_id}#${lol.tag}`)}`, value: lines.join('\n') || 'No mastery yet.' });
            } catch (error) {
                embed.addFields({ name: '⚔️ League', value: `Could not load mastery (${error.response?.status || error.message}).` });
            }
        }
        if (val) {
            try {
                const matches = await getValorantRecentMatches(val.region, val.riot_id, val.tag, 10, { priority: true });
                const agents = countAgents(matches, val.puuid, val.riot_id, val.tag).slice(0, 3);
                embed.addFields({
                    name: `🔴 VALORANT • last ${matches.length} competitive games`,
                    value: agents.map(([agent, games], i) => `${MEDALS[i]} **${agent}** — ${games} game${games === 1 ? '' : 's'}`).join('\n') || 'No recent competitive games.'
                });
            } catch (error) {
                embed.addFields({ name: '🔴 VALORANT', value: `Could not load recent games (${error.response?.status || error.message}).` });
            }
        }
        await interaction.editReply({ embeds: [embed] });
    }

    async function serverMastery(interaction) {
        await interaction.deferReply();
        if (!serverCache || Date.now() - serverCache.at > SERVER_CACHE_MS) {
            const players = await db.prepare('SELECT puuid, region FROM players').all();
            const champions = new Map(); // championId -> { mains, points }
            for (const player of players) {
                try {
                    for (const entry of await getTopMastery(player.puuid, player.region, 3)) {
                        const total = champions.get(entry.championId) || { mains: 0, points: 0 };
                        total.mains++;
                        total.points += entry.championPoints;
                        champions.set(entry.championId, total);
                    }
                } catch {
                    // One failed player should not hide everyone else's champions.
                }
            }
            serverCache = { at: Date.now(), players: players.length, ranking: [...champions.entries()].sort((a, b) => b[1].mains - a[1].mains || b[1].points - a[1].points).slice(0, 10) };
        }
        const lines = [];
        for (const [i, [championId, total]] of serverCache.ranking.entries()) {
            const champion = await getChampion(championId);
            lines.push(`${MEDALS[i] || `**${i + 1}.**`} **${champion.name}** — top-3 pick for ${total.mains} player${total.mains === 1 ? '' : 's'} • ${formatPoints(total.points)} pts`);
        }
        const first = serverCache.ranking[0] ? await getChampion(serverCache.ranking[0][0]) : null;
        const embed = new EmbedBuilder()
            .setColor(0xC8AA6E)
            .setTitle('🏰 Server favourite champions')
            .setDescription(lines.join('\n') || 'No linked League players yet.')
            .setFooter({ text: `Based on ${serverCache.players} linked player${serverCache.players === 1 ? '' : 's'} • updates hourly` });
        if (first?.icon) embed.setThumbnail(first.icon);
        await interaction.editReply({ embeds: [embed] });
    }

    function handleCommand(interaction) {
        return interaction.options.getSubcommand() === 'server' ? serverMastery(interaction) : playerMastery(interaction);
    }

    return { handleCommand };
}

module.exports = { createMastery, countAgents };
