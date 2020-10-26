require('dotenv').config();

module.exports = {
    loggerConfig: {
        path: '/var/log/rammer'
    },
    symbl: {
        appId: process.env.SYMBL_APP_ID,
        appSecret: process.env.SYMBL_APP_SECRET
    },
    symblDeploymentBasePath: process.env.SYMBL_DEPLOYMENT_BASE_PATH || "https://api.symbl.ai"
};
