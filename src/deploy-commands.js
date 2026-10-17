require("dotenv").config();

const { REST, Routes } = require("discord.js");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function deploy() {
  try {
    console.log("⏳ Clearing unused slash commands (/link, /leaderboard)...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: [] }
    );

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: [] }
    );

    console.log("✅ Unused slash commands cleared successfully!");
  } catch (error) {
    console.error("❌ Failed to clear slash commands:", error);
  }
}

deploy();