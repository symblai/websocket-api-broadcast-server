const logger = require('../winston');
const config = require('../config');
const {sdk} = require('symbl-node');

const {symbl, symblDeploymentBasePath} = config;

const appId = process.env.SYMBL_APP_ID || symbl.appId;
const appSecret = process.env.SYMBL_APP_SECRET || symbl.appSecret;

(async () => {
    return sdk.init({
        appId,
        appSecret,
        basePath: symblDeploymentBasePath
    })
})().catch((err) => {
    logger.error('Error while initializing client SDK: ' + err.message, {err});
});

class SymblWebSocketAPI {
    constructor(handlers = {}, connectionId, connectionRefId) {
        this.handlers = handlers;
        this.connectionId = connectionId;
        this.connectionRefId = connectionRefId;

        this.onSpeechDetected = this.onSpeechDetected.bind(this);
        this.onMessageResponse = this.onMessageResponse.bind(this);
        this.onInsightResponse = this.onInsightResponse.bind(this);
    }

    async connect(startRequest = {}) {
        logger.info('Start Request', {startRequest});
        const sampleRateHertz = startRequest.config.speechRecognition.sampleRateHertz;
        const requestBody = {
            id: this.connectionId,
            insightTypes: ["action_item", "question"],
            config: {
                confidenceThreshold: 0.5,
                timezoneOffset: 480,
                languageCode: "en-US",
                sampleRateHertz,
            },
            ...startRequest,
            handlers: {
                'onSpeechDetected': this.onSpeechDetected,
                'onMessageResponse': this.onMessageResponse,
                'onInsightResponse': this.onInsightResponse
            }
        };

        requestBody.config.sampleRateHertz = sampleRateHertz;

        this.connection = await sdk.startRealtimeRequest(requestBody);

        return { conversationId: this.connection.conversationId, speaker: startRequest.speaker };
    }

    async disconnect() {
        if (this.connection) {
            const conversationData = await this.connection.stop();
            logger.debug('Conversation Data', conversationData);

            return {
                type: 'message',
                message: {
                    type: 'conversation_completed',
                    ...conversationData
                }
            };
        } else {
            logger.debug('Connection already stopped for connectionId: ' + this.connectionId);
        }
    }

    async sendAudio(audioData) {
        this.connection && this.connection.sendAudio(audioData);
    }

    onSpeechDetected(speechData) {
        this.handlers.onSpeechDetected && this.handlers.onSpeechDetected({
            type: 'message',
            message: speechData
        });
    }

    onMessageResponse(messages) {
        logger.debug('onMessageResponse', {messages});
        this.handlers.onMessageResponse && this.handlers.onMessageResponse({
            type: 'message_response',
            messages
        });
    }

    onInsightResponse(insights) {
        logger.debug('onInsightResponse', {insights});
        this.handlers.onInsightResponse && this.handlers.onInsightResponse({
            type: 'insight_response',
            insights
        });
    }

    onError(error) {
        this.handlers.onError && this.handlers.onError({
            type: 'message',
            message: error
        });
    }
}

module.exports = SymblWebSocketAPI;
