const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');
const { LOL_TIERS, leagueLabel } = require('./ladder');
const { LANES } = require('./lane-roles');
const { createTempVoice, moveIfInVoice } = require('./temp-voice');

const COOLDOWN = 10 * 60 * 1000;
const MAX_PINGS = 10;

function createLfg({ db }) {
    const cooldowns = new Map(); // userId -> last post time
    const posts = new Map();     // messageId -> { posterId, voiceId }

    async function handleCommand(interaction) {
        const last = cooldowns.get(interaction.user.id);
        if (last && Date.now() - last < COOLDOWN) {
            await interaction.reply({ content: `⏳ You can post again <t:${Math.floor((last + COOLDOWN) / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
            return;
        }
        const lane = interaction.options.getString('lane');
        let min = interaction.options.getString('min_rank') || 'IRON';
        let max = interaction.options.getString('max_rank') || 'CHALLENGER';
        if (LOL_TIERS.indexOf(min) > LOL_TIERS.indexOf(max)) [min, max] = [max, min];
        const tiers = LOL_TIERS.slice(LOL_TIERS.indexOf(min), LOL_TIERS.indexOf(max) + 1);
        const note = interaction.options.getString('note');
        const poster = await db.prepare('SELECT riot_id, tag, region, tier, rank FROM players WHERE discord_id = ?').get(interaction.user.id);

        const candidates = (await db.prepare('SELECT discord_id, lane, tier FROM players WHERE discord_id <> ?').all(interaction.user.id))
            .filter(row => (lane === 'ANY' || row.lane === lane) && tiers.includes(row.tier))
            .slice(0, MAX_PINGS)
            .map(row => row.discord_id);

        const laneText = lane === 'ANY' ? 'any lane' : `${LANES[lane] ? `<:${LANES[lane].emojiName}:${LANES[lane].emojiId}> ` : ''}**${LANES[lane]?.label || lane}**`;
        const rankText = min === max ? leagueLabel(min) : `${leagueLabel(min)} – ${leagueLabel(max)}`;
        const embed = new EmbedBuilder()
            .setColor(0x1ABC9C)
            .setTitle('🤝 Looking for a duo')
            .setDescription([
                `<@${interaction.user.id}> is looking for ${laneText}`,
                `🏅 Rank: **${rankText}**`,
                poster ? `🎮 Plays as **${escapeMarkdown(`${poster.riot_id}#${poster.tag}`)}** (${leagueLabel(poster.tier, poster.rank)})` : '',
                note ? `💬 ${escapeMarkdown(note)}` : ''
            ].filter(Boolean).join('\n'))
            .setFooter({ text: 'Click Join to get a duo voice channel' })
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lfg:join').setLabel('Join').setEmoji('🎧').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lfg:close').setLabel('Close').setStyle(ButtonStyle.Secondary)
        );
        const response = await interaction.reply({
            content: candidates.length ? `📣 ${candidates.map(id => `<@${id}>`).join(' ')}` : undefined,
            embeds: [embed], components: [row],
            allowedMentions: { users: candidates },
            withResponse: true
        });
        posts.set(response.resource.message.id, { posterId: interaction.user.id, voiceId: null });
        // Posts are only useful for a while; keep the map from growing forever.
        if (posts.size > 200) posts.delete(posts.keys().next().value);
        cooldowns.set(interaction.user.id, Date.now());
    }

    async function handleButton(interaction) {
        if (!interaction.isButton() || !interaction.customId.startsWith('lfg:')) return false;
        const post = posts.get(interaction.message.id);
        if (!post) {
            await interaction.reply({ content: 'This post has expired. Use `/lfg` to make a new one.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (interaction.customId === 'lfg:close') {
            if (interaction.user.id !== post.posterId) {
                await interaction.reply({ content: 'Only the poster can close this.', flags: MessageFlags.Ephemeral });
                return true;
            }
            posts.delete(interaction.message.id);
            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x95A5A6).setTitle('🤝 Duo found / closed');
            await interaction.update({ content: null, embeds: [embed], components: [] });
            return true;
        }
        if (interaction.user.id === post.posterId) {
            await interaction.reply({ content: 'You cannot join your own post.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;
        let channel = post.voiceId ? await guild.channels.fetch(post.voiceId).catch(() => null) : null;
        if (!channel) {
            const owner = await guild.members.fetch(post.posterId).catch(() => null);
            channel = await createTempVoice({
                guild, db, name: `🎧 Duo • ${owner?.displayName || 'LFG'}`, parentId: interaction.channel?.parentId,
                ownerId: post.posterId, userLimit: 2, reason: 'LFG duo voice channel'
            });
            post.voiceId = channel.id;
        }
        await moveIfInVoice(guild, post.posterId, channel);
        const moved = await moveIfInVoice(guild, interaction.user.id, channel);
        await interaction.editReply(moved ? `✅ Moved you to <#${channel.id}>.` : `✅ Join <#${channel.id}> to team up.`);
        await interaction.message.reply({ content: `🎧 <@${interaction.user.id}> wants to duo with <@${post.posterId}> → <#${channel.id}>`, allowedMentions: { users: [post.posterId] } });
        return true;
    }

    return { handleCommand, handleButton };
}

module.exports = { createLfg };
