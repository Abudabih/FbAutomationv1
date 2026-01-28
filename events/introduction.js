module.exports = async (api, event, config, style) => {
    // Trigger lang kung BOT ang na-add
    if (event.type !== "event" || event.logMessageType !== "log:subscribe") return;

    const botID = api.getCurrentUserID();
    const addedParticipants = event.logMessageData.addedParticipants || [];

    // Check kung bot mismo ang na-add
    const isBotAdded = addedParticipants.some(p => p.userFbId === botID);
    if (!isBotAdded) return;

    // Kunin ang nag-add (author)
    let adderName = "Facebook User";
    if (event.author) {
        // Try gamitin fullName kung available sa participants
        const adderObj = addedParticipants.find(p => p.userFbId === event.author);
        if (adderObj && adderObj.fullName) {
            adderName = adderObj.fullName;
        } else {
            // fallback sa event.author mismo
            adderName = "Facebook User";
        }
    }

    const introMsg =
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

    api.sendMessage(introMsg, event.threadID);
};
