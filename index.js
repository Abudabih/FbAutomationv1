const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Storage para sa maraming API instances
const apiInstances = new Map(); 
const cooldowns = new Map();

// --------------------
// AUTO-CREATE DIRECTORIES & FILES
// --------------------
const requiredDirs = ['accounts', 'cmds', 'events'];
requiredDirs.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
        console.log(`[SYSTEM] Created directory: /${dir}`);
    }
});

const ACCOUNTS_DIR = path.join(__dirname, 'accounts');

// Auto-create config.json if not exists
const configPath = './config.json';
if (!fs.existsSync(configPath)) {
    const defaultConfig = { prefix: "!", adminUID: [], botCreatorUID: "" };
    fs.writeJsonSync(configPath, defaultConfig, { spaces: 2 });
    console.log(`[SYSTEM] Created default config.json`);
}

// Auto-create style.json if not exists
const stylePath = './style.json';
if (!fs.existsSync(stylePath)) {
    const defaultStyle = { top: '━━━━━━━━━━━━━━━━━━', bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━' };
    fs.writeJsonSync(stylePath, defaultStyle, { spaces: 2 });
    console.log(`[SYSTEM] Created default style.json`);
}

// Load configurations after checking/creating
let config = fs.readJsonSync(configPath);
let style = fs.readJsonSync(stylePath);

// --------------------
// Stats endpoint
// --------------------
app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.existsSync(cmdDir)
        ? fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length
        : 0;

    res.json({
        activeBots: apiInstances.size,
        totalCommands: commandCount
    });
});

// --------------------
// Login endpoint (Adds new cookie)
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix } = req.body;

    try {
        const cookies = JSON.parse(appState);
        login({ appState: cookies }, (err, api) => {
            if (err) return res.status(401).json({ success: false, message: "Login failed" });

            const botID = api.getCurrentUserID();
            
            // I-save ang cookie gamit ang botID para unique
            fs.writeJsonSync(path.join(ACCOUNTS_DIR, `${botID}.json`), cookies, { spaces: 2 });
            
            // Simulan ang bot at i-store sa Map
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

        // Run external events (Welcome, Intro, etc.)
        for (const mod of eventsModules) {
            try { if (typeof mod === 'function') mod(api, event, config, style); } catch (e) {}
        }
    });
}

function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsDir)) return [];
    return fs.readdirSync(eventsDir).filter(f => f.endsWith('.js')).map(f => require(path.join(eventsDir, f)));
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
        if (now < expiration) return; // Silent cooldown
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);
    cmd.execute(api, event, args);
}

// --------------------
// Auto-load existing accounts on restart
// --------------------
function loadSavedAccounts() {
    if (!fs.existsSync(ACCOUNTS_DIR)) return;
    
    // Basahin lang ang .json files para iwas error sa .js
    const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
        const cookiePath = path.join(ACCOUNTS_DIR, file);
        try {
            const cookies = fs.readJsonSync(cookiePath);
            login({ appState: cookies }, (err, api) => {
                if (err) {
                    console.log(`[ERROR] Failed to login: ${file}`);
                    return;
                }
                const botID = api.getCurrentUserID();
                apiInstances.set(botID, api);
                api.setOptions({ listenEvents: true, selfListen: false });
                startBot(api);
                console.log(`[SUCCESS] Bot ${botID} is active.`);
            });
        } catch (e) {
            console.log(`[ERROR] Malformed cookie file: ${file}`);
        }
    });
}

app.listen(PORT, () => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🚀 Doughnut Bot Dashboard: http://localhost:${PORT}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    loadSavedAccounts(); // Tawagin ito para mag-online lahat ng saved bots
});
