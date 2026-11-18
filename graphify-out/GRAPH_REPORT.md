# Graph Report - bot discord  (2026-11-18)

## Corpus Check
- 51 files · ~25,736 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 464 nodes · 905 edges · 24 communities (17 shown, 7 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 116 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ca6633c9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- index.js
- Valorant Dashboard
- Interaction Test Harness
- Slash Commands & Lane Roles
- Package Manifest
- Rank Role Mapping
- game-events.js
- Voice Rooms
- MySQL Deployment Docs
- discord.js
- riot.js
- Valorant API Service
- Graphify Tooling Rules
- Health Server
- README
- features.test.js
- profile-card.js
- leagueScore
- fetchMember
- game-roles.js
- sortPlayers
- updateDashboard

## God Nodes (most connected - your core abstractions)
1. `discord.js` - 26 edges
2. `afterLeagueUpdate()` - 13 edges
3. `leagueLabel()` - 12 edges
4. `getFeatureChannel()` - 10 edges
5. `getChampion()` - 10 edges
6. `recordApiError()` - 9 edges
7. `featureChannelId()` - 9 edges
8. `afterValorantUpdate()` - 9 edges
9. `leagueScore()` - 9 edges
10. `riotRequest()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `graphify Skill (/graphify trigger)` --references--> `graphify Knowledge Graph (graphify-out/)`  [INFERRED]
  .claude/CLAUDE.md → CLAUDE.md
- `MySQL Migration Procedure` --references--> `Run Only One Bot Instance`  [INFERRED]
  MYSQL-SETUP.txt → DEPLOY.txt
- `No SQLite Fallback (MySQL config required for login)` --semantically_similar_to--> `MySQL-Only Persistence (SQLite Removed)`  [INFERRED] [semantically similar]
  MYSQL-SETUP.txt → DEPLOY.txt
- `updateAllPlayers()` --calls--> `recordApiError()`  [EXTRACTED]
  src/index.js → src/bot-status.js
- `updateAllValorantPlayers()` --calls--> `recordApiError()`  [EXTRACTED]
  src/index.js → src/bot-status.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **MySQL-backed Hostinger Deployment Flow** — deploy_hostinger_deployment, deploy_mysql_recovery_sql, deploy_environment_variables, mysql_setup_mysql_migration, mysql_setup_mysql_connected_log [INFERRED 0.85]

## Communities (24 total, 7 thin omitted)

### Community 0 - "index.js"
Cohesion: 0.05
Nodes (35): {
  buildDashboardEmbed: renderDashboard,
  createDashboardUpdater,
}, {
  buildLaneSelectMenu,
  syncLaneRole,
  findLaneRole,
  LANES,
}, { buildWelcomeMessage, sendWelcome }, client, {
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
}, { createGameEvents }, { createInhouse }, { createLfg } (+27 more)

### Community 1 - "Valorant Dashboard"
Cohesion: 0.07
Nodes (44): buildDashboardEmbed(), createDashboardUpdater(), syncSingleMessage(), update(), { EmbedBuilder, escapeMarkdown }, LEGACY_TITLES, { movementArrow, placeLabel }, { progressBar } (+36 more)

### Community 2 - "Interaction Test Harness"
Cohesion: 0.07
Nodes (27): mysql2, assert, discord, { EventEmitter }, fs, path, { test }, vm (+19 more)

### Community 3 - "Slash Commands & Lane Roles"
Cohesion: 0.08
Nodes (31): discord.js, COMMANDS, laneChoices, { LANES }, { LOL_TIERS }, { SlashCommandBuilder, PermissionFlagsBits }, tierChoices, { COMMANDS } (+23 more)

### Community 4 - "Package Manifest"
Cohesion: 0.07
Nodes (28): author, dependencies, axios, discord.js, dotenv, mysql2, description, engines (+20 more)

### Community 5 - "Rank Role Mapping"
Cohesion: 0.21
Nodes (13): findRankRole(), findRankRoleByName(), getAllRankRoles(), getTierDisplayName(), RANK_ROLE_IDS, RANK_TIERS, syncRankRole(), assert (+5 more)

### Community 6 - "game-events.js"
Cohesion: 0.07
Nodes (44): apiErrors, recordApiError(), refreshes, snapshot(), startedAt, FEATURE_CHANNELS, featureChannelId(), getFeatureChannel() (+36 more)

### Community 7 - "Voice Rooms"
Cohesion: 0.21
Nodes (10): {
    ChannelType, PermissionFlagsBits: P, PermissionsBitField, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    UserSelectMenuBuilder, MessageFlags
}, panel(), parseLimit(), registerVoiceRooms(), assert, { Collection, PermissionFlagsBits: P, PermissionsBitField }, fixture(), { registerVoiceRooms, parseLimit, TRIGGERS } (+2 more)

### Community 8 - "MySQL Deployment Docs"
Cohesion: 0.21
Nodes (8): Bot Environment Variables (DISCORD_*, RIOT_API_KEY, MYSQL_*), Hostinger Node.js Deployment, mysql-recovery.sql Import, MySQL Tables (players, dashboard_messages, voice_rooms), src/export-mysql.js (SQLite to SQL export), 'MySQL connected; persistent database ready.' startup log, MySQL Migration Procedure, MYSQL_SSL / MYSQL_SSL_CA TLS Option

### Community 9 - "discord.js"
Cohesion: 0.12
Nodes (26): balanceTeams(), createInhouse(), handleButton(), handleCommand(), lobbyPayload(), ratings(), start(), teamField() (+18 more)

### Community 10 - "riot.js"
Cohesion: 0.10
Nodes (37): getRankedForPlayer(), createLiveGameWatcher(), announce(), check(), handleInteraction(), markFinished(), opponentsText(), start() (+29 more)

### Community 11 - "Valorant API Service"
Cohesion: 0.24
Nodes (12): createRateLimiter(), axios, { createRateLimiter }, fetchValorantPlayerData(), getHeaders(), getValorantAccount(), getValorantMmr(), getValorantRecentMatches() (+4 more)

### Community 12 - "Graphify Tooling Rules"
Cohesion: 0.40
Nodes (3): graphify Skill (/graphify trigger), GRAPH_REPORT.md, graphify Knowledge Graph (graphify-out/)

### Community 16 - "features.test.js"
Cohesion: 0.10
Nodes (27): assert, { balanceTeams }, { buildLeagueRecapEmbed, buildRankUpEmbed }, { COMMANDS }, { countAgents }, { createRateLimiter }, { featureChannelId }, { fetchMemberState, isManagedGuild } (+19 more)

### Community 17 - "profile-card.js"
Cohesion: 0.14
Nodes (25): handleChatCommand(), leagueEmblemUrl(), progressBar(), valorantRankIconUrl(), axios, buildProfileEmbed(), drawFitted(), drawPanel() (+17 more)

### Community 18 - "leagueScore"
Cohesion: 0.28
Nodes (9): recordRefresh(), advanceLeagueMovement(), persistValorantDashboard, refreshAll(), refreshDashboard, refreshValorantDashboard, updateAllPlayers(), updateAllValorantPlayers() (+1 more)

### Community 19 - "fetchMember"
Cohesion: 0.60
Nodes (4): fetchMember(), fetchMemberState(), isManagedGuild(), removeDeparted()

## Knowledge Gaps
- **9 isolated node(s):** `dotenv`, `@napi-rs/canvas`, `graphify Skill (/graphify trigger)`, `GRAPH_REPORT.md`, `bot-discrod README` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 227 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `discord.js` connect `Slash Commands & Lane Roles` to `index.js`, `Valorant Dashboard`, `Interaction Test Harness`, `Package Manifest`, `Rank Role Mapping`, `game-events.js`, `Voice Rooms`, `discord.js`, `riot.js`, `features.test.js`, `profile-card.js`?**
  _High betweenness centrality (0.248) - this node is a cross-community bridge._
- **What connects `dotenv`, `@napi-rs/canvas`, `graphify Skill (/graphify trigger)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Why does `axios` connect `Package Manifest` to `profile-card.js`, `riot.js`, `Valorant API Service`, `Valorant Dashboard`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Should `Valorant Dashboard` be split into smaller, more focused modules?**
  _Cohesion score 0.06636500754147813 - nodes in this community are weakly interconnected._
- **Why does `createInhouse()` connect `discord.js` to `index.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Should `Interaction Test Harness` be split into smaller, more focused modules?**
  _Cohesion score 0.06794871794871794 - nodes in this community are weakly interconnected._