const basePath = process.argv[3] || "http://localhost:3600";
const endConnectionAfter = parseInt(process.argv[4] || 60);
const sampleRate = parseInt(process.argv[5] || 16000);

const { startWebSocketAPIRequest } = require('./WebSocketAPIHelper');

const uuid = require('uuid').v4;
const mic = require('mic');

const micInstance = mic({
    rate: sampleRate,
    channels: '1',
    debug: false,
    exitOnSilence: 6
});

const micInputStream = micInstance.getAudioStream();

const users = {
    "john": {
        userId: 'john@example.com',
        name: 'John'
    },
};

const realtimeSessionId = process.argv[2] || uuid();

console.log('RealTime Session ID:', realtimeSessionId);

(async () => {
    const sendAudioArray = [];
    const activeSpeakerConnections = await Promise.all(Object.values(users).map(async user => {
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
            insightTypes: ["action_item", "question"],
            config: {
                confidenceThreshold: 0.5,
                timezoneOffset: 480,
                languageCode: "en-US",
                sampleRateHertz: sampleRate,
                mode: "speaker"
            },
            speaker: user,
            basePath
        });

        console.log('Connection Started for speaker: ', user, activeConnection.conversationId);

        sendAudioArray.push(activeConnection.sendAudio);

        return { activeConnection, user };
    }));

    setTimeout(() => {
        micInstance.stop();
        activeSpeakerConnections.forEach(({activeConnection, user}) => {
            activeConnection.stop().then((conversationData) => {
                console.log('Connection stopped for speaker:', user);
                console.log('Conversation Data', conversationData);
            }).catch(console.error);
        });
    }, endConnectionAfter * 1000);

    micInputStream.on('data', (data) => {
        sendAudioArray.forEach(sendAudio => sendAudio(data));
    });

    micInstance.start();
})();
