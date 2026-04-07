const MP = (() => {
    let peer = null;
    let conn = null;
    let roomCode = '';
    let isHost = false;
    let messageHandler = null;
    let statusHandler = null;

    function generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    function setStatus(msg) {
        if (statusHandler) statusHandler(msg);
    }

    function setupConn(c) {
        conn = c;
        conn.on('data', (data) => {
            if (messageHandler) messageHandler(data);
        });
        conn.on('close', () => {
            setStatus('Opponent disconnected');
            conn = null;
        });
        conn.on('error', (err) => {
            setStatus('Connection error: ' + err.type);
        });
    }

    function createRoom() {
        return new Promise((resolve, reject) => {
            roomCode = generateCode();
            const peerId = 'clocksim-' + roomCode;
            isHost = true;

            try {
                peer = new Peer(peerId);
            } catch (e) {
                reject('Failed to create peer: ' + e.message);
                return;
            }

            peer.on('open', () => {
                setStatus('Room created. Waiting...');
                resolve(roomCode);
            });

            peer.on('connection', (c) => {
                setupConn(c);
                c.on('open', () => {
                    setStatus('Opponent connected!');
                    if (messageHandler) messageHandler({ type: 'peer-connected' });
                });
            });

            peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    roomCode = generateCode();
                    peer.destroy();
                    createRoom().then(resolve).catch(reject);
                } else {
                    setStatus('Error: ' + err.type);
                    reject(err.type);
                }
            });
        });
    }

    function joinRoom(code) {
        return new Promise((resolve, reject) => {
            roomCode = code.toUpperCase().trim();
            isHost = false;
            const peerId = 'clocksim-join-' + roomCode + '-' + Date.now();

            try {
                peer = new Peer(peerId);
            } catch (e) {
                reject('Failed to create peer');
                return;
            }

            peer.on('open', () => {
                setStatus('Connecting to room...');
                const c = peer.connect('clocksim-' + roomCode, { reliable: true });

                c.on('open', () => {
                    setupConn(c);
                    setStatus('Connected!');
                    resolve();
                });

                c.on('error', (err) => {
                    setStatus('Connection failed');
                    reject(err);
                });
            });

            peer.on('error', (err) => {
                if (err.type === 'peer-unavailable') {
                    setStatus('Room not found');
                    reject('Room not found');
                } else {
                    setStatus('Error: ' + err.type);
                    reject(err.type);
                }
            });
        });
    }

    function send(data) {
        if (conn && conn.open) {
            conn.send(data);
        }
    }

    function onMessage(handler) {
        messageHandler = handler;
    }

    function onStatus(handler) {
        statusHandler = handler;
    }

    function disconnect() {
        if (conn) { conn.close(); conn = null; }
        if (peer) { peer.destroy(); peer = null; }
        roomCode = '';
        isHost = false;
    }

    function connected() {
        return conn && conn.open;
    }

    return {
        createRoom, joinRoom, send, onMessage, onStatus,
        disconnect, connected,
        get isHost() { return isHost; },
        get roomCode() { return roomCode; },
    };
})();
