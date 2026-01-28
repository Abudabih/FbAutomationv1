const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Dito itatago ang lahat ng aktibong bot sessions
const activeSessions = {}; 
const cooldowns = new Map();

const COOKIE_DIR = path.join(__dirname, 'account_cookies');
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);

let config = { prefix: "!", adminUID: [], botCreatorUID: "" };
if (fs.existsSync('./config.json')) {
    config = fs.readJsonSync('./config.json');
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
        totalCommands: commandCount,
        runningAccounts: Object.keys(activeSessions) // List of active UIDs
    });
});

// --------------------
// Login endpoint (Multi-Account Support)
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix, adminID } = req.body;

    try {
        const cookies = typeof appState === 'string' ? JSON.parse(appState) : appState;

        login({ appState: cookies }, (err, api) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    message: "Login failed: " + (err.error || "Check your cookies.")
                });
            }

            const userID = api.getCurrentUserID();
            
            // Check kung running na ang account
            if (activeSessions[userID]) {
                return res.json({ success: true, id: userID, message: "Account is already active." });
            }

            const cookiePath = path.join(COOKIE_DIR, `${userID}.json`);
            fs.writeJsonSync(cookiePath, cookies, { spaces: 2 });

            api.setOptions({ listenEvents: true, selfListen: false, online: true });
            
            // Register session
            activeSessions[userID] = {
                api: api,
                prefix: prefix || config.prefix,
                adminID: Array.isArray(adminID) ? adminID : [adminID]
            };

            api.getUserInfo(userID, (err, ret) => {
                const name = err ? "Bot" : ret[userID].name;
                res.json({
                    success: true,
                    id: userID,
                    name: name
                });
                console.log(`[LOGIN] Account Started: ${name} (${userID})`);
            });

            // Simulan ang listener para sa account na ito
            startBot(api, userID);
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Invalid Cookies Format" });
    }
});

function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsDir)) return [];
    return fs.readdirSync(eventsDir)
        .filter(f => f.endsWith('.js'))
        .map(f => {
            try {
                return require(path.join(eventsDir, f));
            } catch (e) {
                console.error(`Failed to load event ${f}:`, e);
                return null;
            }
        }).filter(ev => ev !== null);
}

// --------------------
// Independent Bot Listener
// --------------------
function startBot(api, userID) {
    const eventsModules = loadEvents();

    // Mahalaga: listenMqtt ay per instance ng api
    const listenEmitter = api.listenMqtt(async (err, event) => {
        if (err) {
            console.error(`[ERROR - ${userID}]`, err);
            if (err === 'Not logged in.' || err.error === 'Not logged in.') {
                delete activeSessions[userID];
                return listenEmitter.stopListening();
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
                    // Fresh require para sa bawat execute (optional, pero good for dev)
                    delete require.cache[require.resolve(cmdPath)];
                    const cmd = require(cmdPath);
                    
                    // Ipasa ang session info para alam ng command kung sino ang admin/prefix
                    executeCommand(cmd, api, event, args, session);
                } catch (e) {
                    console.error(`[CMD ERROR - ${commandName}]`, e);
                }
            }
        }

        // Run events for this specific account
        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') {
                    mod(api, event, config, style);
                } else if (mod.onEvent) {
                    mod.onEvent({ api, event, config, style });
                }
            } catch (e) { 
                // Wag hayaang mag-crash ang ibang accounts pag may error sa isang event
            }
        }
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
            const timeLeft = Math.ceil((expiration - now) / 1000);
            return api.sendMessage(`⏱️ Wait ${timeLeft}s.`, event.threadID, event.messageID);
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);

    // I-inject ang session data para magamit ng commands (prefix, adminID)
    const context = {
        api,
        event,
        args,
        prefix: session.prefix,
        adminID: session.adminID,
        style
    };

    if (cmd.execute) {
        cmd.execute(api, event, args, context); // Support standard args
    } else if (cmd.run) {
        cmd.run(context); // Support object-based commands
    }
}

app.listen(PORT, () => {
    console.log(`[SERVER] Multi-Account Dashboard: http://localhost:${PORT}`);
    console.log(`[INFO] Ready to host multiple bot instances.`);
});
