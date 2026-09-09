require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} = require("discord.js");

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = "1547347832611278909";

client.once("ready", async () => {

    console.log(`✅ Logged in as ${client.user.tag}`);

    try {

        const channel = await client.channels.fetch(CHANNEL_ID);

        if (!channel) {
            console.log("❌ Channel not found.");
            process.exit(1);
        }

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

        await channel.send({
            embeds: [embed],
            components: [row]
        });

        console.log("✅ Link panel sent successfully!");

    } catch (error) {

        console.error("❌ Failed to send link panel:");
        console.error(error);

    }

    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);