require("dotenv").config();
require("./health-server").startHealthServer();

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
  MessageFlags,
  escapeMarkdown,
} = require("discord.js");

const db = require("./database");
const { getRiotAccount, getSummoner, getRanked } = require("./services/riot");
const { syncLeagueGameRole } = require("./game-roles");
const { syncRankRole } = require("./rank-roles");
const {
  buildLaneSelectMenu,
  syncLaneRole,
  findLaneRole,
  LANES,
} = require("./lane-roles");
const { initPatchNotesPoster } = require("./patch-notes");
const { fetchValorantPlayerData } = require("./services/valorant");
const {
  syncValorantGameRole,
  syncValorantRankRole,
  syncValorantAgentRole,
  buildValorantRoleSelectMenu,
  VALORANT_AGENT_ROLES,
} = require("./valorant-roles");
const {
  createValorantDashboardUpdater,
  buildValorantLinkPanel,
} = require("./valorant-dashboard");
const { leagueScore } = require("./ladder");
const { createMovementTracker } = require("./movement");
const { createGameEvents } = require("./game-events");
const { createLpRace } = require("./lp-race");
const { createLiveGameWatcher } = require("./live-games");
const { createInhouse } = require("./inhouse");
const { createLfg } = require("./lfg");
const { createMastery } = require("./mastery");
const { handleProfileCommand } = require("./profile-card");
const { handleStatusCommand } = require("./status");
const { buildWelcomeMessage, sendWelcome } = require("./welcome");
const { fetchMemberState, removeDeparted, isManagedGuild } = require("./member-cleanup");
const { recordRefresh, recordApiError } = require("./bot-status");

// Welcome messages and instant leave-cleanup need the privileged Server Members
// intent. Requesting it without enabling it in the Developer Portal makes login
// fail, so it is opt-in.
const MEMBER_EVENTS_ENABLED = process.env.ENABLE_MEMBER_EVENTS === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    ...(MEMBER_EVENTS_ENABLED ? [GatewayIntentBits.GuildMembers] : []),
  ],
});

require("./client-errors").registerClientErrors(client);
require("./client-errors").registerProcessErrors(process);

require("./voice-rooms").registerVoiceRooms(client, db);

const gameEvents = createGameEvents({ client, db });
const lpRace = createLpRace({ client, db });
const liveGames = createLiveGameWatcher({ client, db });
const inhouse = createInhouse({ db });
const lfg = createLfg({ db });
const mastery = createMastery({ db });
const movement = createMovementTracker();

// ============================================================
// CONFIG
// ============================================================

const LINK_CHANNEL_ID = "1547347832611278909";
const DASHBOARD_CHANNEL_ID = "1547348269053648896";
const PATCH_NOTES_CHANNEL_ID = process.env.PATCH_NOTES_CHANNEL_ID || "1547015987495182377";
const VALORANT_LEADERBOARD_CHANNEL_ID = process.env.VALORANT_LEADERBOARD_CHANNEL_ID || "1547648922636255323";
const VALORANT_LINK_CHANNEL_ID = process.env.VALORANT_LINK_CHANNEL_ID || "1547652464356888668";

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
  JP: "jp1",
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
  CHALLENGER: 9,
};

const divisionOrder = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
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

// Without the GuildMembers intent the member cache never hears about role
// changes made elsewhere, so always read the member's current roles from Discord.
// Returns null when the member is unavailable; if they left the server, their
// linked accounts are removed so they drop off the leaderboards.
async function fetchMember(guild, discordId) {
  const { member, gone } = await fetchMemberState(guild, discordId);
  if (gone && isManagedGuild(client, guild)) {
    await removeDeparted(db, discordId, "left the server").catch((error) =>
      console.error(`Could not remove departed member ${discordId}:`, error.message),
    );
  }
  return member || null;
}

// Runs the task at most once at a time: a refresh still waiting on slow API calls
// must not overlap the next interval's refresh and interleave role changes.
function singleFlight(name, task) {
  let running = null;
  return () => {
    if (running) {
      console.warn(`⏭️ ${name} still running; skipping this cycle.`);
      return running;
    }
    running = Promise.resolve()
      .then(task)
      .finally(() => {
        running = null;
      });
    return running;
  };
}

function sortPlayers(players) {
  return players.sort((a, b) => {
    const tierDifference =
      (tierOrder[b.tier] ?? -1) - (tierOrder[a.tier] ?? -1);

    if (tierDifference !== 0) {
      return tierDifference;
    }

    const divisionDifference =
      (divisionOrder[b.rank] ?? -1) - (divisionOrder[a.rank] ?? -1);

    if (divisionDifference !== 0) {
      return divisionDifference;
    }

    return b.league_points - a.league_points;
  });
}

// ============================================================
// BUILD DASHBOARD
// ============================================================

const {
  buildDashboardEmbed: renderDashboard,
  createDashboardUpdater,
} = require("./dashboard");

async function buildDashboardEmbed(guild, queueType = 'SOLO') {
  let emojis = guild?.emojis.cache;
  if (guild) {
    try {
      emojis = await guild.emojis.fetch();
    } catch (error) {
      console.error(
        "Could not refresh rank emojis; using cached icons:",
        error.message,
      );
    }
  }
  const allPlayers = await db.prepare("SELECT * FROM players").all();
  if (queueType === 'FLEX') {
    const flexSorted = [...allPlayers].sort((a, b) => {
      const tierDifference = (tierOrder[b.flex_tier] ?? -1) - (tierOrder[a.flex_tier] ?? -1);
      if (tierDifference !== 0) return tierDifference;
      const divisionDifference = (divisionOrder[b.flex_rank] ?? -1) - (divisionOrder[a.flex_rank] ?? -1);
      if (divisionDifference !== 0) return divisionDifference;
      return (b.flex_league_points || 0) - (a.flex_league_points || 0);
    });
    return renderDashboard(flexSorted, emojis, 'FLEX', movement.deltas('lol:FLEX', flexSorted.map(p => p.discord_id)));
  }
  const soloSorted = sortPlayers(allPlayers);
  return renderDashboard(soloSorted, emojis, 'SOLO', movement.deltas('lol:SOLO', soloSorted.map(p => p.discord_id)));
}

const persistDashboard = createDashboardUpdater({
  client,
  db,
  channelId: DASHBOARD_CHANNEL_ID,
  buildEmbed: buildDashboardEmbed,
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
  const players = await db
    .prepare(
      `
        SELECT *
        FROM players
    `,
    )
    .all();

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
            flex_tier = ?,
            flex_rank = ?,
            flex_league_points = ?,
            flex_wins = ?,
            flex_losses = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE discord_id = ?
    `);

  const guild =
    (process.env.DISCORD_GUILD_ID &&
      client.guilds.cache.get(process.env.DISCORD_GUILD_ID)) ||
    client.guilds.cache.first();

  const startedAt = Date.now();
  const baselines = [];
  for (const player of players) {
    try {
      const rankedEntries = await getRanked(player.puuid, player.region);

      const soloQueue = rankedEntries.find(
        (entry) => entry.queueType === "RANKED_SOLO_5x5",
      );
      const flexQueue = rankedEntries.find(
        (entry) => entry.queueType === "RANKED_FLEX_SR",
      );

      const flexTier = flexQueue ? flexQueue.tier : "UNRANKED";
      const flexRank = flexQueue ? flexQueue.rank : "";
      const flexLp = flexQueue ? flexQueue.leaguePoints : 0;
      const flexWins = flexQueue ? flexQueue.wins : 0;
      const flexLosses = flexQueue ? flexQueue.losses : 0;

      if (!soloQueue) {
        await updatePlayer.run(
          player.riot_id,
          player.tag,
          player.region,
          player.summoner_level,
          "UNRANKED",
          "",
          0,
          0,
          0,
          flexTier,
          flexRank,
          flexLp,
          flexWins,
          flexLosses,
          player.discord_id,
        );

        console.log(`ℹ️ ${player.riot_id} is currently unranked in Solo/Duo.`);

        if (guild) {
          try {
            const member = await fetchMember(guild, player.discord_id);
            if (!member) continue;
            await syncRankRole(member, "UNRANKED");
          } catch (err) {
            console.error(
              `Failed to sync rank role for ${player.discord_id}:`,
              err.message,
            );
          }
        }

        await gameEvents.afterLeagueUpdate({ player, solo: null, flex: flexQueue || null });
        continue;
      }

      await updatePlayer.run(
        player.riot_id,
        player.tag,
        player.region,
        player.summoner_level,
        soloQueue.tier,
        soloQueue.rank,
        soloQueue.leaguePoints,
        soloQueue.wins,
        soloQueue.losses,
        flexTier,
        flexRank,
        flexLp,
        flexWins,
        flexLosses,
        player.discord_id,
      );

      console.log(
        `✅ ${player.riot_id} → Solo: ${soloQueue.tier} ${soloQueue.rank} ${soloQueue.leaguePoints} LP | Flex: ${flexTier} ${flexRank} ${flexLp} LP`,
      );

      if (guild) {
        try {
          const member = await fetchMember(guild, player.discord_id);
          if (!member) continue;
          await syncRankRole(member, soloQueue.tier);
        } catch (err) {
          console.error(
            `Failed to sync rank role for ${player.discord_id}:`,
            err.message,
          );
        }
      }

      baselines.push({
        discord_id: player.discord_id,
        score: leagueScore(soloQueue.tier, soloQueue.rank, soloQueue.leaguePoints),
      });
      await gameEvents.afterLeagueUpdate({ player, solo: soloQueue, flex: flexQueue || null });
    } catch (error) {
      recordApiError("riot", error);
      console.error(`❌ Failed to update ${player.riot_id}#${player.tag}`);

      if (error.response) {
        console.error(`Riot API status: ${error.response.status}`);
      } else {
        console.error(error.message);
      }
    }
  }

  await lpRace.recordBaselines("LOL", baselines).catch((error) =>
    console.error("Could not record weekly LP baselines:", error.message),
  );
  recordRefresh("league", { startedAt, players: players.length });
}

// Moves the "previous refresh" order forward so dashboard arrows show movement
// since the last periodic refresh.
async function advanceLeagueMovement() {
  const allPlayers = await db.prepare("SELECT * FROM players").all();
  movement.advance("lol:SOLO", sortPlayers([...allPlayers]).map((p) => p.discord_id));
  const flexSorted = [...allPlayers].sort((a, b) =>
    (leagueScore(b.flex_tier, b.flex_rank, b.flex_league_points) ?? -1) -
    (leagueScore(a.flex_tier, a.flex_rank, a.flex_league_points) ?? -1),
  );
  movement.advance("lol:FLEX", flexSorted.map((p) => p.discord_id));
}

// ============================================================
// FULL REFRESH
// ============================================================

const refreshDashboard = singleFlight("League leaderboard refresh", async () => {
  console.log("======================================");
  console.log("🔄 Starting leaderboard refresh...");

  await updateAllPlayers();
  await advanceLeagueMovement().catch((error) =>
    console.error("Could not track leaderboard movement:", error.message),
  );
  await updateDashboard();

  console.log("✅ Leaderboard refresh completed.");
  console.log("======================================");
});

// ============================================================
// VALORANT DASHBOARD & UPDATER
// ============================================================

const persistValorantDashboard = createValorantDashboardUpdater({
  client,
  db,
  channelId: VALORANT_LEADERBOARD_CHANNEL_ID,
  linkChannelId: VALORANT_LINK_CHANNEL_ID,
  getMovement: (players) => movement.deltas("val", players.map((p) => p.discord_id)),
});

async function updateAllValorantPlayers() {
  let players = [];
  try {
    players = await db.prepare("SELECT * FROM valorant_players").all();
  } catch (err) {
    console.error("Failed to read valorant_players:", err.message);
    return;
  }

  if (players.length === 0) return;
  console.log(`🔄 Updating ${players.length} Valorant player(s)...`);

  const updateStmt = db.prepare(`
    UPDATE valorant_players
    SET
      riot_id = ?,
      tag = ?,
      region = ?,
      account_level = ?,
      current_tier = ?,
      tier_name = ?,
      ranking_in_tier = ?,
      elo = ?,
      wins = ?,
      number_of_games = ?,
      card_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE discord_id = ?
  `);

  const guild = (process.env.DISCORD_GUILD_ID && client.guilds.cache.get(process.env.DISCORD_GUILD_ID)) || client.guilds.cache.first();

  const startedAt = Date.now();
  const baselines = [];
  for (const player of players) {
    try {
      const data = await fetchValorantPlayerData(player.riot_id, player.tag, player.region);
      await updateStmt.run(
        data.riot_id,
        data.tag,
        data.region,
        // The account lookup can fail on its own; keep the stored level and card.
        data.account_level || player.account_level || 0,
        data.current_tier,
        data.tier_name,
        data.ranking_in_tier,
        data.elo,
        data.wins,
        data.number_of_games,
        data.card_url || player.card_url || null,
        player.discord_id
      );

      console.log(`✅ Valorant: ${player.riot_id}#${player.tag} → ${data.tier_name} (${data.ranking_in_tier} RR)`);

      if (guild) {
        const member = await fetchMember(guild, player.discord_id);
        if (!member) continue;
        await syncValorantRankRole(member, data.tier_name);
      }

      if (data.current_tier >= 3) baselines.push({ discord_id: player.discord_id, score: data.elo });
      await gameEvents.afterValorantUpdate({ player, data });
    } catch (err) {
      recordApiError("henrik", err);
      console.error(`❌ Failed to update Valorant player ${player.riot_id}#${player.tag}:`, err.message);
    }
  }

  await lpRace.recordBaselines("VAL", baselines).catch((error) =>
    console.error("Could not record weekly RR baselines:", error.message),
  );
  recordRefresh("valorant", { startedAt, players: players.length });
}

const refreshValorantDashboard = singleFlight("Valorant leaderboard refresh", async () => {
  await updateAllValorantPlayers();
  try {
    const ordered = await db.prepare("SELECT discord_id FROM valorant_players ORDER BY elo DESC, ranking_in_tier DESC").all();
    movement.advance("val", ordered.map((p) => p.discord_id));
  } catch (error) {
    console.error("Could not track Valorant leaderboard movement:", error.message);
  }
  await persistValorantDashboard();
});

// Both games record their weekly baselines during refresh; the Monday post
// needs both, so it runs after both refreshes settle.
function refreshAll(label) {
  return Promise.allSettled([
    refreshDashboard().catch((err) => console.error(`❌ ${label} League leaderboard refresh failed:`, err)),
    refreshValorantDashboard().catch((err) => console.error(`❌ ${label} Valorant leaderboard refresh failed:`, err)),
  ]).then(() =>
    lpRace.maybePost().catch((err) => console.error("❌ Weekly LP race post failed:", err)),
  );
}

// ============================================================
// LINK PANEL
// ============================================================

function buildLinkPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎮 Link your League of Legends account")
    .setDescription(
      [
        "Connect your Riot account to join the server leaderboard.",
        "",
        "• Your **rank, LP, wins and losses** are tracked automatically.",
        "• You will automatically receive your **Rank Role** on the server.",
        "• Select your **primary lane** below to receive your Lane Role and icon.",
        "",
        "Click the button below to link your account, and choose your lane!",
      ].join("\n"),
    )
    .setFooter({
      text: "League of Legends • Account Linking",
    });

  const button = new ButtonBuilder()
    .setCustomId("link_league_account")
    .setLabel("Link League Account")
    .setEmoji("🔗")
    .setStyle(ButtonStyle.Primary);

  const buttonRow = new ActionRowBuilder().addComponents(button);
  const selectRow = new ActionRowBuilder().addComponents(buildLaneSelectMenu());

  return {
    embeds: [embed],
    components: [buttonRow, selectRow],
  };
}

// ============================================================
// BOT READY
// ============================================================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Initialize League of Legends patch notes announcer immediately.
  // A throw here would be an unhandled rejection from this async listener.
  try {
    initPatchNotesPoster(client, db, { channelId: PATCH_NOTES_CHANNEL_ID });
  } catch (err) {
    console.error("❌ Patch notes poster failed to start:", err);
  }

  // Initial leaderboard refreshes, then every 5 minutes
  refreshAll("Initial");
  setInterval(() => refreshAll("Periodic"), DASHBOARD_REFRESH_INTERVAL);

  liveGames.start();
});

// ============================================================
// MEMBER EVENTS (opt-in: needs the Server Members intent)
// ============================================================

if (MEMBER_EVENTS_ENABLED) {
  client.on("guildMemberAdd", (member) => {
    sendWelcome(client, member).catch((error) =>
      console.error("Could not send welcome message:", error.message),
    );
  });
  client.on("guildMemberRemove", (member) => {
    if (!isManagedGuild(client, member.guild)) return;
    removeDeparted(db, member.id, "left the server")
      .then(() => Promise.allSettled([updateDashboard(), persistValorantDashboard()]))
      .catch((error) => console.error("Could not clean up departed member:", error.message));
  });
}

// ============================================================
// SLASH COMMANDS
// ============================================================

async function handleChatCommand(interaction) {
  switch (interaction.commandName) {
    case "profile":
      return handleProfileCommand(interaction, db);
    case "mastery":
      return mastery.handleCommand(interaction);
    case "inhouse":
      return inhouse.handleCommand(interaction);
    case "lfg":
      return lfg.handleCommand(interaction);
    case "status":
      return handleStatusCommand(interaction, {
        client,
        db,
        memberEventsEnabled: MEMBER_EVENTS_ENABLED,
        liveWatcher: liveGames,
      });
    case "welcome-preview":
      return interaction.reply({
        ...buildWelcomeMessage(interaction.member),
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    default:
      return interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
  }
}

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
  if (interaction.isChatInputCommand?.()) {
    await handleChatCommand(interaction);
    return;
  }
  if (
    interaction.isButton?.() &&
    ((await liveGames.handleInteraction(interaction)) ||
      (await inhouse.handleButton(interaction)) ||
      (await lfg.handleButton(interaction)))
  ) {
    return;
  }

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
      new ActionRowBuilder().addComponents(regionInput),
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
      flags: MessageFlags.Ephemeral,
    });

    try {
      const riotId = interaction.fields.getTextInputValue("riot_id").trim();

      const tag = interaction.fields.getTextInputValue("tag").trim();

      const regionInput = interaction.fields
        .getTextInputValue("region")
        .trim()
        .toUpperCase();

      const region = regionMap[regionInput];

      if (!region) {
        await interaction.editReply({
          content:
            "❌ Invalid region. Please use **EUW, EUNE, NA, KR, BR, TR, LAN, LAS, OCE or JP**.",
        });

        return;
      }

      console.log(
        `🔎 Linking ${riotId}#${tag} (${regionInput}) for ${interaction.user.tag}`,
      );

      // Get Riot account
      const account = await getRiotAccount(riotId, tag, region);

      const puuid = account.puuid;

      // Get summoner
      const summoner = await getSummoner(puuid, region);

      // Get ranked data
      const rankedEntries = await getRanked(puuid, region, { priority: true });

      const soloQueue = rankedEntries.find(
        (entry) => entry.queueType === "RANKED_SOLO_5x5",
      );

      const existingPlayer = await db
        .prepare(
          `
                SELECT discord_id
                FROM players
                WHERE puuid = ?
            `,
        )
        .get(puuid);

      if (existingPlayer && existingPlayer.discord_id !== interaction.user.id) {
        await interaction.editReply({
          content:
            "❌ **This League account is already linked to another Discord account.**",
        });

        return;
      }

      const tier = soloQueue ? soloQueue.tier : "UNRANKED";

      const rank = soloQueue ? soloQueue.rank : "";

      const leaguePoints = soloQueue ? soloQueue.leaguePoints : 0;

      const wins = soloQueue ? soloQueue.wins : 0;

      const losses = soloQueue ? soloQueue.losses : 0;

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

      await savePlayer.run(
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
        losses,
      );

      let member = interaction.member;
      if ((!member || !member.roles) && interaction.guild) {
        try {
          member = await interaction.guild.members.fetch(interaction.user.id);
        } catch (err) {
          console.error("Could not fetch guild member for rank role assignment:", err.message);
        }
      }

      let assignedRole = null;
      if (member) {
        await syncLeagueGameRole(member);
        assignedRole = await syncRankRole(member, tier);
      }

      // Check if user already has a lane in DB or lane role on Discord
      const existingRecord = await db
        .prepare("SELECT lane FROM players WHERE discord_id = ?")
        .get(interaction.user.id);

      let currentLane = existingRecord?.lane || null;
      if (!currentLane && member && interaction.guild) {
        for (const laneKey of Object.keys(LANES)) {
          const role = findLaneRole(interaction.guild, laneKey);
          if (role && member.roles.cache.has(role.id)) {
            currentLane = laneKey;
            break;
          }
        }
      }

      let assignedLaneRole = null;
      if (currentLane && member) {
        assignedLaneRole = await syncLaneRole(member, currentLane);
        await db
          .prepare("UPDATE players SET lane = ? WHERE discord_id = ?")
          .run(currentLane, interaction.user.id);
      }

      const winRate = getWinRate(wins, losses);

      const replyLines = [
        "✅ **League account linked successfully!**",
        "",
        `🎮 **${riotId}#${tag}**`,
        `🏅 **${tier} ${rank}** — ${leaguePoints} LP`,
      ];

      if (assignedRole) {
        replyLines.push(`🏷️ **Rank Role:** ${assignedRole.name}`);
      }

      if (assignedLaneRole && currentLane) {
        const laneObj = LANES[currentLane];
        const emojiStr = laneObj ? `<:${laneObj.emojiName}:${laneObj.emojiId}> ` : "";
        replyLines.push(`🛡️ **Lane Role:** ${emojiStr}${assignedLaneRole.name}`);
      }

      replyLines.push(
        `📊 **${wins}W - ${losses}L** — ${winRate}% WR`,
        "",
        "🛡️ **Select which lane you play below to choose/update your lane:**",
      );

      const laneSelectRow = new ActionRowBuilder().addComponents(
        buildLaneSelectMenu(),
      );

      await interaction.editReply({
        content: replyLines.join("\n"),
        components: [laneSelectRow],
      });

      // Immediately update dashboard
      await updateDashboard();
    } catch (error) {
      console.error("❌ League account linking failed:");

      if (error.response) {
        console.error(`Riot API status: ${error.response.status}`);
        console.error(error.response.data);
      } else {
        console.error(error);
      }

      let message = "❌ **Could not verify your League account.**";

      if (error.response && error.response.status === 404) {
        message +=
          "\n\nMake sure your **Riot ID, Tag and Region** are correct.";
      } else if (
        error.response &&
        (error.response.status === 401 || error.response.status === 403)
      ) {
        message += "\n\nThe Riot API key may be missing, invalid or expired.";
      } else if (error.response && error.response.status === 429) {
        message += "\n\nRiot API rate limit reached. Please try again later.";
      }

      await interaction.editReply({
        content: message,
      });
    }

    return;
  }

  // ========================================================
  // LANE SELECT MENU
  // ========================================================

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "select_lane"
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selectedLane = interaction.values[0];
    const laneInfo = LANES[selectedLane];

    let member = interaction.member;
    if ((!member || !member.roles) && interaction.guild) {
      try {
        member = await interaction.guild.members.fetch(interaction.user.id);
      } catch (err) {
        console.error(
          "Could not fetch guild member for lane role:",
          err.message,
        );
      }
    }

    let assignedRole = null;
    if (member) {
      assignedRole = await syncLaneRole(member, selectedLane);
    }

    const player = await db
      .prepare("SELECT * FROM players WHERE discord_id = ?")
      .get(interaction.user.id);

    if (player) {
      await db
        .prepare("UPDATE players SET lane = ? WHERE discord_id = ?")
        .run(selectedLane, interaction.user.id);

      await updateDashboard();
    }

    const roleName = assignedRole
      ? ` and received the **${assignedRole.name}** role`
      : "";
    const emojiStr = laneInfo
      ? `<:${laneInfo.emojiName}:${laneInfo.emojiId}>`
      : "🛡️";

    const extraNotice = player
      ? " Your leaderboard icon has been updated."
      : "\n💡 *Link your League account above whenever you want your rank tracked on the leaderboard!*";

    await interaction.editReply({
      content: `✅ **Lane selected!** You are now set as ${emojiStr} **${laneInfo?.label || selectedLane}**${roleName}.${extraNotice}`,
      flags: MessageFlags.Ephemeral,
    });

    return;
  }

  // ========================================================
  // VALORANT LINK BUTTON
  // ========================================================

  if (
    interaction.isButton() &&
    interaction.customId === "link_valorant_account"
  ) {
    const modal = new ModalBuilder()
      .setCustomId("link_valorant_modal")
      .setTitle("Link VALORANT Account");

    const riotIdInput = new TextInputBuilder()
      .setCustomId("valorant_riot_id")
      .setLabel("Riot ID (Name)")
      .setPlaceholder("Jumia Caps")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const tagInput = new TextInputBuilder()
      .setCustomId("valorant_tag")
      .setLabel("Tag")
      .setPlaceholder("9929")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const regionInput = new TextInputBuilder()
      .setCustomId("valorant_region")
      .setLabel("Region (eu, na, ap, kr, latam, br)")
      .setValue("eu")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(riotIdInput),
      new ActionRowBuilder().addComponents(tagInput),
      new ActionRowBuilder().addComponents(regionInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // ========================================================
  // VALORANT LINK MODAL SUBMIT
  // ========================================================

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "link_valorant_modal"
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const riotId = interaction.fields.getTextInputValue("valorant_riot_id").trim();
    const tag = interaction.fields.getTextInputValue("valorant_tag").trim().replace(/^#/, "");
    const region = interaction.fields.getTextInputValue("valorant_region").trim().toLowerCase();

    try {
      const data = await fetchValorantPlayerData(riotId, tag, region, { priority: true });

      const savePlayer = db.prepare(`
        INSERT INTO valorant_players (
          discord_id, puuid, riot_id, tag, region, account_level,
          current_tier, tier_name, ranking_in_tier, elo, wins, number_of_games, card_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET
          puuid = excluded.puuid,
          riot_id = excluded.riot_id,
          tag = excluded.tag,
          region = excluded.region,
          account_level = excluded.account_level,
          current_tier = excluded.current_tier,
          tier_name = excluded.tier_name,
          ranking_in_tier = excluded.ranking_in_tier,
          elo = excluded.elo,
          wins = excluded.wins,
          number_of_games = excluded.number_of_games,
          card_url = excluded.card_url
      `);

      await savePlayer.run(
        interaction.user.id,
        data.puuid,
        data.riot_id,
        data.tag,
        data.region,
        data.account_level,
        data.current_tier,
        data.tier_name,
        data.ranking_in_tier,
        data.elo,
        data.wins,
        data.number_of_games,
        data.card_url
      );

      console.log(`✅ Valorant linked: ${data.riot_id}#${data.tag} (${data.tier_name}) for user ${interaction.user.tag}`);

      let member = interaction.member;
      if ((!member || !member.roles) && interaction.guild) {
        member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      }
      if (member) {
        await syncValorantRankRole(member, data.tier_name);
      }

      await persistValorantDashboard();

      const winRate = data.number_of_games > 0
        ? `${((data.wins / data.number_of_games) * 100).toFixed(1)}%`
        : "—";

      const embed = new EmbedBuilder()
        .setTitle("✅ VALORANT Account Linked!")
        .setColor(0xFD4556)
        .setDescription([
          `Your Riot account **${escapeMarkdown(data.riot_id)}#${escapeMarkdown(data.tag)}** has been connected.`,
          "",
          `• **Competitive Rank:** \`${data.tier_name}\` (${data.ranking_in_tier} RR)`,
          `• **Rating / Elo:** \`${data.elo}\``,
          `• **Win Rate:** \`${winRate}\` (${data.wins}W / ${data.number_of_games}G)`,
          `• **Account Level:** \`${data.account_level}\``,
          "",
          "You have received your **Rank Role** and the **Valorant Gamer Role**!",
          "Choose your **Agent Class / Role** below to set your icon on the leaderboard."
        ].join("\n"))
        .setThumbnail(data.card_url || null)
        .setFooter({ text: "VALORANT • Macro Diff" });

      const roleSelectRow = new ActionRowBuilder().addComponents(buildValorantRoleSelectMenu(interaction.guild?.emojis?.cache));

      await interaction.editReply({
        embeds: [embed],
        components: [roleSelectRow]
      });
    } catch (error) {
      console.error("❌ Valorant account linking failed:", error.message);
      await interaction.editReply({
        content: `❌ **Could not link your Valorant account.**\n\n${error.message || "Please verify your Riot ID, Tag, and Region."}`
      });
    }
    return;
  }

  // ========================================================
  // VALORANT AGENT ROLE SELECT
  // ========================================================

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "select_valorant_role"
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const selectedRole = interaction.values[0];
    const roleInfo = VALORANT_AGENT_ROLES[selectedRole];

    let member = interaction.member;
    if ((!member || !member.roles) && interaction.guild) {
      member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    }
    if (member) {
      await syncValorantAgentRole(member, selectedRole);
    }

    try {
      await db
        .prepare("UPDATE valorant_players SET agent_role = ? WHERE discord_id = ?")
        .run(selectedRole, interaction.user.id);
      await persistValorantDashboard();
    } catch (err) {
      console.warn("Could not save agent_role to valorant_players:", err.message);
    }

    await interaction.editReply({
      content: `✅ **Agent Role Selected!** You are now set as ${roleInfo?.emoji || "🎯"} **${roleInfo?.label || selectedRole}**. Your icon has been updated on the leaderboard!`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  } catch (err) {
    console.error("❌ Interaction failed:", { customId: interaction.customId, code: err.code, name: err.name, message: err.message });
    // Try to let the user know something went wrong (best effort)
    try {
      const msg = { content: "⚠️ Something went wrong. Please try again in a moment.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch {
      // Silently ignore if we can't reply (e.g. showModal already sent)
    }
  }
});

// ============================================================
// LOGIN
// ============================================================

db.ready
  .then(() =>
    db.acquireInstanceLock?.({
      onLost: (error) => {
        console.error(
          "❌ Lost the single-instance lock (another bot copy may be running); exiting:",
          error.message,
        );
        client.destroy();
        setTimeout(() => process.exit(1), 1000);
      },
    }),
  )
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .then(() => {
    console.log("🔐 Login request sent");
  })
  .catch((error) => {
    console.error("❌ Database initialization or Discord login failed:");
    console.error(error);

    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
