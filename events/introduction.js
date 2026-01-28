const fs = require('fs-extra');

module.exports = async (api, event, config, style) => {
    // Check kung ang bot ang sumali sa GC
    if (event.logMessageType === "log:subscribe") {
        const { threadID, author } = event;
        const botID = api.getCurrentUserID();
        const addedParticipants = event.logMessageData.addedParticipants;

        const botWasAdded = addedParticipants.some(p => p.userFbId === botID);

        if (botWasAdded) {
            try {
                // Kunin ang info para sa pangalan
                const info = await api.getUserInfo(author);
                const name = info[author]?.name || "Admin";

                const msg = {
                    body: `𝗗𝗢𝗨𝗚𝗛𝗡𝗨𝗧-𝗕𝗢𝗧\n` +
                          `━━━━━━━━━━━━━━━━━━\n` +
                          `✨ 𝗔𝗱𝗱𝗲𝗱 𝘁𝗼 𝗮 𝗡𝗲𝘄 𝗚𝗿𝗼𝘂𝗽 𝗖𝗵𝗮𝘁! ✨\n\n` +
                          `Hello everyone! I'm 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁 𝗕𝗼𝘁, your automation assistant! 🍩🤖\n\n` +
                          `Type ❪ **${config.prefix}help** ❫ to see my commands.\n\n` +
                          `━━━━━━━━━━━━━━━━━━\n` +
                          `👤 𝗔𝗱𝗱𝗲𝗱 𝗯𝘆: ${name}\n` +
                          `👑 𝗢𝘄𝗻𝗲𝗿: 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁\n` +
                          `🚀 𝗦𝘁𝗮𝘁𝘂𝘀: Active!\n` +
                          `━━━━━━━━⊱⋆⊰━━━━━━━━`,
                    mentions: [{
                        tag: name,
                        id: author
                    }]
                };

                api.sendMessage(msg, threadID);
            } catch (err) {
                console.error("Error sa intro mention:", err);
            }
        }
    }
};
