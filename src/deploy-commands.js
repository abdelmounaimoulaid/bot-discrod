require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const linkCommand = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Riot account")

  .addStringOption((option) =>
    option
      .setName("riot_id")
      .setDescription("Your Riot ID, e.g. Faker")
      .setRequired(true)
  )

  .addStringOption((option) =>
    option
      .setName("tag")
      .setDescription("Your Riot tag, e.g. KR1")
      .setRequired(true)
  )

  .addStringOption((option) =>
    option
      .setName("region")
      .setDescription("Your Riot region")
      .setRequired(true)
      .addChoices(
        { name: "EUW", value: "euw1" },
        { name: "EUNE", value: "eun1" },
        { name: "NA", value: "na1" },
        { name: "KR", value: "kr" },
        { name: "BR", value: "br1" },
        { name: "TR", value: "tr1" },
        { name: "LAN", value: "la1" },
        { name: "LAS", value: "la2" },
        { name: "OCE", value: "oc1" },
        { name: "JP", value: "jp1" }
      )
  );

const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the League of Legends leaderboard");

const commands = [
  linkCommand.toJSON(),
  leaderboardCommand.toJSON()
];

const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

async function deploy() {
  try {
    console.log("⏳ Deploying /link and /leaderboard...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log("✅ /link deployed!");
    console.log("✅ /leaderboard deployed!");
  } catch (error) {
    console.error(error);
  }
}

deploy();