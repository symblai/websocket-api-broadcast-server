const { startWebSocketAPIRequest } = require('./WebSocketAPIHelper');
const realtimeSessionId = process.argv[2] || "";
const basePath = process.argv[3] || "http://localhost:3600";
const endConnectionAfter = parseInt(process.argv[4] || 60);

if (!realtimeSessionId) {
    throw new Error("realtimeSessionId needs to be set for listening to an ongoing session.");
}

const users = {
    "ben": {
        name: "Ben",
        userId: "ben@example.ai"
    }
};

(async () => {
    const activeListenerConnections = await Promise.all(Object.values(users).map(async user => {
        const activeConnection = await startWebSocketAPIRequest({
            handlers: {
                'onSpeechDetected': (data) => {
                    console.log(user.name, 'onSpeechDetected', JSON.stringify(data));
                },
                'onMessageResponse': (data) => {
                    console.log(user.name, 'onMessageResponse', JSON.stringify(data));
                },
                'onInsightResponse': (data) => {
                    console.log(user.name, 'onInsightResponse', JSON.stringify(data));
                }
            },
            id: realtimeSessionId,
            basePath
        });

        return { activeConnection, user }
    }));

    setTimeout(() => {
        activeListenerConnections.forEach(({activeConnection, user}) => {
            activeConnection.stop().then((conversationData) => {
                console.log('Connection stopped for listener:', user);
                console.log('Conversation Data', conversationData);
            }).catch(console.error);
        });
    }, endConnectionAfter * 1000);
})();






