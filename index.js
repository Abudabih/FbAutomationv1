const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Dito itatago ang lahat ng aktibong login sessions
const activeSessions = {}; 
const cooldowns = new Map();

// --------------------
// Configurations
// --------------------
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
// Multi-Account Stats
// --------------------
app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.existsSync(cmdDir)
        ? fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length
        : 0;

    res.json({
        activeAccounts: Object.keys(activeSessions).length,
        accountIDs: Object.keys(activeSessions),
        totalCommands: commandCount
    });
});

// --------------------
// Login Endpoint (Handles Multiple)
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix } = req.body;

    try {
        const cookies = typeof appState === 'string' ? JSON.parse(appState) : appState;
        
        login({ appState: cookies }, (err, api) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    message: err.error || "Login failed"
                });
            }

            const userID = api.getCurrentUserID();
            
            // I-set ang options para sa account na ito
            api.setOptions({ listenEvents: true, selfListen: false, online: true });

            // I-store sa global object para hindi ma-overwrite ang ibang account
            activeSessions[userID] = {
                api: api,
                prefix: prefix || config.prefix
            };

            res.json({
                success: true,
                id: userID,
                message: `Account ${userID} is now active.`
            });

            console.log(`[SYSTEM] Account logged in: ${userID}`);
            startBot(api, userID);
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Invalid JSON Cookies" });
    }
});

// --------------------
// Event & Bot Logic
// --------------------
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
            if (err.error === 'Not logged in.') delete activeSessions[userID];
            return;
        }

        // Kunin ang specific prefix para sa account na ito
        const accountPrefix = activeSessions[userID]?.prefix || config.prefix;

        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(accountPrefix)) return;

            const args = message.slice(accountPrefix.length).trim().split(/ +/);
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

        // Run external events
        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') mod(api, event, config, style);
            } catch (e) {
                console.error(`[EVENT ERROR - ${userID}]`, e);
            }
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
            return api.sendMessage(`⏱️ Cooldown: ${timeLeft}s`, event.threadID, event.messageID);
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);

    // Siguraduhing may execute function ang command
    if (cmd.execute) cmd.execute(api, event, args, activeSessions); 
}

app.listen(PORT, () => {
    console.log(`Multi-Account Dashboard active at http://localhost:${PORT}`);
});
