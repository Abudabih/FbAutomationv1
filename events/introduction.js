const getUserInfoFactory = require('../package/src/deltas/apis/users/getUserInfo');
const utils = require('../package/src/utils');

module.exports = async (api, event, config, style) => {
    // Trigger only on BOT being added
    if (event.type !== "event") return;
    if (event.logMessageType !== "log:subscribe") return;

    const botID = api.getCurrentUserID();
    const addedParticipants = event.logMessageData.addedParticipants || [];

    const isBotAdded = addedParticipants.some(p => p.userFbId === botID);
    if (!isBotAdded) return;

    // --------------------
    // INIT getUserInfo (same as ws3-fca internal)
    // --------------------
    const getUserInfo = getUserInfoFactory(
        utils,
        api,
        { jar: api.jar }
    );

    let adderName = "Facebook User";

    try {
        const adderID = event.author; // 🔥 ID ng nag-add
        if (adderID) {
            const userInfo = await getUserInfo(adderID, true);
            if (userInfo && userInfo.name) {
                adderName = userInfo.name;
            }
        }
    } catch (err) {
        console.error("Failed to fetch adder name:", err);
    }

    // --------------------
    // INTRO MESSAGE
    // --------------------
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
