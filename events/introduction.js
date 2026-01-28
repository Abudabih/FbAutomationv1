const getUserInfo = require('../../package/src/deltas/apis/users/getUserInfo')(
  require('../../package/src/utils'), null, { jar: {} }
);

module.exports = async (api, event, config, style) => {
  if (event.logMessageType === "log:subscribe") {
    const botID = api.getCurrentUserID();
    const addedParticipants = event.logMessageData.addedParticipants;

    for (const participant of addedParticipants) {
      if (participant.userFbId === botID) {
        // Kunin pangalan ng nag-add
        let adderName = "Facebook User";
        try {
          const info = await getUserInfo(event.author);
          if (info?.name) adderName = info.name;
        } catch {}

        const welcomeMsg =
          `𝗗𝗢𝗨𝗚𝗛𝗡𝗨𝗧-𝗕𝗢𝗧\n` +
          `${style.top}\n` +
          `✨ 𝗔𝗱𝗱𝗲𝗱 𝘁𝗼 𝗮 𝗡𝗲𝘄 𝗚𝗿𝗼𝘂𝗽 𝗖𝗵𝗮𝘁! ✨\n\n` +
          `Hello everyone! I'm 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁 𝗕𝗼𝘁, your automation assistant! 🍩🤖\n\n` +
          `Type ❪ **${config.prefix}help** ❫ to see my commands.\n\n` +
          `${style.top}\n` +
          `👤 𝗔𝗱𝗱𝗲𝗱 𝗯𝘆: ${adderName}\n` +
          `👑 𝗢𝘄𝗻𝗲𝗿: 𝗗𝗼𝘂𝗴𝗵𝗻𝘂𝘁\n` +
          `🚀 𝗦𝘁𝗮𝘁𝘂s: Active!\n` +
          `${style.bottom}`;

        api.sendMessage(welcomeMsg, event.threadID);
      }
    }
  }
};
