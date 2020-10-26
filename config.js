require('dotenv').config();

module.exports = {
    loggerConfig: {
        path: '/var/log/rammer'
    },
    symbl: {
        appId: process.env.SYMBL_APP_ID,
        appSecret: process.env.SYMBL_APP_SECRET
    }
};
