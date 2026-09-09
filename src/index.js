require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require("discord.js");

const db = require("./database");
const {
    getRiotAccount,
    getSummoner,
    getRanked
} = require("./services/riot");

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ============================================================
// CONFIG
// ============================================================

const LINK_CHANNEL_ID = "1547347832611278909";
const DASHBOARD_CHANNEL_ID = "1547348269053648896";

const DASHBOARD_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ============================================================
// RIOT REGIONS
// ============================================================

const regionMap = {
    EUW: "euw1",
    EUNE: "eun1",
    NA: "na1",
    KR: "kr",
    BR: "br1",
    TR: "tr1",
    LAN: "la1",
    LAS: "la2",
    OCE: "oc1",
    JP: "jp1"
};

// ============================================================
// RANK SORTING
// ============================================================

const tierOrder = {
    IRON: 0,
    BRONZE: 1,
    SILVER: 2,
    GOLD: 3,
    PLATINUM: 4,
    EMERALD: 5,
    DIAMOND: 6,
    MASTER: 7,
    GRANDMASTER: 8,
    CHALLENGER: 9
};

const divisionOrder = {
    IV: 0,
    III: 1,
    II: 2,
    I: 3
};

// ============================================================
// HELPERS
// ============================================================

function getWinRate(wins, losses) {
    const total = wins + losses;

    if (total === 0) {
        return "0.0";
    }

    return ((wins / total) * 100).toFixed(1);
}

function sortPlayers(players) {
    return players.sort((a, b) => {
        const tierDifference =
            (tierOrder[b.tier] ?? -1) -
            (tierOrder[a.tier] ?? -1);

        if (tierDifference !== 0) {
            return tierDifference;
        }

        const divisionDifference =
            (divisionOrder[b.rank] ?? -1) -
            (divisionOrder[a.rank] ?? -1);

        if (divisionDifference !== 0) {
            return divisionDifference;
        }

        return b.league_points - a.league_points;
    });
}

// ============================================================
// BUILD DASHBOARD
// ============================================================

const { buildDashboardEmbed: renderDashboard, createDashboardUpdater } = require("./dashboard");

async function buildDashboardEmbed(guild) {
    let emojis = guild?.emojis.cache;
    if (guild) {
        try {
            emojis = await guild.emojis.fetch();
        } catch (error) {
            console.error("Could not refresh rank emojis; using cached icons:", error.message);
        }
    }
    return renderDashboard(sortPlayers(db.prepare("SELECT * FROM players").all()), emojis);
}

const persistDashboard = createDashboardUpdater({
    client,
    db,
    channelId: DASHBOARD_CHANNEL_ID,
    buildEmbed: buildDashboardEmbed
});

async function updateDashboard() {
    try {
        await persistDashboard();
        console.log("✅ Dashboard updated.");
    } catch (error) {
        console.error("❌ Failed to update dashboard:", error);
    }
}

// ============================================================
// UPDATE ALL PLAYERS FROM RIOT
// ============================================================

async function updateAllPlayers() {
    const players = db.prepare(`
        SELECT *
        FROM players
    `).all();

    if (players.length === 0) {
        console.log("ℹ️ No linked players to update.");
        return;
    }

    console.log(`🔄 Updating ${players.length} player(s)...`);

    const updatePlayer = db.prepare(`
        UPDATE players
        SET
            riot_id = ?,
            tag = ?,
            region = ?,
            summoner_level = ?,
            tier = ?,
            rank = ?,
            league_points = ?,
            wins = ?,
            losses = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE discord_id = ?
    `);

    for (const player of players) {
        try {
            const rankedEntries = await getRanked(
                player.puuid,
                player.region
            );

            const soloQueue = rankedEntries.find(
                entry => entry.queueType === "RANKED_SOLO_5x5"
            );

            if (!soloQueue) {
                updatePlayer.run(
                    player.riot_id,
                    player.tag,
                    player.region,
                    player.summoner_level,
                    "UNRANKED",
                    "",
                    0,
                    0,
                    0,
                    player.discord_id
                );

                console.log(
                    `ℹ️ ${player.riot_id} is currently unranked.`
                );

                continue;
            }

            updatePlayer.run(
                player.riot_id,
                player.tag,
                player.region,
                player.summoner_level,
                soloQueue.tier,
                soloQueue.rank,
                soloQueue.leaguePoints,
                soloQueue.wins,
                soloQueue.losses,
                player.discord_id
            );

            console.log(
                `✅ ${player.riot_id} → ${soloQueue.tier} ${soloQueue.rank} ${soloQueue.leaguePoints} LP`
            );

        } catch (error) {
            console.error(
                `❌ Failed to update ${player.riot_id}#${player.tag}`
            );

            if (error.response) {
                console.error(
                    `Riot API status: ${error.response.status}`
                );
            } else {
                console.error(error.message);
            }
        }
    }
}

// ============================================================
// FULL REFRESH
// ============================================================

async function refreshDashboard() {
    console.log("======================================");
    console.log("🔄 Starting leaderboard refresh...");

    await updateAllPlayers();
    await updateDashboard();

    console.log("✅ Leaderboard refresh completed.");
    console.log("======================================");
}

// ============================================================
// LINK PANEL
// ============================================================

function buildLinkPanel() {
    const embed = new EmbedBuilder()
        .setTitle("🎮 Link your League of Legends account")
        .setDescription([
            "Connect your Riot account to join the server leaderboard.",
            "",
            "Your **rank, LP, wins and losses** will be tracked automatically.",
            "",
            "Click the button below to get started."
        ].join("\n"))
        .setFooter({
            text: "League of Legends • Account Linking"
        });

    const button = new ButtonBuilder()
        .setCustomId("link_league_account")
        .setLabel("Link League Account")
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
        .addComponents(button);

    return {
        embeds: [embed],
        components: [row]
    };
}

// ============================================================
// BOT READY
// ============================================================

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Initial refresh
    await refreshDashboard();

    // Refresh every 5 minutes
    setInterval(async () => {
        await refreshDashboard();
    }, DASHBOARD_REFRESH_INTERVAL);
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async interaction => {

    // ========================================================
    // LINK BUTTON
    // ========================================================

    if (
        interaction.isButton() &&
        interaction.customId === "link_league_account"
    ) {
        const modal = new ModalBuilder()
            .setCustomId("link_league_modal")
            .setTitle("Link League of Legends Account");

        const riotIdInput = new TextInputBuilder()
            .setCustomId("riot_id")
            .setLabel("Riot ID")
            .setPlaceholder("Jumia Caps")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const tagInput = new TextInputBuilder()
            .setCustomId("tag")
            .setLabel("Tag")
            .setPlaceholder("9929")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const regionInput = new TextInputBuilder()
            .setCustomId("region")
            .setLabel("Region")
            .setPlaceholder("EUW")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(riotIdInput),
            new ActionRowBuilder().addComponents(tagInput),
            new ActionRowBuilder().addComponents(regionInput)
        );

        await interaction.showModal(modal);

        return;
    }

    // ========================================================
    // LINK MODAL
    // ========================================================

    if (
        interaction.isModalSubmit() &&
        interaction.customId === "link_league_modal"
    ) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const riotId = interaction.fields
                .getTextInputValue("riot_id")
                .trim();

            const tag = interaction.fields
                .getTextInputValue("tag")
                .trim();

            const regionInput = interaction.fields
                .getTextInputValue("region")
                .trim()
                .toUpperCase();

            const region = regionMap[regionInput];

            if (!region) {
                await interaction.editReply({
                    content:
                        "❌ Invalid region. Please use **EUW, EUNE, NA, KR, BR, TR, LAN, LAS, OCE or JP**."
                });

                return;
            }

            console.log(
                `🔎 Linking ${riotId}#${tag} (${regionInput}) for ${interaction.user.tag}`
            );

            // Get Riot account
            const account = await getRiotAccount(
                riotId,
                tag,
                region
            );

            const puuid = account.puuid;

            // Get summoner
            const summoner = await getSummoner(
                puuid,
                region
            );

            // Get ranked data
            const rankedEntries = await getRanked(
                puuid,
                region
            );

            const soloQueue = rankedEntries.find(
                entry =>
                    entry.queueType === "RANKED_SOLO_5x5"
            );

            const existingPlayer = db.prepare(`
                SELECT discord_id
                FROM players
                WHERE puuid = ?
            `).get(puuid);

            if (
                existingPlayer &&
                existingPlayer.discord_id !== interaction.user.id
            ) {
                await interaction.editReply({
                    content:
                        "❌ **This League account is already linked to another Discord account.**"
                });

                return;
            }

            const tier = soloQueue
                ? soloQueue.tier
                : "UNRANKED";

            const rank = soloQueue
                ? soloQueue.rank
                : "";

            const leaguePoints = soloQueue
                ? soloQueue.leaguePoints
                : 0;

            const wins = soloQueue
                ? soloQueue.wins
                : 0;

            const losses = soloQueue
                ? soloQueue.losses
                : 0;

            const savePlayer = db.prepare(`
                INSERT INTO players (
                    discord_id,
                    puuid,
                    riot_id,
                    tag,
                    region,
                    summoner_level,
                    tier,
                    rank,
                    league_points,
                    wins,
                    losses
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

                ON CONFLICT(discord_id)
                DO UPDATE SET
                    puuid = excluded.puuid,
                    riot_id = excluded.riot_id,
                    tag = excluded.tag,
                    region = excluded.region,
                    summoner_level = excluded.summoner_level,
                    tier = excluded.tier,
                    rank = excluded.rank,
                    league_points = excluded.league_points,
                    wins = excluded.wins,
                    losses = excluded.losses,
                    updated_at = CURRENT_TIMESTAMP
            `);

            savePlayer.run(
                interaction.user.id,
                puuid,
                riotId,
                tag,
                region,
                summoner.summonerLevel || 0,
                tier,
                rank,
                leaguePoints,
                wins,
                losses
            );

            const winRate = getWinRate(wins, losses);

            await interaction.editReply({
                content: [
                    "✅ **League account linked successfully!**",
                    "",
                    `🎮 **${riotId}#${tag}**`,
                    `🏅 **${tier} ${rank}** — ${leaguePoints} LP`,
                    `📊 **${wins}W - ${losses}L** — ${winRate}% WR`,
                    "",
                    "Your stats will now appear automatically on the server leaderboard."
                ].join("\n")
            });

            // Immediately update dashboard
            await updateDashboard();

        } catch (error) {
            console.error("❌ League account linking failed:");

            if (error.response) {
                console.error(
                    `Riot API status: ${error.response.status}`
                );
                console.error(error.response.data);
            } else {
                console.error(error);
            }

            let message =
                "❌ **Could not verify your League account.**";

            if (
                error.response &&
                error.response.status === 404
            ) {
                message +=
                    "\n\nMake sure your **Riot ID, Tag and Region** are correct.";
            } else if (
                error.response &&
                error.response.status === 403
            ) {
                message +=
                    "\n\nThe Riot API key may be invalid or expired.";
            } else if (
                error.response &&
                error.response.status === 429
            ) {
                message +=
                    "\n\nRiot API rate limit reached. Please try again later.";
            }

            await interaction.editReply({
                content: message
            });
        }

        return;
    }

    // ========================================================
    // SLASH COMMANDS
    // ========================================================

    if (interaction.isChatInputCommand()) {

        // /link
        if (interaction.commandName === "link") {
            await interaction.reply({
                content:
                    "🔗 Please use the **Link League Account** button in the account-linking channel.",
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // /leaderboard
        if (interaction.commandName === "leaderboard") {
            await interaction.deferReply();
            await interaction.editReply({
                embeds: [await buildDashboardEmbed(interaction.guild)]
            });

            return;
        }
    }
});

// ============================================================
// LOGIN
// ============================================================

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log("🔐 Login request sent");
    })
    .catch(error => {
        console.error("❌ Discord login failed:");
        console.error(error);
    });

