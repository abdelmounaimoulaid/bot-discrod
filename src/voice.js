const { ChannelType, PermissionFlagsBits } = require("discord.js");

// ============================================================
// JOIN TO CREATE
// ============================================================
// When a member joins the "Join To Create" voice channel, the bot creates a
// voice channel named after them in the same category, moves them into it,
// and deletes it once everyone has left.
//
// The hub channel is found by JOIN_TO_CREATE_CHANNEL_ID, or else by any voice
// channel whose name contains "join to create".
//
// The bot needs Manage Channels and Move Members in that category.

function isHub(channel) {
    if (!channel || channel.type !== ChannelType.GuildVoice) {
        return false;
    }

    const configuredId = process.env.JOIN_TO_CREATE_CHANNEL_ID;
    if (configuredId) {
        return channel.id === configuredId;
    }

    return channel.name.toLowerCase().includes("join to create");
}

function setupJoinToCreate({ client, db }) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS temp_voice_channels (
            channel_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const insertChannel = db.prepare(
        "INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)"
    );
    const findChannel = db.prepare(
        "SELECT channel_id FROM temp_voice_channels WHERE channel_id = ?"
    );
    const findByOwner = db.prepare(
        "SELECT channel_id FROM temp_voice_channels WHERE guild_id = ? AND owner_id = ?"
    );
    const removeChannel = db.prepare(
        "DELETE FROM temp_voice_channels WHERE channel_id = ?"
    );
    const allChannels = db.prepare("SELECT channel_id FROM temp_voice_channels");

    // Members currently getting a channel, so a double join event does not
    // create two channels.
    const creating = new Set();

    async function createFor(member, hub) {
        const key = `${member.guild.id}:${member.id}`;
        if (creating.has(key)) {
            return;
        }
        creating.add(key);

        try {
            // Already has a channel (for example after a quick rejoin): reuse it.
            const existing = findByOwner.get(member.guild.id, member.id);
            if (existing) {
                const channel = member.guild.channels.cache.get(existing.channel_id);
                if (channel) {
                    await member.voice.setChannel(channel);
                    return;
                }
                removeChannel.run(existing.channel_id);
            }

            const channel = await member.guild.channels.create({
                name: `🔊 ${member.displayName}`.slice(0, 100),
                type: ChannelType.GuildVoice,
                parent: hub.parentId ?? undefined,
                // Right under the hub, above the other voice channels.
                position: hub.rawPosition + 1,
                bitrate: hub.bitrate,
                userLimit: hub.userLimit,
                permissionOverwrites: [
                    // Keep the category's permissions...
                    ...(hub.parent?.permissionOverwrites.cache.map(overwrite => ({
                        id: overwrite.id,
                        type: overwrite.type,
                        allow: overwrite.allow,
                        deny: overwrite.deny
                    })) ?? []),
                    // ...and let the owner manage their own channel.
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.ViewChannel
                        ]
                    }
                ],
                reason: `Join to create for ${member.user.tag}`
            });

            insertChannel.run(channel.id, member.guild.id, member.id);

            // Discord does not shift the other channels for the position given
            // at creation, so a sibling with the same position can still sort
            // first. Reorder explicitly to sit right under the hub.
            try {
                await channel.setPosition(hub.position + 1);
            } catch (error) {
                console.warn("⚠️ Could not move the voice channel under the hub:", error.message);
            }

            try {
                await member.voice.setChannel(channel);
            } catch (error) {
                // The member left before we could move them.
                await deleteIfEmpty(channel);
                throw error;
            }

            console.log(`🔊 Created voice channel for ${member.user.tag}`);
        } finally {
            creating.delete(key);
        }
    }

    async function deleteIfEmpty(channel) {
        if (!channel || channel.members.size > 0) {
            return;
        }

        removeChannel.run(channel.id);

        try {
            await channel.delete("Temporary voice channel is empty");
            console.log(`🗑️ Deleted empty voice channel ${channel.name}`);
        } catch (error) {
            // 10003 = already deleted.
            if (error.code !== 10003) {
                throw error;
            }
        }
    }

    client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            if (newState.channelId !== oldState.channelId) {
                if (isHub(newState.channel) && newState.member) {
                    await createFor(newState.member, newState.channel);
                }

                if (oldState.channel && findChannel.get(oldState.channelId)) {
                    await deleteIfEmpty(oldState.channel);
                }
            }
        } catch (error) {
            console.error("❌ Join to create failed:", error.message);
            if (error.code === 50013) {
                console.error(
                    "   The bot needs the Manage Channels and Move Members permissions in this category."
                );
            }
        }
    });

    // After a restart, remove temporary channels that emptied while the bot
    // was offline.
    client.once("clientReady", async () => {
        for (const { channel_id } of allChannels.all()) {
            try {
                const channel = await client.channels.fetch(channel_id).catch(() => null);
                if (!channel) {
                    removeChannel.run(channel_id);
                    continue;
                }
                await deleteIfEmpty(channel);
            } catch (error) {
                console.error("❌ Could not clean up voice channel:", error.message);
            }
        }
    });
}

module.exports = { setupJoinToCreate, isHub };
