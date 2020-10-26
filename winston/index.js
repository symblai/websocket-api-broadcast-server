const winston = require('winston');
const stackDriverLevels = require('./stackDriverSeverityLevels');
const { name: applicationName } = require('../package.json');
const { loggerConfig  } = require('../config');
let logger = null;

const buildStackDriverEntry = winston.format((info) => {
    info.severity = info.level;
    delete  info.level;
    info.application = applicationName;
    return info;
});

const getLogger = () => {
    if(logger) {
        return logger;
    }

    logger = winston.createLogger({
        level: 'debug',
        levels: stackDriverLevels,
        transports: [
            new winston.transports.Console({
                stderrLevels: [
                    'emergency',
                    'alert',
                    'critical',
                    'error',
                    'warning'
                ],
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.prettyPrint(),
                    winston.format.simple()
                ),
                handleExceptions: true
            }),
        ],
        exitOnError: false
    });

    // Add stackdriver on prod env
    if(process.env.ENV && process.env.ENV.toLowerCase() === 'prod') {
        logger.add(
            new winston.transports.File({
                filename: `${loggerConfig.path}/${applicationName}.log`,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    buildStackDriverEntry(),
                    winston.format.json()
                ),
                handleExceptions: true,
                level: 'debug',
                tailable: false,
                maxFiles: 1,
                maxsize: 2097152
            })
        );
    }

    return logger;
};

/**
 * @type {winston.Logger}
 */
module.exports = getLogger();
