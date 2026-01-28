const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

let apiInstance = null;
const cooldowns = new Map();

// --------------------
// Load config.json
// --------------------
let config = { prefix: "!", adminUID: [], botCreatorUID: "" };
if (fs.existsSync('./config.json')) {
    config = fs.readJsonSync('./config.json');
} else {
    fs.writeJsonSync('./config.json', config, { spaces: 2 });
}

// --------------------
// Load style.json
// --------------------
let style = {
    top: '━━━━━━━━━━━━━━━━━━',
    bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━'
};
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
        activeUsers: apiInstance ? 1 : 0,
        totalCommands: commandCount
    });
});

// --------------------
// Login endpoint
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix } = req.body;

    try {
        const cookies = JSON.parse(appState);
        config.prefix = prefix || config.prefix;

        fs.writeJsonSync('./config.json', config, { spaces: 2 });
        fs.writeJsonSync('./cookie.json', cookies, { spaces: 2 });

        login({ appState: cookies }, (err, api) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    message: err.error || "Login failed"
                });
            }

            apiInstance = api;
            api.setOptions({ listenEvents: true, selfListen: false });

            const uid = api.getCurrentUserID();
            res.json({ success: true, id: uid });

            startBot(api);
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: "Invalid JSON Cookies"
        });
    }
});

// --------------------
// Event loader
// --------------------
function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsDir)) return [];

    return fs.readdirSync(eventsDir)
        .filter(f => f.endsWith('.js'))
        .map(f => require(path.join(eventsDir, f)));
}

// --------------------
// Bot starter
// --------------------
function startBot(api) {
    const eventsModules = loadEvents();

    api.listenMqtt(async (err, event) => {
        if (err) return;

        // --------------------
        // BOT JOIN EVENT
        // --------------------
        if (event.type === "event" && event.logMessageType === "log:subscribe") {
            const botID = api.getCurrentUserID();
            const { addedParticipants } = event.logMessageData;

            const botAdded = addedParticipants.some(p => p.userFbId === botID);
            if (!botAdded) return;

            let adderName = "Someone";

            try {
                const threadInfo = await api.getThreadInfo(event.threadID);
                const adderInfo = threadInfo.userInfo?.[event.author];
                if (adderInfo?.name) adderName = adderInfo.name;
            } catch (e) {}

            const welcomeMsg =
                `𝗗𝗢𝗨𝗚𝗛𝗡𝗨𝗧-𝗕𝗢𝗧\n` +
                `${style.top}\n` +
                `✨ 𝗔𝗱𝗱𝗲𝗱 𝘁𝗼 𝗮 𝗡𝗲𝘄 𝗚𝗿𝗼𝘂𝗽 𝗖𝗵𝗮𝘁! ✨\n\n` +
                `Hello everyone! I'm 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁 𝗕𝗼𝘁, your automation assistant! 🍩🤖\n\n` +
                `Type ❪ **${config.prefix}help** ❫ to see my commands.\n\n` +
                `${style.top}\n` +
                `👤 𝗔𝗱𝗱𝗲𝗱 𝗯𝘆: ${adderName}\n` +
                `👑 𝗢𝘄𝗻𝗲𝗿: 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁\n` +
                `🚀 𝗦𝘁𝗮𝘁𝘂𝘀: Active!\n` +
                `${style.bottom}`;

            api.sendMessage(welcomeMsg, event.threadID);
        }

        // --------------------
        // COMMAND HANDLER
        // --------------------
        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(config.prefix)) return;

            const args = message.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const cmdPath = path.join(__dirname, 'cmds', `${commandName}.js`);

            if (!fs.existsSync(cmdPath)) {
                return api.sendMessage(
                    `Command "${commandName}" not found!\nUse ${config.prefix}help to see all commands.`,
                    event.threadID,
                    event.messageID
                );
            }

            try {
                delete require.cache[require.resolve(cmdPath)];
                const cmd = require(cmdPath);
                if (typeof cmd.execute !== 'function') return;

                const senderID = event.senderID;
                const isCreator = senderID === config.botCreatorUID;
                const isBotAdmin = Array.isArray(config.adminUID)
                    ? config.adminUID.includes(senderID)
                    : senderID === config.adminUID;

                if (cmd.role === 1 && !isCreator) {
                    return api.sendMessage(
                        "❌ This command is for the bot creator only.",
                        event.threadID,
                        event.messageID
                    );
                }

                if (cmd.role === 2) {
                    return api.getThreadInfo(event.threadID, (err, info) => {
                        if (err) return;
                        const isGCAdmin = info.adminIDs.some(a => a.id === senderID);
                        if (!isGCAdmin && !isCreator && !isBotAdmin) {
                            return api.sendMessage(
                                "❌ This command is for admins only.",
                                event.threadID,
                                event.messageID
                            );
                        }
                        executeCommand(cmd, api, event, args);
                    });
                }

                executeCommand(cmd, api, event, args);
            } catch (e) {
                console.error(e);
            }
        }

        // --------------------
        // External event modules
        // --------------------
        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') {
                    mod(api, event, config, style);
                }
            } catch (e) {}
        }
    });
}

// --------------------
// Cooldown executor
// --------------------
function executeCommand(cmd, api, event, args) {
    const userId = event.senderID;
    const cooldownTime = (cmd.cooldown || 0) * 1000;

    if (!cooldowns.has(cmd.name)) {
        cooldowns.set(cmd.name, new Map());
    }

    const timestamps = cooldowns.get(cmd.name);
    const now = Date.now();

    if (timestamps.has(userId)) {
        const expiration = timestamps.get(userId) + cooldownTime;
        if (now < expiration) {
            const timeLeft = Math.ceil((expiration - now) / 1000);
            return api.sendMessage(
                `⏱️ Please wait ${timeLeft}s to use "${cmd.name}" again.`,
                event.threadID,
                event.messageID
            );
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownTime);

    if (cmd.styleOutput) {
        const styled =
            `**${cmd.styleOutput.title}**\n` +
            `${style.top}\n` +
            `${cmd.styleOutput.content}\n` +
            `${style.bottom}`;

        api.sendMessage(styled, event.threadID, event.messageID);
    } else {
        cmd.execute(api, event, args);
    }
}

app.listen(PORT, () => {
    console.log(`Dashboard active at http://localhost:${PORT}`);
});
