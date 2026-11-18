const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DEFAULT_PATCH_NOTES_CHANNEL_ID = '1547015987495182377';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // Check every 30 minutes

async function getLatestPatchNotes() {
    // 1. Primary source: Fetch official League game updates page
    try {
        const listUrl = 'https://www.leagueoflegends.com/en-us/news/game-updates/';
        const res = await fetch(listUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
            const html = await res.text();
            const match = html.match(/href="([^"]*patch-([^"]*)-notes[^"]*)"/i);
            if (match) {
                let patchUrl = match[1];
                if (!patchUrl.startsWith('http')) {
                    patchUrl = `https://www.leagueoflegends.com${patchUrl}`;
                }

                const versionMatch = patchUrl.match(/patch-([0-9-]+)-notes/i);
                const version = versionMatch ? versionMatch[1].replace(/-/g, '.') : '';

                let title = `League of Legends Patch ${version} Notes`;
                let description = 'Check out the latest balance changes, champion adjustments, and game updates!';
                let imageUrl = null;

                try {
                    const articleRes = await fetch(patchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                        },
                        signal: AbortSignal.timeout(10000)
                    });

                    if (articleRes.ok) {
                        const articleHtml = await articleRes.text();
                        const titleMatch = articleHtml.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*)"/i) ||
                                           articleHtml.match(/<title>([^<]*)<\/title>/i);
                        const descMatch = articleHtml.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*)"/i) ||
                                          articleHtml.match(/<meta\s+(?:name|property)="description"\s+content="([^"]*)"/i);
                        const imgMatch = articleHtml.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*)"/i);

                        if (titleMatch?.[1]) {
                            title = titleMatch[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim();
                        }
                        if (descMatch?.[1]) {
                            description = descMatch[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim();
                        }
                        if (imgMatch?.[1]) {
                            imageUrl = imgMatch[1].replace(/&amp;/g, '&');
                        }
                    }
                } catch (articleErr) {
                    console.warn('[Patch Notes] Could not fetch article metadata:', articleErr.message);
                }

                return { version, url: patchUrl, title, description, imageUrl };
            }
        }
    } catch (webErr) {
        console.warn('[Patch Notes] Web scraping failed or blocked, trying DataDragon fallback:', webErr.message);
    }

    // 2. Fallback source: Riot Games official DataDragon API (always accessible from datacenters)
    try {
        const ddragonRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
            signal: AbortSignal.timeout(10000)
        });

        if (ddragonRes.ok) {
            const versions = await ddragonRes.json();
            if (Array.isArray(versions) && versions.length > 0) {
                const latest = versions[0];
                const parts = latest.split('.');
                const version = parts.slice(0, 2).join('.');
                const url = `https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-${version.replace('.', '-')}-notes`;
                return {
                    version,
                    url,
                    title: `League of Legends Patch ${version} Notes`,
                    description: 'The latest official balance updates, champion adjustments, and bug fixes for League of Legends.',
                    imageUrl: null
                };
            }
        }
    } catch (ddragonErr) {
        console.error('[Patch Notes] DataDragon fallback failed:', ddragonErr.message);
    }

    throw new Error('Unable to retrieve latest League of Legends patch notes from all sources.');
}

function buildPatchNotesEmbed(patch) {
    const embed = new EmbedBuilder()
        .setTitle(`📢 ${patch.title}`)
        .setURL(patch.url)
        .setColor(0xC89B3C) // League Hextech Gold
        .setDescription(patch.description || 'Check out the latest patch updates!')
        .addFields(
            { name: '🔖 Version', value: `\`Patch ${patch.version || 'Update'}\``, inline: true },
            { name: '🌐 Source', value: '[Official Riot Games](https://www.leagueoflegends.com/)', inline: true }
        )
        .setFooter({ text: 'League of Legends • Game Updates • Official Patch Notes' })
        .setTimestamp();

    if (patch.imageUrl) {
        embed.setImage(patch.imageUrl);
    }

    return embed;
}

function buildPatchNotesButton(patch) {
    const button = new ButtonBuilder()
        .setLabel('Read Full Patch Notes')
        .setStyle(ButtonStyle.Link)
        .setURL(patch.url)
        .setEmoji('📜');

    return new ActionRowBuilder().addComponents(button);
}

async function checkAndPostPatchNotes({ client, db, channelId = DEFAULT_PATCH_NOTES_CHANNEL_ID, fetchFn = getLatestPatchNotes }) {
    console.log(`[Patch Notes] 🔄 Checking for patch updates (channel: ${channelId})...`);
    try {
        const patch = await fetchFn();
        if (!patch || !patch.url) {
            console.warn('[Patch Notes] ⚠️ No patch data retrieved.');
            return;
        }

        console.log(`[Patch Notes] 🔍 Found patch: ${patch.title} (${patch.version})`);

        // 1. Check if already recorded in database
        let saved = null;
        try {
            const getSaved = db.prepare('SELECT setting_value FROM bot_settings WHERE setting_key = ?');
            saved = await getSaved.get('last_patch_url');
        } catch (dbErr) {
            console.warn('[Patch Notes] Notice: bot_settings read skipped:', dbErr.message);
        }

        if (saved && saved.setting_value === patch.url) {
            console.log(`[Patch Notes] ℹ️ Patch ${patch.version} already recorded in database. Skipping.`);
            return;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.warn(`[Patch Notes] ❌ Channel ${channelId} not found or bot lacks access.`);
            return;
        }

        // 2. Check if already posted in Discord channel
        try {
            const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
            if (recent) {
                const alreadyPosted = recent.some(m =>
                    m.author.id === client.user.id &&
                    m.embeds.some(e => e.title?.includes(patch.version) || e.url === patch.url)
                );
                if (alreadyPosted) {
                    console.log(`[Patch Notes] ℹ️ Patch ${patch.version} is already present in channel.`);
                    // Save to DB so we don't scan messages next time
                    try {
                        const saveSetting = db.prepare(
                            'INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value'
                        );
                        await saveSetting.run('last_patch_url', patch.url);
                        console.log('[Patch Notes] 💾 Saved last_patch_url to bot_settings table.');
                    } catch {}
                    return;
                }
            }
        } catch {}

        const embed = buildPatchNotesEmbed(patch);
        const row = buildPatchNotesButton(patch);

        await channel.send({
            embeds: [embed],
            components: [row]
        });

        // 3. Save new patch URL to database
        try {
            const saveSetting = db.prepare(
                'INSERT INTO bot_settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value'
            );
            await saveSetting.run('last_patch_url', patch.url);
            console.log('[Patch Notes] 💾 Saved last_patch_url to bot_settings table.');
        } catch (saveErr) {
            console.warn('[Patch Notes] Notice: Could not save last_patch_url to database:', saveErr.message);
        }

        console.log(`[Patch Notes] ✅ Successfully posted patch notes to Discord: ${patch.title}`);
    } catch (error) {
        console.error('[Patch Notes] ❌ Error checking or posting patch notes:', error.message);
    }
}

function initPatchNotesPoster(client, db, options = {}) {
    const channelId = options.channelId || process.env.PATCH_NOTES_CHANNEL_ID || DEFAULT_PATCH_NOTES_CHANNEL_ID;

    // Check immediately on startup
    checkAndPostPatchNotes({ client, db, channelId });

    // Periodically check for new patches
    const interval = setInterval(() => {
        checkAndPostPatchNotes({ client, db, channelId });
    }, options.intervalMs || CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
}

module.exports = {
    DEFAULT_PATCH_NOTES_CHANNEL_ID,
    getLatestPatchNotes,
    buildPatchNotesEmbed,
    buildPatchNotesButton,
    checkAndPostPatchNotes,
    initPatchNotesPoster
};
