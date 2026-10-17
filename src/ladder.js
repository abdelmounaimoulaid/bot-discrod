// Shared rank math for leaderboards, rank-up announcements, the weekly LP race,
// inhouse balancing and profile cards.

const LOL_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_DIVISIONS = ['IV', 'III', 'II', 'I'];
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

// One point per LP: every division is 100 LP, so IRON IV 0 LP = 0, GOLD IV 0 LP = 1200,
// and Master+ (no divisions) starts at 2800 and keeps counting LP.
function leagueScore(tier, rank, lp = 0) {
    const tierIndex = LOL_TIERS.indexOf((tier || '').toUpperCase());
    if (tierIndex < 0) return null;
    if (APEX_TIERS.has(LOL_TIERS[tierIndex])) return 2800 + (lp || 0);
    const division = Math.max(0, LOL_DIVISIONS.indexOf(rank || 'IV'));
    return tierIndex * 400 + division * 100 + (lp || 0);
}

// Division-level position, ignoring LP: a promotion is a move to a higher one.
function leagueStep(tier, rank) {
    const tierIndex = LOL_TIERS.indexOf((tier || '').toUpperCase());
    if (tierIndex < 0) return -1;
    if (APEX_TIERS.has(LOL_TIERS[tierIndex])) return 28 + (tierIndex - LOL_TIERS.indexOf('MASTER'));
    return tierIndex * 4 + Math.max(0, LOL_DIVISIONS.indexOf(rank || 'IV'));
}

function isLeaguePromotion(oldTier, oldRank, newTier, newRank) {
    const before = leagueStep(oldTier, oldRank);
    const after = leagueStep(newTier, newRank);
    return before >= 0 && after > before;
}

function leagueLabel(tier, rank, lp) {
    const upper = (tier || 'UNRANKED').toUpperCase();
    if (upper === 'UNRANKED' || LOL_TIERS.indexOf(upper) < 0) return 'Unranked';
    const name = upper.charAt(0) + upper.slice(1).toLowerCase();
    const division = APEX_TIERS.has(upper) ? '' : ` ${rank || ''}`.trimEnd();
    return `${name}${division}${lp === undefined ? '' : ` • ${lp} LP`}`;
}

// Inverse of leagueScore, for showing a team's average rank.
function scoreToLabel(score) {
    if (score === null || score === undefined) return 'Unranked';
    if (score >= 2800) return `Master+ • ${Math.round(score - 2800)} LP`;
    const clamped = Math.max(0, score);
    const tier = LOL_TIERS[Math.floor(clamped / 400)];
    const division = LOL_DIVISIONS[Math.floor((clamped % 400) / 100)];
    return leagueLabel(tier, division, Math.round(clamped % 100));
}

function leagueEmblemUrl(tier) {
    const upper = (tier || '').toUpperCase();
    if (LOL_TIERS.indexOf(upper) < 0) return null;
    return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${upper.toLowerCase()}.png`;
}

// Henrik's "currenttier" is 3 (Iron 1) … 27 (Radiant); 0–2 are unrated.
function isValorantPromotion(oldTier, newTier) {
    return (oldTier || 0) >= 3 && (newTier || 0) > (oldTier || 0);
}

function valorantRankIconUrl(currentTier) {
    if (!currentTier || currentTier < 3) return null;
    return `https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/${currentTier}/largeicon.png`;
}

function progressBar(value, max = 100, length = 5) {
    const filled = Math.max(0, Math.min(length, Math.round((value / max) * length)));
    return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

// Monday 00:00 UTC of the week containing `date`, as YYYY-MM-DD.
function weekKey(date = new Date()) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return day.toISOString().slice(0, 10);
}

function previousWeekKey(key) {
    const day = new Date(`${key}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 7);
    return day.toISOString().slice(0, 10);
}

module.exports = {
    LOL_TIERS,
    LOL_DIVISIONS,
    APEX_TIERS,
    leagueScore,
    isLeaguePromotion,
    leagueLabel,
    scoreToLabel,
    leagueEmblemUrl,
    isValorantPromotion,
    valorantRankIconUrl,
    progressBar,
    weekKey,
    previousWeekKey
};
