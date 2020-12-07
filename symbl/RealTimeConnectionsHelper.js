const SymblWebSocketAPI = require("./SymblWebSocketAPI");

const logger = require('../winston');
const uuid = require('uuid').v4;

const getError = (err, message) => {
    let details = 'No additional details available.';
    if (err && err instanceof Error) {
        details = err.message || details;
    }
    return JSON.stringify({
        type: 'error',
        details,
        message: message || 'Unhandled error occurred. Please contact us at support@rammer.ai to report this issue.'
    });
};

const RealTimeConnectionsHelper = class {
    constructor() {
        this.activeConnections = {};
    }

    addConnection(appConnection, symblConnection, connectionId, connectionRefId) {
        if (!this.activeConnections[connectionId]) {
            this.activeConnections[connectionId] = {};
            this.activeConnections[connectionId].connections = {};
        }

        this.activeConnections[connectionId].connections[connectionRefId] = {appConnection, symblConnection};
    }

    removeConnection(connectionId, connectionRefId) {
        if (this.activeConnections[connectionId] && this.activeConnections[connectionId].connections[connectionRefId]) {
            delete this.activeConnections[connectionId].connections[connectionRefId];
            if (Object.keys(this.activeConnections[connectionId].connections).length <= 0) {
                logger.debug("Clearing cache for connectionId: " + connectionId);
                delete this.activeConnections[connectionId];
            }
        } else {
            logger.error(`No connection found with ${connectionId} and ${connectionRefId}`);
        }
    }

    getConnection(connectionId, connectionRefId) {
        if (connectionId && this.activeConnections[connectionId]) {
            if (connectionRefId && this.activeConnections[connectionId].connections[connectionRefId]) {
                return this.activeConnections[connectionId].connections[connectionRefId];
            }

            return this.activeConnections[connectionId];
        }
        logger.warning('Connection ID: ' + connectionId + ' not active anymore', {connectionId, connectionRefId});
        return {};
    }

    async sendDataOnConnections(connectionId, data) {
        if (!!this.activeConnections[connectionId]) {
            Object.values(this.activeConnections[connectionId].connections).forEach(connection => {
                connection.appConnection.sendUTF(JSON.stringify(data));
            });
        } else {
            logger.warning('Trying to send data on a closed/unestablished connection', {connectionId});
        }
    }

    getConnectionIdFromRequest(request) {
        const path = request.resourceURL.pathname;
        let connectionId = null;
        logger.debug('Path: ' + path);

        if (path) {
            const parts = path.split('/');
            if (parts.length >= 3) {
                connectionId = parts[parts.length - 1];
            }
        }

        return connectionId;
    }

    getModeFromRequest(request) {
        const {mode} = request.resourceURL.query;
        logger.debug('Mode (Query-Param): ' + mode);

        if (mode !== undefined && mode !== 'listener' && mode !== 'speaker') {
            return '';
        }

        return mode;
    }

    onRequestReceived(request, options = {}) {
        const connectionId = this.getConnectionIdFromRequest(request);
        const mode = this.getModeFromRequest(request);

        logger.debug('ConnectionID: ' + connectionId);

        if (connectionId) {
            const connectionRefId = uuid();
            const appConnection = request.accept(request.origin);
            let symblWebSocketConnection;

            symblWebSocketConnection = new SymblWebSocketAPI({
                'onSpeechDetected': this.getOnSpeechDetected(connectionId, connectionRefId, mode),
                'onMessageResponse': this.getOnMessageData(connectionId, connectionRefId, mode),
                'onInsightResponse': this.getOnInsightsData(connectionId, connectionRefId, mode)
            }, connectionId, connectionRefId, mode);

            this.addConnection(appConnection, symblWebSocketConnection, connectionId, connectionRefId);

            this.bindConnection(appConnection, connectionId, connectionRefId, {...options, mode});
            logger.info(`[${connectionId}] Connection added and bound`);
        } else {
            logger.notice('No connectionId found in the path.. Rejecting the request');
            request.reject();
        }
    }

    getOnSpeechDetected(connectionId, connectionRefId) {
        return (speechData) => {
            const connections = this.getConnection(connectionId, connectionRefId);
            if (connections) {
                this.sendDataOnConnections(connectionId, speechData);
            } else {
                logger.warning(`Connection with connectionId ${connectionId} and connectionRefId: ${connectionRefId} not found`);
            }
        }
    }

    getOnMessageData(connectionId, connectionRefId) {
        return (messages) => {
            const connections = this.getConnection(connectionId, connectionRefId);

            if (connections) {
                this.sendDataOnConnections(connectionId, messages);
            } else {
                logger.warning(`Connection with connectionId ${connectionId} and connectionRefId: ${connectionRefId} not found`);
            }
        }
    }

    getOnInsightsData(connectionId, connectionRefId) {
        return (insights) => {
            const connections = this.getConnection(connectionId, connectionRefId);
            if (connections) {
                this.sendDataOnConnections(connectionId, insights);
            } else {
                logger.warning(`Connection with connectionId ${connectionId} and connectionRefId: ${connectionRefId} not found`);
            }
        }
    }

    getMembersForConnectionId(connectionId) {
        const members = {
            listeners: 0,
            speakers: 0,
        };

        if (this.activeConnections[connectionId] && this.activeConnections[connectionId].connections) {
            Object.values(this.activeConnections[connectionId].connections).forEach(connection => {
                if (connection.speaker) {
                    members.speakers += 1;
                } else {
                    members.listeners += 1;
                }
            });
        }

        return {
            type: 'member_response',
            members
        };
    }

    sendMembersData(connectionId) {
        const connections = this.getConnection(connectionId);
        const membersData = this.getMembersForConnectionId(connectionId);

        if (connections) {
            this.sendDataOnConnections(connectionId, membersData);
        } else {
            logger.warning(`Connection with connectionId ${connectionId} and connectionRefId: ${connectionRefId} not found`);
        }
    }

    getOnMessage(connection, connectionId, connectionRefId, options) {
        const {mode} = options;
        return async (message) => {
            if (message.type === 'binary') {
                const value = this.getConnection(connectionId, connectionRefId);
                if (value && value.symblConnection && !value.listener) {
                    await value.symblConnection.sendAudio(message.binaryData);
                } else if (!value.listener) {
                    logger.warning(`No active connection detected but incoming audio is being pushed.`);
                }
            } else if (message.type === 'utf8' && message.utf8Data) {
                try {
                    const data = JSON.parse(message.utf8Data);

                    const {type, config: {mode: apiMode, speechRecognition: {sampleRateHertz} = {}} = {}} = data;

                    logger.notice(`[${connectionId}] Request Payload`, {data});

                    if (type) {
                        if (type.toLowerCase() === 'start_request' || type.toLowerCase() === 'stop_request' || type.toLowerCase() === 'stop_recognition') {
                            if (type.toLowerCase() === 'start_request' && !mode && !apiMode) {
                                logger.error(`'mode' must be provided in the payload inside 'config' or as a query param and must take one of the values from [listener, speaker]`);
                                connection.send(getError(null, `'mode' must be provided in the payload inside 'config' or as a query param and must take one of the values from [listener, speaker]`));

                                return;
                            } else if (!this.getConnection(connectionId, connectionRefId).mode) {
                                this.getConnection(connectionId, connectionRefId).mode = mode || apiMode;
                            }

                            const value = this.getConnection(connectionId, connectionRefId);
                            if (value) {
                                if (type.toLowerCase() === 'start_request') {
                                    let response;
                                    if ((!!mode && mode === 'speaker') || (!!apiMode && apiMode === 'speaker')) {
                                        if (!sampleRateHertz) {
                                            connection.send(getError(null, `sampleRateHertz must be provided for mode 'speaker'.`));
                                        } else if (typeof sampleRateHertz !== 'number') {
                                            connection.send(getError(null, `sampleRateHertz must be a valid number.`));
                                        } else {
                                            const { conversationId, speaker } = await value.symblConnection.connect(data);

                                            this.activeConnections[connectionId].connections[connectionRefId].speaker = speaker;
                                            this.activeConnections[connectionId].conversationId = conversationId;

                                            response = JSON.stringify({
                                                type: 'message',
                                                message: {
                                                    type: 'recognition_started',
                                                    data: {
                                                        conversationId
                                                    }
                                                }
                                            });
                                        }
                                    } else {
                                        this.activeConnections[connectionId].connections[connectionRefId].listener = true;
                                        delete this.activeConnections[connectionId].connections[connectionRefId].symblConnection;

                                        response = JSON.stringify({
                                            type: 'message',
                                            message: {
                                                type: 'recognition_started',
                                                data: {
                                                    conversationId: this.activeConnections[connectionId].conversationId
                                                }
                                            }
                                        });
                                    }

                                    value.appConnection && response && value.appConnection.sendUTF(response);
                                    this.sendMembersData(connectionId);
                                } else if (type.toLowerCase() === 'stop_request') {
                                    if (this.getConnection(connectionId, connectionRefId).mode === 'speaker') {
                                        const conversationData = await value.symblConnection.disconnect(connectionId);
                                        if (conversationData)
                                            value.appConnection && value.appConnection.sendUTF(JSON.stringify(conversationData));
                                    }

                                    if (!!apiMode && apiMode === 'listener') {
                                        this.activeConnections[connectionId].connections[connectionRefId].listener = true;
                                        delete this.activeConnections[connectionId].connections[connectionRefId].speaker;
                                        delete this.activeConnections[connectionId].connections[connectionRefId].symblConnection;

                                        value.appConnection && value.appConnection.sendUTF(JSON.stringify({
                                            type: 'message',
                                            message: {
                                                type: 'recognition_started',
                                                data: {
                                                    conversationId: this.activeConnections[connectionId].conversationId
                                                }
                                            }
                                        }));
                                    } else {
                                        value.appConnection && value.appConnection.sendUTF(JSON.stringify({
                                            type: 'message',
                                            message: {
                                                type: 'conversation_completed',
                                                data: {
                                                    conversationId: this.activeConnections[connectionId].conversationId
                                                }
                                            }
                                        }));

                                        setImmediate(() => {
                                            value.appConnection && value.appConnection.close();

                                            this.removeConnection(connectionId, connectionRefId);
                                            this.sendMembersData(connectionId);
                                        });
                                    }
                                }
                            } else {
                                logger.warning(`No active connection detected for pushing requests`);
                            }
                        } else {
                            logger.debug('Unsupported \'type\' detected: ', {
                                type
                            });
                            connection.send(getError(null, 'Unsupported \'type\' detected: ' + type));
                        }
                    } else {
                        logger.debug('\'type\' must be provided in the payload.');
                        connection.send(getError(null, '\'type\' must be provided in the payload.'));
                    }

                } catch (e) {
                    logger.error('Error while establishing connection with Symbl Backend: ' + e.message, {e});
                    connection.send(getError(e, 'Error while establishing connection with backend'));
                }
            }
        };
    }

    async closeAppConnection(connectionId, connectionRefId) {
        const connectionRef = this.getConnection(connectionId, connectionRefId);
        if (connectionRef && Object.keys(connectionRef).length > 0) {
            logger.debug(`Attempting to stop processing for this connection.`);

            await connectionRef.appConnection && connectionRef.appConnection.close();
            await connectionRef.symblConnection && connectionRef.symblConnection.disconnect();

            logger.debug('WebSocket connection closed.', {
                connectionId: connectionId
            });

            this.removeConnection(connectionId, connectionRefId);
        } else {
            logger.warning('No connection reference found with connectionId: ' + connectionId + ' and referenceId: ' + connectionRefId);
        }
    }

    getOnClose(connectionId, connectionRefId) {
        return async () => {
            await this.closeAppConnection(connectionId, connectionRefId);
        };
    }

    getOnError(connectionId, connectionRefId) {
        return async (code, message) => {
            logger.error('Error occurred in the webSocket connection. Stopping the request for connection: ', {
                connectionId,
                code,
                message
            });
            const connectionRef = this.getConnection(connectionId, connectionRefId);
            await connectionRef && connectionRef.symblConnection && connectionRef.symblConnection.disconnect();

            this.removeConnection(connectionId, connectionRefId);
        };
    }

    bindConnection(connection, connectionId, connectionRefId, options) {
        connection.on('message', this.getOnMessage(connection, connectionId, connectionRefId, options));

        connection.on('close', this.getOnClose(connectionId, connectionRefId));

        connection.on('error', this.getOnError(connectionId, connectionRefId));
    };
};

module.exports = RealTimeConnectionsHelper;
