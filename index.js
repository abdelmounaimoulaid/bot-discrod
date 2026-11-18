// Entry point for hosts that start the root index.js (such as Hostinger's
// default "Entry File" setting). The bot itself lives in src/index.js.
//
// Web hosting like Hostinger's Node.js apps expects the app to answer HTTP
// requests on process.env.PORT, and can stop an app that does not. This small
// status page keeps the host happy and shows whether the bot is connected.

const http = require("http");

const port = process.env.PORT || 3000;
let client;

http.createServer((request, response) => {
    const online = Boolean(client?.isReady());
    response.writeHead(online ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
        bot: online ? "online" : "offline",
        user: online ? client.user.tag : null,
        uptimeSeconds: Math.round(process.uptime())
    }));
}).listen(port, () => {
    console.log(`🌐 Status page listening on port ${port}`);
});

client = require("./src/index.js");
