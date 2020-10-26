const SymblWebSocketAPI = require("./SymblWebSocketAPI");

const logger = require('../winston');
const uuid = require('uuid').v4;

const getError = (err, message) => {
    let details = 'No additional details available.';
    if (err && err instanceof Error) {
        details = err.message || details;
    }
    return {
        type: 'error',
        details,
        message: message || 'Unhandled error occurred. Please contact us at support@rammer.ai to report this issue.'
    }
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

        this.activeConnections[connectionId].connections[connectionRefId] = { appConnection, symblConnection };
    }

    removeConnection(connectionId, connectionRefId) {
        if (this.activeConnections[connectionId] && this.activeConnections[connectionId].connections[connectionRefId]) {
            delete this.activeConnections[connectionId].connections[connectionRefId];
        } else {
            logger.error(`No connection found with ${connectionId} and ${connectionRefId}`);
        }
    }

    getConnection(connectionId, connectionRefId) {
        if (connectionId) {
            if (connectionRefId) {
                return this.activeConnections[connectionId].connections[connectionRefId];
            }

            return this.activeConnections[connectionId];
        }
        logger.error('No connection id', this.activeConnections);
        return {};
    }

    async sendDataOnConnections(connectionId, data) {
        if (!!this.activeConnections[connectionId]) {
            Object.values(this.activeConnections[connectionId].connections).forEach(connection => {
                connection.appConnection.send(JSON.stringify(data));
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
        const { mode } = request.resourceURL.query;
        logger.debug('Mode: ' + mode);

        if (mode !== undefined && mode !== 'listener' && mode !== 'speaker') {
            return '';
        }

        return mode;
    }

    onRequestReceived(request, options = {}) {
        const connectionId = this.getConnectionIdFromRequest(request);
        const mode = this.getModeFromRequest(request);

        logger.debug('ConnectionID: ' + connectionId);

        if (!mode) {
            const errorString = `No valid mode passed in the query-params. Please pass in the mode query-param which can take on of [listener, speaker]`;
            logger.error(errorString);
            request.reject(400, errorString);

            return;
        }

        if (connectionId) {
            const connectionRefId = uuid();
            const appConnection = request.accept(request.origin);
            let symblWebSocketConnection = {};

            if (mode === 'speaker') {
                symblWebSocketConnection = new SymblWebSocketAPI({
                    'onSpeechDetected': this.getOnSpeechDetected(connectionId, connectionRefId, mode),
                    'onMessageResponse': this.getOnMessageData(connectionId, connectionRefId, mode),
                    'onInsightDetected': this.getOnInsightsData(connectionId, connectionRefId, mode),
                }, connectionId, connectionRefId, mode);
            }

            this.addConnection(appConnection, symblWebSocketConnection, connectionId, connectionRefId);

            this.bindConnection(appConnection, connectionId, connectionRefId, { ...options, mode });
            logger.info('Connection added and bound');
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

    getOnMessage(connection, connectionId, connectionRefId, options) {
        const { mode } = options;
        return async (message) => {
            if (message.type === 'binary') {
                const value = this.getConnection(connectionId, connectionRefId);
                if (value && value.symblConnection && !value.listener) {
                    await value.symblConnection.sendAudio(message.binaryData);
                } else if(!value.listener) {
                    logger.warning(`No active connection detected but incoming audio is being pushed.`);
                }
            } else if (message.type === 'utf8') {
                if (message.utf8Data) {
                    try {
                        const data = JSON.parse(message.utf8Data);

                        const {type, config: { apiMode } = {} } = data;

                        if (!mode && !apiMode) {
                            logger.debug(`'mode' must be provided in the payload inside 'config' or as a query param and must take one of the values from [listener, speaker]`);
                            connection.send(getError(null, `'mode' must be provided in the payload inside 'config' or as a query param and must take one of the values from [listener, speaker]`));

                            return;
                        } else {
                            this.getConnection(connectionId, connectionRefId).mode = mode || apiMode;
                        }

                        if (type) {
                            if (type.toLowerCase() === 'start_request' || type.toLowerCase() === 'stop_request' || type.toLowerCase() === 'stop_recognition') {
                                const value = this.getConnection(connectionId, connectionRefId);
                                if (value && value.symblConnection) {
                                    if (type.toLowerCase() === 'start_request') {
                                        let response;
                                        if ((!!mode && mode === 'speaker') || (!!apiMode && apiMode === 'speaker')) {
                                            this.activeConnections[connectionId].connections[connectionRefId].speaker = await value.symblConnection.connect(data);
                                            response = JSON.stringify({
                                                type: 'message',
                                                message: { type: 'recognition_started' }
                                            });
                                        } else {
                                            this.activeConnections[connectionId].connections[connectionRefId].listener = true;
                                            response = JSON.stringify({
                                                type: 'message',
                                                message: { type: 'listening_started' }
                                            });
                                        }

                                        value.appConnection && value.appConnection.send(response);
                                    } else if (value.toLowerCase() === 'stop_request') {
                                        if (!!value.symblConnection) {
                                            const conversationData = await value.symblConnection.disconnect(connectionId);
                                            value.appConnection && value.appConnection.send(JSON.stringify(conversationData));
                                        }

                                        value.appConnection && value.appConnection.close();

                                        this.removeConnection(connectionId, connectionRefId);
                                    }
                                } else {
                                    logger.warning(`No active connection detected for pushing requests`);
                                }
                            } else {
                                logger.debug('Unsupported \'type\' detected: ', {
                                    type
                                });
                                connection.send(JSON.stringify(getError(null, 'Unsupported \'type\' detected: ' + type)));
                            }
                        } else {
                            logger.debug('\'type\' must be provided in the payload.');
                            connection.send(getError(null, '\'type\' must be provided in the payload.'));
                        }

                    } catch (e) {
                        logger.error('Error while establishing connection with Symbl Backend' + e.toString());
                        connection.send(getError(e, 'Error while establishing connection with backend'));
                    }
                }
            }
        };
    }

    async closeAppConnection(connectionId, connectionRefId) {
        const connectionRef = this.getConnection(connectionId, connectionRefId);
        if (connectionRef && Object.keys(connectionRef).length > 0) {
            logger.debug('WebSocket connection closed.', {
                connectionId: connectionId
            });
            logger.debug(`Attempting to stop processing for this connection.`);
            await connectionRef.symblConnection && connectionRef.symblConnection.disconnect();

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
        return async () => {
            logger.error('Error occurred in the webSocket connection. Stopping the request for connection: ', {
                connectionId
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
