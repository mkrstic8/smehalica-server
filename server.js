const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// ==================== KONFIGURACIJA ====================
const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 15;
const DISCONNECT_GRACE_MS = 20 * 1000; // 2 minuta pre predaje
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Bonus tabla
const bonusBoard = [
    ['TW','','','DL','','','','TW','','','','DL','','','TW'],
    ['','DW','','','','TL','','','','TL','','','','DW',''],
    ['','','DW','','','','DL','','DL','','','','DW','',''],
    ['DL','','','DW','','','','DL','','','','DW','','','DL'],
    ['','','','','DW','','','','','','DW','','','',''],
    ['','TL','','','','TL','','','','TL','','','','TL',''],
    ['','','DL','','','','DL','','DL','','','','DL','',''],
    ['TW','','','DL','','','','★','','','','DL','','','TW'],
    ['','','DL','','','','DL','','DL','','','','DL','',''],
    ['','TL','','','','TL','','','','TL','','','','TL',''],
    ['','','','','DW','','','','','','DW','','','',''],
    ['DL','','','DW','','','','DL','','','','DW','','','DL'],
    ['','','DW','','','','DL','','DL','','','','DW','',''],
    ['','DW','','','','TL','','','','TL','','','','DW',''],
    ['TW','','','DL','','','','TW','','','','DL','','','TW'],
];

const letterValues = {
    'А':1,'Б':3,'В':2,'Г':3,'Д':2,'Ђ':8,'Е':1,'Ж':5,'З':3,
    'И':1,'Ј':3,'К':2,'Л':2,'Љ':5,'М':2,'Н':1,'Њ':5,'О':1,
    'П':2,'Р':1,'С':1,'Т':1,'Ћ':8,'У':1,'Ф':5,'Х':4,'Ц':4,
    'Ч':4,'Џ':10,'Ш':4
};

const tileDistribution = [
    ['А',9], ['Б',2], ['В',4], ['Г',2], ['Д',4],
    ['Ђ',1], ['Е',10], ['Ж',2], ['З',2], ['И',8],
    ['Ј',3], ['К',3], ['Л',3], ['Љ',1], ['М',3],
    ['Н',6], ['Њ',1], ['О',9], ['П',3], ['Р',6],
    ['С',6], ['Т',5], ['Ћ',1], ['У',4], ['Ф',1],
    ['Х',2], ['Ц',2], ['Ч',2], ['Џ',1], ['Ш',2]
];

// ==================== REČNIK ====================
let DICTIONARY = new Set();
function loadDictionary() {
    try {
        const dictFile = fs.readFileSync('./serbian-words.txt', 'utf8');
        const words = dictFile.split(/[\n\r]+/)
            .map(w => w.trim().toUpperCase())
            .filter(w => /^[АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ]+$/.test(w))
            .filter(w => w.length >= 3 && w.length <= 15);

        const newDictionary = new Set(words);

        const oldSize = DICTIONARY.size;
        DICTIONARY = newDictionary;

        console.log(`📚 Rečnik učitan: ${DICTIONARY.size} reči (prethodno: ${oldSize})`);
        return true;
    } catch (e) {
        console.error('❌ Ne mogu da učitam serbian-words.txt:', e.message);
        return false;
    }
}

// Učitaj rečnik pri startu
if (!loadDictionary()) {
    process.exit(1);
}

// Automatski watch fajla — hot-reload rečnika bez restarta servera
console.log('👀 Slušam promene u serbian-words.txt...');
let dictionaryReloadTimeout = null;
fs.watchFile('./serbian-words.txt', { interval: 1000 }, (curr, prev) => {
    if (curr.mtime.getTime() !== prev.mtime.getTime()) {
        console.log('🔄 Rečnik se promenio, učitavam...');
        // Debounce - ako se fajl menja više puta zaredom (npr. editor snima u koracima),
        // sačekaj da se promene smire pre nego što učitaš
        if (dictionaryReloadTimeout) clearTimeout(dictionaryReloadTimeout);
        dictionaryReloadTimeout = setTimeout(() => {
            loadDictionary();
        }, 300);
    }
});

// ==================== STANJE IGARA ====================
const games = {};        // gameId -> gameState
const players = {};      // playerId -> { socket, gameId, playerNum, name, disconnectTimer, ... }
const matchmaking = new Set(); // Set igrača koji čekaju
const rooms = {};        // linkKod -> { creatorId, createdAt }

// ==================== POMOĆNE FUNKCIJE ====================
function createBag() {
    const bag = [];
    for (const [letter, count] of tileDistribution) {
        for (let i = 0; i < count; i++) bag.push(letter);
    }
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
}

function drawTiles(bag, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
        if (bag.length > 0) drawn.push(bag.pop());
    }
    return drawn;
}

function createEmptyBoard() {
    const board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        board[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            board[r][c] = null;
        }
    }
    return board;
}

function generateRoomLink() {
    const slova = 'АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ';
    let link = '';
    for (let i = 0; i < 5; i++) {
        link += slova[Math.floor(Math.random() * slova.length)];
    }
    if (rooms[link]) return generateRoomLink();
    return link;
}

function createGame(player1Id, player2Id) {
    const gameId = uuidv4().substring(0, 8).toUpperCase();
    const bag = createBag();

    const game = {
        id: gameId,
        board: createEmptyBoard(),
        bag: bag,
        players: {
            [player1Id]: {
                rack: drawTiles(bag, 8),
                score: 0,
                playerNum: 1
            },
            [player2Id]: {
                rack: drawTiles(bag, 8),
                score: 0,
                playerNum: 2
            }
        },
        currentTurn: player1Id,
        isFirstMove: true,
        status: 'active',
        winner: null,
        lastMove: null,
        skipCount: 0,
        createdAt: Date.now(),
        chatMessages: []          // <-- DODAJ OVO
    };

    games[gameId] = game;

    // Poveži igrače sa igrom
    players[player1Id].gameId = gameId;
    players[player1Id].playerNum = 1;
    players[player2Id].gameId = gameId;
    players[player2Id].playerNum = 2;

    // Dodaj igrače u Socket.IO room (ako su konektovani)
    if (players[player1Id].socket) {
        players[player1Id].socket.join(gameId);
        players[player1Id].socket.data.gameId = gameId;
    }
    if (players[player2Id].socket) {
        players[player2Id].socket.join(gameId);
        players[player2Id].socket.data.gameId = gameId;
    }

    return game;
}

function getGameState(game, playerId) {
    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    const player = game.players[playerId];
    const opponent = game.players[opponentId];

    return {
        gameId: game.id,
        board: game.board,
        yourRack: player.rack,
        yourScore: player.score,
        opponentScore: opponent ? opponent.score : 0,
        opponentRackCount: opponent ? opponent.rack.length : 0,
        currentTurn: game.currentTurn,
        isYourTurn: game.currentTurn === playerId,
        isFirstMove: game.isFirstMove,
        status: game.status,
        winner: game.winner,
        bagCount: game.bag.length,
        lastMove: game.lastMove,
        chatMessages: game.chatMessages || []   // <-- DODAJ OVO
    };
}

// ==================== VALIDACIJA POTEZA ====================
function validateMove(game, playerId, placements) {
    if (game.currentTurn !== playerId) {
        return { valid: false, error: 'Није твој потез.' };
    }
    if (game.status !== 'active') {
        return { valid: false, error: 'Игра је завршена.' };
    }
    if (!placements || placements.length === 0) {
        return { valid: false, error: 'Нема постављених слова.' };
    }

    const player = game.players[playerId];
    const board = game.board;

    // Proveri da li igrač ima ova slova
    const neededLetters = [...player.rack];
    const tempBoard = [];

    for (const p of placements) {
        const { row, col, letter } = p;
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
            return { valid: false, error: `Неважећа позиција [${row+1},${col+1}].` };
        }
        if (board[row][col]) {
            return { valid: false, error: `Поље [${row+1},${col+1}] је већ заузето.` };
        }
        const idx = neededLetters.indexOf(letter);
        if (idx === -1) {
            return { valid: false, error: `Немаш слово "${letter}" на табли.` };
        }
        neededLetters.splice(idx, 1);
        tempBoard.push({ row, col, letter });
    }

    // Postavi privremeno
    for (const p of tempBoard) {
        board[p.row][p.col] = { letter: p.letter, isNewlyPlaced: true };
    }

    // Proveri da li su sva slova u istom redu/koloni
    const rows = tempBoard.map(p => p.row);
    const cols = tempBoard.map(p => p.col);
    const uniqueRows = [...new Set(rows)];
    const uniqueCols = [...new Set(cols)];

    if (uniqueRows.length !== 1 && uniqueCols.length !== 1) {
        for (const p of tempBoard) board[p.row][p.col] = null;
        return { valid: false, error: 'Сва слова морају бити у истом реду или колони.' };
    }

    const isHorizontal = uniqueRows.length === 1;
    let mainWord = '';
    let mainCells = [];

    if (isHorizontal) {
        const row = uniqueRows[0];
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);

        for (let c = minCol; c <= maxCol; c++) {
            if (!board[row][c]) {
                for (const p of tempBoard) board[p.row][p.col] = null;
                return { valid: false, error: `Недостаје слово на [${row+1},${c+1}].` };
            }
        }

        let startCol = minCol;
        while (startCol > 0 && board[row][startCol - 1]) startCol--;
        let endCol = maxCol;
        while (endCol < BOARD_SIZE - 1 && board[row][endCol + 1]) endCol++;

        for (let c = startCol; c <= endCol; c++) {
            mainWord += board[row][c].letter;
            mainCells.push({ row, col: c });
        }
    } else {
        const col = uniqueCols[0];
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);

        for (let r = minRow; r <= maxRow; r++) {
            if (!board[r][col]) {
                for (const p of tempBoard) board[p.row][p.col] = null;
                return { valid: false, error: `Недостаје слово на [${r+1},${col+1}].` };
            }
        }

        let startRow = minRow;
        while (startRow > 0 && board[startRow - 1][col]) startRow--;
        let endRow = maxRow;
        while (endRow < BOARD_SIZE - 1 && board[endRow + 1][col]) endRow++;

        for (let r = startRow; r <= endRow; r++) {
            mainWord += board[r][col].letter;
            mainCells.push({ row: r, col });
        }
    }

    // Prvi potez — mora pokriti centar
    if (game.isFirstMove) {
        const coversCenter = tempBoard.some(p => p.row === 7 && p.col === 7);
        if (!coversCenter) {
            for (const p of tempBoard) board[p.row][p.col] = null;
            return { valid: false, error: 'Први потез мора покрити центар (★).' };
        }
    } else {
        // Mora biti povezano sa postojećim rečima
        let connected = false;
        for (const p of tempBoard) {
            const neighbors = [[p.row-1,p.col],[p.row+1,p.col],[p.row,p.col-1],[p.row,p.col+1]];
            for (const [nr, nc] of neighbors) {
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE &&
                    board[nr][nc] && !board[nr][nc].isNewlyPlaced) {
                    connected = true;
                    break;
                }
            }
            if (connected) break;
        }
        if (!connected) {
            for (const p of tempBoard) board[p.row][p.col] = null;
            return { valid: false, error: 'Мора бити повезано са постојећим речима.' };
        }
    }

    // Sakupljanje svih formiranih reči
    const allWords = [];

    // Dodaj glavnu reč samo ako ima 2+ slova
    if (mainWord.length >= 2) {
        allWords.push({ word: mainWord, cells: mainCells });
    }

    // Unakrsne reči
    for (const p of tempBoard) {
        if (isHorizontal) {
            let sr = p.row;
            while (sr > 0 && board[sr - 1][p.col]) sr--;
            let er = p.row;
            while (er < BOARD_SIZE - 1 && board[er + 1][p.col]) er++;
            if (er > sr) {
                let cw = '';
                const cells = [];
                for (let r = sr; r <= er; r++) {
                    cw += board[r][p.col].letter;
                    cells.push({ row: r, col: p.col });
                }
                if (cw.length >= 2 && cw !== mainWord) {
                    allWords.push({ word: cw, cells });
                }
            }
        } else {
            let sc = p.col;
            while (sc > 0 && board[p.row][sc - 1]) sc--;
            let ec = p.col;
            while (ec < BOARD_SIZE - 1 && board[p.row][ec + 1]) ec++;
            if (ec > sc) {
                let cw = '';
                const cells = [];
                for (let c = sc; c <= ec; c++) {
                    cw += board[p.row][c].letter;
                    cells.push({ row: p.row, col: c });
                }
                if (cw.length >= 2 && cw !== mainWord) {
                    allWords.push({ word: cw, cells });
                }
            }
        }
    }

    // Proveri da li uopšte ima validnih reči
    if (allWords.length === 0) {
        for (const p of tempBoard) board[p.row][p.col] = null;
        return { valid: false, error: 'Мораш формирати реч од најмање 2 слова.' };
    }

    // Proveri rečnik
    const invalidWords = [];
    for (const w of allWords) {
        if (!DICTIONARY.has(w.word.toUpperCase())) {
            invalidWords.push(`"${w.word}" (није у речнику)`);
        }
    }

    if (invalidWords.length > 0) {
        for (const p of tempBoard) board[p.row][p.col] = null;
        return { valid: false, error: 'Неважеће речи: ' + invalidWords.join(', ') };
    }

    // Izračunaj skor
    let totalScore = 0;
    for (const w of allWords) {
        let wordScore = 0;
        let wordMultiplier = 1;
        for (const { row, col } of w.cells) {
            let lv = letterValues[board[row][col].letter] || 1;
            const isNew = tempBoard.some(p => p.row === row && p.col === col);
            if (isNew) {
                const bonus = bonusBoard[row][col];
                if (bonus === 'DL') lv *= 2;
                if (bonus === 'TL') lv *= 3;
                if (bonus === 'DW') wordMultiplier *= 2;
                if (bonus === 'TW') wordMultiplier *= 3;
                if (bonus === '★') wordMultiplier *= 2;
            }
            wordScore += lv;
        }
        totalScore += wordScore * wordMultiplier;
    }

    if (tempBoard.length === 7) totalScore += 50; // BINGO bonus

    // Finalizuj — ukloni isNewlyPlaced flag
    for (const p of tempBoard) {
        board[p.row][p.col] = { letter: p.letter, isNewlyPlaced: false };
    }

    // Ukloni slova sa stalka i dodaj nova
    const remainingRack = [...neededLetters];
    const newTiles = drawTiles(game.bag, tempBoard.length);
    const newRack = [...remainingRack, ...newTiles];

    return {
        valid: true,
        score: totalScore,
        words: allWords.map(w => w.word),
        newRack: newRack,
        placements: tempBoard
    };
}

// ==================== SOCKET.IO SERVER ====================
const httpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');

        try {
            const html = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            res.end(html);
        } catch (e) {
            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8'
            });
            res.end(JSON.stringify({
                server: 'Смехалица укрштеница',
                version: '1.0.0',
                error: 'HTML fajl nije pronađen.'
            }));
        }

    } else if (req.url === '/style.css') {
        const filePath = path.join(__dirname, 'public', 'style.css');

        try {
            const css = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/css; charset=utf-8'
            });
            res.end(css);
        } catch (e) {
            res.writeHead(404, {
                'Content-Type': 'text/plain; charset=utf-8'
            });
            res.end('style.css nije pronađen');
        }

    } else if (req.url === '/status') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
            server: 'Смехалица укрштеница',
            version: '1.0.0',
            activeGames: Object.keys(games).length,
            playersOnline: Object.keys(players).length,
            dictionarySize: DICTIONARY.size,
            waitingPlayers: matchmaking.size
        }));

    } else {
        res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('Stranica ne postoji');
    }
});

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ==================== MIDDLEWARE ZA IGRAČE ====================
io.use((socket, next) => {
    const authPlayerId = socket.handshake.auth.playerId;
    let playerId;
    if (authPlayerId && players[authPlayerId]) {
        playerId = authPlayerId;
    } else {
        playerId = authPlayerId || uuidv4();
    }
    socket.data.playerId = playerId;
    next();
});

// ==================== KONEKCIJA ====================
io.on('connection', (socket) => {
    const playerId = socket.data.playerId;
    console.log(`🔌 Novi socket: ${socket.id} (playerId: ${playerId.substring(0,8)})`);

    // Ako igrač već postoji u players, ažuriraj socket i otkaži disconnect tajmer
    if (players[playerId]) {
        const existingPlayer = players[playerId];
        existingPlayer.socket = socket;
        if (existingPlayer.disconnectTimer) {
            clearTimeout(existingPlayer.disconnectTimer);
            existingPlayer.disconnectTimer = null;
        }
                // ✅ Ponovo pridruži socket Socket.IO sobi igre (bitno za chat i broadcast poruke!)
        if (existingPlayer.gameId) {
            socket.join(existingPlayer.gameId);
            socket.data.gameId = existingPlayer.gameId;
        }

        console.log(`🔁 Igrač se ponovo povezao: ${playerId.substring(0,8)}`);
    } else {
        players[playerId] = {
            socket: socket,
            gameId: null,
            playerNum: null,
            name: 'Играч',
            disconnectTimer: null,
            lastCancelTime: 0, 
            roomLink: null          // <-- DODATO: prati koju sobu igrač trenutno drži otvorenu     // <-- DODAJ OVO
        };
    }

    // Pošalji potvrdu sa playerId
    socket.emit('connected', {
        playerId: playerId,
        message: 'Повезан/а на сервер Смехалице!'
    });

    // Ako je igrač već u aktivnoj igri, automatski pošalji stanje
    // Ako je igrač već u nekoj igri, obradi prema statusu igre
    if (players[playerId].gameId) {
        const game = games[players[playerId].gameId];

        // Ako igra više ne postoji (možda je obrisana), očisti igrača
        if (!game) {
            players[playerId].gameId = null;
            players[playerId].playerNum = null;
            socket.emit('error', { message: 'Претходна игра је обрисана.' });
        }
        // Igra je aktivna — pošalji trenutno stanje
        else if (game.status === 'active') {
            const state = getGameState(game, playerId);
            state.type = 'game_state';
            const opponentId = Object.keys(game.players).find(id => id !== playerId);
            state.opponentName = players[opponentId]?.name || 'Противник';
            socket.emit('game_state', state);
        }
        // Igra je već završena — pošalji rezultat da igrač nije zaglavljen
        else if (game.status === 'finished') {
            const opponentId = Object.keys(game.players).find(id => id !== playerId);
            let resultMessage;

            if (game.winner === 'draw') {
                resultMessage = '🤝 Нерешено!';
            } else if (game.winner === playerId) {
                resultMessage = '🎉 Победио/ла си!';
            } else {
                resultMessage = '😞 Изгубио/ла си.';
            }

            const state = getGameState(game, playerId);
            state.type = 'game_over';
            state.gameOver = true;
            state.resultMessage = resultMessage;
            state.finalScores = {
                you: game.players[playerId].score,
                opponent: game.players[opponentId] ? game.players[opponentId].score : 0
            };
            socket.emit('game_over', state);
        }
    }

    // ---------- EVENTI ----------
    socket.on('set_name', (data) => {
        if (players[playerId]) {
            players[playerId].name = data.name || 'Играч';
            socket.emit('name_set', { name: players[playerId].name });
        }
    });

    socket.on('create_room', () => {
        handleCreateRoom(socket, playerId);
    });

    socket.on('join_room', (data) => {
        handleJoinRoom(socket, playerId, data.roomLink);
    });

    socket.on('quick_match', () => {
        handleFindGame(socket, playerId);
    });

    socket.on('cancel_find', () => {
        handleCancelFind(socket, playerId);
    });

    socket.on('place_tiles', (data) => {
        handlePlaceTiles(socket, playerId, data.placements);
    });

    socket.on('skip_turn', () => {
        handleSkipTurn(socket, playerId);
    });

    socket.on('get_state', () => {
        handleGetState(socket, playerId);
    });

    socket.on('resign', () => {
        handleResign(socket, playerId);
    });

    socket.on('chat', (data) => {
        handleChat(socket, playerId, data.text);
    });

    socket.on('request_rematch', () => {
        handleRematchRequest(socket, playerId);
    });

    socket.on('accept_rematch', (data) => {
        handleAcceptRematch(socket, playerId, data.fromId);
    });

    socket.on('decline_rematch', (data) => {
        handleDeclineRematch(socket, playerId, data.fromId);
    });

    socket.on('leave_game', () => {
        handleLeaveGame(socket, playerId);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket, playerId);
    });

    socket.on('error', (err) => {
        console.error(`❌ Socket greška za ${playerId.substring(0,8)}:`, err.message);
    });
});

// ==================== POMOĆNE ZA SOCKET ====================
function sendToPlayer(playerId, event, data) {
    const player = players[playerId];
    if (player && player.socket) {
        player.socket.emit(event, data);
    } else {
        console.warn(`⚠️ Pokušaj slanja igraču ${playerId.substring(0,8)} koji nije povezan`);
    }
}

function sendToGame(gameId, event, data, excludePlayerId = null) {
    if (excludePlayerId) {
        io.to(gameId).except(players[excludePlayerId]?.socket?.id).emit(event, data);
    } else {
        io.to(gameId).emit(event, data);
    }
}

// ==================== HANDLERI ====================
function handleCreateRoom(socket, playerId) {
    const player = players[playerId];
    if (!player) return;
    if (player.gameId) {
        const existingGame = games[player.gameId];
        if (existingGame && existingGame.status === 'finished') {
            player.gameId = null;
            player.playerNum = null;
        } else {
            socket.emit('error', { message: 'Већ си у игри.' });
            return;
        }
    }

    const remaining = getCooldownRemaining(player);
    if (remaining > 0) {
        socket.emit('error', { message: `Сачекај ${remaining} секунди пре нове акције.`, cooldownSeconds: remaining });
        return;
    }

    if (matchmaking.has(playerId)) {
        matchmaking.delete(playerId);
        console.log(`🔴 Igrač ${playerId.substring(0,8)} uklonjen iz reda zbog kreiranja sobe.`);
    }

    // Ako igrač već ima otvorenu sobu, obriši je pre nego što napravi novu
    if (player.roomLink && rooms[player.roomLink]) {
        delete rooms[player.roomLink];
    }

    const link = generateRoomLink();
    rooms[link] = {
        creatorId: playerId,
        createdAt: Date.now()
    };
    player.roomLink = link;   // <-- DODATO

    socket.emit('room_created', {
        roomLink: link,
        message: `Соба креирана! Пошаљи линк противнику: ${link}`
    });
    console.log(`🏠 Soba kreirana: ${link} od strane ${player.name}`);
}
function handleJoinRoom(socket, playerId, roomLink) {
    const player = players[playerId];
    if (!player) return;
    if (player.gameId) {
        const existingGame = games[player.gameId];
        if (existingGame && existingGame.status === 'finished') {
            player.gameId = null;
            player.playerNum = null;
        } else {
            socket.emit('error', { message: 'Већ си у игри.' });
            return;
        }
    }

    const remaining = getCooldownRemaining(player);
    if (remaining > 0) {
        socket.emit('error', { message: `Сачекај ${remaining} секунди пре нове акције.`, cooldownSeconds: remaining });
        return;
    }

    if (matchmaking.has(playerId)) {
        matchmaking.delete(playerId);
        console.log(`🔴 Igrač ${playerId.substring(0,8)} uklonjen iz reda zbog pridruživanja sobi.`);
    }
    if (!roomLink || !rooms[roomLink]) {
        socket.emit('error', { message: 'Соба не постоји или је линк неважећи.' });
        return;
    }
    const room = rooms[roomLink];
    const creatorId = room.creatorId;
    if (!players[creatorId] || players[creatorId].gameId) {
        delete rooms[roomLink];
        socket.emit('error', { message: 'Креатор собе више није доступан.' });
        return;
    }
    if (creatorId === playerId) {
        socket.emit('error', { message: 'Не можеш се придружити сопственој соби.' });
        return;
    }

    const game = createGame(creatorId, playerId);
    players[creatorId].roomLink = null;   // <-- DODATO

    const state1 = getGameState(game, creatorId);
    state1.type = 'game_start';
    state1.opponentName = player.name;
    state1.yourPlayerNum = 1;
    sendToPlayer(creatorId, 'game_start', state1);

    const state2 = getGameState(game, playerId);
    state2.type = 'game_start';
    state2.opponentName = players[creatorId].name;
    state2.yourPlayerNum = 2;
    sendToPlayer(playerId, 'game_start', state2);

    delete rooms[roomLink];
    console.log(`🎮 Igra ${game.id}: ${players[creatorId].name} vs ${player.name} (soba: ${roomLink})`);
}
function handleFindGame(socket, playerId) {
    const player = players[playerId];
    if (!player) return;
    if (player.gameId) {
        socket.emit('error', { message: 'Већ си у игри.' });
        return;
    }

    const remaining = getCooldownRemaining(player);
    if (remaining > 0) {
        socket.emit('error', { message: `Сачекај ${remaining} секунди пре нове претраге.`, cooldownSeconds: remaining });
        return;
    }

    if (matchmaking.has(playerId)) {
        socket.emit('finding_game', { message: 'Већ тражиш противника...' });
        return;
    }

    let opponentId = null;
    for (const id of matchmaking) {
        if (id !== playerId && players[id] && !players[id].gameId) {
            opponentId = id;
            break;
        }
    }

    if (opponentId) {
        matchmaking.delete(opponentId);
        const game = createGame(playerId, opponentId);

        const state1 = getGameState(game, playerId);
        state1.type = 'game_start';
        state1.opponentName = players[opponentId].name;
        state1.yourPlayerNum = 1;
        sendToPlayer(playerId, 'game_start', state1);

        const state2 = getGameState(game, opponentId);
        state2.type = 'game_start';
        state2.opponentName = players[playerId].name;
        state2.yourPlayerNum = 2;
        sendToPlayer(opponentId, 'game_start', state2);

        console.log(`🎮 Igra ${game.id}: ${players[playerId].name} vs ${players[opponentId].name}`);
    } else {
        matchmaking.add(playerId);
        socket.emit('finding_game', {
            message: 'Тражим противника... Само тренутак.',
            queuePosition: matchmaking.size
        });
        console.log(`⏳ ${player.name || playerId.substring(0,8)} čeka protivnika (red: ${matchmaking.size})`);
    }
}
function handleCancelFind(socket, playerId) {
    const player = players[playerId];
    if (!player) return;

    let didCancel = false;

    if (matchmaking.has(playerId)) {
        matchmaking.delete(playerId);
        didCancel = true;
    }

    if (player.roomLink && rooms[player.roomLink]) {
        delete rooms[player.roomLink];
        player.roomLink = null;
        didCancel = true;
    }

    if (didCancel) {
        player.lastCancelTime = Date.now();
        socket.emit('find_cancelled', {
            message: 'Претрага отказана.',
            cooldownSeconds: 10
        });
    }
}
/*function handleChat(socket, playerId, text) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game) return;

    const message = {
        from: player.name,
        text: text.substring(0, 200),
        timestamp: Date.now()
    };

    // Sačuvaj u istoriju igre
    game.chatMessages.push(message);
    if (game.chatMessages.length > 100) {
        game.chatMessages.shift(); // zadrži max 100 poruka
    }

    // Pošalji poruku direktno obojici igrača
    for (const pid of Object.keys(game.players)) {
        const p = players[pid];
        if (p && p.socket) {
            p.socket.emit('chat_message', message);
        }
    }
}
*/
function handlePlaceTiles(socket, playerId, placements) {
    const player = players[playerId];
    if (!player || !player.gameId) {
        socket.emit('error', { message: 'Ниси у игри.' });
        return;
    }
    const game = games[player.gameId];
    if (!game) {
        socket.emit('error', { message: 'Игра не постоји.' });
        return;
    }

    const result = validateMove(game, playerId, placements);
    if (!result.valid) {
        socket.emit('move_invalid', { error: result.error });
        return;
    }

    game.players[playerId].rack = result.newRack;
    game.players[playerId].score += result.score;
    game.isFirstMove = false;
    game.lastMove = {
        playerId: playerId,
        words: result.words,
        score: result.score,
        placements: result.placements
    };
    game.skipCount = 0;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    game.currentTurn = opponentId;

    let gameOver = false;
    let winner = null;
    if (game.bag.length === 0) {
        const p1Rack = game.players[playerId].rack;
        const p2Rack = game.players[opponentId].rack;
        if (p1Rack.length === 0 || p2Rack.length === 0) {
            gameOver = true;
            let p1Deduction = 0, p2Deduction = 0;
            for (const l of p1Rack) p1Deduction += letterValues[l] || 0;
            for (const l of p2Rack) p2Deduction += letterValues[l] || 0;
            game.players[playerId].score -= p1Deduction;
            game.players[opponentId].score -= p2Deduction;
            const p1Score = game.players[playerId].score;
            const p2Score = game.players[opponentId].score;
            if (p1Score > p2Score) winner = playerId;
            else if (p2Score > p1Score) winner = opponentId;
            else winner = 'draw';
            game.status = 'finished';
            game.winner = winner;
        }
    }

    for (const pid of Object.keys(game.players)) {
        const state = getGameState(game, pid);
        state.type = 'move_result';
        state.lastMovePlayerName = players[playerId].name;
        state.lastMoveWords = result.words;
        state.lastMoveScore = result.score;
        if (gameOver) {
            state.type = 'game_over';
            state.gameOver = true;
            if (winner === 'draw') state.resultMessage = '🤝 Нерешено!';
            else if (winner === pid) state.resultMessage = '🎉 Победио/ла си!';
            else state.resultMessage = '😞 Изгубио/ла си.';
            state.finalScores = {
                you: game.players[pid].score,
                opponent: game.players[opponentId].score
            };
        }
        sendToPlayer(pid, state.type, state);
    }

    console.log(`🎯 Igra ${game.id}: ${players[playerId].name} igra ${result.words.join(', ')} (+${result.score})`);
}

function handleSkipTurn(socket, playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game || game.currentTurn !== playerId) return;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    game.currentTurn = opponentId;
    game.lastMove = { playerId: playerId, words: [], score: 0, skipped: true };
    if (!game.skipCount) game.skipCount = 0;
    game.skipCount++;

    let gameOver = false;
    let winner = null;
    if (game.skipCount >= 4) {
        gameOver = true;
        const p1Rack = game.players[playerId].rack;
        const p2Rack = game.players[opponentId].rack;
        let p1Deduction = 0, p2Deduction = 0;
        for (const l of p1Rack) p1Deduction += letterValues[l] || 0;
        for (const l of p2Rack) p2Deduction += letterValues[l] || 0;
        game.players[playerId].score -= p1Deduction;
        game.players[opponentId].score -= p2Deduction;
        const p1Score = game.players[playerId].score;
        const p2Score = game.players[opponentId].score;
        if (p1Score > p2Score) winner = playerId;
        else if (p2Score > p1Score) winner = opponentId;
        else winner = 'draw';
        game.status = 'finished';
        game.winner = winner;
    }

    for (const pid of Object.keys(game.players)) {
        const state = getGameState(game, pid);
        state.type = gameOver ? 'game_over' : 'turn_skipped';
        state.skippedByName = players[playerId].name;
        if (gameOver) {
            state.gameOver = true;
            state.resultMessage = winner === 'draw'
                ? '🤝 Нерешено! Оба играча су прескочила 4 пута.'
                : winner === pid
                    ? '🎉 Победио/ла си! Противник је прескочио превише пута.'
                    : '😞 Изгубио/ла си. Превише прескакања.';
            state.finalScores = {
                you: game.players[pid].score,
                opponent: game.players[opponentId].score
            };
        }
        sendToPlayer(pid, state.type, state);
    }
    console.log(`⏭ Igra ${game.id}: ${players[playerId].name} preskače (skip ${game.skipCount}/4)`);
}

function handleGetState(socket, playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) {
        socket.emit('error', { message: 'Ниси у игри.' });
        return;
    }
    const game = games[player.gameId];
    if (!game) return;
    const state = getGameState(game, playerId);
    state.type = 'game_state';
    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    state.opponentName = players[opponentId]?.name || 'Противник';
    socket.emit('game_state', state);
}

function handleResign(socket, playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game || game.status !== 'active') return;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    game.status = 'finished';
    game.winner = opponentId;

    for (const pid of Object.keys(game.players)) {
        const state = getGameState(game, pid);
        state.type = 'game_over';
        state.gameOver = true;
        state.resignedByName = players[playerId].name;
        state.resultMessage = pid === opponentId
            ? '🎉 Противник је одустао! Победио/ла си!'
            : '🏳 Предао/ла си се.';
        sendToPlayer(pid, 'game_over', state);
    }
    console.log(`🏳 Igra ${game.id}: ${players[playerId].name} predaje`);
}

function handleChat(socket, playerId, text) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game) return;

    const message = {
        from: player.name,
        text: text.substring(0, 200),
        timestamp: Date.now()
    };

    // Sačuvaj u istoriju igre
    game.chatMessages.push(message);
    if (game.chatMessages.length > 100) {
        game.chatMessages.shift(); // zadrži max 100 poruka
    }

    // Pošalji protivniku (svima u sobi osim pošiljaoca)
    socket.to(game.id).emit('chat_message', message);

    // Pošalji pošiljaocu direktno (garantuje da vidi svoju poruku)
    socket.emit('chat_message', message);
}

function handleRematchRequest(socket, playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game || game.status !== 'finished') return;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    if (!opponentId || !players[opponentId]) return;

    sendToPlayer(opponentId, 'rematch_request', {
        fromId: playerId,
        fromName: player.name,
        message: `${player.name} жели реванш!`
    });
    socket.emit('rematch_sent', { message: 'Захтев за реванш је послат.' });
    console.log(`🔄 ${player.name} traži revanš od ${players[opponentId].name}`);
}

function handleAcceptRematch(socket, playerId, fromId) {
    const player = players[playerId];
    if (!player) return;
    const opponent = players[fromId];
    if (!opponent || !opponent.gameId) {
        socket.emit('error', { message: 'Противник више није доступан.' });
        return;
    }
    const oldGame = games[opponent.gameId];
    if (!oldGame || oldGame.status !== 'finished') return;

    const newGame = createGame(fromId, playerId);
    const state1 = getGameState(newGame, fromId);
    state1.type = 'game_start';
    state1.opponentName = player.name;
    state1.yourPlayerNum = 1;
    state1.isRematch = true;
    sendToPlayer(fromId, 'game_start', state1);

    const state2 = getGameState(newGame, playerId);
    state2.type = 'game_start';
    state2.opponentName = opponent.name;
    state2.yourPlayerNum = 2;
    state2.isRematch = true;
    sendToPlayer(playerId, 'game_start', state2);

    delete games[oldGame.id];
    console.log(`🔄 Revanš prihvaćen: ${newGame.id}`);
}

function handleDeclineRematch(socket, playerId, fromId) {
    const opponent = players[fromId];
    if (!opponent) return;
    sendToPlayer(fromId, 'rematch_declined', { message: `${players[playerId].name} је одбио реванш.` });
    socket.emit('rematch_declined', { message: 'Одбио/ла си реванш.' });
    console.log(`❌ ${players[playerId].name} odbija revanš`);
}

function handleLeaveGame(socket, playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game) return;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    if (opponentId && players[opponentId]) {
        sendToPlayer(opponentId, 'opponent_left', { message: `${player.name} је напустио игру.` });
    }

    socket.leave(game.id);
    delete games[game.id];
    players[playerId].gameId = null;
    players[playerId].playerNum = null;
    if (players[opponentId]) {
        players[opponentId].gameId = null;
        players[opponentId].playerNum = null;
        if (players[opponentId].socket) players[opponentId].socket.leave(game.id);
    }
    console.log(`🚪 ${player.name} napušta igru ${game.id}`);
}
function getCooldownRemaining(player) {
    const cooldownMs = 10 * 1000;
    const now = Date.now();
    if (player.lastCancelTime && (now - player.lastCancelTime) < cooldownMs) {
        return Math.ceil((cooldownMs - (now - player.lastCancelTime)) / 1000);
    }
    return 0;
}
// ==================== DISCONNECT SA GRACE PERIODOM ====================
function handleDisconnect(socket, playerId) {
    const player = players[playerId];
    if (!player) return;

    // Ako je disconnecting socket različit od trenutnog, ignoriši
    if (player.socket && player.socket.id !== socket.id) {
        console.log(`🔌 Stari socket ${socket.id} diskonektovan, ignorišem (trenutni je ${player.socket.id})`);
        return;
    }

    console.log(`🔌 Socket disconnected: ${socket.id} (playerId: ${playerId.substring(0,8)})`);

    // Ukloni iz matchmaking-a odmah
    if (matchmaking.has(playerId)) {
        matchmaking.delete(playerId);
        console.log(`🔴 Igrač ${playerId.substring(0,8)} uklonjen iz reda zbog diskonekcije.`);
    }

    // Ako je u aktivnoj igri, pokreni tajmer
    if (player.gameId) {
        const game = games[player.gameId];
        if (game && game.status === 'active') {
            console.log(`⏳ Igrač ${playerId.substring(0,8)} diskonektovan iz aktivne igre. Čekam ${DISCONNECT_GRACE_MS/1000}s pre predaje...`);
            player.disconnectTimer = setTimeout(() => {
                console.log(`⏰ Vreme isteklo, automatska predaja igrača ${playerId.substring(0,8)}`);
                if (players[playerId] && players[playerId].gameId === player.gameId) {
                    handleResign(null, playerId);
                }
            }, DISCONNECT_GRACE_MS);
        }
    }

    // Postavi socket na null da znamo da je offline (ali zadržavamo player objekat)
    player.socket = null;
}

// ==================== ČIŠĆENJE ====================
setInterval(() => {
    const now = Date.now();
    for (const [gameId, game] of Object.entries(games)) {
        if (game.status === 'finished' && now - game.createdAt > 30 * 60 * 1000) {
            delete games[gameId];
            console.log(`🧹 Očišćena igra ${gameId}`);
        }
    }
    for (const [link, room] of Object.entries(rooms)) {
        if (now - room.createdAt > 10 * 60 * 1000) {
            delete rooms[link];
            console.log(`🧹 Očišćena soba ${link}`);
        }
    }
}, CLEANUP_INTERVAL_MS);

// ==================== POKRETANJE ====================
httpServer.listen(PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log('🎯 СМЕХАЛИЦА УКРШТЕНИЦА - СЕРВЕР (Socket.IO)');
    console.log('═══════════════════════════════════════════');
    console.log(`🚀 Server pokrenut na portu ${PORT}`);
    console.log(`📚 Rečnik: ${DICTIONARY.size} reči`);
    console.log(`🔌 Socket.IO: http://localhost:${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
});