// In-memory health counters shown by /status.
const startedAt = Date.now();
const refreshes = {};
const apiErrors = {};

function recordRefresh(name, { startedAt: start, players }) {
    refreshes[name] = { finishedAt: Date.now(), durationMs: Date.now() - start, players };
}

function recordApiError(api, error) {
    const entry = apiErrors[api] || (apiErrors[api] = { count: 0 });
    entry.count++;
    entry.lastAt = Date.now();
    entry.lastMessage = error?.response?.status ? `HTTP ${error.response.status}` : (error?.message || String(error)).slice(0, 120);
}

function snapshot() {
    return { startedAt, refreshes: { ...refreshes }, apiErrors: JSON.parse(JSON.stringify(apiErrors)) };
}

module.exports = { recordRefresh, recordApiError, snapshot };
