const http = require("node:http");

// index.js plugs in a function that reports Discord state. The answer is always
// HTTP 200 so the hosting proxy never marks the app down; monitors such as
// UptimeRobot should look for the keyword "discord":"online" instead.
let statusProvider = () => ({});

function setStatusProvider(fn) {
    statusProvider = fn;
}

function healthBody() {
    let extra = {};
    try { extra = statusProvider() || {}; } catch {}
    return { status: "running", uptimeSeconds: Math.round(process.uptime()), ...extra };
}

function startHealthServer(port = process.env.PORT || 3000) {

    const server = http.createServer((request, response) => {

        if (request.url !== "/" && request.url !== "/health") {
            response.writeHead(404);
            response.end("Not found");
            return;
        }

        response.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        });

        response.end(JSON.stringify(healthBody()));
    });

    server.on("error", error => {
        console.error("❌ HTTP listener failed:", error);
        process.exit(1);
    });

    server.listen(Number(port), "0.0.0.0", () => {
        console.log(`✅ Health server listening on port ${port}`);
    });

    return server;
}

module.exports = { startHealthServer, setStatusProvider, healthBody };