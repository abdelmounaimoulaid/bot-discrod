const axios = require("axios");

const platformUrls = {
    euw1: "https://euw1.api.riotgames.com",
    eun1: "https://eun1.api.riotgames.com",
    na1: "https://na1.api.riotgames.com",
    kr: "https://kr.api.riotgames.com",
    br1: "https://br1.api.riotgames.com",
    tr1: "https://tr1.api.riotgames.com",
    la1: "https://la1.api.riotgames.com",
    la2: "https://la2.api.riotgames.com",
    oc1: "https://oc1.api.riotgames.com",
    jp1: "https://jp1.api.riotgames.com"
};

const accountUrls = {
    euw1: "https://europe.api.riotgames.com",
    eun1: "https://europe.api.riotgames.com",
    tr1: "https://europe.api.riotgames.com",

    na1: "https://americas.api.riotgames.com",
    br1: "https://americas.api.riotgames.com",
    la1: "https://americas.api.riotgames.com",
    la2: "https://americas.api.riotgames.com",

    kr: "https://asia.api.riotgames.com",
    jp1: "https://asia.api.riotgames.com",

    oc1: "https://sea.api.riotgames.com"
};

async function riotRequest(url) {
    const response = await axios.get(url, {
        headers: {
            "X-Riot-Token": process.env.RIOT_API_KEY
        }
    });

    return response.data;
}

// Riot ID → PUUID
async function getRiotAccount(riotId, tag, region) {

    const baseUrl = accountUrls[region];

    if (!baseUrl) {
        throw new Error(`Unsupported region: ${region}`);
    }

    return riotRequest(
        `${baseUrl}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tag)}`
    );
}

// PUUID → Summoner information
async function getSummoner(puuid, region) {

    const baseUrl = platformUrls[region];

    if (!baseUrl) {
        throw new Error(`Unsupported region: ${region}`);
    }

    return riotRequest(
        `${baseUrl}/lol/summoner/v4/summoners/by-puuid/${puuid}`
    );
}

// PUUID → Ranked information
async function getRanked(puuid, region) {

    const baseUrl = platformUrls[region];

    if (!baseUrl) {
        throw new Error(`Unsupported region: ${region}`);
    }

    return riotRequest(
        `${baseUrl}/lol/league/v4/entries/by-puuid/${puuid}`
    );
}

module.exports = {
    getRiotAccount,
    getSummoner,
    getRanked
};