const axios = require("axios");
const { createRateLimiter } = require("./rate-limiter");

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

// Match-v5 uses regional routing; OCE matches live on "sea", not "asia".
const matchUrls = { ...accountUrls };

// Default 1.25s gap = 96 requests / 2 min, under a development key's 100 / 2 min.
// Production keys can lower it with RIOT_MIN_GAP_MS.
const schedule = createRateLimiter(() => Number(process.env.RIOT_MIN_GAP_MS ?? 1250));

async function riotRequest(url, { priority = false } = {}) {
    const response = await schedule(() => axios.get(url, {
        headers: {
            "X-Riot-Token": process.env.RIOT_API_KEY
        },
        // Without a timeout one hung request stalls the whole refresh loop.
        timeout: 10000
    }), { priority });

    return response.data;
}

function baseUrl(table, region) {
    const url = table[region];
    if (!url) {
        throw new Error(`Unsupported region: ${region}`);
    }
    return url;
}

// Riot ID → PUUID
async function getRiotAccount(riotId, tag, region) {
    return riotRequest(
        `${baseUrl(accountUrls, region)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tag)}`,
        { priority: true }
    );
}

// PUUID → Summoner information
async function getSummoner(puuid, region) {
    return riotRequest(
        `${baseUrl(platformUrls, region)}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
        { priority: true }
    );
}

// PUUID → Ranked information
async function getRanked(puuid, region, options) {
    return riotRequest(
        `${baseUrl(platformUrls, region)}/lol/league/v4/entries/by-puuid/${puuid}`,
        options
    );
}

// PUUID → current game, or null when the player is not in a game.
async function getActiveGame(puuid, region) {
    try {
        return await riotRequest(`${baseUrl(platformUrls, region)}/lol/spectator/v5/active-games/by-summoner/${puuid}`);
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

// PUUID → most recent ranked match ids (newest first).
async function getRankedMatchIds(puuid, region, count = 1) {
    return riotRequest(
        `${baseUrl(matchUrls, region)}/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=${count}`
    );
}

async function getMatch(matchId, region) {
    return riotRequest(`${baseUrl(matchUrls, region)}/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
}

async function getTopMastery(puuid, region, count = 3, options) {
    return riotRequest(
        `${baseUrl(platformUrls, region)}/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=${count}`,
        options
    );
}

// Data Dragon is Riot's public static CDN (no key, no rate limit), so it is
// fetched directly and cached for 6 hours.
let championCache = null;
async function getChampionData() {
    if (championCache && Date.now() - championCache.loadedAt < 6 * 60 * 60 * 1000) return championCache;
    const versions = (await axios.get("https://ddragon.leagueoflegends.com/api/versions.json", { timeout: 10000 })).data;
    const version = versions[0];
    const champions = (await axios.get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, { timeout: 10000 })).data.data;
    const byKey = new Map(Object.values(champions).map(champion => [Number(champion.key), { id: champion.id, name: champion.name }]));
    championCache = { version, byKey, loadedAt: Date.now() };
    return championCache;
}

async function getChampion(championId) {
    try {
        const { version, byKey } = await getChampionData();
        const champion = byKey.get(Number(championId));
        if (!champion) return { name: `Champion ${championId}`, icon: null };
        return { name: champion.name, icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.id}.png` };
    } catch {
        return { name: `Champion ${championId}`, icon: null };
    }
}

module.exports = {
    getRiotAccount,
    getSummoner,
    getRanked,
    getActiveGame,
    getRankedMatchIds,
    getMatch,
    getTopMastery,
    getChampion
};
