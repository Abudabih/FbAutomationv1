const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

const activeSessions = {}; 
const cooldowns = new Map();

const COOKIE_DIR = path.join(__dirname, 'account_cookies');
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);

let config = { prefix: "!", adminUID: [], botCreatorUID: "" };
if (fs.existsSync('./config.json')) {
    config = fs.readJsonSync('./config.json');
} else {
    fs.writeJsonSync('./config.json', config, { spaces: 2 });
}

let style = { top: '━━━━━━━━━━━━━━━━━━', bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━' };
if (fs.existsSync('./style.json')) {
    style = fs.readJsonSync('./style.json');
}

// --------------------
// Stats endpoint
// --------------------
app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.existsSync(cmdDir)
        ? fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length
        : 0;

    res.json({
        activeUsers: Object.keys(activeSessions).length,
        totalCommands: commandCount
    });
});

// --------------------
// Login endpoint with Duplicate Check
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix, adminID } = req.body;

    try {
        const cookies = JSON.parse(appState);

        login({ appState: cookies }, (err, api) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    message: err.error || "Login failed"
                });
            }

            const userID = api.getCurrentUserID();

            // --- DUPLICATE CHECK START ---
            if (activeSessions[userID]) {
                console.log(`[WARNING] Session for ${userID} is already active!`);
                
                // Opsyonal: I-logout ang bagong api instance para tipid sa memory
                api.logout(); 

                return res.status(400).json({
                    success: false,
                    message: "Session is already active!"
                });
            }
            // --- DUPLICATE CHECK END ---

            const cookiePath = path.join(COOKIE_DIR, `${userID}.json`);
            fs.writeJsonSync(cookiePath, cookies, { spaces: 2 });

            api.setOptions({ listenEvents: true, selfListen: false, online: true });
            
            activeSessions[userID] = {
                api: api,
                prefix: prefix || config.prefix,
                adminID: adminID ? adminID.split(',').map(id => id.trim()) : []
            };

            api.getUserInfo(userID, (err, ret) => {
                const name = err ? "Bot" : ret[userID].name;
                res.json({
                    success: true,
                    id: userID,
                    name: name
                });
                console.log(`[SYSTEM] Account Active: ${name} (${userID})`);
            });

            startBot(api, userID);
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: "Invalid JSON Cookies"
        });
    }
});

function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsDir)) return [];
    return fs.readdirSync(eventsDir)
        .filter(f => f.endsWith('.js'))
        .map(f => require(path.join(eventsDir, f)));
}

function startBot(api, userID) {
    const eventsModules = loadEvents();

    api.listenMqtt(async (err, event) => {
        if (err) {
            console.error(`[ERROR - ${userID}]`, err);
            if (err.error === 'Not logged in.' || err.error === 'Connection closed.') {
                delete activeSessions[userID];
            }
            return;
        }

        const session = activeSessions[userID];
        if (!session) return;

        const currentPrefix = session.prefix;

        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(currentPrefix)) return;

            const args = message.slice(currentPrefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const cmdPath = path.join(__dirname, 'cmds', `${commandName}.js`);

            if (fs.existsSync(cmdPath)) {
                try {
                    delete require.cache[require.resolve(cmdPath)];
                    const cmd = require(cmdPath);
                    executeCommand(cmd, api, event, args);
                } catch (e) {
                    console.error(e);
                }
            }
        }

        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') mod(api, event, config, style);
            } catch (e) { /* silent error for events */ }
        }
    });
}

function executeCommand(cmd, api, event, args) {
    const userId = event.senderID;
    const cooldownTime = (cmd.cooldown || 0) * 1000;

    if (!cooldowns.has(cmd.name)) cooldowns.set(cmd.name, new Map());
    const timestamps = cooldowns.get(cmd.name);
    const now = Date.now();

    if (timestamps.has(userId)) {
        const expiration = timestamps.get(userId) + cooldownTime;
        if (now < expiration) {
            const timeLeft = Math.ceil((expiration - now) / 1000);
            return api.sendMessage(`⏱️ Wait ${timeLeft}s.`, event.threadID, event.messageID);
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);

    if (cmd.execute) cmd.execute(api, event, args);
}

app.listen(PORT, () => {
    console.log(`Multi-Account Dashboard active at http://localhost:${PORT}`);
});
