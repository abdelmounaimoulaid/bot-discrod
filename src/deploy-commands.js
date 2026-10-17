require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { COMMANDS } = require("./commands");

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function deploy() {
  try {
    console.log(`⏳ Registering ${COMMANDS.length} slash commands (${COMMANDS.map((c) => `/${c.name}`).join(", ")})...`);

    // Guild commands update instantly; global ones can take an hour to appear.
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: COMMANDS }
    );

    // Clear any old global commands so nothing shows up twice.
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: [] }
    );

    console.log("✅ Slash commands registered successfully!");
  } catch (error) {
    console.error("❌ Failed to register slash commands:", error);
    process.exitCode = 1;
  }
}

deploy();
