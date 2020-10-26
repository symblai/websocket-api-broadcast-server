const logger = require('../winston');
const config = require('../config');
const { sdk } = require('symbl-node');

const { symbl } = config;

const appId = process.env.SYMBL_APP_ID || symbl.appId;
const appSecret = process.env.SYMBL_APP_SECRET || symbl.appSecret;

(async () => {
    return sdk.init({
        appId,
        appSecret,
        basePath: 'https://api.symbl.ai'
    })
})().catch((err) => {
    logger.error('Error while initializing client SDK: ' + err.message, {err});
});

class SymblWebSocketAPI {
    constructor(handlers = {}, connectionId, connectionRefId, mode) {
        this.handlers = handlers;
        this.connectionId = connectionId;
        this.connectionRefId = connectionRefId;
        this.mode = mode;

        this.onSpeechDetected = this.onSpeechDetected.bind(this);
        this.onMessageResponse = this.onMessageResponse.bind(this);
        this.onInsightResponse = this.onInsightResponse.bind(this);
    }

    async connect(startRequest = {}) {
        logger.info('Start Request', { startRequest });
        this.connection = await sdk.startRealtimeRequest({
            id: this.connectionId,
            insightTypes: ["action_item", "question"],
            config: {
                confidenceThreshold: 0.5,
                timezoneOffset: 480,
                languageCode: "en-US",
                sampleRateHertz: 48000,
            },
            ...startRequest,
            handlers: {
                'onSpeechDetected': this.onSpeechDetected,
                'onMessageResponse': this.onMessageResponse,
                'onInsightResponse': this.onInsightResponse
            }
        });

        return startRequest.speaker;
    }

    async disconnect() {
        if (this.connection) {
            const conversationData = await this.connection.stop();
            logger.debug('Conversation Data', conversationData);
            return conversationData;
        } else {
            logger.debug('Connection already stopped for connectionId: ' +  this.connectionId);
        }
    }

    async sendAudio(audioData) {
        this.connection && this.connection.sendAudio(audioData);
    }

    onSpeechDetected(speechData) {
        this.handlers.onSpeechDetected && this.handlers.onSpeechDetected(speechData);
    }

    onMessageResponse(messages) {
        logger.info('onMessageResponse', {messages});
        this.handlers.onMessageResponse && this.handlers.onMessageResponse(messages);
    }

    onInsightResponse(insights) {
        this.handlers.onInsightResponse && this.handlers.onInsightResponse(insights);
    }
}

module.exports = SymblWebSocketAPI;
