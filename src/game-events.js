const { EmbedBuilder } = require('discord.js');
const { getRankedMatchIds, getMatch, getChampion } = require('./services/riot');
const { getValorantRecentMatches } = require('./services/valorant');
const {
    leagueScore, isLeaguePromotion, leagueLabel, leagueEmblemUrl,
    isValorantPromotion, valorantRankIconUrl
} = require('./ladder');
const { getFeatureChannel, featureChannelId } = require('./channels');
const { recordApiError } = require('./bot-status');

const QUEUE_NAMES = { 420: 'Ranked Solo/Duo', 440: 'Ranked Flex' };
const NO_PINGS = { parse: [] };

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function signed(value, unit) {
    if (value === null || value === undefined) return 'Updating…';
    return `${value > 0 ? '+' : ''}${value} ${unit}`;
}

function buildRankUpEmbed({ discordId, riotId, game, from, to, iconUrl }) {
    const isLeague = game === 'LOL';
    const embed = new EmbedBuilder()
        .setColor(isLeague ? 0xF1C40F : 0xFD4556)
        .setTitle('🎉 Rank Up!')
        .setDescription(`<@${discordId}> just reached **${to}** in ${isLeague ? 'League of Legends' : 'VALORANT'}!\n\n${from} ➜ **${to}**`)
        .setFooter({ text: riotId })
        .setTimestamp();
    if (iconUrl) embed.setThumbnail(iconUrl);
    return embed;
}

function buildLeagueRecapEmbed({ discordId, riotId, match, participant, champion, lpChange }) {
    const info = match.info;
    const win = participant.win;
    const kills = participant.kills, deaths = participant.deaths, assists = participant.assists;
    const kda = deaths ? ((kills + assists) / deaths).toFixed(2) : 'Perfect';
    const cs = (participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0);
    const minutes = Math.max(1, info.gameDuration / 60);
    const position = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' }[participant.teamPosition] || '';
    const embed = new EmbedBuilder()
        .setColor(win ? 0x2ECC71 : 0xE74C3C)
        .setTitle(`${win ? '✅ Victory' : '❌ Defeat'} • ${QUEUE_NAMES[info.queueId] || 'Ranked'}`)
        .setDescription(`<@${discordId}> played **${champion.name}**${position ? ` (${position})` : ''}`)
        .addFields(
            { name: 'KDA', value: `**${kills}/${deaths}/${assists}** (${kda})`, inline: true },
            { name: 'CS', value: `${cs} (${(cs / minutes).toFixed(1)}/min)`, inline: true },
            { name: 'LP', value: `**${signed(lpChange, 'LP')}**`, inline: true },
            { name: 'Damage', value: `${(participant.totalDamageDealtToChampions || 0).toLocaleString('en-US')}`, inline: true },
            { name: 'Vision', value: `${participant.visionScore || 0}`, inline: true },
            { name: 'Duration', value: formatDuration(info.gameDuration), inline: true }
        )
        .setFooter({ text: `${riotId} • League of Legends` })
        .setTimestamp(info.gameEndTimestamp || Date.now());
    if (champion.icon) embed.setThumbnail(champion.icon);
    return embed;
}

function buildValorantRecapEmbed({ discordId, riotId, match, me, win, rrChange }) {
    const meta = match.metadata || {};
    const stats = me.stats || {};
    const rounds = meta.rounds_played || 1;
    const shots = (stats.headshots || 0) + (stats.bodyshots || 0) + (stats.legshots || 0);
    const hs = shots ? `${Math.round(((stats.headshots || 0) / shots) * 100)}%` : '—';
    const team = (me.team || '').toLowerCase();
    const teamData = match.teams?.[team] || {};
    const score = teamData.rounds_won !== undefined ? `${teamData.rounds_won}–${teamData.rounds_lost}` : '';
    const embed = new EmbedBuilder()
        .setColor(win ? 0x2ECC71 : 0xE74C3C)
        .setTitle(`${win ? '✅ Victory' : '❌ Defeat'} • ${meta.map || 'Competitive'}${score ? ` (${score})` : ''}`)
        .setDescription(`<@${discordId}> played **${me.character || 'an agent'}**`)
        .addFields(
            { name: 'KDA', value: `**${stats.kills || 0}/${stats.deaths || 0}/${stats.assists || 0}**`, inline: true },
            { name: 'ACS', value: `${Math.round((stats.score || 0) / rounds)}`, inline: true },
            { name: 'RR', value: `**${signed(rrChange, 'RR')}**`, inline: true },
            { name: 'Headshot %', value: hs, inline: true }
        )
        .setFooter({ text: `${riotId} • VALORANT` })
        .setTimestamp();
    const icon = me.assets?.agent?.small;
    if (icon) embed.setThumbnail(icon);
    return embed;
}

// Match lookups feed recaps and the LP race's win streaks; skip the API calls
// when neither has a channel.
function wantsMatches() {
    return Boolean(featureChannelId('matchRecaps') || featureChannelId('lpRace'));
}

function createGameEvents({ client, db }) {
    const saveHistory = db.prepare('INSERT IGNORE INTO match_history (game, match_id, discord_id, win, lp_change, played_at) VALUES (?, ?, ?, ?, ?, ?)');
    const missingChannelWarned = new Set();

    async function post(feature, embed) {
        const channel = await getFeatureChannel(client, feature);
        if (!channel) {
            if (!missingChannelWarned.has(feature)) {
                missingChannelWarned.add(feature);
                console.warn(`[Game events] No channel configured for ${feature}; set ANNOUNCEMENTS_CHANNEL_ID to enable it.`);
            }
            return;
        }
        await channel.send({ embeds: [embed], allowedMentions: NO_PINGS });
    }

    // `player` is the row from before this refresh; `solo` / `flex` are Riot entries (or null).
    async function afterLeagueUpdate({ player, solo, flex }) {
        const riotId = `${player.riot_id}#${player.tag}`;
        try {
            for (const [queue, entry, oldTier, oldRank] of [
                ['Solo/Duo', solo, player.tier, player.rank],
                ['Flex', flex, player.flex_tier, player.flex_rank]
            ]) {
                if (entry && isLeaguePromotion(oldTier, oldRank, entry.tier, entry.rank)) {
                    await post('rankUps', buildRankUpEmbed({
                        discordId: player.discord_id, riotId, game: 'LOL',
                        from: `${leagueLabel(oldTier, oldRank)} (${queue})`, to: leagueLabel(entry.tier, entry.rank),
                        iconUrl: leagueEmblemUrl(entry.tier)
                    }));
                }
            }
        } catch (error) {
            console.error(`[Game events] Rank-up post failed for ${riotId}:`, error.message);
        }

        if (!wantsMatches()) return;
        try {
            const [latest] = await getRankedMatchIds(player.puuid, player.region, 1);
            if (!latest || latest === player.last_match_id) return;
            await db.prepare('UPDATE players SET last_match_id = ? WHERE discord_id = ?').run(latest, player.discord_id);
            // First sighting just records the id, so linking or upgrading the bot
            // does not post a recap for an old game.
            if (!player.last_match_id) return;

            const match = await getMatch(latest, player.region);
            const participant = match.info?.participants?.find(item => item.puuid === player.puuid);
            if (!participant || !QUEUE_NAMES[match.info.queueId] || participant.gameEndedInEarlySurrender) return;

            const isSolo = match.info.queueId === 420;
            const before = isSolo ? leagueScore(player.tier, player.rank, player.league_points) : leagueScore(player.flex_tier, player.flex_rank, player.flex_league_points);
            const entry = isSolo ? solo : flex;
            const after = entry ? leagueScore(entry.tier, entry.rank, entry.leaguePoints) : null;
            // Riot can publish the match before the new LP; 0 means "not updated yet".
            const lpChange = before !== null && after !== null && after !== before ? after - before : null;

            await saveHistory.run('LOL', latest, player.discord_id, participant.win ? 1 : 0, lpChange,
                new Date(match.info.gameEndTimestamp || Date.now()));
            const champion = await getChampion(participant.championId);
            await post('matchRecaps', buildLeagueRecapEmbed({ discordId: player.discord_id, riotId, match, participant, champion, lpChange }));
        } catch (error) {
            recordApiError('riot', error);
            console.error(`[Game events] League match recap failed for ${riotId}:`, error.response?.status || error.message);
        }
    }

    // `player` is the stored row from before this refresh; `data` is the fresh Henrik data.
    async function afterValorantUpdate({ player, data }) {
        const riotId = `${data.riot_id}#${data.tag}`;
        try {
            if (isValorantPromotion(player.current_tier, data.current_tier)) {
                await post('rankUps', buildRankUpEmbed({
                    discordId: player.discord_id, riotId, game: 'VAL',
                    from: player.tier_name, to: data.tier_name,
                    iconUrl: data.rank_image || valorantRankIconUrl(data.current_tier)
                }));
            }
        } catch (error) {
            console.error(`[Game events] Valorant rank-up post failed for ${riotId}:`, error.message);
        }

        if (!wantsMatches()) return;
        try {
            const [match] = await getValorantRecentMatches(data.region, data.riot_id, data.tag, 1);
            const matchId = match?.metadata?.matchid;
            if (!matchId || matchId === player.last_match_id) return;
            await db.prepare('UPDATE valorant_players SET last_match_id = ? WHERE discord_id = ?').run(matchId, player.discord_id);
            if (!player.last_match_id) return;

            const players = match.players?.all_players || [];
            const me = players.find(item => item.puuid && item.puuid === (data.puuid || player.puuid)) ||
                players.find(item => item.name?.toLowerCase() === data.riot_id.toLowerCase() && item.tag?.toLowerCase() === data.tag.toLowerCase());
            if (!me) return;
            const win = Boolean(match.teams?.[(me.team || '').toLowerCase()]?.has_won);
            const rrChange = data.last_rr_change;
            const startedAt = match.metadata?.game_start ? new Date(match.metadata.game_start * 1000) : new Date();

            await saveHistory.run('VAL', matchId, player.discord_id, win ? 1 : 0, rrChange, startedAt);
            await post('matchRecaps', buildValorantRecapEmbed({ discordId: player.discord_id, riotId, match, me, win, rrChange }));
        } catch (error) {
            recordApiError('henrik', error);
            console.error(`[Game events] Valorant match recap failed for ${riotId}:`, error.response?.status || error.message);
        }
    }

    return { afterLeagueUpdate, afterValorantUpdate };
}

module.exports = { createGameEvents, buildRankUpEmbed, buildLeagueRecapEmbed, buildValorantRecapEmbed };
