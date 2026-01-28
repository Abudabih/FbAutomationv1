const fs = require('fs-extra');

module.exports = async (api, event, config, style) => {
    if (event.logMessageType === "log:subscribe") {
        const { threadID, author } = event;
        const botID = api.getCurrentUserID();
        const addedParticipants = event.logMessageData.addedParticipants;

        const botWasAdded = addedParticipants.some(p => p.userFbId === botID);

        if (botWasAdded) {
            try {
                // Kunin ang lahat ng user info sa thread para sigurado
                const threadInfo = await api.getThreadInfo(threadID);
                const senderInfo = await api.getUserInfo(author);
                
                // Kunin ang name mula sa user info, kung wala, gamitin ang sa thread list
                let name = senderInfo[author]?.name || "User";

                // Kung "User" pa rin, hanapin sa threadInfo.userInfo list
                if (name === "User" && threadInfo.userInfo) {
                    const found = threadInfo.userInfo.find(u => u.id === author);
                    if (found) name = found.name;
                }

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
                console.error("Error fetching name:", err);
                // Last resort kung nag-error talaga ang API
                api.sendMessage(`Hello! I'm 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁 𝗕𝗼𝘁. Type ${config.prefix}help to start!`, threadID);
            }
        }
    }
};
