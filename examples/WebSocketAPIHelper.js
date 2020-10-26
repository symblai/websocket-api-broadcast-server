const WebSocket = require('./WebSocketHelper');
const uuid = require('uuid').v4;
const { get } = require('lodash');

const webSocketConnectionStatus = {
    notAvailable: 'not_available',
    notConnected: 'not_connected',
    connected: 'connected',
    error: 'error',
    closed: 'closed',
    connecting: 'connecting'
};

const WebSocketAPIHelper = class {

    constructor(options = {}) {
        let basePath = options.basePath;
        if (basePath.startsWith('https')) {
            basePath = basePath.replace('https', 'wss')
        } else if (basePath.startsWith('http')) {
            basePath = basePath.replace('https', 'wss')
        }
        const uri = `${basePath}/symbl/participant`;

        const {id} = options;

        this.id = id ? id : uuid();

        this.webSocketUrl = `${uri}/${this.id}`;
        this.options = options;

        this.connect = this.connect.bind(this);
        this.onConnectWebSocket = this.onConnectWebSocket.bind(this);
        this.onErrorWebSocket = this.onErrorWebSocket.bind(this);
        this.onMessageWebSocket = this.onMessageWebSocket.bind(this);
        this.onCloseWebSocket = this.onCloseWebSocket.bind(this);

        this.onSpeechDetected = this.onSpeechDetected.bind(this);
        this.onRequestStart = this.onRequestStart.bind(this);
        this.onRequestStop = this.onRequestStop.bind(this);
        this.onMessageResponse = this.onMessageResponse.bind(this);
        this.onInsightResponse = this.onInsightResponse.bind(this);

        this.sendAudio = this.sendAudio.bind(this);
        this.sendStart = this.sendStart.bind(this);

        this.handlers = this.options.handlers || {};

        this.retryCount = 0;
        this.requestStarted = false;
    }

    onErrorWebSocket(err) {
        this.webSocketStatus = webSocketConnectionStatus.error;
        console.error(err);
    }

    onMessageWebSocket(result) {
        // Incoming results for this connection
        if (result) {
            const data = JSON.parse(result);
            if (data.type === 'message') {
                const {message: {type}} = data;

                if (type === 'recognition_started') {
                    this.onRequestStart(data.message);
                } else if (type === 'recognition_result') {
                    this.onSpeechDetected(data.message);
                } else if (type === 'conversation_completed') {
                    this.onRequestStop(data.message);
                } else if (type === 'error') {
                    this.onRequestError(data);
                }
            } else {
                if (data.type === 'message_response') {
                    this.onMessageResponse(data.messages);
                } else if (data.type === 'insight_response') {
                    this.onInsightResponse(data.insights);
                }
            }
        }
    }

    onCloseWebSocket() {
        console.log('WebSocket Closed.');
        this.webSocketStatus = webSocketConnectionStatus.closed;
    }

    onConnectWebSocket() {
        console.log('WebSocket Connected.');
        this.webSocketStatus = webSocketConnectionStatus.connected;
    }

    connect() {
        console.log('WebSocket Connecting.');
        this.webSocketStatus = webSocketConnectionStatus.connecting;
        this.webSocket = new WebSocket({
            url: this.webSocketUrl,
            onError: this.onErrorWebSocket,
            onClose: this.onCloseWebSocket,
            onMessage: this.onMessageWebSocket,
            onConnect: this.onConnectWebSocket
        });
    }

    onRequestStart(message) {
        if (this.requestStartedResolve) {
            this.requestStartedResolve(message.data && message.data.conversationId);
            this.requestStartedResolve = undefined;
        }
    }

    onRequestStop(conversationData) {
        if (this.requestStoppedResolve) {
            this.requestStoppedResolve(conversationData);
            this.requestStoppedResolve = undefined;
        }
        this.webSocket.disconnect();
    }

    onRequestError(err) {
        if (this.requestErrorReject) {
            this.requestErrorReject(err);
            this.requestErrorReject = undefined;
        }
    }

    sendStart(resolve, reject) {
        const {insightTypes, config, speaker} = this.options;
        if (config) {
            const speechRecognition = {};
            if (!config.sampleRateHertz) {
                throw new Error("sampleRateHertz must be provided.")
            } else if (typeof config.sampleRateHertz !== 'number') {
                throw new Error("sampleRateHertz must be a valid number")
            }

            Object.keys(config).forEach(key => {
                switch (key) {
                    case 'engine':
                    case 'encoding':
                    case 'sampleRateHertz':
                    case 'interimResults':
                        speechRecognition[key] = config[key];
                        delete config[key];
                        break;
                    default:
                        break;
                }
            });

            if (Object.keys(speechRecognition).length > 0) {
                config['speechRecognition'] = speechRecognition;
            }
        }
        console.log('Sending start_request to WebSocket API');
        this.requestStartedResolve = resolve;
        this.onRequestError = reject;
        this.requestStarted = true;

        this.webSocket.send(JSON.stringify({
            type: 'start_request',
            insightTypes: insightTypes || [],
            config,
            speaker
        }));
    }

    startRequest() {
        return new Promise((resolve, reject) => {
            const mode = get(this.options, 'config.mode', null);

            if (this.webSocketStatus === webSocketConnectionStatus.connected) {
                if (mode === 'speaker') {
                    this.sendStart(resolve, reject);
                } else {
                    console.log('Connected on listener mode');
                    resolve();
                }
            } else {
                console.log('WebSocket connection status:', this.webSocketStatus);
                const retry = () => {
                    if (this.retryCount < 3 && !this.requestStarted) {
                        this.retryCount > 0 && console.log('Retry attempt: ', this.retryCount);
                        if (this.webSocketStatus === webSocketConnectionStatus.connected) {
                            if (mode === 'speaker') {
                                this.sendStart(resolve, reject);
                            } else {
                                console.log('Connected on listener mode');
                                resolve();
                            }
                            this.retryCount = 0;
                        } else {
                            this.retryCount++;
                            setTimeout(retry.bind(this), 1000 * this.retryCount);
                        }
                    }
                };
                setTimeout(retry.bind(this), 500);
            }
        });
    }

    stopRequest() {
        return new Promise((resolve, reject) => {
            if (this.webSocketStatus === webSocketConnectionStatus.connected) {
                console.log('Send stop request.');
                this.requestStoppedResolve = resolve;
                this.onRequestError = reject;

                this.webSocket.send(JSON.stringify({
                    type: 'stop_request',
                }));
            } else {
                console.warn('WebSocket connection is not connected. No stop request sent.');
                resolve();
            }
        });
    }

    sendAudio(data) {
        this.webSocket.send(data);
    }

    onSpeechDetected(data) {
        if (this.handlers.onSpeechDetected) {
            setImmediate(() => {
                this.handlers.onSpeechDetected(data);
            });
        }
    }

    onMessageResponse(messages) {
        if (this.handlers.onMessageResponse) {
            setImmediate(() => {
                this.handlers.onMessageResponse(messages);
            });
        }
    }

    onInsightResponse(messages) {
        if (this.handlers.onInsightResponse) {
            setImmediate(() => {
                this.handlers.onInsightResponse(messages);
            });
        }
    }
};

const startWebSocketAPIRequest = async (options = {}) => {
    if (!options.basePath) {
        throw new Error('basePath is required to be set to the Base URL of the Symbl WebSocket API Broadcast server');
    }

    const webSocketClient = new WebSocketAPIHelper(options);

    const startRequest = (resolve, reject) => {
        console.log('Starting request.');
        webSocketClient.startRequest().then((conversationId) => {
            conversationId && console.log('WebSocket API request started: ' + conversationId);
            resolve({
                stop: () => {
                    return new Promise((resolve, reject) => {
                        webSocketClient.stopRequest().then((conversationData) => {
                            console.log('WebSocket API request stopped.');
                            if (conversationData)
                                delete conversationData.type;
                            resolve(conversationData);
                        }).catch((err) => {
                            reject(err);
                        });
                    });
                },
                sendAudio: (data) => {
                    webSocketClient.sendAudio(data);
                },
                conversationId
            });
        }).catch((err) => {
            reject(err);
        });
    };

    return new Promise((resolve, reject) => {
        const retry = () => {
            webSocketClient.connect();
            startRequest(resolve, reject);
        };

        setTimeout(retry.bind(this), 0);
    });
};

module.exports = {
    startWebSocketAPIRequest
};
