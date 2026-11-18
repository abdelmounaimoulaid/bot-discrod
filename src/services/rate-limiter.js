// Spaces API calls so background refreshes stay under the provider's rate limit.
// Interactive requests (a user clicking a button) jump ahead of background work
// so linking an account never waits behind a whole leaderboard refresh.
function createRateLimiter(getGapMs) {
    const urgent = [];
    const background = [];
    let lastRun = 0;
    let draining = false;

    async function drain() {
        if (draining) return;
        draining = true;
        try {
            while (urgent.length || background.length) {
                const wait = lastRun + getGapMs() - Date.now();
                if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
                const job = urgent.shift() || background.shift();
                lastRun = Date.now();
                job.task().then(job.resolve, job.reject);
            }
        } finally {
            draining = false;
        }
    }

    return function schedule(task, { priority = false } = {}) {
        return new Promise((resolve, reject) => {
            (priority ? urgent : background).push({ task, resolve, reject });
            drain();
        });
    };
}

module.exports = { createRateLimiter };
