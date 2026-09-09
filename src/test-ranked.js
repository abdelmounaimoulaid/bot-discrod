require("dotenv").config();

const { getRanked } = require("./services/riot");

const puuid =
    "emIfAUB8wUJNiC1Q-NjYk6H4ClF0mf4K5Tr7XR7Wl-zUkcPt5OBvVpnXsFpI13Hx4X3cc8bpPR1OdQ";

async function test() {
    try {
        const ranked = await getRanked(puuid, "euw1");

        console.log("✅ Ranked data:");
        console.log(JSON.stringify(ranked, null, 2));

    } catch (error) {
        console.error(
            "❌ Riot error:",
            error.response?.status,
            error.response?.data
        );
    }
}

test();