const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { getActiveGame, getRanked, getChampion } = require('./services/riot');
const { leagueLabel } = require('./ladder');
const { getFeatureChannel, featureChannelId } = require('./channels');
const { recordApiError } = require('./bot-status');

const RANKED_QUEUES = { 420: 'Ranked Solo/Duo', 440: 'Ranked Flex' };
const CHECK_INTERVAL = 3 * 60 * 1000;

function createLiveGameWatcher({ client, db, intervalMs = CHECK_INTERVAL }) {
    const live = new Map();   // discordId -> { gameId, message }
    const games = new Map();  // gameId -> { region, participants, teams: Map discordId -> teamId, opponents: Map teamId -> text, seenAt }
    let running = false;
    let forbidden = 0;
    let timer = null;

    async function announce(player, game) {
        const channel = await getFeatureChannel(client, 'liveGames');
        if (!channel) return null;
        const me = game.participants.find(item => item.puuid === player.puuid);
        const champion = await getChampion(me?.championId);
        const started = game.gameStartTime ? Math.floor(game.gameStartTime / 1000) : null;
        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle(`🔴 Live • ${RANKED_QUEUES[game.gameQueueConfigId]}`)
            .setDescription(`<@${player.discord_id}> is in a ranked game as **${champion.name}**`)
            .setFooter({ text: `${player.riot_id}#${player.tag}` });
        if (started) embed.addFields({ name: 'Started', value: `<t:${started}:R>`, inline: true });
        if (champion.icon) embed.setThumbnail(champion.icon);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`live:opponents:${game.gameId}:${player.discord_id}`).setLabel('Show opponents').setEmoji('👀').setStyle(ButtonStyle.Secondary)
        );
        return channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    }

    async function markFinished(entry) {
        const embed = EmbedBuilder.from(entry.message.embeds[0]).setColor(0x95A5A6).setTitle('⚫ Game finished');
        await entry.message.edit({ embeds: [embed], components: [] }).catch(() => {});
    }

    async function check() {
        if (running || forbidden >= 3) return;
        running = true;
        try {
            const players = await db.prepare('SELECT discord_id, puuid, region, riot_id, tag FROM players').all();
            for (const player of players) {
                let game;
                try {
                    game = await getActiveGame(player.puuid, player.region);
                    forbidden = 0;
                } catch (error) {
                    recordApiError('riot', error);
                    if (error.response?.status === 403 && ++forbidden >= 3) {
                        console.error('[Live games] Riot spectator API returned 403 three times; live alerts are off until restart. Check the Riot API key.');
                        return;
                    }
                    continue;
                }
                const current = live.get(player.discord_id);
                if (game && RANKED_QUEUES[game.gameQueueConfigId]) {
                    if (current?.gameId === game.gameId) continue;
                    if (current) await markFinished(current);
                    const known = games.get(game.gameId) || { region: player.region, participants: game.participants || [], teams: new Map(), opponents: new Map(), seenAt: Date.now() };
                    known.teams.set(player.discord_id, game.participants?.find(item => item.puuid === player.puuid)?.teamId);
                    games.set(game.gameId, known);
                    const message = await announce(player, game);
                    if (message) live.set(player.discord_id, { gameId: game.gameId, message });
                } else if (current) {
                    live.delete(player.discord_id);
                    await markFinished(current);
                }
            }
            for (const [gameId, game] of games) {
                if (Date.now() - game.seenAt > 3 * 60 * 60 * 1000) games.delete(gameId);
            }
        } catch (error) {
            console.error('[Live games] Check failed:', error.message);
        } finally {
            running = false;
        }
    }

    async function opponentsText(gameId, discordId) {
        const game = games.get(gameId);
        if (!game) return null;
        const myTeam = game.teams.get(discordId);
        if (game.opponents.has(myTeam)) return game.opponents.get(myTeam);
        const lines = [];
        for (const opponent of game.participants.filter(item => item.teamId !== myTeam)) {
            const champion = await getChampion(opponent.championId);
            let rank = 'Unranked';
            try {
                const entries = await getRanked(opponent.puuid, game.region, { priority: true });
                const solo = entries.find(entry => entry.queueType === 'RANKED_SOLO_5x5');
                if (solo) {
                    const total = solo.wins + solo.losses;
                    rank = `${leagueLabel(solo.tier, solo.rank, solo.leaguePoints)} • ${total ? Math.round((solo.wins / total) * 100) : 0}% WR`;
                }
            } catch {
                rank = 'Rank unavailable';
            }
            lines.push(`**${champion.name}** — ${escapeMarkdown(opponent.riotId || 'Hidden')}\n└ ${rank}`);
        }
        const text = lines.join('\n') || 'No opponent data.';
        game.opponents.set(myTeam, text);
        return text;
    }

    async function handleInteraction(interaction) {
        if (!interaction.isButton() || !interaction.customId.startsWith('live:opponents:')) return false;
        const [, , gameId, discordId] = interaction.customId.split(':');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const text = await opponentsText(Number(gameId), discordId);
        await interaction.editReply(text
            ? { embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle('👀 Enemy team').setDescription(text)] }
            : { content: 'This game has finished or the bot restarted since it started.' });
        return true;
    }

    function start() {
        if (timer) return;
        // Polling costs Riot rate limit, so it only runs when alerts have somewhere to go.
        if (!featureChannelId('liveGames')) {
            console.warn('[Live games] Off: set LIVE_GAMES_CHANNEL_ID or ANNOUNCEMENTS_CHANNEL_ID to enable live game alerts.');
            return;
        }
        check();
        timer = setInterval(check, intervalMs);
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { start, stop, check, handleInteraction, isRunning: () => Boolean(timer) && forbidden < 3 };
}

module.exports = { createLiveGameWatcher };
