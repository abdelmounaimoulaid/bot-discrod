const axios = require('axios');
const { createRateLimiter } = require('./rate-limiter');

const BASE_URL = 'https://api.henrikdev.xyz/valorant';

const REGION_MAP = {
    eu: 'eu',
    euw: 'eu',
    eun: 'eu',
    eune: 'eu',
    na: 'na',
    br: 'br',
    latam: 'latam',
    lan: 'latam',
    las: 'latam',
    ap: 'ap',
    sea: 'ap',
    oce: 'ap',
    kr: 'kr'
};

function normalizeRegion(region = 'eu') {
    const clean = region.toLowerCase().trim();
    return REGION_MAP[clean] || 'eu';
}

// HenrikDev basic keys allow 30 requests / minute; 2.1s spacing stays under it.
const schedule = createRateLimiter(() => Number(process.env.HENRIK_MIN_GAP_MS ?? 2100));

function henrikGet(url, priority) {
    return schedule(() => axios.get(url, { headers: getHeaders(), timeout: 10000 }), { priority });
}

function getHeaders() {
    const key = process.env.VALORANT_API_KEY;
    if (!key) throw new Error('Missing VALORANT_API_KEY in environment variables.');
    return {
        Authorization: key,
        'User-Agent': 'DiscordBot/ValorantLeaderboard'
    };
}

async function getValorantAccount(name, tag, { priority = false } = {}) {
    const url = `${BASE_URL}/v1/account/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`;
    const res = await henrikGet(url, priority);
    return res.data?.data;
}

async function getValorantMmr(region, name, tag, { priority = false } = {}) {
    const normRegion = normalizeRegion(region);
    const url = `${BASE_URL}/v2/mmr/${normRegion}/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`;
    const res = await henrikGet(url, priority);
    return res.data?.data;
}

// Most recent competitive matches, newest first.
async function getValorantRecentMatches(region, name, tag, size = 1, { priority = false } = {}) {
    const url = `${BASE_URL}/v3/matches/${normalizeRegion(region)}/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}?mode=competitive&size=${size}`;
    const res = await henrikGet(url, priority);
    return res.data?.data || [];
}

async function fetchValorantPlayerData(name, tag, region = 'eu', { priority = false } = {}) {
    const normRegion = normalizeRegion(region);
    let mmrError = null;
    const [account, mmr] = await Promise.all([
        getValorantAccount(name, tag, { priority }).catch(() => null),
        getValorantMmr(normRegion, name, tag, { priority }).catch(error => { mmrError = error; return null; })
    ]);

    // A 404 means the player has no rank data; anything else (429, 5xx, timeout)
    // means the rank is unknown. Never report "Unrated" for an API failure, or the
    // periodic refresh strips the player's real rank role until the next run.
    const mmrStatus = mmrError?.response?.status;
    if (mmrError && mmrStatus !== 404) {
        throw new Error(`Could not load the Valorant rank for ${name}#${tag} right now (API ${mmrStatus || mmrError.code || 'error'}). Please try again in a minute.`);
    }

    if (!account && !mmr) {
        throw new Error(`Player ${name}#${tag} not found in region ${normRegion}. Please check your Riot ID and Tag.`);
    }

    const current = mmr?.current_data;
    const puuid = account?.puuid || mmr?.puuid || '';
    const riotId = account?.name || mmr?.name || name;
    const playerTag = account?.tag || mmr?.tag || tag;
    const accountLevel = account?.account_level || 0;
    const cardUrl = account?.card?.small || account?.card?.wide || null;

    const currentTier = current?.currenttier || 0;
    const tierName = current?.currenttierpatched || 'Unrated';
    const rankingInTier = current?.ranking_in_tier ?? 0;
    const elo = current?.elo ?? 0;

    // Find most recent act with game statistics
    let wins = 0;
    let numberOfGames = 0;
    if (mmr?.by_season) {
        const seasons = Object.keys(mmr.by_season);
        for (let i = seasons.length - 1; i >= 0; i--) {
            const seasonData = mmr.by_season[seasons[i]];
            if (seasonData?.number_of_games > 0) {
                wins = seasonData.wins || 0;
                numberOfGames = seasonData.number_of_games || 0;
                break;
            }
        }
    }

    return {
        puuid,
        riot_id: riotId,
        tag: playerTag,
        region: normRegion,
        account_level: accountLevel,
        card_url: cardUrl,
        current_tier: currentTier,
        tier_name: tierName,
        ranking_in_tier: rankingInTier,
        elo,
        wins,
        number_of_games: numberOfGames,
        // Not stored: used for rank-up and match recap cards.
        rank_image: current?.images?.small || null,
        last_rr_change: current?.mmr_change_to_last_game ?? null
    };
}

module.exports = {
    normalizeRegion,
    getValorantAccount,
    getValorantMmr,
    getValorantRecentMatches,
    fetchValorantPlayerData
};
