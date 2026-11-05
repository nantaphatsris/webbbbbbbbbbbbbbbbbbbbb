
const osc = require("osc");
const WebSocket = require("ws");

const PORT = 8080;
const MAX_PLAYERS = 10;

// ========================================
// OSC -> TouchDesigner
// ========================================

const udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 9001,
    remoteAddress: "127.0.0.1",
    remotePort: 9000
});

let oscReady = false;

udpPort.on("ready", () => {
    oscReady = true;
    console.log("OSC READY");
    console.log("TouchDesigner: 127.0.0.1:9000");
});

udpPort.on("error", (err) => {
    console.error("OSC ERROR:", err.message);
});

udpPort.open();

function sendOSC(address, type, value) {
    if (!oscReady) return;

    udpPort.send({
        address,
        args: [{ type, value }]
    });
}

// ========================================
// PLAYER MANAGEMENT
// ========================================

const occupiedSlots = new Set();

function allocatePlayer() {
    for (let i = 1; i <= MAX_PLAYERS; i++) {
        if (!occupiedSlots.has(i)) {
            occupiedSlots.add(i);
            return i;
        }
    }

    return null;
}

function releasePlayer(ws) {
    const id = ws.playerId;

    if (!id) return;

    sendOSC(`/player/${id}/active`, "i", 0);

    occupiedSlots.delete(id);
    ws.playerId = null;

    console.log(`Player ${id} disconnected`);
}

// ========================================
// WEBSOCKET SERVER
// ========================================

const wss = new WebSocket.Server({
    port: PORT
});

wss.on("listening", () => {
    console.log("==============================");
    console.log(" NIGHT SKY MULTIPLAYER SERVER");
    console.log("==============================");
    console.log(`WebSocket port: ${PORT}`);
    console.log(`Max players: ${MAX_PLAYERS}`);
});

wss.on("connection", (ws) => {
    const playerId = allocatePlayer();

    if (playerId === null) {
        ws.send(JSON.stringify({
            type: "error",
            message: "ห้องเต็มแล้ว"
        }));

        ws.close(1013, "Server full");
        return;
    }

    ws.playerId = playerId;
    ws.isAlive = true;

    console.log(`Player ${playerId} connected`);

    // เริ่มต้น inactive จนกว่าจะเปิดกล้อง
    sendOSC(`/player/${playerId}/active`, "i", 0);

    ws.send(JSON.stringify({
        type: "welcome",
        playerId
    }));

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    // ========================================
    // RECEIVE WEBSITE MESSAGES
    // ========================================

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // CAMERA ACTIVE / INACTIVE
            if (data.type === "active") {
                const active = data.active ? 1 : 0;

                sendOSC(
                    `/player/${playerId}/active`,
                    "i",
                    active
                );

                console.log(
                    `Player ${playerId} camera active: ${active}`
                );

                return;
            }

            // PLAYER X/Y
            if (data.type === "xy") {
                const x = Number(data.x);
                const y = Number(data.y);

                if (
                    !Number.isFinite(x) ||
                    !Number.isFinite(y)
                ) {
                    return;
                }

                const safeX = Math.max(0, Math.min(1, x));
                const safeY = Math.max(0, Math.min(1, y));

                sendOSC(
                    `/player/${playerId}/x`,
                    "f",
                    safeX
                );

                sendOSC(
                    `/player/${playerId}/y`,
                    "f",
                    safeY
                );

                return;
            }

            // RUN CONSTELLATION ANIMATION
            if (data.type === "runAnimation") {
                console.log(
                    `Player ${playerId} triggered animation`
                );

                sendOSC("/animation/run", "i", 1);

                // Reset pulse after 100ms
                setTimeout(() => {
                    sendOSC("/animation/run", "i", 0);
                }, 100);

                return;
            }

        } catch (error) {
            console.error(
                "Invalid message:",
                error.message
            );
        }
    });

    // ========================================
    // DISCONNECT
    // ========================================

    ws.on("close", () => {
        releasePlayer(ws);
    });

    ws.on("error", (err) => {
        console.error(
            `Player ${playerId} WebSocket error:`,
            err.message
        );
    });
});

// ========================================
// CONNECTION WATCHDOG
// ========================================

const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            ws.terminate();
            return;
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on("close", () => {
    clearInterval(heartbeat);
});
