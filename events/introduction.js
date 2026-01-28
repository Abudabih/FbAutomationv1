// src/events/introduction.js
const path = require('path');

// Correct path to getUserInfo and utils
const utils = require(path.join(__dirname, '..', 'package/src/utils'));
const getUserInfoFactory = require(path.join(__dirname, '..', 'package/src/deltas/apis/users/getUserInfo'));
const getUserInfo = getUserInfoFactory(utils, null, { jar: {} });

module.exports = async (api, event, config, style) => {
  // Trigger only kapag ang bot ang na-add
  if (event.logMessageType !== "log:subscribe") return;

  const botID = api.getCurrentUserID();
  const addedParticipants = event.logMessageData.addedParticipants;

  for (const participant of addedParticipants) {
    if (participant.userFbId === botID) {
      // Kunin ang pangalan ng nag-add
      let adderName = "Facebook User";
      try {
        const userInfo = await getUserInfo(event.author, true);
        adderName = userInfo?.name || adderName;
      } catch (e) {
        console.error("Failed to fetch adder name:", e);
      }

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
  }
};
