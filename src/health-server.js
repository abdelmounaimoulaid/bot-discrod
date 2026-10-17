const http = require("node:http");

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

        response.end(JSON.stringify({
            status: "running"
        }));
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

module.exports = { startHealthServer };