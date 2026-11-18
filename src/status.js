const { EmbedBuilder, MessageFlags } = require('discord.js');
const { snapshot } = require('./bot-status');
const { FEATURE_CHANNELS, featureChannelId } = require('./channels');
const { canDraw } = require('./profile-card');

function ago(timestamp) {
    return timestamp ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'never';
}

async function handleStatusCommand(interaction, { client, db, memberEventsEnabled, liveWatcher }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const state = snapshot();

    let database;
    try {
        const start = Date.now();
        await db.prepare('SELECT 1 AS ok').get();
        const [lol, val] = await Promise.all([
            db.prepare('SELECT COUNT(*) AS total FROM players').get(),
            db.prepare('SELECT COUNT(*) AS total FROM valorant_players').get()
        ]);
        database = `🟢 ${Date.now() - start} ms • ${lol.total} League / ${val.total} VALORANT linked`;
    } catch (error) {
        database = `🔴 ${error.message}`;
    }

    const refreshLine = name => {
        const refresh = state.refreshes[name];
        return refresh ? `${ago(refresh.finishedAt)} • ${Math.round(refresh.durationMs / 1000)}s • ${refresh.players} players` : 'not run yet';
    };
    const apiLine = name => {
        const entry = state.apiErrors[name];
        return entry ? `⚠️ ${entry.count} error${entry.count === 1 ? '' : 's'} • last ${ago(entry.lastAt)}: ${entry.lastMessage}` : '🟢 no errors';
    };
    const memory = process.memoryUsage().rss / 1024 / 1024;
    const features = Object.keys(FEATURE_CHANNELS)
        .map(feature => `${featureChannelId(feature) ? '🟢' : '⚪'} ${feature}${featureChannelId(feature) ? ` → <#${featureChannelId(feature)}>` : ''}`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🩺 Bot status')
        .addFields(
            { name: 'Uptime', value: `Since ${ago(state.startedAt)}`, inline: true },
            { name: 'Discord ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
            { name: 'Memory', value: `${memory.toFixed(0)} MB`, inline: true },
            { name: 'Database', value: database },
            { name: 'League refresh', value: refreshLine('league'), inline: true },
            { name: 'VALORANT refresh', value: refreshLine('valorant'), inline: true },
            { name: 'Riot API', value: apiLine('riot') },
            { name: 'HenrikDev API', value: apiLine('henrik') },
            { name: 'Announcement channels', value: features },
            {
                name: 'Other',
                value: [
                    `${liveWatcher?.isRunning() ? '🟢' : '⚪'} Live game alerts`,
                    `${memberEventsEnabled ? '🟢' : '⚪'} Member events (welcome + instant cleanup)`,
                    `${canDraw() ? '🟢' : '⚪'} Image profile cards`
                ].join('\n')
            }
        )
        .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
}

module.exports = { handleStatusCommand };
