const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Storage para sa active instances at cooldowns
const activeSessions = {}; 
const cooldowns = new Map();
const COOKIE_DIR = path.join(__dirname, 'account_cookies');

if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR, { recursive: true });

// Global Configurations
let config = { prefix: "!", adminUID: [], botCreatorUID: "" };
if (fs.existsSync('./config.json')) config = fs.readJsonSync('./config.json');

let style = { top: '━━━━━━━━━━━━━━━━━━', bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━' };
if (fs.existsSync('./style.json')) style = fs.readJsonSync('./style.json');

// --- Helper: Safe Message Sender (Anti-Crash) ---
const safeSend = (api, msg, threadID, messageID = null) => {
    try {
        api.sendMessage(msg, threadID, (err) => {
            if (err) console.error(`[SEND ERROR] ${threadID}:`, err.error || err);
        }, messageID);
    } catch (e) {
        console.error("[CRITICAL SEND ERROR]", e.message);
    }
};

// --- Helper: Unlimited Incremental Naming ---
function getNewCookiePath() {
    let fileName = 'cookie.json';
    let filePath = path.join(COOKIE_DIR, fileName);
    let count = 2;

    while (fs.existsSync(filePath)) {
        fileName = `cookie${count}.json`;
        filePath = path.join(COOKIE_DIR, fileName);
        count++;
    }
    return { filePath, fileName };
}

// --------------------
// Core Bot Bootstrapper
// --------------------
async function bootBot(cookies, prefix, adminID, savedFile = null) {
    return new Promise((resolve) => {
        login({ appState: cookies }, (err, api) => {
            if (err) {
                console.error(`[LOGIN FAILED] ${savedFile || 'New Login'} - Error: ${err.error || err}`);
                return resolve(null);
            }

            const userID = api.getCurrentUserID();
            
            // Iwasan ang duplicate sessions sa iisang UID
            if (activeSessions[userID]) {
                console.log(`[SKIP] UID ${userID} is already active.`);
                return resolve(userID);
            }

            // Save file kung bagong login (Manual)
            let currentFileName = savedFile;
            if (!savedFile) {
                const { filePath, fileName } = getNewCookiePath();
                fs.writeJsonSync(filePath, cookies, { spaces: 2 });
                currentFileName = fileName;
            }

            api.setOptions({ listenEvents: true, selfListen: false, online: true });
            
            activeSessions[userID] = {
                api,
                prefix: prefix || config.prefix,
                adminID: Array.isArray(adminID) ? adminID : [adminID]
            };

            api.getUserInfo(userID, (err, ret) => {
                const name = (ret && ret[userID]) ? ret[userID].name : "Facebook Bot";
                console.log(`[SYSTEM] ${savedFile ? 'RELOADED' : 'NEW LOGIN'}: ${name} (${userID}) | File: ${currentFileName}`);
                resolve(userID);
            });

            startBot(api, userID);
        });
    });
}

// --------------------
// API Endpoints
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix, adminID } = req.body;
    try {
        const cookies = typeof appState === 'string' ? JSON.parse(appState) : appState;
        const result = await bootBot(cookies, prefix, adminID);

        if (result) {
            res.json({ success: true, message: "Bot started and saved successfully!" });
        } else {
            res.status(401).json({ success: false, message: "Login failed. Check cookies." });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Invalid JSON Cookies format." });
    }
});

app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.existsSync(cmdDir) ? fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length : 0;
    res.json({
        activeBots: Object.keys(activeSessions).length,
        totalCommands: commandCount,
        instances: Object.keys(activeSessions)
    });
});

// --------------------
// Auto-Load on Startup
// --------------------
async function autoLoadSavedBots() {
    console.log("[SYSTEM] Scanning for saved cookie files...");
    const files = fs.readdirSync(COOKIE_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        try {
            const cookies = fs.readJsonSync(path.join(COOKIE_DIR, file));
            // Delay para iwas checkpoint/spam detection ng FB
            await new Promise(r => setTimeout(r, 2500));
            await bootBot(cookies, config.prefix, config.adminUID, file);
        } catch (e) {
            console.error(`[SYSTEM] Failed to load ${file}:`, e.message);
        }
    }
}

// --------------------
// Independent Bot Listener
// --------------------
function startBot(api, userID) {
    const eventsDir = path.join(__dirname, 'events');
    const eventsModules = fs.existsSync(eventsDir) 
        ? fs.readdirSync(eventsDir).filter(f => f.endsWith('.js')).map(f => require(path.join(eventsDir, f))) 
        : [];

    api.listenMqtt(async (err, event) => {
        if (err) {
            if (err.error === 'Not logged in.' || err === 'Not logged in.') {
                console.log(`[OFFLINE] Account ${userID} session expired.`);
                delete activeSessions[userID];
            }
            return;
        }

        const session = activeSessions[userID];
        if (!session) return;

        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(session.prefix)) return;

            const args = message.slice(session.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const cmdPath = path.join(__dirname, 'cmds', `${commandName}.js`);

            if (fs.existsSync(cmdPath)) {
                try {
                    delete require.cache[require.resolve(cmdPath)];
                    const cmd = require(cmdPath);
                    executeCommand(cmd, api, event, args, session);
                } catch (e) { console.error(`[CMD ERROR]`, e); }
            } else {
                safeSend(api, `Command "${commandName}" not found!`, event.threadID, event.messageID);
            }
        }

        // Run events safely
        eventsModules.forEach(mod => {
            try {
                if (typeof mod === 'function') mod(api, event, config, style);
                else if (mod.onEvent) mod.onEvent({ api, event, config, style });
            } catch (e) {}
        });
    });
}

function executeCommand(cmd, api, event, args, session) {
    const userId = event.senderID;
    const cooldownTime = (cmd.cooldown || 1) * 1000;

    if (!cooldowns.has(cmd.name)) cooldowns.set(cmd.name, new Map());
    const timestamps = cooldowns.get(cmd.name);
    const now = Date.now();

    if (timestamps.has(userId)) {
        const expiration = timestamps.get(userId) + cooldownTime;
        if (now < expiration) {
            return safeSend(api, `⏱️ Wait ${Math.ceil((expiration - now) / 1000)}s.`, event.threadID, event.messageID);
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);

    try {
        const context = { api, event, args, prefix: session.prefix, adminID: session.adminID, style };
        if (cmd.execute) cmd.execute(api, event, args, context);
        else if (cmd.run) cmd.run(context);
    } catch (e) {
        console.error(`[EXECUTION ERROR]`, e);
        safeSend(api, "❌ May error sa pagtakbo ng command na ito.", event.threadID);
    }
}

// Start Server
app.listen(PORT, async () => {
    console.log(`[SERVER] Dashboard live at: http://localhost:${PORT}`);
    await autoLoadSavedBots();
});
