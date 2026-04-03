const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PUBLIC_DIR = __dirname;
const ALLOWED_FILE_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg', '.ico', '.png']);
const MAX_USERNAME_LENGTH = 20;
const MAX_ROOM_CODE_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 32;
const MAX_WS_MESSAGE_BYTES = 4096;
const RATE_WINDOW_MS = 10000;
const MAX_MESSAGES_PER_WINDOW = 80;
const MAX_MESSAGES_PER_IP_WINDOW = 160;
const PREP_PHASE_MS = 3000;
const LISTEN_MODE_DURATIONS = {
    noob: 5000,
    easy: 2500,
    hard: [1000, 670],
};
const GUESS_PHASE_MS = 30000;
const NORMAL_HURRY_UP_MS = 5000;
const HARD_HURRY_UP_MS = 2500;
const SUBMIT_GRACE_MS = 3000;
const DAILY_LEADERBOARD_PATH = path.join(__dirname, 'daily-leaderboard.json');
const DAILY_MAX_ENTRIES_PER_DAY = 5000;

// 1. Create HTTP Server to serve static files
const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
            'Allow': 'GET, HEAD',
        });
        res.end('Method Not Allowed');
        return;
    }

    let requestUrl;
    try {
        requestUrl = new URL(req.url, 'http://localhost');
    } catch (error) {
        res.writeHead(400, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
        });
        res.end('Bad Request');
        return;
    }

    let relativePath;
    try {
        relativePath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    } catch (error) {
        res.writeHead(400, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
        });
        res.end('Bad Request');
        return;
    }

    const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.png': 'image/png',
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    if (!ALLOWED_FILE_EXTENSIONS.has(extname) || !filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
        });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': 'no-store',
                });
                res.end('Error: 404 Not Found');
            } else {
                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': 'no-store',
                });
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Referrer-Policy': 'no-referrer',
                'Cross-Origin-Resource-Policy': 'same-origin',
                'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
                'Cache-Control': 'no-store',
                'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            });
            res.end(content, 'utf-8');
        }
    });
});

// 2. Attach WebSocket server to the HTTP server
const wss = new WebSocket.Server({ server });

const players = Object.create(null);
const rooms = Object.create(null); // Use rooms instead of gameSessions
const ipMessageTimestamps = Object.create(null);

wss.on('connection', (ws, request) => {
    if (!isAllowedWebSocketOrigin(request)) {
        ws.close(1008, 'Invalid origin');
        return;
    }

    ws.isAlive = true;
    const playerId = generateId();
    players[playerId] = { ws, id: playerId, messageTimestamps: [], ip: getClientIp(request) };
    sendMessage(ws, 'assignId', { playerId });

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', message => {
        if (typeof message === 'string' && Buffer.byteLength(message, 'utf8') > MAX_WS_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
        }

        if (Buffer.isBuffer(message) && message.length > MAX_WS_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
        }

        if (!allowIncomingMessage(playerId)) {
            sendMessage(ws, 'error', { message: 'Too many requests. Please slow down.' });
            return;
        }

        try {
            const textMessage = Buffer.isBuffer(message) ? message.toString('utf8') : message;
            const { type, payload } = JSON.parse(textMessage);
            if (typeof type !== 'string' || typeof payload !== 'object' || payload === null) {
                sendMessage(ws, 'error', { message: 'Malformed message.' });
                return;
            }
            handleMessage(playerId, type, payload);
        } catch (error) {
            console.error('Failed to parse message or handle it:', message, error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(playerId);
    });
});

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            ws.terminate();
            return;
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

function handleMessage(playerId, type, payload) {
    const player = players[playerId];
    if (!player) return;

    const ALLOWED_TYPES = new Set(['login', 'createRoom', 'joinRoom', 'updateSettings', 'startGame', 'leaveRoom', 'submitGuess', 'updateDraftGuess', 'submitDailyScore']);
    if (!ALLOWED_TYPES.has(type)) {
        sendMessage(player.ws, 'error', { message: 'Unsupported action.' });
        return;
    }

            if (type !== 'login' && !player.username) {
        sendMessage(player.ws, 'error', { message: 'Please login first.' });
        return;
    }

    switch (type) {
        case 'login':
            if (player.username) {
                sendMessage(player.ws, 'error', { message: 'Username is already set.' });
                break;
            }
            player.username = sanitizeUsername(payload?.username);
            if (!player.username) {
                sendMessage(player.ws, 'error', { message: 'Invalid username.' });
            }
            break;

        case 'createRoom':
            if (player.roomCode) {
                sendMessage(player.ws, 'error', { message: 'Leave current room before creating a new one.' });
                break;
            }

            const roomCode = generateRoomCode();
            const password = sanitizePassword(payload?.password);
            const passwordSalt = password ? crypto.randomBytes(16).toString('hex') : null;
            rooms[roomCode] = {
                id: roomCode,
                ownerId: playerId,
                players: [playerId],
                passwordSalt,
                passwordHash: password ? hashPassword(password, passwordSalt) : null,
                settings: {
                    lives: 3,
                    rounds: 3,
                    maxPlayers: clampInteger(payload?.settings?.maxPlayers, 2, 2, 2),
                    listenMode: resolveListenMode(payload?.settings?.listenMode, payload?.settings?.hardMode)
                },
                gameState: null
            };
            player.roomCode = roomCode;
            sendMessage(player.ws, 'roomCreated', { roomCode });
            updateLobby(roomCode);
            break;

        case 'joinRoom':
            if (player.roomCode) {
                sendMessage(player.ws, 'error', { message: 'Leave current room before joining another room.' });
                break;
            }

            const requestedRoomCode = sanitizeRoomCode(payload?.roomCode);
            const requestedPassword = sanitizePassword(payload?.password);
            const room = rooms[requestedRoomCode];
            if (room && room.players.length < room.settings.maxPlayers) {
                if (room.passwordHash) {
                    const submittedHash = hashPassword(requestedPassword, room.passwordSalt);
                    if (submittedHash !== room.passwordHash) {
                        sendMessage(player.ws, 'error', { message: 'Wrong room password.' });
                        break;
                    }
                }

                if (room.gameState) {
                    sendMessage(player.ws, 'error', { message: 'Room is currently in a game.' });
                    break;
                }
                player.roomCode = requestedRoomCode;
                room.players.push(playerId);
                updateLobby(requestedRoomCode);
            } else {
                sendMessage(player.ws, 'error', { message: 'Room not found or is full.' });
            }
            break;

        case 'updateSettings':
            const playerRoom = rooms[player.roomCode];
            if (playerRoom && playerRoom.ownerId === playerId) {
                playerRoom.settings.lives = clampInteger(payload?.lives, 1, 5, playerRoom.settings.lives);
                playerRoom.settings.rounds = clampInteger(payload?.rounds, 1, 10, playerRoom.settings.rounds);
                const requestedMaxPlayers = clampInteger(payload?.maxPlayers, 2, 2, playerRoom.settings.maxPlayers);
                playerRoom.settings.maxPlayers = Math.max(requestedMaxPlayers, playerRoom.players.length);
                playerRoom.settings.listenMode = resolveListenMode(payload?.listenMode, payload?.hardMode, playerRoom.settings.listenMode);
                updateLobby(player.roomCode);
            }
            break;

        case 'startGame':
            const roomToStart = rooms[player.roomCode];
            if (roomToStart && roomToStart.ownerId === playerId && !roomToStart.gameState) {
                if (roomToStart.players.length > 2) {
                    sendMessage(player.ws, 'error', { message: 'Current match mode supports 2 active players. Set max players to 2 or ask others to leave.' });
                    break;
                }

                if (roomToStart.players.length < 2) {
                    sendMessage(player.ws, 'error', { message: 'Need at least 2 players to start.' });
                    break;
                }

                createGameSession(roomToStart);
            }
            break;

        case 'leaveRoom':
            removePlayerFromRoom(playerId);
            break;

        case 'submitGuess':
            const sessionRoom = rooms[player.roomCode];
            if (sessionRoom && sessionRoom.gameState) {
                const session = sessionRoom.gameState;
                if (session.phase !== 'guessing') {
                    sendMessage(player.ws, 'error', { message: 'Guessing is not open yet.' });
                    break;
                }

                if (Date.now() > session.guessingEndsAt + SUBMIT_GRACE_MS) {
                    sendMessage(player.ws, 'error', { message: 'Guess window has closed.' });
                    break;
                }

                if (session.guesses[playerId] === null) {
                    session.guesses[playerId] = clampNumber(payload?.frequency, 100, 1000, session.targetFrequency);
                    const opponentId = session.player1 === playerId ? session.player2 : session.player1;
                    if (session.guesses[opponentId] !== null) {
                        evaluateRound(sessionRoom);
                    } else {
                        applyHurryUpWindow(sessionRoom, session, playerId, opponentId);
                    }
                }
            }
            break;

        case 'updateDraftGuess':
            const draftRoom = rooms[player.roomCode];
            if (draftRoom && draftRoom.gameState) {
                const draftSession = draftRoom.gameState;
                if (draftSession.phase === 'guessing' && draftSession.guesses[playerId] === null) {
                    draftSession.lastKnownGuesses[playerId] = clampNumber(payload?.frequency, 100, 1000, 550);
                }
            }
            break;

        case 'submitDailyScore':
            handleDailyScoreSubmit(player, payload);
            break;
    }
}

function sanitizeDateKey(dateKey) {
    if (typeof dateKey !== 'string') return '';
    const trimmed = dateKey.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return '';
    return trimmed;
}

function loadDailyLeaderboard() {
    try {
        const raw = fs.readFileSync(DAILY_LEADERBOARD_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        console.error('Failed to read daily leaderboard:', error);
        return {};
    }
}

function saveDailyLeaderboard(store) {
    try {
        fs.writeFileSync(DAILY_LEADERBOARD_PATH, JSON.stringify(store, null, 2));
    } catch (error) {
        console.error('Failed to write daily leaderboard:', error);
    }
}

function sortDailyEntries(entries) {
    entries.sort((a, b) => {
        if (b.roundsCompleted !== a.roundsCompleted) {
            return b.roundsCompleted - a.roundsCompleted;
        }

        if (a.totalDelta !== b.totalDelta) {
            return a.totalDelta - b.totalDelta;
        }

        if (a.timeoutCount !== b.timeoutCount) {
            return a.timeoutCount - b.timeoutCount;
        }

        return a.submittedAt - b.submittedAt;
    });
}

function handleDailyScoreSubmit(player, payload) {
    if (!player || !player.ws || !player.username) return;

    const dateKey = sanitizeDateKey(payload?.dateKey);
    if (!dateKey) {
        sendMessage(player.ws, 'error', { message: 'Invalid daily date.' });
        return;
    }

    const maxRounds = clampInteger(payload?.maxRounds, 1, 10, 5);
    const roundsCompleted = clampInteger(payload?.roundsCompleted, 0, maxRounds, 0);
    const totalDelta = Number(clampNumber(payload?.totalDelta, 0, 999999, 0).toFixed(2));
    const timeoutCount = clampInteger(payload?.timeoutCount, 0, maxRounds, 0);

    const leaderboardStore = loadDailyLeaderboard();
    if (!Array.isArray(leaderboardStore[dateKey])) {
        leaderboardStore[dateKey] = [];
    }

    const entry = {
        id: generateId(12),
        playerId: player.id,
        username: sanitizeUsername(player.username) || 'Player',
        roundsCompleted,
        maxRounds,
        totalDelta,
        timeoutCount,
        submittedAt: Date.now(),
    };

    leaderboardStore[dateKey].push(entry);
    sortDailyEntries(leaderboardStore[dateKey]);

    if (leaderboardStore[dateKey].length > DAILY_MAX_ENTRIES_PER_DAY) {
        leaderboardStore[dateKey] = leaderboardStore[dateKey].slice(0, DAILY_MAX_ENTRIES_PER_DAY);
    }

    saveDailyLeaderboard(leaderboardStore);

    const entries = leaderboardStore[dateKey];
    const rank = entries.findIndex(item => item.id === entry.id) + 1;
    const ownEntries = entries.filter(item => item.playerId === player.id);
    const ownBest = ownEntries[0] || null;
    const bestRank = ownBest ? entries.findIndex(item => item.id === ownBest.id) + 1 : null;

    sendMessage(player.ws, 'dailyScoreResult', {
        dateKey,
        rank: rank > 0 ? rank : null,
        totalPlayers: entries.length,
        bestRank,
        bestTotalDelta: ownBest ? ownBest.totalDelta : null,
    });
}

function updateLobby(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const lobbyData = {
        roomCode: room.id,
        ownerId: room.ownerId,
        players: room.players.map(pid => ({ id: pid, username: sanitizeUsername(players[pid]?.username || 'Player') })),
        settings: room.settings,
        hasPassword: Boolean(room.passwordHash)
    };

    room.players.forEach(playerId => {
        sendMessage(players[playerId].ws, 'lobbyUpdate', lobbyData);
    });
}

function createGameSession(room) {
    const [player1Id, player2Id] = room.players;
    const player1 = players[player1Id];
    const player2 = players[player2Id];

    const session = {
        id: room.id,
        player1: player1Id,
        player2: player2Id,
        lives: { [player1Id]: room.settings.lives, [player2Id]: room.settings.lives },
        setScores: { [player1Id]: 0, [player2Id]: 0 },
        currentRound: 0,
        phase: 'idle',
        listeningEndsAt: 0,
        guessingEndsAt: 0,
        prepTimer: null,
        listenTimer: null,
        guessTimer: null,
        hurryUpMs: room.settings.listenMode === 'hard' ? HARD_HURRY_UP_MS : NORMAL_HURRY_UP_MS,
        targetFrequency: null,
        listenMs: 0,
        guesses: { [player1Id]: null, [player2Id]: null },
        lastKnownGuesses: { [player1Id]: 550, [player2Id]: 550 },
        settings: room.settings
    };
    room.gameState = session;

    sendMessage(player1.ws, 'gameStart', {
        opponent: { id: player2.id, username: player2.username },
        lives: session.lives[player1Id],
        opponentLives: session.lives[player2Id],
    });
    
    sendMessage(player2.ws, 'gameStart', {
        opponent: { id: player1.id, username: player1.username },
        lives: session.lives[player2Id],
        opponentLives: session.lives[player1Id],
    });

    startNewRound(room);
}

function startNewRound(room) {
    const session = room.gameState;
    if (!session) return;

    clearRoundTimers(session);
    session.currentRound++;
    session.targetFrequency = Math.floor(Math.random() * 901) + 100; // 100-1000 Hz
    session.listenMs = getListenDuration(session.settings.listenMode);
    session.phase = 'prep';
    session.listeningEndsAt = 0;
    session.guessingEndsAt = 0;
    session.guesses[session.player1] = null;
    session.guesses[session.player2] = null;
    session.lastKnownGuesses[session.player1] = 550;
    session.lastKnownGuesses[session.player2] = 550;

    broadcastToRoom(room.id, 'roundPrepStart', {
        round: session.currentRound,
        maxRounds: session.settings.rounds,
        prepMs: PREP_PHASE_MS,
    });

    session.prepTimer = setTimeout(() => {
        if (!room.gameState || room.gameState !== session) return;

        session.phase = 'listening';
        session.listeningEndsAt = Date.now() + session.listenMs;

        broadcastToRoom(room.id, 'listenPhaseStart', {
            targetFrequency: session.targetFrequency,
            listenMs: session.listenMs,
            listenMode: session.settings.listenMode,
        });

        session.listenTimer = setTimeout(() => {
            if (!room.gameState || room.gameState !== session) return;

            session.phase = 'guessing';
            session.guessingEndsAt = Date.now() + GUESS_PHASE_MS;
            broadcastToRoom(room.id, 'guessPhaseStart', { guessMs: GUESS_PHASE_MS });

            session.guessTimer = setTimeout(() => {
                if (!room.gameState || room.gameState !== session) return;
                evaluateRound(room);
            }, GUESS_PHASE_MS);
        }, session.listenMs);
    }, PREP_PHASE_MS);
}

function applyHurryUpWindow(room, session, submitterId, opponentId) {
    if (!players[opponentId]) return;
    if (session.phase !== 'guessing') return;

    const remainingMs = Math.max(0, session.guessingEndsAt - Date.now());
    const hurryUpMs = session.hurryUpMs || NORMAL_HURRY_UP_MS;
    if (remainingMs <= hurryUpMs) return;

    session.guessingEndsAt = Date.now() + hurryUpMs;
    if (session.guessTimer) {
        clearTimeout(session.guessTimer);
    }
    session.guessTimer = setTimeout(() => {
        if (!room.gameState || room.gameState !== session) return;
        evaluateRound(room);
    }, hurryUpMs);

    sendMessage(players[opponentId].ws, 'hurryUp', {
        remainingMs: hurryUpMs,
        message: `Opponent submitted. You only have ${hurryUpMs === HARD_HURRY_UP_MS ? '2.5' : '5'} seconds left!`
    });

    if (players[submitterId]) {
        sendMessage(players[submitterId].ws, 'statusUpdate', {
            message: `Opponent has ${hurryUpMs === HARD_HURRY_UP_MS ? '2.5' : '5'} seconds to answer.`
        });
    }
}

function evaluateRound(room) {
    const session = room.gameState;
    if (!session) return;

    clearRoundTimers(session);
    session.phase = 'result';

    const p1Id = session.player1;
    const p2Id = session.player2;
    const target = session.targetFrequency;

    const p1Guess = Number.isFinite(session.guesses[p1Id])
        ? session.guesses[p1Id]
        : (Number.isFinite(session.lastKnownGuesses[p1Id]) ? session.lastKnownGuesses[p1Id] : null);
    const p2Guess = Number.isFinite(session.guesses[p2Id])
        ? session.guesses[p2Id]
        : (Number.isFinite(session.lastKnownGuesses[p2Id]) ? session.lastKnownGuesses[p2Id] : null);
    const p1Diff = p1Guess === null ? Number.POSITIVE_INFINITY : Math.abs(target - p1Guess);
    const p2Diff = p2Guess === null ? Number.POSITIVE_INFINITY : Math.abs(target - p2Guess);

    let roundWinner = p1Diff < p2Diff ? p1Id : (p2Diff < p1Diff ? p2Id : null);
    if(roundWinner) session.setScores[roundWinner]++;

    const resultData = {
        roundWinnerId: roundWinner,
        yourGuess: p1Guess ?? 550,
        opponentGuess: p2Guess ?? 550,
        target: target,
        yourSetScore: session.setScores[p1Id],
        opponentSetScore: session.setScores[p2Id],
        yourTimedOut: session.guesses[p1Id] === null,
        opponentTimedOut: session.guesses[p2Id] === null,
    };
    sendMessage(players[p1Id].ws, 'roundResult', resultData);

    const resultData2 = {
        roundWinnerId: roundWinner,
        yourGuess: p2Guess ?? 550,
        opponentGuess: p1Guess ?? 550,
        target: target,
        yourSetScore: session.setScores[p2Id],
        opponentSetScore: session.setScores[p1Id],
        yourTimedOut: session.guesses[p2Id] === null,
        opponentTimedOut: session.guesses[p1Id] === null,
    };
    sendMessage(players[p2Id].ws, 'roundResult', resultData2);

    if (session.currentRound >= session.settings.rounds) {
        setTimeout(() => evaluateSet(room), 4000);
    } else {
        setTimeout(() => startNewRound(room), 5000);
    }
}

function evaluateSet(room) {
    const session = room.gameState;
    if (!session) return;

    clearRoundTimers(session);
    const p1Id = session.player1;
    const p2Id = session.player2;
    let setWinner = session.setScores[p1Id] > session.setScores[p2Id] ? p1Id : (session.setScores[p2Id] > session.setScores[p1Id] ? p2Id : null);

    if (setWinner === p1Id) session.lives[p2Id]--;
    if (setWinner === p2Id) session.lives[p1Id]--;

    sendMessage(players[p1Id].ws, 'setResult', {
        setWinnerId: setWinner,
        yourLives: session.lives[p1Id],
        opponentLives: session.lives[p2Id],
    });

    sendMessage(players[p2Id].ws, 'setResult', {
        setWinnerId: setWinner,
        yourLives: session.lives[p2Id],
        opponentLives: session.lives[p1Id],
    });

    session.currentRound = 0;
    session.setScores = { [p1Id]: 0, [p2Id]: 0 };

    if (session.lives[p1Id] <= 0 || session.lives[p2Id] <= 0) {
        const gameWinner = session.lives[p1Id] > 0 ? p1Id : p2Id;
        broadcastToRoom(room.id, 'gameOver', { winnerId: gameWinner });
        room.gameState = null;
        setTimeout(() => updateLobby(room.id), 4200);
    } else {
        setTimeout(() => startNewRound(room), 5000);
    }
}

function getListenDuration(listenMode) {
    if (listenMode === 'hard') {
        return Math.random() < 0.5 ? LISTEN_MODE_DURATIONS.hard[0] : LISTEN_MODE_DURATIONS.hard[1];
    }

    if (listenMode === 'noob') {
        return LISTEN_MODE_DURATIONS.noob;
    }

    return LISTEN_MODE_DURATIONS.easy;
}

function resolveListenMode(listenMode, legacyHardMode, fallbackMode = 'easy') {
    if (listenMode === 'noob' || listenMode === 'easy' || listenMode === 'hard') {
        return listenMode;
    }

    if (typeof legacyHardMode === 'boolean') {
        return legacyHardMode ? 'hard' : 'easy';
    }

    return fallbackMode === 'noob' || fallbackMode === 'hard' || fallbackMode === 'easy' ? fallbackMode : 'easy';
}

function removePlayerFromRoom(playerId) {
    const player = players[playerId];
    if (!player || !player.roomCode) return;

    const roomCode = player.roomCode;
    const room = rooms[roomCode];
    player.roomCode = null;

    if (!room) return;

    room.players = room.players.filter(pid => pid !== playerId);
    if (room.gameState) {
        clearRoundTimers(room.gameState);
    }
    room.gameState = null;

    if (room.players.length === 0) {
        delete rooms[roomCode];
        return;
    }

    if (room.ownerId === playerId) {
        room.ownerId = room.players[0];
    }

    room.players.forEach(pid => {
        if (players[pid]) {
            sendMessage(players[pid].ws, 'error', { message: 'A player left the room.' });
        }
    });

    updateLobby(roomCode);
}

function handleDisconnect(playerId) {
    console.log(`Player ${playerId} disconnected`);
    const player = players[playerId];
    if (player && player.roomCode) {
        removePlayerFromRoom(playerId);
    }
    delete players[playerId];
}

function sendMessage(ws, type, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcastToRoom(roomCode, type, payload) {
    const room = rooms[roomCode];
    if (room) {
        room.players.forEach(id => {
            if (players[id]) sendMessage(players[id].ws, type, payload);
        });
    }
}

function findSessionByPlayerId(playerId) {
    const player = players[playerId];
    if (player && player.roomCode) {
        const room = rooms[player.roomCode];
        return room ? room.gameState : null;
    }
    return null;
}

function generateId(length = 16) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase();
}

function generateRoomCode() {
    let roomCode = '';
    do {
        roomCode = generateId(MAX_ROOM_CODE_LENGTH);
    } while (rooms[roomCode]);
    return roomCode;
}

function isAllowedWebSocketOrigin(request) {
    const origin = request?.headers?.origin;
    if (!origin) return false;

    let parsedOrigin;
    try {
        parsedOrigin = new URL(origin);
    } catch (error) {
        return false;
    }

    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
        return false;
    }

    const originHost = parsedOrigin.host.toLowerCase();
    const requestHost = String(request?.headers?.host || '').toLowerCase();

    if (originHost === requestHost) return true;
    if (originHost === 'localhost' || originHost.startsWith('localhost:')) return true;
    if (originHost === '127.0.0.1' || originHost.startsWith('127.0.0.1:')) return true;
    if (originHost.endsWith('.trycloudflare.com')) return true;

    return false;
}

function getClientIp(request) {
    const forwardedFor = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const cfConnectingIp = String(request?.headers?.['cf-connecting-ip'] || '').trim();
    const xRealIp = String(request?.headers?.['x-real-ip'] || '').trim();
    const remoteAddress = String(request?.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim();

    return (cfConnectingIp || forwardedFor || xRealIp || remoteAddress || 'unknown').toLowerCase();
}

function sanitizeUsername(username) {
    if (typeof username !== 'string') return '';
    const cleaned = username
        .replace(/[\x00-\x1F\x7F<>"'&`]/g, '')
        .trim()
        .slice(0, MAX_USERNAME_LENGTH);
    return cleaned;
}

function sanitizeRoomCode(roomCode) {
    if (typeof roomCode !== 'string') return '';
    return roomCode.replace(/[^A-Z0-9]/g, '').trim().slice(0, MAX_ROOM_CODE_LENGTH).toUpperCase();
}

function sanitizePassword(password) {
    if (typeof password !== 'string') return '';
    return password.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, MAX_PASSWORD_LENGTH);
}

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function allowIncomingMessage(playerId) {
    const player = players[playerId];
    if (!player) return false;

    const now = Date.now();
    player.messageTimestamps = player.messageTimestamps.filter(ts => now - ts <= RATE_WINDOW_MS);

    if (player.ip) {
        if (!ipMessageTimestamps[player.ip]) {
            ipMessageTimestamps[player.ip] = [];
        }

        ipMessageTimestamps[player.ip] = ipMessageTimestamps[player.ip].filter(ts => now - ts <= RATE_WINDOW_MS);
        if (ipMessageTimestamps[player.ip].length >= MAX_MESSAGES_PER_IP_WINDOW) {
            return false;
        }
    }

    if (player.messageTimestamps.length >= MAX_MESSAGES_PER_WINDOW) {
        return false;
    }

    player.messageTimestamps.push(now);
    if (player.ip) {
        ipMessageTimestamps[player.ip].push(now);
    }
    return true;
}

function clearRoundTimers(session) {
    if (!session) return;
    if (session.prepTimer) {
        clearTimeout(session.prepTimer);
        session.prepTimer = null;
    }
    if (session.listenTimer) {
        clearTimeout(session.listenTimer);
        session.listenTimer = null;
    }
    if (session.guessTimer) {
        clearTimeout(session.guessTimer);
        session.guessTimer = null;
    }
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST;

if (HOST) {
    server.listen(PORT, HOST, () => {
        console.log(`Server is running on http://${HOST}:${PORT}`);
        if (HOST !== 'localhost' && HOST !== '127.0.0.1') {
            console.log(`Open locally via http://localhost:${PORT}`);
        }
    });
} else {
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}
