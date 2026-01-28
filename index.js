const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

const apiInstances = new Map(); 
const cooldowns = new Map();

// --------------------
// DIRECTORY & FILE INITIALIZER
// --------------------
const requiredDirs = ['accounts', 'cmds', 'events'];
requiredDirs.forEach(dir => {
    if (!fs.existsSync(path.join(__dirname, dir))) {
        fs.mkdirSync(path.join(__dirname, dir));
        console.log(`[SYSTEM] Created directory: /${dir}`);
    }
});

const ACCOUNTS_DIR = path.join(__dirname, 'accounts');

// Default Configs
const configPath = './config.json';
const stylePath = './style.json';

if (!fs.existsSync(configPath)) {
    fs.writeJsonSync(configPath, { prefix: "#", adminUID: [], botCreatorUID: "" }, { spaces: 2 });
}
if (!fs.existsSync(stylePath)) {
    fs.writeJsonSync(stylePath, { top: '━━━━━━━━━━━━━━━━━━', bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━' }, { spaces: 2 });
}

let config = fs.readJsonSync(configPath);
let style = fs.readJsonSync(stylePath);

// --------------------
// Stats endpoint
// --------------------
app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length;

    res.json({
        activeBots: apiInstances.size,
        totalCommands: commandCount
    });
});

// --------------------
// Login endpoint
// --------------------
app.post('/login', async (req, res) => {
    const { appState } = req.body;

    try {
        const cookies = JSON.parse(appState);
        login({ appState: cookies }, (err, api) => {
            if (err) return res.status(401).json({ success: false, message: "Login failed" });

            const botID = api.getCurrentUserID();
            
            // Auto-save cookie sa accounts folder
            fs.writeJsonSync(path.join(ACCOUNTS_DIR, `${botID}.json`), cookies, { spaces: 2 });
            
            apiInstances.set(botID, api);
            api.setOptions({ listenEvents: true, selfListen: false });
            startBot(api);

            res.json({ success: true, id: botID });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Invalid JSON Cookies" });
    }
});

// --------------------
// Bot starter logic
// --------------------
function startBot(api) {
    const eventsModules = loadEvents();

    api.listenMqtt(async (err, event) => {
        if (err) return;

        // Reload config/style para realtime updates kung binago ang file
        config = fs.readJsonSync(configPath);
        style = fs.readJsonSync(stylePath);

        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(config.prefix)) return;

            const args = message.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const cmdPath = path.join(__dirname, 'cmds', `${commandName}.js`);

            if (fs.existsSync(cmdPath)) {
                try {
                    delete require.cache[require.resolve(cmdPath)];
                    const cmd = require(cmdPath);
                    executeCommand(cmd, api, event, args);
                } catch (e) { console.error(e); }
            }
        }

        // Run events for each bot instance
        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') mod(api, event, config, style);
            } catch (e) { /* ignore event errors */ }
        }
    });
}

function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    return fs.readdirSync(eventsDir)
        .filter(f => f.endsWith('.js'))
        .map(f => {
            const modPath = path.join(eventsDir, f);
            delete require.cache[require.resolve(modPath)];
            return require(modPath);
        });
}

function executeCommand(cmd, api, event, args) {
    const userId = event.senderID;
    const cmdName = cmd.name || "unknown";
    const cooldownTime = (cmd.cooldown || 0) * 1000;

    if (!cooldowns.has(cmdName)) cooldowns.set(cmdName, new Map());
    const timestamps = cooldowns.get(cmdName);
    const now = Date.now();

    if (timestamps.has(userId)) {
        const expiration = timestamps.get(userId) + cooldownTime;
        if (now < expiration) return; 
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);
    cmd.execute(api, event, args);
}

// --------------------
// Auto-load accounts
// --------------------
function loadSavedAccounts() {
    const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
    
    if (files.length === 0) console.log("[SYSTEM] No saved accounts found.");

    files.forEach(file => {
        const cookies = fs.readJsonSync(path.join(ACCOUNTS_DIR, file));
        login({ appState: cookies }, (err, api) => {
            if (err) {
                console.log(`[ERROR] Account ${file} is invalid. Check your cookies.`);
                return;
            }
            const botID = api.getCurrentUserID();
            apiInstances.set(botID, api);
            api.setOptions({ listenEvents: true, selfListen: false });
            startBot(api);
            console.log(`[ONLINE] Bot ID: ${botID} is active.`);
        });
    });
}

app.listen(PORT, () => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🚀 Doughnut Bot Dashboard: http://localhost:${PORT}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loadSavedAccounts();
});
