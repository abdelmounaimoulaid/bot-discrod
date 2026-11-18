const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { leagueScore, leagueLabel, scoreToLabel } = require('./ladder');
const { LANES } = require('./lane-roles');
const { createTempVoice, moveIfInVoice } = require('./temp-voice');

const UNLINKED_SCORE = 1000; // Silver II: a neutral guess for players with no linked account.

function laneIcon(lane) {
    const info = LANES[lane];
    return info ? `<:${info.emojiName}:${info.emojiId}>` : '❔';
}

// Tries every split (252 for 5v5) and keeps the one with the closest total
// score; duplicate lanes inside a team count as a small penalty, so ties go to
// teams that cover more roles.
function balanceTeams(entries, teamSize) {
    const [first, ...rest] = entries;
    const total = entries.reduce((sum, entry) => sum + entry.score, 0);
    let best = null;
    const lanePenalty = team => {
        const lanes = team.map(entry => entry.lane).filter(Boolean);
        return lanes.length - new Set(lanes).size;
    };
    (function choose(start, picked) {
        if (picked.length === teamSize - 1) {
            const teamA = [first, ...picked];
            const teamB = rest.filter(entry => !picked.includes(entry));
            const sumA = teamA.reduce((sum, entry) => sum + entry.score, 0);
            const cost = Math.abs(total - 2 * sumA) + 50 * (lanePenalty(teamA) + lanePenalty(teamB));
            if (!best || cost < best.cost) best = { cost, teamA, teamB };
            return;
        }
        for (let i = start; i < rest.length; i++) choose(i + 1, [...picked, rest[i]]);
    })(0, []);
    return best;
}

function createInhouse({ db }) {
    const lobbies = new Map(); // messageId -> { hostId, teamSize, players: string[] }

    function lobbyPayload(lobby, closed = false) {
        const needed = lobby.teamSize * 2;
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🎮 Inhouse Lobby • ${lobby.teamSize}v${lobby.teamSize}`)
            .setDescription([
                `Host: <@${lobby.hostId}>`,
                '',
                lobby.players.length ? lobby.players.map((id, i) => `${i + 1}. <@${id}>`).join('\n') : '*Nobody has joined yet.*',
                '',
                `**${lobby.players.length}/${needed}** players • Teams are balanced by Solo/Duo rank and lane`
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('inhouse:join').setLabel('Join').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(closed || lobby.players.length >= needed),
            new ButtonBuilder().setCustomId('inhouse:leave').setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(closed),
            new ButtonBuilder().setCustomId('inhouse:start').setLabel('Make teams').setEmoji('⚖️').setStyle(ButtonStyle.Primary).setDisabled(closed || lobby.players.length !== needed),
            new ButtonBuilder().setCustomId('inhouse:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(closed)
        );
        return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
    }

    async function ratings(ids) {
        const rows = new Map();
        for (const id of ids) rows.set(id, await db.prepare('SELECT tier, rank, league_points, lane FROM players WHERE discord_id = ?').get(id));
        return ids.map(id => {
            const row = rows.get(id);
            const score = row ? leagueScore(row.tier, row.rank, row.league_points) : null;
            return {
                id,
                score: score ?? UNLINKED_SCORE,
                lane: row?.lane || null,
                label: row ? leagueLabel(row.tier, row.rank) : 'Not linked'
            };
        });
    }

    function teamField(name, team) {
        const average = team.reduce((sum, entry) => sum + entry.score, 0) / team.length;
        return {
            name: `${name} — avg ${scoreToLabel(average)}`,
            value: team.map(entry => `${laneIcon(entry.lane)} <@${entry.id}> — ${entry.label}`).join('\n'),
            inline: true
        };
    }

    async function start(interaction, lobby) {
        await interaction.deferUpdate();
        const best = balanceTeams(await ratings(lobby.players), lobby.teamSize);
        const guild = interaction.guild;
        const parentId = interaction.channel?.parentId;
        let voiceLine = '';
        try {
            const blue = await createTempVoice({ guild, db, name: '🔵 Inhouse • Team 1', parentId, ownerId: lobby.hostId, reason: 'Inhouse team voice' });
            const red = await createTempVoice({ guild, db, name: '🔴 Inhouse • Team 2', parentId, ownerId: lobby.hostId, reason: 'Inhouse team voice' });
            for (const entry of best.teamA) await moveIfInVoice(guild, entry.id, blue);
            for (const entry of best.teamB) await moveIfInVoice(guild, entry.id, red);
            voiceLine = `Voice: <#${blue.id}> vs <#${red.id}> — players already in voice were moved. Channels delete themselves when empty.`;
        } catch (error) {
            console.error('[Inhouse] Could not create team voice channels:', error.message);
            voiceLine = '⚠️ Could not create team voice channels (the bot needs Manage Channels and Move Members).';
        }
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`⚖️ Inhouse Teams • ${lobby.teamSize}v${lobby.teamSize}`)
            .addFields(teamField('🔵 Team 1', best.teamA), teamField('🔴 Team 2', best.teamB))
            .setDescription(voiceLine)
            .setFooter({ text: `Rating difference: ${Math.abs(best.teamA.reduce((s, e) => s + e.score, 0) - best.teamB.reduce((s, e) => s + e.score, 0))} LP total` });
        lobbies.delete(interaction.message.id);
        await interaction.editReply({ ...lobbyPayload(lobby, true) });
        await interaction.followUp({ embeds: [embed], allowedMentions: { users: lobby.players } });
    }

    async function handleCommand(interaction) {
        const lobby = { hostId: interaction.user.id, teamSize: interaction.options.getInteger('team_size') || 5, players: [interaction.user.id] };
        const message = await interaction.reply({ ...lobbyPayload(lobby), withResponse: true });
        lobbies.set(message.resource.message.id, lobby);
    }

    async function handleButton(interaction) {
        if (!interaction.isButton() || !interaction.customId.startsWith('inhouse:')) return false;
        const lobby = lobbies.get(interaction.message.id);
        if (!lobby) {
            await interaction.reply({ content: 'This lobby has closed (or the bot restarted). Start a new one with `/inhouse`.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const action = interaction.customId.slice('inhouse:'.length);
        const isHost = interaction.user.id === lobby.hostId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
        if (action === 'join') {
            if (!lobby.players.includes(interaction.user.id) && lobby.players.length < lobby.teamSize * 2) lobby.players.push(interaction.user.id);
            await interaction.update(lobbyPayload(lobby));
        } else if (action === 'leave') {
            lobby.players = lobby.players.filter(id => id !== interaction.user.id);
            await interaction.update(lobbyPayload(lobby));
        } else if (!isHost) {
            await interaction.reply({ content: 'Only the host (or a server manager) can do that.', flags: MessageFlags.Ephemeral });
        } else if (action === 'start') {
            await start(interaction, lobby);
        } else if (action === 'cancel') {
            lobbies.delete(interaction.message.id);
            await interaction.update({ ...lobbyPayload(lobby, true), content: '❌ Lobby cancelled.' });
        }
        return true;
    }

    return { handleCommand, handleButton };
}

module.exports = { createInhouse, balanceTeams };
