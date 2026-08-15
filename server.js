const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');
// ==================== KONFIGURACIJA ====================
const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 15;

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
    'П':2,'Р':1,'С':1,'Т':1,'Ћ':10,'У':1,'Ф':5,'Х':4,'Ц':4,
    'Ч':4,'Џ':8,'Ш':4
};

const tileDistribution = [
    ['А',9],['Б',2],['В',4],['Г',2],['Д',4],['Ђ',1],['Е',9],
    ['Ж',2],['З',2],['И',9],['Ј',3],['К',3],['Л',3],['Љ',1],
    ['М',3],['Н',6],['Њ',1],['О',9],['П',3],['Р',6],['С',6],
    ['Т',6],['Ћ',1],['У',4],['Ф',1],['Х',2],['Ц',2],['Ч',2],
    ['Џ',1],['Ш',2]
];

// ==================== REČNIK ====================
// Učitaj reči iz fajla (ili koristi ugrađeni demo set)
// ==================== REČNIK ====================
let DICTIONARY = new Set();

try {
    const dictFile = fs.readFileSync('./serbian-words.txt', 'utf8');
    const words = dictFile.split(/[\n\r]+/)
        .map(w => w.trim().toUpperCase())
        .filter(w => /^[АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ]+$/.test(w))
        .filter(w => w.length >= 3 && w.length <= 15); // SAMO 3+ slova iz fajla
    DICTIONARY = new Set(words);
    console.log(`📚 Rečnik učitan iz fajla: ${DICTIONARY.size} reči (3+ slova)`);
} catch (e) {
    console.error('❌ Ne mogu da učitam serbian-words.txt:', e.message);
    process.exit(1);
}

// Dodaj dozvoljene dvoslovne reči
const allowedTwoLetterWords = [
    'АД','АХ','АЈ','АЛ','АС','АТ','АУ',
    'БА','БЕ','БИ',
    'ДА','ДЕ','ДО',
    'ЕХ','ЕЈ',
    'ЈА','ЈЕ',
    'КА','КО',
    'МА','МЕ','МИ','МУ',
    'НА','НЕ','НИ','НО',
    'ОД','ОН','ОТ',
    'ПА','ПО',
    'СА','СЕ','СИ','СО','СУ',
    'ТА','ТЕ','ТИ','ТО','ТУ',
    'УЗ','УФ',
    'ХА','ХЕ','ХИ','ХО',
    'ЋЕ','ЋИ','ЋУ',
    'ШУ'
];

for (const w of allowedTwoLetterWords) {
    DICTIONARY.add(w);
}

console.log(`📚 Dodato ${allowedTwoLetterWords.length} dvoslovnih reči`);
console.log(`📚 Ukupno reči u rečniku: ${DICTIONARY.size}`);

// ==================== STANJE IGARA ====================
const games = {};        // gameId -> gameState
const players = {};      // playerId -> { ws, gameId, playerNum, name }
const matchmaking = [];  // igrači koji čekaju protivnika
const rooms = {};  // { linkKod: { gameId, creatorId, createdAt } }
// ==================== POMOĆNE FUNKCIJE ====================
function createBag() {
    const bag = [];
    for (const [letter, count] of tileDistribution) {
        for (let i = 0; i < count; i++) bag.push(letter);
    }
    
    // FIX #3: Dodaj još samoglasnika (duplo) za lakše formiranje reči
    const extraVowels = ['А','А','А','А','Е','Е','Е','Е','И','И','И','О','О','О','У','У'];
    bag.push(...extraVowels);
    
    // Fisher-Yates shuffle
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
    // Proveri da nije duplikat
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
        status: 'active', // active, finished
        winner: null,
        lastMove: null,
        turnStartTime: Date.now(),
        createdAt: Date.now(),
        skipCount: 0
    };

    games[gameId] = game;

    // Poveži igrače sa igrom
    players[player1Id].gameId = gameId;
    players[player1Id].playerNum = 1;
    players[player2Id].gameId = gameId;
    players[player2Id].playerNum = 2;

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
        lastMove: game.lastMove
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
        // Rollback
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

        // Proveri praznine
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

// DODAJ GLAVNU REČ SAMO AKO IMA 2+ SLOVA
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
            // DODAJ SAMO AKO IMA 2+ SLOVA I NIJE ISTA KAO GLAVNA REČ
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
            // DODAJ SAMO AKO IMA 2+ SLOVA I NIJE ISTA KAO GLAVNA REČ
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

// ==================== WEBSOCKET SERVER ====================
const server = http.createServer((req, res) => {
    // Serviraj index.html za glavnu stranicu
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');
        try {
            const html = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                server: 'Смехалица укрштеница',
                version: '1.0.0',
                error: 'HTML fajl nije pronađen. Kreiraj public/index.html'
            }));
        }
    }
    // Status endpoint
    else if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            server: 'Смехалица укрштеница',
            version: '1.0.0',
            activeGames: Object.keys(games).length,
            playersOnline: Object.keys(players).length,
            dictionarySize: DICTIONARY.size
        }));
    }
    else {
        res.writeHead(404);
        res.end('Stranica ne postoji');
    }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    const playerId = uuidv4();
    players[playerId] = { ws, gameId: null, playerNum: null, name: 'Играч' };

    console.log(`🔌 Играч повезан: ${playerId.substring(0, 8)}`);

    // Pošalji ID igraču
    send(ws, {
        type: 'connected',
        playerId: playerId,
        message: 'Повезан/а на сервер Смехалице!'
    });

        ws.on('message', (data) => {
        try {
            const raw = data.toString();
            console.log('📨 Primljena poruka:', raw.substring(0, 200)); // Loguj prvih 200 karaktera
            const message = JSON.parse(raw);
            console.log('✅ Parsiran tip:', message.type);
            handleMessage(playerId, message);
        } catch (e) {
            console.error('❌ Greška u parsiranju:', e.message);
            console.error('📄 Sirovi podaci:', data.toString().substring(0, 200));
            send(ws, { type: 'error', message: 'Неважећи формат поруке.' });
        }
    });

    ws.on('close', () => {
        console.log(`🔌 Играч искључен: ${playerId.substring(0, 8)}`);
        handleDisconnect(playerId);
        delete players[playerId];
    });

    ws.on('error', (err) => {
        console.error(`❌ WebSocket greška za ${playerId.substring(0, 8)}:`, err.message);
    });
});

function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function sendToPlayer(playerId, message) {
    const player = players[playerId];
    if (player && player.ws) {
        send(player.ws, message);
    }
}

function broadcastToGame(gameId, message, excludePlayerId = null) {
    const game = games[gameId];
    if (!game) return;
    for (const pid of Object.keys(game.players)) {
        if (pid !== excludePlayerId) {
            sendToPlayer(pid, message);
        }
    }
}

// ==================== HANDLERI PORUKA ====================
function handleMessage(playerId, message) {
    const { type } = message;

    switch (type) {
        case 'set_name':
            if (players[playerId]) {
                players[playerId].name = message.name || 'Igrac';
                sendToPlayer(playerId, { type: 'name_set', name: players[playerId].name });
            }
            break;

        case 'create_room':
            handleCreateRoom(playerId);
            break;

        case 'join_room':
            handleJoinRoom(playerId, message.roomLink);
            break;

        case 'quick_match':
            handleFindGame(playerId);
            break;

        case 'cancel_find':
            handleCancelFind(playerId);
            break;

        case 'place_tiles':
            handlePlaceTiles(playerId, message.placements);
            break;

        case 'skip_turn':
            handleSkipTurn(playerId);
            break;

        case 'get_state':
            handleGetState(playerId);
            break;

        case 'resign':
            handleResign(playerId);
            break;

        case 'chat':
            handleChat(playerId, message.text);
            break;

        case 'ping':
            sendToPlayer(playerId, { type: 'pong' });
            break;

        case 'request_rematch':
            handleRematchRequest(playerId);
            break;

        case 'accept_rematch':
            handleAcceptRematch(playerId, message.fromId);
            break;

        case 'decline_rematch':
            handleDeclineRematch(playerId, message.fromId);
            break;
        case 'leave_game':
            handleLeaveGame(playerId);
            break;
        default:
            console.log('Nepoznat tip poruke:', type);
            sendToPlayer(playerId, { type: 'error', message: 'Nepoznat tip poruke: ' + type });
    }
}
function handleCreateRoom(playerId) {
    const player = players[playerId];
    if (!player) return;
    if (player.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Већ си у игри.' });
        return;
    }
    
    const link = generateRoomLink();
    // Kreiraj praznu sobu (igra još nije aktivna)
    rooms[link] = {
        creatorId: playerId,
        createdAt: Date.now()
    };
    
    sendToPlayer(playerId, {
        type: 'room_created',
        roomLink: link,
        message: `Соба креирана! Пошаљи линк противнику: ${link}`
    });
    
    console.log(`🏠 Soba kreirana: ${link} od strane ${player.name}`);
}

function handleJoinRoom(playerId, roomLink) {
    const player = players[playerId];
    if (!player) return;
    if (player.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Већ си у игри.' });
        return;
    }
    
    if (!roomLink || !rooms[roomLink]) {
        sendToPlayer(playerId, { type: 'error', message: 'Соба не постоји или је линк неважећи.' });
        return;
    }
    
    const room = rooms[roomLink];
    const creatorId = room.creatorId;
    
    if (!players[creatorId] || players[creatorId].gameId) {
        delete rooms[roomLink];
        sendToPlayer(playerId, { type: 'error', message: 'Креатор собе више није доступан.' });
        return;
    }
    
    // Kreiraj igru
    const game = createGame(creatorId, playerId);
    
    // Obavesti oba igrača
    const state1 = getGameState(game, creatorId);
    state1.type = 'game_start';
    state1.opponentName = player.name;
    state1.yourPlayerNum = 1;
    sendToPlayer(creatorId, state1);
    
    const state2 = getGameState(game, playerId);
    state2.type = 'game_start';
    state2.opponentName = players[creatorId].name;
    state2.yourPlayerNum = 2;
    sendToPlayer(playerId, state2);
    
    // Obriši sobu
    delete rooms[roomLink];
    
    console.log(`🎮 Igra ${game.id}: ${players[creatorId].name} vs ${player.name} (soba: ${roomLink})`);
}

function handleGetRoomLink(playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Ниси у игри.' });
        return;
    }
    
    const game = games[player.gameId];
    if (!game) return;
    
    // Generiši link za postojeću igru (za deljenje)
    const link = generateRoomLink();
    rooms[link] = { creatorId: playerId, gameId: player.gameId, createdAt: Date.now() };
    
    sendToPlayer(playerId, {
        type: 'room_link',
        roomLink: link,
        message: `Линк за дељење: ${link}`
    });
}
function handleFindGame(playerId) {
    const player = players[playerId];
    if (!player) return;

    // Ako je već u igri
    if (player.gameId) {
        sendToPlayer(playerId, {
            type: 'error',
            message: 'Већ си у игри.'
        });
        return;
    }

    // Ukloni iz matchmaking-a ako već čeka
    const existingIndex = matchmaking.indexOf(playerId);
    if (existingIndex >= 0) {
        matchmaking.splice(existingIndex, 1);
    }

    // Pokušaj da nađeš protivnika
    if (matchmaking.length > 0) {
        const opponentId = matchmaking.shift();

        // Proveri da li je opponent još uvek dostupan
        if (!players[opponentId] || players[opponentId].gameId) {
            // Opponent više nije dostupan, traži dalje
            matchmaking.push(playerId);
            sendToPlayer(playerId, {
                type: 'finding_game',
                message: 'Тражим противника...'
            });
            return;
        }

        // Kreiraj igru
        const game = createGame(playerId, opponentId);

        // Obavesti oba igrača
        const state1 = getGameState(game, playerId);
        state1.type = 'game_start';
        state1.opponentName = players[opponentId].name;
        state1.yourPlayerNum = 1;
        sendToPlayer(playerId, state1);

        const state2 = getGameState(game, opponentId);
        state2.type = 'game_start';
        state2.opponentName = players[playerId].name;
        state2.yourPlayerNum = 2;
        sendToPlayer(opponentId, state2);

        console.log(`🎮 Игра ${game.id}: ${players[playerId].name} vs ${players[opponentId].name}`);

    } else {
        // Nema protivnika, dodaj u red čekanja
        matchmaking.push(playerId);
        sendToPlayer(playerId, {
            type: 'finding_game',
            message: 'Тражим противника... Само тренутак.',
            queuePosition: matchmaking.length
        });
        console.log(`⏳ ${player.name || playerId.substring(0,8)} чека противника (ред: ${matchmaking.length})`);
    }
}

function handleCancelFind(playerId) {
    const index = matchmaking.indexOf(playerId);
    if (index >= 0) {
        matchmaking.splice(index, 1);
        sendToPlayer(playerId, {
            type: 'find_cancelled',
            message: 'Претрага отказана.'
        });
    }
}

function handlePlaceTiles(playerId, placements) {
    const player = players[playerId];
    if (!player || !player.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Ниси у игри.' });
        return;
    }

    const game = games[player.gameId];
    if (!game) {
        sendToPlayer(playerId, { type: 'error', message: 'Игра не постоји.' });
        return;
    }

    const result = validateMove(game, playerId, placements);

    if (!result.valid) {
        sendToPlayer(playerId, {
            type: 'move_invalid',
            error: result.error
        });
        return;
    }

    // Ažuriraj stanje igre
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
    game.turnStartTime = Date.now();

    // Promeni redosled
    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    game.currentTurn = opponentId;

    // Proveri kraj igre
    let gameOver = false;
    let winner = null;

    if (game.bag.length === 0) {
        const p1Rack = game.players[playerId].rack;
        const p2Rack = game.players[opponentId].rack;

        if (p1Rack.length === 0 || p2Rack.length === 0) {
            gameOver = true;
            // Oduzmi preostale pločice
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

    // Obavesti oba igrača
    for (const pid of Object.keys(game.players)) {
        const state = getGameState(game, pid);
        state.type = 'move_result';
        state.lastMovePlayerName = players[playerId].name;
        state.lastMoveWords = result.words;
        state.lastMoveScore = result.score;

        if (gameOver) {
            state.type = 'game_over';
            state.gameOver = true;
            if (winner === 'draw') {
                state.resultMessage = '🤝 Нерешено!';
            } else if (winner === pid) {
                state.resultMessage = '🎉 Победио/ла си!';
            } else {
                state.resultMessage = '😞 Изгубио/ла си.';
            }
            state.finalScores = {
                you: game.players[pid].score,
                opponent: game.players[opponentId].score
            };
        }

        sendToPlayer(pid, state);
    }

    console.log(`🎯 Igra ${game.id}: ${players[playerId].name} igra ${result.words.join(', ')} (+${result.score})`);
}

function handleSkipTurn(playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;

    const game = games[player.gameId];
    if (!game || game.currentTurn !== playerId) return;

    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    game.currentTurn = opponentId;
    game.turnStartTime = Date.now();
    game.lastMove = {
        playerId: playerId,
        words: [],
        score: 0,
        skipped: true
    };

    // Povećaj brojač uzastopnih preskakanja
    if (!game.skipCount) game.skipCount = 0;
    game.skipCount++;
    console.log('SKIP COUNT SADA:', game.skipCount);

    // Proveri da li je dostignuto 4 uzastopna preskakanja
    let gameOver = false;
    let winner = null;

    if (game.skipCount >= 4) {
        gameOver = true;
        
        // Oduzmi vrednost preostalih pločica od skora oba igrača
        const p1Rack = game.players[playerId].rack;
        const p2Rack = game.players[opponentId].rack;
        
        let p1Deduction = 0;
        let p2Deduction = 0;
        
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
        
        sendToPlayer(pid, state);
    }

    console.log(`⏭ Igra ${game.id}: ${players[playerId].name} preskače (skip ${game.skipCount}/4)`);
}

function handleGetState(playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Ниси у игри.' });
        return;
    }

    const game = games[player.gameId];
    if (!game) {
        sendToPlayer(playerId, { type: 'error', message: 'Игра не постоји.' });
        return;
    }

    const state = getGameState(game, playerId);
    state.type = 'game_state';
    state.opponentName = players[Object.keys(game.players).find(id => id !== playerId)]?.name || 'Противник';
    sendToPlayer(playerId, state);
}

function handleResign(playerId) {
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
        state.resultMessage = pid === opponentId ? '🎉 Противник је одустао! Победио/ла си!' : '🏳 Предао/ла си се.';
        sendToPlayer(pid, state);
    }

    console.log(`🏳 Igra ${game.id}: ${players[playerId].name} predaje`);
}

function handleChat(playerId, text) {
    const player = players[playerId];
    if (!player || !player.gameId) return;

    const game = games[player.gameId];
    if (!game) return;

    broadcastToGame(player.gameId, {
        type: 'chat_message',
        from: player.name,
        fromId: playerId,
        text: text.substring(0, 200), // max 200 karaktera
        timestamp: Date.now()
    });
}

function handleRematchRequest(playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    const game = games[player.gameId];
    if (!game || game.status !== 'finished') return;
    
    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    if (!opponentId || !players[opponentId]) return;
    
    // Pošalji zahtev protivniku
    sendToPlayer(opponentId, {
        type: 'rematch_request',
        fromId: playerId,
        fromName: player.name,
        message: `${player.name} жели реванш!`
    });
    
    sendToPlayer(playerId, {
        type: 'rematch_sent',
        message: 'Захтев за реванш је послат.'
    });
    
    console.log(`🔄 ${player.name} traži revanš od ${players[opponentId].name}`);
}

function handleAcceptRematch(playerId, fromId) {
    const player = players[playerId];
    if (!player) return;
    
    const opponent = players[fromId];
    if (!opponent || !opponent.gameId) {
        sendToPlayer(playerId, { type: 'error', message: 'Противник више није доступан.' });
        return;
    }
    
    const oldGame = games[opponent.gameId];
    if (!oldGame || oldGame.status !== 'finished') return;
    
    // Kreiraj novu igru
    const newGame = createGame(fromId, playerId);
    const gameState1 = getGameState(newGame, fromId);
    const gameState2 = getGameState(newGame, playerId);
    
    sendToPlayer(fromId, {
        ...gameState1,
        type: 'game_start',
        opponentName: player.name,
        yourPlayerNum: 1,
        isRematch: true
    });
    
    sendToPlayer(playerId, {
        ...gameState2,
        type: 'rematch_accepted',
        opponentName: opponent.name,
        yourPlayerNum: 2
    });
    
    // Odmah pošalji i game_start
    setTimeout(() => {
        sendToPlayer(playerId, {
            ...gameState2,
            type: 'game_start',
            opponentName: opponent.name,
            yourPlayerNum: 2,
            isRematch: true
        });
    }, 200);
    
    delete games[oldGame.id];
    console.log(`🔄 Revanš prihvaćen: ${newGame.id}`);
}

function handleDeclineRematch(playerId, fromId) {
    const opponent = players[fromId];
    if (!opponent) return;
    
    sendToPlayer(fromId, {
        type: 'rematch_declined',
        message: `${players[playerId].name} је одбио реванш.`
    });
    
    sendToPlayer(playerId, {
        type: 'rematch_declined',
        message: 'Одбио/ла си реванш.'
    });
    
    console.log(`❌ ${players[playerId].name} odbija revanš`);
}

function handleDisconnect(playerId) {
    const player = players[playerId];
    if (!player) return;

    // Ukloni iz matchmaking-a
    const mmIndex = matchmaking.indexOf(playerId);
    if (mmIndex >= 0) matchmaking.splice(mmIndex, 1);

    // Ako je u igri
    if (player.gameId) {
        const game = games[player.gameId];
        if (game && game.status === 'active') {
            const opponentId = Object.keys(game.players).find(id => id !== playerId);
            game.status = 'finished';
            game.winner = opponentId;

            sendToPlayer(opponentId, {
                type: 'game_over',
                gameOver: true,
                resultMessage: '🎉 Противник је искључен. Победио/ла си!',
                opponentDisconnected: true
            });

            console.log(`🔌 Igra ${game.id} prekinuta — igrač se isključio`);
        }
    }
}
function handleLeaveGame(playerId) {
    const player = players[playerId];
    if (!player || !player.gameId) return;
    
    const game = games[player.gameId];
    if (!game) return;
    
    const opponentId = Object.keys(game.players).find(id => id !== playerId);
    
    // Obavesti protivnika da je igrač otišao
    sendToPlayer(opponentId, {
        type: 'opponent_left',
        message: `${player.name} је напустио игру.`
    });
    
    // Ukloni igru
    delete games[game.id];
    
    // Očisti igrače
    players[playerId].gameId = null;
    players[playerId].playerNum = null;
    if (players[opponentId]) {
        players[opponentId].gameId = null;
        players[opponentId].playerNum = null;
    }
    
    console.log(`🚪 ${player.name} napušta igru ${game.id}`);
}

// ==================== PERIODIČNO ČIŠĆENJE ====================
setInterval(() => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minuta

    for (const [gameId, game] of Object.entries(games)) {
        // Očisti završene igre starije od 30 min
        if (game.status === 'finished' && now - game.createdAt > timeout) {
            delete games[gameId];
            console.log(`🧹 Očišćena igra ${gameId}`);
        }
    }
}, 5 * 60 * 1000); // Svakih 5 minuta

// ==================== POKRETANJE ====================
server.listen(PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log('🎯 СМЕХАЛИЦА УКРШТЕНИЦА - СЕРВЕР');
    console.log('═══════════════════════════════════════════');
    console.log(`🚀 Server pokrenut na portu ${PORT}`);
    console.log(`📚 Rečnik: ${DICTIONARY.size} reči`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
});