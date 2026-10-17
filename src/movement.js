// Remembers leaderboard order at each periodic refresh, so arrows show movement
// since the previous refresh (and stay visible until the next one) rather than
// since the last re-render triggered by someone linking an account.
function createMovementTracker() {
    const previous = new Map();
    const current = new Map();

    function advance(key, ids) {
        if (current.has(key)) previous.set(key, current.get(key));
        current.set(key, new Map(ids.map((id, index) => [id, index])));
    }

    // Positive = moved up that many places. New entries and the first refresh get no arrow.
    function deltas(key, ids) {
        const before = previous.get(key);
        const result = new Map();
        if (!before) return result;
        ids.forEach((id, index) => {
            if (before.has(id)) result.set(id, before.get(id) - index);
        });
        return result;
    }

    return { advance, deltas };
}

function movementArrow(delta) {
    if (!delta) return '';
    return delta > 0 ? ` ⬆️${delta}` : ` 🔻${-delta}`;
}

function placeLabel(index) {
    return ['🥇', '🥈', '🥉'][index] || `**#${index + 1}**`;
}

module.exports = { createMovementTracker, movementArrow, placeLabel };
