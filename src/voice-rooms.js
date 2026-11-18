const {
    ChannelType, PermissionFlagsBits: P, PermissionsBitField, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    UserSelectMenuBuilder, MessageFlags
} = require('discord.js');

const TRIGGERS = new Set(['1545191862170816552', '1545483798005944402', '1545448198980505683', '1545448597728919736', '1545132840289832962']);

function parseLimit(value) {
    return /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : null;
}

function panel(ownerId) {
    return {
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Your voice room')
            .setDescription(`<@${ownerId}> owns this room. Only the owner can use these controls.\n\n**Lock / Unlock** — close or open entry.\n**Allow user** — let someone join, even when locked.\n**Block user** — prevent entry and disconnect them.\n**Member limit** — choose 0–99 (0 = unlimited, includes you).\n\nLocking does not remove people already inside. Server administrators can still enter. The room is deleted when everyone leaves.`)],
        components: [new ActionRowBuilder().addComponents(
            ...[['lock', 'Lock', ButtonStyle.Secondary], ['unlock', 'Unlock', ButtonStyle.Secondary], ['allow', 'Allow user', ButtonStyle.Success], ['block', 'Block user', ButtonStyle.Danger], ['limit', 'Member limit', ButtonStyle.Primary]]
                .map(([id, label, style]) => new ButtonBuilder().setCustomId(`voice:${id}`).setLabel(label).setStyle(style))
        )],
        allowedMentions: { parse: [] }
    };
}

function registerVoiceRooms(client, db) {
    const get = db.prepare('SELECT * FROM voice_rooms WHERE channel_id = ?');
    const remove = db.prepare('DELETE FROM voice_rooms WHERE channel_id = ?');
    const queues = new Map();
    function serial(key, task) {
        const result = (queues.get(key) || Promise.resolve()).then(task);
        const tail = result.catch(error => console.error('Voice room error:', error));
        queues.set(key, tail);
        tail.finally(() => { if (queues.get(key) === tail) queues.delete(key); });
        return result;
    }

    async function cleanup(channelId) {
        if (!channelId || !(await get.get(channelId))) return;
        let channel;
        try { channel = await client.channels.fetch(channelId); }
        catch (error) { if (error.code !== 10003) throw error; }
        if (!channel) { await remove.run(channelId); return; }
        if (channel.members.size === 0) {
            await channel.delete('Temporary voice room is empty');
            await remove.run(channelId);
        }
    }

    client.on('voiceStateUpdate', (oldState, state) => {
        if (oldState.channelId === state.channelId) return;
        console.log(`[Voice rooms v2] member=${state.id} from=${oldState.channelId || 'disconnected'} to=${state.channelId || 'disconnected'} trigger=${TRIGGERS.has(state.channelId)}`);
        serial(state.guild.id, async () => {
            if (TRIGGERS.has(state.channelId) && !state.member?.user.bot && state.member?.voice.channelId === state.channelId) {
                const existing = await db.prepare('SELECT channel_id FROM voice_rooms WHERE guild_id = ? AND owner_id = ?').all(state.guild.id, state.id);
                let room;
                for (const entry of existing) {
                    await cleanup(entry.channel_id).catch(error => console.error('Old voice room cleanup failed:', error));
                }
                {
                    const source = state.channel;
                    const overwrites = source.permissionOverwrites.cache
                        .filter(item => item.id !== state.id && item.id !== client.user.id)
                        .map(item => ({ id: item.id, type: item.type, allow: item.allow.bitfield, deny: item.deny.bitfield }));
                    overwrites.push({ id: state.id, allow: [P.ViewChannel, P.Connect, P.Speak, P.SendMessages, P.ReadMessageHistory] });
                    overwrites.push({ id: client.user.id, allow: [P.ViewChannel, P.Connect, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageChannels, P.MoveMembers] });
                    try {
                        room = await state.guild.channels.create({
                        name: `${state.member.displayName}'s room`.slice(0, 100),
                        type: ChannelType.GuildVoice, parent: source.parentId,
                        // Inherit category permissions at creation. Discord applies special
                        // validation to ManageRoles overwrites in the creation endpoint.
                        userLimit: 0,
                        reason: 'Join-to-create personal voice room'
                        });
                    } catch (error) {
                        if (error.code === 50013) {
                            const bot = await state.guild.members.fetchMe();
                            const requested = overwrites.reduce((bits, item) => bits |
                                new PermissionsBitField(item.allow || 0n).bitfield |
                                new PermissionsBitField(item.deny || 0n).bitfield, P.ManageChannels);
                            const missing = bot.permissions.missing(requested);
                            const location = source.parent || source;
                            const categoryMissing = location.permissionsFor(bot).missing([P.ViewChannel, P.ManageChannels, P.ManageRoles, P.MoveMembers]);
                            throw new Error(`Cannot create voice room for lobby ${source.id}. Missing server permissions: ${missing.join(', ') || 'none detected'}. Missing permissions in category/channel ${location.id}: ${categoryMissing.join(', ') || 'none detected'}. Check the bot role and category overrides. Copied lobby permission overrides also require the bot to hold those permissions in the server.`, { cause: error });
                        }
                        throw error;
                    }
                    await db.prepare('INSERT INTO voice_rooms VALUES (?, ?, ?)').run(room.id, state.guild.id, state.id);
                    let moved = false;
                    try {
                        // Apply lobby access rules only once the channel exists, before
                        // posting controls or moving its owner into it.
                        await room.permissionOverwrites.set(overwrites);
                        await room.send(panel(state.id));
                        if (state.member.voice.channelId === source.id) {
                            await state.member.voice.setChannel(room);
                            moved = true;
                            console.log(`[Voice rooms v2] Created ${room.id} from lobby ${source.id} and moved ${state.id}`);
                        }
                        try {
                            await room.setPosition(source.position + 1);
                        } catch (error) {
                            console.error(`Could not position voice room ${room.id} below ${source.id}:`, error);
                            await room.send({ content: 'Your room is ready, but I could not place it below Join To Create. Check the bot’s Manage Channels permission.', allowedMentions: { parse: [] } }).catch(() => {});
                        }
                    } finally {
                        // REST move completion can precede the voice-state gateway event.
                        // An empty member cache here does not mean the moved user left.
                        if (!moved) await cleanup(room.id);
                    }
                }
            }
            await cleanup(oldState.channelId);
        }).catch(async error => {
            if (TRIGGERS.has(state.channelId) && state.channel) {
                await state.channel.send({ content: 'I could not finish creating your voice room. Check the latest Voice room error in the hosting logs.', allowedMentions: { parse: [] } }).catch(() => {});
            }
        });
    });

    client.once('ready', async () => {
        try {
        console.log(`[Voice rooms v2] Listening for joins to: ${[...TRIGGERS].join(', ')}`);
        for (const room of await db.prepare('SELECT * FROM voice_rooms').all()) {
            if (client.guilds.cache.has(room.guild_id)) serial(room.guild_id, () => cleanup(room.channel_id)).catch(() => {});
        }
        } catch (error) { console.error('Voice room startup failed:', error); }
    });
    client.on('channelDelete', channel => { remove.run(channel.id).catch(error => console.error('Voice room record cleanup failed:', error)); });

    client.on('interactionCreate', async interaction => {
        if (!interaction.customId?.startsWith('voice:')) return;
        try {
            const room = await get.get(interaction.channelId);
            if (!room || room.owner_id !== interaction.user.id) {
                await interaction.reply({ content: 'Only the owner of this room can use these controls.', flags: MessageFlags.Ephemeral });
                return;
            }
            const action = interaction.customId.slice(6);
            if (interaction.isButton() && action === 'limit') {
                await interaction.showModal(new ModalBuilder().setCustomId('voice:set-limit').setTitle('Member limit')
                    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('limit')
                        .setLabel('0–99 members (0 = unlimited)').setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(true))));
                return;
            }
            if (interaction.isButton() && ['allow', 'block'].includes(action)) {
                await interaction.reply({ content: `Choose a user to ${action}.`, flags: MessageFlags.Ephemeral,
                    components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`voice:${action}-user`).setPlaceholder('Choose a user').setMaxValues(1))] });
                return;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await serial(room.guild_id, async () => {
                if ((await get.get(interaction.channelId))?.owner_id !== interaction.user.id) {
                    await interaction.editReply('This room no longer exists.');
                    return;
                }
                const channel = await interaction.guild.channels.fetch(room.channel_id);
                if (interaction.isModalSubmit() && action === 'set-limit') {
                    const limit = parseLimit(interaction.fields.getTextInputValue('limit'));
                    if (limit === null) { await interaction.editReply('Enter a whole number from 0 to 99.'); return; }
                    await channel.setUserLimit(limit);
                    await interaction.editReply(limit ? `Member limit set to ${limit}, including you.` : 'Member limit removed.');
                } else if (interaction.isButton() && ['lock', 'unlock'].includes(action)) {
                    if (action === 'lock') {
                        // Role-level Connect grants override the @everyone deny. Clear those
                        // grants together, while retaining individual invitations and blocks.
                        const overwrites = channel.permissionOverwrites.cache.map(item => ({
                            id: item.id, type: item.type,
                            allow: item.type === 0 ? item.allow.bitfield & ~P.Connect : item.allow.bitfield,
                            deny: item.deny.bitfield
                        })).filter(item => item.id !== interaction.guild.id);
                        const everyone = channel.permissionOverwrites.cache.get(interaction.guild.id);
                        overwrites.push({ id: interaction.guild.id, type: 0, allow: (everyone?.allow.bitfield || 0n) & ~P.Connect, deny: (everyone?.deny.bitfield || 0n) | P.Connect });
                        await channel.permissionOverwrites.set(overwrites);
                    } else {
                        await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true });
                    }
                    await interaction.editReply(action === 'lock' ? 'Room locked. Allowed users can still join.' : 'Room unlocked. Blocked users remain blocked.');
                } else if (interaction.isUserSelectMenu() && ['allow-user', 'block-user'].includes(action)) {
                    const id = interaction.values[0];
                    if ([room.owner_id, client.user.id].includes(id)) { await interaction.editReply('You cannot change access for the room owner or this bot.'); return; }
                    const member = await interaction.guild.members.fetch(id);
                    const allow = action === 'allow-user';
                    if (!allow && member.permissions.has(P.Administrator)) { await interaction.editReply('Server administrators bypass channel restrictions.'); return; }
                    await channel.permissionOverwrites.edit(member, { Connect: allow, ...(allow ? { ViewChannel: true } : {}) });
                    if (!allow && member.voice.channelId === channel.id) await member.voice.disconnect('Blocked by voice room owner');
                    await interaction.editReply(allow ? 'User allowed to join your room.' : 'User blocked from your room.');
                } else {
                    await interaction.editReply('Unknown room control.');
                }
            });
        } catch (error) {
            console.error('Voice control failed:', error);
            const content = 'Could not update the room. Check the bot has Manage Channels, Manage Roles, Move Members, View Channel and Send Messages permissions.';
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    });
}

module.exports = { registerVoiceRooms, parseLimit, panel, TRIGGERS };
