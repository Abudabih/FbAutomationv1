const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const { login } = require('ws3-fca');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Active bot sessions storage
const activeSessions = {}; 
const cooldowns = new Map();

// Directories
const COOKIE_DIR = path.join(__dirname, 'cookies');
const LOGS_DIR = path.join(__dirname, 'logs');
const INVALID_COOKIES_DIR = path.join(__dirname, 'invalid_cookies');

// Create necessary directories
if (!fs.existsSync(COOKIE_DIR)) fs.mkdirSync(COOKIE_DIR);
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(INVALID_COOKIES_DIR)) fs.mkdirSync(INVALID_COOKIES_DIR);

// System Logger
class SystemLogger {
    constructor() {
        this.logFile = path.join(LOGS_DIR, `system_${this.getDateString()}.log`);
    }

    getDateString() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    getTimestamp() {
        return new Date().toISOString();
    }

    log(level, message, accountID = null) {
        const timestamp = this.getTimestamp();
        const accountInfo = accountID ? `[${accountID}]` : '[SYSTEM]';
        const logMessage = `[${timestamp}] [${level}] ${accountInfo} ${message}\n`;
        
        // Console output
        console.log(logMessage.trim());
        
        // File output
        fs.appendFileSync(this.logFile, logMessage);
    }

    info(message, accountID = null) {
        this.log('INFO', message, accountID);
    }

    error(message, accountID = null) {
        this.log('ERROR', message, accountID);
    }

    warn(message, accountID = null) {
        this.log('WARN', message, accountID);
    }

    success(message, accountID = null) {
        this.log('SUCCESS', message, accountID);
    }
}

const logger = new SystemLogger();

// Load config
let config = { prefix: "!", adminUID: [], botCreatorUID: "" };
if (fs.existsSync('./config.json')) {
    config = fs.readJsonSync('./config.json');
    logger.info('Configuration loaded successfully');
}

// Load style
let style = { top: '━━━━━━━━━━━━━━━━━━', bottom: '━━━━━━━━⊱⋆⊰━━━━━━━━' };
if (fs.existsSync('./style.json')) {
    style = fs.readJsonSync('./style.json');
    logger.info('Style configuration loaded');
}

// --------------------
// Delete Invalid Cookie
// --------------------
function deleteInvalidCookie(cookieFile, reason) {
    try {
        const sourcePath = path.join(COOKIE_DIR, cookieFile);
        const targetPath = path.join(INVALID_COOKIES_DIR, `${Date.now()}_${cookieFile}`);
        
        // Move to invalid_cookies folder instead of deleting
        if (fs.existsSync(sourcePath)) {
            fs.moveSync(sourcePath, targetPath);
            logger.warn(`Invalid cookie moved: ${cookieFile} -> invalid_cookies/ (Reason: ${reason})`);
            
            // Create a log file explaining why it was moved
            const logPath = path.join(INVALID_COOKIES_DIR, `${Date.now()}_${cookieFile}.log`);
            fs.writeFileSync(logPath, `Timestamp: ${new Date().toISOString()}\nReason: ${reason}\nOriginal File: ${cookieFile}\n`);
        }
    } catch (e) {
        logger.error(`Failed to move invalid cookie ${cookieFile}: ${e.message}`);
    }
}

// --------------------
// Auto-load all cookies on startup
// --------------------
function autoLoadAllAccounts() {
    logger.info('Starting automatic account loading...');
    
    const cookieFiles = fs.readdirSync(COOKIE_DIR).filter(f => f.endsWith('.json'));
    
    if (cookieFiles.length === 0) {
        logger.warn('No cookie files found in cookies directory');
        return;
    }

    logger.info(`Found ${cookieFiles.length} cookie file(s): ${cookieFiles.join(', ')}`);

    cookieFiles.forEach((file, index) => {
        setTimeout(() => {
            const cookiePath = path.join(COOKIE_DIR, file);
            logger.info(`[${index + 1}/${cookieFiles.length}] Attempting to load: ${file}`);
            
            try {
                const cookies = fs.readJsonSync(cookiePath);
                
                // Validate cookie structure
                if (!Array.isArray(cookies) || cookies.length === 0) {
                    throw new Error('Invalid cookie format - must be non-empty array');
                }
                
                logger.info(`Cookie file ${file} parsed successfully (${cookies.length} entries)`);
                loginAccount(cookies, file, true); // Pass true to indicate auto-load
            } catch (e) {
                logger.error(`Failed to load ${file}: ${e.message}`);
                deleteInvalidCookie(file, `Parse error: ${e.message}`);
            }
        }, index * 5000); // Increased to 5 seconds between logins
    });
}

// --------------------
// Login function (reusable)
// --------------------
function loginAccount(cookies, source = 'API', isAutoLoad = false) {
    logger.info(`Initiating login from source: ${source}`, null);
    
    login({ appState: cookies }, (err, api) => {
        if (err) {
            const errorMsg = err.error || err.toString();
            logger.error(`Login failed from ${source}: ${errorMsg}`);
            
            // Delete invalid cookie if auto-loading
            if (isAutoLoad && typeof source === 'string' && source.endsWith('.json')) {
                deleteInvalidCookie(source, `Login failed: ${errorMsg}`);
            }
            return;
        }

        try {
            const userID = api.getCurrentUserID();
            logger.info(`Login successful, UserID: ${userID}`, userID);
            
            // Check if account is already active
            if (activeSessions[userID]) {
                logger.warn(`Account ${userID} is already active - skipping duplicate`, userID);
                return;
            }

            // Save cookies with userID as filename (only save new format)
            const cookiePath = path.join(COOKIE_DIR, `${userID}.json`);
            if (!fs.existsSync(cookiePath)) {
                fs.writeJsonSync(cookiePath, cookies, { spaces: 2 });
                logger.info(`Cookies saved to ${userID}.json`, userID);
            }

            api.setOptions({ 
                listenEvents: true, 
                selfListen: false, 
                online: true 
            });
            
            // Register session
            activeSessions[userID] = {
                api: api,
                prefix: config.prefix,
                adminID: config.adminUID,
                startTime: Date.now(),
                cookieFile: `${userID}.json`,
                errorCount: 0
            };
            
            logger.info(`Session registered for ${userID}`, userID);

            api.getUserInfo(userID, (err, ret) => {
                const name = err ? "Unknown" : ret[userID].name;
                logger.success(`✓ Account fully started: ${name} (${userID})`, userID);
                
                // Start bot listener for this account
                startBot(api, userID);
            });
        } catch (e) {
            logger.error(`Error during login process: ${e.message}`);
        }
    });
}

// --------------------
// Stats endpoint
// --------------------
app.get('/stats', (req, res) => {
    const cmdDir = path.join(__dirname, 'cmds');
    const commandCount = fs.existsSync(cmdDir)
        ? fs.readdirSync(cmdDir).filter(f => f.endsWith('.js')).length
        : 0;

    const accounts = Object.keys(activeSessions).map(uid => {
        const session = activeSessions[uid];
        return {
            uid: uid,
            uptime: Math.floor((Date.now() - session.startTime) / 1000),
            prefix: session.prefix,
            errorCount: session.errorCount || 0
        };
    });

    res.json({
        activeUsers: Object.keys(activeSessions).length,
        totalCommands: commandCount,
        runningAccounts: accounts,
        timestamp: new Date().toISOString()
    });
});

// --------------------
// Logs endpoint - Get recent system logs
// --------------------
app.get('/logs', (req, res) => {
    try {
        const logFile = logger.logFile;
        
        if (!fs.existsSync(logFile)) {
            return res.json({ logs: [] });
        }
        
        const logContent = fs.readFileSync(logFile, 'utf-8');
        const logLines = logContent.split('\n').filter(line => line.trim());
        
        // Get last 50 logs
        const recentLogs = logLines.slice(-50);
        
        res.json({ 
            logs: recentLogs,
            count: recentLogs.length 
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read logs' });
    }
});

// --------------------
// Login endpoint (Manual Login via API)
// --------------------
app.post('/login', async (req, res) => {
    const { appState, prefix, adminID } = req.body;

    try {
        const cookies = typeof appState === 'string' ? JSON.parse(appState) : appState;

        login({ appState: cookies }, (err, api) => {
            if (err) {
                logger.error(`Manual login failed: ${err.error || err}`);
                return res.status(401).json({
                    success: false,
                    message: "Login failed: " + (err.error || "Check your cookies.")
                });
            }

            const userID = api.getCurrentUserID();
            
            // Check if already running
            if (activeSessions[userID]) {
                logger.warn(`Login attempt for already active account: ${userID}`, userID);
                return res.json({ 
                    success: true, 
                    id: userID, 
                    message: "Account is already active." 
                });
            }

            const cookiePath = path.join(COOKIE_DIR, `${userID}.json`);
            fs.writeJsonSync(cookiePath, cookies, { spaces: 2 });

            api.setOptions({ 
                listenEvents: true, 
                selfListen: false, 
                online: true 
            });
            
            // Register session with custom settings
            activeSessions[userID] = {
                api: api,
                prefix: prefix || config.prefix,
                adminID: Array.isArray(adminID) ? adminID : [adminID || config.adminUID],
                startTime: Date.now(),
                cookieFile: `${userID}.json`,
                errorCount: 0
            };

            api.getUserInfo(userID, (err, ret) => {
                const name = err ? "Bot" : ret[userID].name;
                logger.success(`Manual login successful: ${name} (${userID})`, userID);
                
                res.json({
                    success: true,
                    id: userID,
                    name: name
                });

                // Start bot listener
                startBot(api, userID);
            });
        });
    } catch (e) {
        logger.error(`Invalid cookie format: ${e.message}`);
        res.status(500).json({ 
            success: false, 
            message: "Invalid Cookies Format" 
        });
    }
});

// --------------------
// Logout/Stop Account endpoint
// --------------------
app.post('/logout', (req, res) => {
    const { userID } = req.body;
    
    if (!userID) {
        return res.status(400).json({ 
            success: false, 
            message: "userID is required" 
        });
    }

    if (!activeSessions[userID]) {
        return res.status(404).json({ 
            success: false, 
            message: "Account not found or not active" 
        });
    }

    try {
        const session = activeSessions[userID];
        session.api.logout(() => {
            delete activeSessions[userID];
            logger.info(`Account logged out: ${userID}`, userID);
            res.json({ 
                success: true, 
                message: "Account stopped successfully" 
            });
        });
    } catch (e) {
        logger.error(`Logout failed for ${userID}: ${e.message}`, userID);
        res.status(500).json({ 
            success: false, 
            message: "Logout failed" 
        });
    }
});

// --------------------
// Load Events
// --------------------
function loadEvents() {
    const eventsDir = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsDir)) {
        logger.warn('Events directory not found');
        return [];
    }
    
    const eventFiles = fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'));
    logger.info(`Loading ${eventFiles.length} event module(s)`);
    
    return eventFiles.map(f => {
        try {
            const event = require(path.join(eventsDir, f));
            logger.info(`Event loaded: ${f}`);
            return event;
        } catch (e) {
            logger.error(`Failed to load event ${f}: ${e.message}`);
            return null;
        }
    }).filter(ev => ev !== null);
}

// --------------------
// Handle Account Disconnection
// --------------------
function handleAccountDisconnection(userID, reason) {
    const session = activeSessions[userID];
    if (!session) return;

    session.errorCount = (session.errorCount || 0) + 1;

    // If too many errors, delete the cookie
    if (session.errorCount >= 3) {
        logger.error(`Account ${userID} has too many errors (${session.errorCount}). Removing cookie.`, userID);
        deleteInvalidCookie(session.cookieFile, `Too many errors: ${reason}`);
        delete activeSessions[userID];
    } else {
        logger.warn(`Account ${userID} error count: ${session.errorCount}/3`, userID);
    }
}

// --------------------
// Independent Bot Listener
// --------------------
function startBot(api, userID) {
    const eventsModules = loadEvents();

    const listenEmitter = api.listenMqtt(async (err, event) => {
        if (err) {
            const errorMsg = err.error || err.toString();
            logger.error(`Listen error: ${errorMsg}`, userID);
            
            // Critical errors that should delete the cookie
            const criticalErrors = [
                'Not logged in.',
                'Connection refused',
                'Please try again later',
                'checkpoint',
                'Checkpoint',
                'Session expired'
            ];

            const isCritical = criticalErrors.some(e => errorMsg.includes(e));

            if (isCritical) {
                logger.error(`Critical error detected for account ${userID}: ${errorMsg}`, userID);
                const session = activeSessions[userID];
                if (session) {
                    deleteInvalidCookie(session.cookieFile, `Critical error: ${errorMsg}`);
                    delete activeSessions[userID];
                }
                return listenEmitter.stopListening();
            }

            // Track non-critical errors
            handleAccountDisconnection(userID, errorMsg);
            return;
        }

        const session = activeSessions[userID];
        if (!session) return;

        // Reset error count on successful event
        if (session.errorCount > 0) {
            session.errorCount = 0;
        }

        const currentPrefix = session.prefix;

        // Handle commands
        if (event.type === "message") {
            const message = event.body || "";
            if (!message.startsWith(currentPrefix)) return;

            const args = message.slice(currentPrefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const cmdPath = path.join(__dirname, 'cmds', `${commandName}.js`);

            if (fs.existsSync(cmdPath)) {
                logger.info(`Command executed: ${commandName} by ${event.senderID}`, userID);
                
                try {
                    delete require.cache[require.resolve(cmdPath)];
                    const cmd = require(cmdPath);
                    executeCommand(cmd, api, event, args, session, userID);
                } catch (e) {
                    logger.error(`Command error [${commandName}]: ${e.message}`, userID);
                    api.sendMessage(`❌ Command error: ${e.message}`, event.threadID);
                }
            }
        }

        // Run events for this account
        for (const mod of eventsModules) {
            try {
                if (typeof mod === 'function') {
                    mod(api, event, config, style);
                } else if (mod.onEvent) {
                    mod.onEvent({ api, event, config, style });
                }
            } catch (e) { 
                logger.error(`Event error: ${e.message}`, userID);
            }
        }
    });

    logger.info(`Bot listener started for account ${userID}`, userID);
}

// --------------------
// Execute Command with Cooldown
// --------------------
function executeCommand(cmd, api, event, args, session, userID) {
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

    const context = {
        api,
        event,
        args,
        prefix: session.prefix,
        adminID: session.adminID,
        style,
        logger: logger
    };

    if (cmd.execute) {
        cmd.execute(api, event, args, context);
    } else if (cmd.run) {
        cmd.run(context);
    }
}

// --------------------
// Start Server
// --------------------
app.listen(PORT, () => {
    logger.success(`Multi-Account Dashboard started on http://localhost:${PORT}`);
    logger.info('System initialized - Ready for multi-account operation');
    
    // Auto-load all accounts after server starts
    setTimeout(() => {
        autoLoadAllAccounts();
    }, 1000);
});

// --------------------
// Graceful Shutdown
// --------------------
process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    Object.keys(activeSessions).forEach(uid => {
        activeSessions[uid].api.logout(() => {});
    });
    process.exit(0);
});
