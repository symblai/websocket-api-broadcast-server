const express = require('express');
const logger = require('morgan');

const WebSocketServer = require('websocket').server;
const WebSocketRouter = require('websocket').router;

const RealTimeConnectionsHelper = require('./symbl/RealTimeConnectionsHelper');
const realTimeConnectionsHelper = new RealTimeConnectionsHelper();

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const server = app.listen(process.env.PORT || 3600, () => {
    console.log("Symbl's WebSocket-API-Broadcast server listening on port: " + server.address().port);
});

const webSocketServer = new WebSocketServer({
    httpServer: server
});

const wsRouter = new WebSocketRouter();
wsRouter.attachServer(webSocketServer);
const onReqReceived = function(...args){
    realTimeConnectionsHelper.onRequestReceived(...args);
};

wsRouter.mount(new RegExp('^/symbl/participant/.*$'), '*', onReqReceived);

module.exports = app;
