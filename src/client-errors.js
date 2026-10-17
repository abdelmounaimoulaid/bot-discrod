function registerClientErrors(client, logger = console) {
    const report = (source, error) => logger.error(`[Discord ${source}]`, {
        name: error?.name, code: error?.code, message: error?.message
    });
    // An unhandled EventEmitter 'error' is fatal even when interaction promises are caught.
    client.on('error', error => report('client error', error));
    client.on('shardError', (error, shardId) => report(`shard ${shardId}`, error));
    client.on('shardDisconnect', (event, shardId) => logger.warn(`[Discord shard ${shardId}] disconnected, code=${event.code}`));
}
function registerProcessErrors(proc = process, logger = console) {
    if (typeof proc?.on !== 'function') return;
    // Node exits on an unhandled rejection by default; one stray promise from an
    // async event listener would otherwise take the whole bot offline.
    proc.on('unhandledRejection', reason => logger.error('[Process] Unhandled promise rejection:', reason));
    proc.on('uncaughtException', error => {
        // State after a synchronous throw is unknown: log, then let the host restart us.
        logger.error('[Process] Uncaught exception, exiting:', error);
        setTimeout(() => proc.exit(1), 1000);
    });
}
module.exports = { registerClientErrors, registerProcessErrors };
