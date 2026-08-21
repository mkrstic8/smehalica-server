const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { Server } = require('socket.io');

// ==================== KONFIGURACIJA ====================
const PORT = process.env.PORT || 3000;
const BOARD_SIZE = 15;
const DISCONNECT_GRACE_MS =5 * 60 * 1000; // 1 minut pre predaje
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 10 * 1000;
// Bonus tabla
const bonusBoard = [
    ['TW','','','DL','','','','TW','','','','DL','','','TW'],
    ['','DW','','','','TL','','','','TL','','','','DW',''],
    ['','','DW','','','','DL','','DL','','','','DW','',''],
    ['DL','','','DW','','','','DL','','','','DW','','','DL'],
    ['','','','','DW','','','','','','DW','','','',''],
    ['','TL','','','','TL','','','','TL','','','','TL',''],
    ['','','DL','','','','DL','','DL','','','','DL','',''],
    ['TW','','','DL','','','','❖','','','','DL','','','TW'],
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
    ['Ђ',1], ['Е',10], ['Ж',2], ['З',2], ['И',10],
    ['Ј',4], ['К',3], ['Л',3], ['Љ',1], ['М',3],
    ['Н',6], ['Њ',1], ['О',8], ['П',3], ['Р',6],
    ['С',6], ['Т',5], ['Ћ',1], ['У',5], ['Ф',1],
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
            .filter(w => w.length >= 2 && w.length <= 15);

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
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function sanitizePlayerName(name) {
    if (typeof name !== 'string') {
        return 'Играч';
    }

    const clean = name
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F]/g, '')       // ukloni kontrolne karaktere
        .replace(/[^\p{L}\p{N} ._!?-]/gu, '')         // beli spisak: slova (bilo kog pisma), brojevi, razmak, . _ ! ? -
        .replace(/\s+/g, ' ')                         // spoji višestruke razmake u jedan
        .trim()
        .slice(0, 20);

    return clean || 'Играч';
}

function isValidLetter(letter) {
    return typeof letter === 'string' &&
        letter.length === 1 &&
        Object.prototype.hasOwnProperty.call(letterValues, letter);
}

// ==================== POMOĆNE FUNKCIJE ====================
function createBag() {
    const bag = [];

    // 1. Направи комплетну врећу по постојећој дистрибуцији
    for (const [letter, count] of tileDistribution) {
        for (let i = 0; i < count; i++) {
            bag.push(letter);
        }
    }

    const vowels = new Set(['А', 'Е', 'И', 'О', 'У']);

    // Ретка/тешка слова – прилагоди ако твој tileDistribution
    // користи другачију поделу.
    const rareLetters = new Set([
        'Ђ', 'Љ', 'Њ', 'Ћ', 'Џ', 'Ф', 'Х', 'Ц'
    ]);

    const isVowel = letter => vowels.has(letter);
    const isRare = letter => rareLetters.has(letter);

    // 2. Насумично измешај почетну врећу
    for (let i = bag.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    // 3. Покушај више пута да добијемо добру расподелу.
    // Не мењамо садржај вреће, само позиције.
    function scoreArrangement(arr) {
        let penalty = 0;

        for (let i = 0; i < arr.length; i++) {

            // Највише 2 ретка слова у непосредном низу
            if (i >= 2 &&
                isRare(arr[i]) &&
                isRare(arr[i - 1]) &&
                isRare(arr[i - 2])) {
                penalty += 8;
            }

            // Више од 3 сугласника заредом
            if (i >= 3 &&
                !isVowel(arr[i]) &&
                !isVowel(arr[i - 1]) &&
                !isVowel(arr[i - 2]) &&
                !isVowel(arr[i - 3])) {
                penalty += 5;
            }

            // Више од 3 самогласника заредом
            if (i >= 3 &&
                isVowel(arr[i]) &&
                isVowel(arr[i - 1]) &&
                isVowel(arr[i - 2]) &&
                isVowel(arr[i - 3])) {
                penalty += 5;
            }

            // Два ретка слова веома близу једно другом
            if (i >= 1 &&
                isRare(arr[i]) &&
                isRare(arr[i - 1])) {
                penalty += 2;
            }
        }

        return penalty;
    }

    // 4. Изабери најбоље од више случајних мешања
    let bestBag = bag.slice();
    let bestScore = scoreArrangement(bestBag);

    const attempts = Math.min(100, Math.max(20, bag.length));

    for (let attempt = 0; attempt < attempts; attempt++) {
        const candidate = bag.slice();

        for (let i = candidate.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [candidate[i], candidate[j]] =
                [candidate[j], candidate[i]];
        }

        const score = scoreArrangement(candidate);

        if (score < bestScore) {
            bestScore = score;
            bestBag = candidate;
        }

        // Ако је распоред већ веома добар, нема потребе даље мешати
        if (bestScore === 0) {
            break;
        }
    }

    return bestBag;
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
        link += slova[crypto.randomInt(slova.length)];
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
        stateVersion: 0,
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
        stateVersion: game.stateVersion || 0,
        status: game.status,
        winner: game.winner,
        bagCount: game.bag.length,
        lastMove: game.lastMove,
        chatMessages: game.chatMessages || []   // <-- DODAJ OVO
    };
}

// ==================== VALIDACIJA POTEZA ====================
function validateMove(game, playerId, placements) {
    const seen = new Set();

    for (const p of placements) {
        const key = `${p.row},${p.col}`;

        if (seen.has(key)) {
            return {
                valid: false,
                error: 'Дуплирана позиција плочице.'
            };
        }

        seen.add(key);
    }
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

    if (!p || typeof p !== 'object') {
        return {
            valid: false,
            error: 'Неисправан податак о плочици.'
        };
    }

    const { row, col, letter } = p;

    if (
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        row >= BOARD_SIZE ||
        col < 0 ||
        col >= BOARD_SIZE
    ) {
        return {
            valid: false,
            error: 'Неважећа позиција плочице.'
        };
    }

    if (!isValidLetter(letter)) {
        return {
            valid: false,
            error: 'Неважеће слово.'
        };
    }
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
            return { valid: false, error: 'Први потез мора покрити центар (❖).' };
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
        return { valid: false, error: 'Грешка' + invalidWords.join(', ') };
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
                if (bonus === '❖') wordMultiplier *= 2;
            }
            wordScore += lv;
        }
        totalScore += wordScore * wordMultiplier;
    }

    if (tempBoard.length === 8) totalScore += 50; // BINGO bonus

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

// Bezbednosni HTTP header-i dodati na svaki odgovor.
// NAPOMENA: script-src/style-src i dalje sadrže 'unsafe-inline' jer index.html
// trenutno koristi inline onclick="" atribute i inline <script>/style="" blokove.
// Ovi header-i i dalje pomažu (zaštita od clickjackinga, blokiranje <object>/<embed>,
// ograničenje spoljnih konekcija i skripti na dozvoljene domene), ali SAMI PO SEBI
// ne blokiraju inline-handler XSS (npr. name="<svg onload=...>") — to je zatvoreno
// eskejpovanjem u addChatMessage() i belespiskovnom sanitizePlayerName() ispravkom.
const SECURITY_HEADERS = {
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.socket.io",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=15552000'
};

// ==================== SOCKET.IO SERVER ====================
const httpServer = http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/' || pathname === '/index.html') {
        const filePath = path.join(__dirname, 'public', 'index.html');

        try {
            const html = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, {
                ...SECURITY_HEADERS,
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
                'Surrogate-Control': 'no-store'
            });
            res.end(html);
        } catch (e) {
            res.writeHead(500, {
                ...SECURITY_HEADERS,
                'Content-Type': 'application/json; charset=utf-8'
            });
            res.end(JSON.stringify({
                server: 'Смехалица укрштеница',
                version: '1.0.0',
                error: 'HTML fajl nije pronađen.'
            }));
        }

    } else if (pathname === '/style.css') {
        const filePath = path.join(__dirname, 'public', 'style.css');

        try {
            const css = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, {
                ...SECURITY_HEADERS,
                'Content-Type': 'text/css; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(css);
        } catch (e) {
            res.writeHead(404, {
                ...SECURITY_HEADERS,
                'Content-Type': 'text/plain; charset=utf-8'
            });
            res.end('style.css nije pronađen');
        }
    } else if (pathname === '/izreke.txt') {
    const filePath = path.join(__dirname, 'public', 'izreke.txt');
    try {
        const txt = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
        });
        res.end(txt);
    } catch (e) {
        res.writeHead(404, {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('izreke.txt nije pronađen');
    }

    } else if (pathname === '/status') {
        res.writeHead(200, {
            ...SECURITY_HEADERS,
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
         } else if (pathname === '/favicon.ico') {
        const filePath = path.join(__dirname, 'public', 'favicon.ico');
        try {
            const icon = fs.readFileSync(filePath);
            res.writeHead(200, {
                ...SECURITY_HEADERS,
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(icon);
        } catch (e) {
            res.writeHead(204, SECURITY_HEADERS);
            res.end();
        }
    } else {
        res.writeHead(404, {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('Stranica ne postoji');
    }
});

// ==================== ZAŠTITA OD MASOVNIH KONEKCIJA (DoS) ====================
// Podesivi limiti - po potrebi promeni na osnovu stvarnog saobraćaja.
const MAX_CONCURRENT_PER_IP = 20;     // koliko ISTOVREMENIH konekcija sme jedna IP adresa da drži
const MAX_NEW_CONN_PER_WINDOW = 30;   // koliko NOVIH konekcija jedna IP sme da otvori u prozoru ispod
const CONN_WINDOW_MS = 60 * 1000;     // dužina tog prozora (60s)
const MAX_TOTAL_CONCURRENT = 500;     // globalni maksimum konekcija na server, bez obzira na IP

const connectionsByIp = new Map();     // ip -> Set<socket.id>  (trenutni broj otvorenih konekcija)
const connectAttemptsByIp = new Map(); // ip -> [timestamps]    (brzina otvaranja novih konekcija)

function getClientIp(socket) {
    const xff = socket.handshake.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        const parts = xff.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length > 0) {
            // Render i slični PaaS dodaju STVARNU IP adresu na KRAJ liste kad je proslede dalje;
            // sve pre poslednje stavke klijent može sam da izmisli, zato uzimamo poslednju.
            return parts[parts.length - 1];
        }
    }
    return socket.handshake.address || 'unknown';
}

function registerConnectionForIp(ip, socketId) {
    let set = connectionsByIp.get(ip);
    if (!set) {
        set = new Set();
        connectionsByIp.set(ip, set);
    }
    set.add(socketId);
}

function unregisterConnectionForIp(ip, socketId) {
    const set = connectionsByIp.get(ip);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
        connectionsByIp.delete(ip);
    }
}

// true ako je IP adresa premašila dozvoljeni broj NOVIH konekcija u prozoru vremena
function isRateLimited(ip) {
    const now = Date.now();
    let attempts = connectAttemptsByIp.get(ip);
    if (!attempts) {
        attempts = [];
        connectAttemptsByIp.set(ip, attempts);
    }
    while (attempts.length > 0 && now - attempts[0] > CONN_WINDOW_MS) {
        attempts.shift();
    }
    if (attempts.length >= MAX_NEW_CONN_PER_WINDOW) {
        return true;
    }
    attempts.push(now);
    return false;
}

// Povremeno počisti stare/prazne zapise da connectAttemptsByIp ne raste unedogled
setInterval(() => {
    const now = Date.now();
    for (const [ip, attempts] of connectAttemptsByIp.entries()) {
        while (attempts.length > 0 && now - attempts[0] > CONN_WINDOW_MS) {
            attempts.shift();
        }
        if (attempts.length === 0) {
            connectAttemptsByIp.delete(ip);
        }
    }
}, 5 * 60 * 1000);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ==================== MIDDLEWARE ZA IGRAČE (identitet) ====================
// Ide PRE limita konekcija namerno: mora prvo da se zna da li je poznat
// igrač (validan sessionToken), da limit ispod ne bi blokirao NJEGOVE
// legitimne pokušaje rekonekcije (npr. mobilna aplikacija posle izlaska
// u pozadinu i gubitka konekcije).
io.use((socket, next) => {
    try {
        const auth = socket.handshake.auth || {};
        const sessionToken =
            typeof auth.sessionToken === 'string'
                ? auth.sessionToken
                : null;

        let playerId = null;

        // Постојећи играч — идентификује се session token-ом,
        // а НЕ playerId-јем који клијент сам задаје.
        if (sessionToken) {
            for (const [id, player] of Object.entries(players)) {
                if (
                    player.sessionToken &&
                    player.sessionToken === sessionToken
                ) {
                    playerId = id;
                    break;
                }
            }
        }

        // Нови играч
        if (!playerId) {
            playerId = uuidv4();
            socket.data.isNewPlayer = true;
        } else {
            socket.data.isNewPlayer = false;
        }

        socket.data.playerId = playerId;

        next();
    } catch (err) {
        console.error('❌ Auth middleware greška:', err);
        next(new Error('Аутентификација није успела.'));
    }
});

// ==================== MIDDLEWARE ZA OGRANIČENJE KONEKCIJA ====================
// Globalni limit važi za SVE (novi i poznati igrači) - to je čista zaštita
// kapaciteta servera. Po-IP limiti (broj istovremenih / brzina novih
// pokušaja) važe SAMO za NOVE igrače (bez prepoznatog sessionToken-a) -
// to je stvarni DoS vektor koji ograničavamo (skriptovano pravljenje
// beskonačno novih zapisa u memoriji). Igrač koji se VRAĆA sa validnim
// tokenom (npr. telefon posle izlaska iz aplikacije) se NE odbija ovim -
// on ne pravi nov zapis, samo nastavlja postojeću partiju.
io.use((socket, next) => {
    const ip = getClientIp(socket);
    socket.data.clientIp = ip;

    if (io.engine.clientsCount >= MAX_TOTAL_CONCURRENT) {
        return next(new Error('Server je trenutno pun. Pokušaj ponovo za koji minut.'));
    }

    if (socket.data.isNewPlayer) {
        const currentForIp = connectionsByIp.get(ip);
        if (currentForIp && currentForIp.size >= MAX_CONCURRENT_PER_IP) {
            return next(new Error('Previše aktivnih konekcija sa ove adrese.'));
        }

        if (isRateLimited(ip)) {
            return next(new Error('Previše pokušaja povezivanja. Sačekaj malo pa probaj ponovo.'));
        }
    }

    next();
});

// ==================== KONEKCIJA ====================
io.on('connection', (socket) => {
    const playerId = socket.data.playerId;
    registerConnectionForIp(socket.data.clientIp, socket.id);
    console.log(`🔌 Novi socket: ${socket.id} (playerId: ${playerId.substring(0,8)})`);

    // Ako igrač već postoji u players, ažuriraj socket i otkaži disconnect tajmer
if (players[playerId]) {
    const existingPlayer = players[playerId];
    existingPlayer.lastSeen = Date.now();

    // ------------------------------------------------
    // НОВИ SOCKET ПОСТАЈЕ ЈЕДИНИ ВАЖЕЋИ SOCKET
    // ------------------------------------------------

    const oldSocket = existingPlayer.socket;

    existingPlayer.socket = socket;

    // Откажи аутоматску предају.
    if (existingPlayer.disconnectTimer) {
        clearTimeout(existingPlayer.disconnectTimer);
        existingPlayer.disconnectTimer = null;
    }

    // ------------------------------------------------
    // ВРАТИ ИГРАЧА У SOCKET.IO ROOM
    // ------------------------------------------------

    if (existingPlayer.gameId) {
        socket.join(existingPlayer.gameId);
        socket.data.gameId = existingPlayer.gameId;

        const activeGame = games[existingPlayer.gameId];

        if (activeGame) {

            // Обавезно провери да ли је играч стварно део игре.
            if (!activeGame.players[playerId]) {
                console.warn(
                    `⚠️ Играч ${playerId.substring(0, 8)} није део игре ${activeGame.id}`
                );
            } else {

                console.log(
                    `🔄 RECONNECT ${existingPlayer.name} | ` +
                    `game=${activeGame.id} | ` +
                    `turn=${activeGame.currentTurn?.substring(0, 8)} | ` +
                    `myTurn=${activeGame.currentTurn === playerId} | ` +
                    `version=${activeGame.stateVersion || 0}`
                );

                // Обавести противника да се играч вратио.
                const opponentId = Object.keys(activeGame.players)
                    .find(id => id !== playerId);

                if (
                    activeGame.status === 'active' &&
                    opponentId
                ) {
                    sendToPlayer(
                        opponentId,
                        'opponent_reconnected',
                        {
                            message: `${existingPlayer.name} се вратио у игру.`
                        }
                    );
                }
            }
        }
    } else if (existingPlayer.roomLink) {
        // Креатор се враћа у собу док игра још није почела.
        // Користимо постојећи room_created event — без новог reconnect handler-а.
        const roomLink = existingPlayer.roomLink;
        const room = rooms[roomLink];
        const ROOM_TTL_MS = 10 * 60 * 1000;

        const roomIsValid =
            room &&
            room.creatorId === playerId &&
            typeof room.createdAt === 'number' &&
            (Date.now() - room.createdAt) <= ROOM_TTL_MS;

        if (roomIsValid) {
            console.log(
                `🏠 RECONNECT У СОБУ ${roomLink} | ${existingPlayer.name}`
            );

            socket.emit('room_created', {
                roomLink: roomLink,
                message: `Соба поново повезана! Пошаљи линк противнику: ${roomLink}`
            });
        } else {
            if (room && room.creatorId === playerId) {
                delete rooms[roomLink];
            }

            existingPlayer.roomLink = null;

            console.log(
                `⌛ Соба ${roomLink} више није доступна за ` +
                `${existingPlayer.name}`
            );

            socket.emit('error', {
                message: 'Соба је истекла или више није доступна. Направи нову собу.'
            });
        }
    }

    console.log(
        `🔁 Играч се поново повезао: ${playerId.substring(0, 8)}`
    );

} else {

    players[playerId] = {
        socket: socket,
        sessionToken: generateSessionToken(),
        gameId: null,
        playerNum: null,
        name: 'Играч',
        disconnectTimer: null,
        lastCancelTime: 0,
        lastSeen: Date.now(),
        roomLink: null,
        lastChatTime: 0,
        lastTypingTime: 0,
        lastRematchTime: 0,
        rematchRequestedBy: null
    };
}

    // Pošalji potvrdu sa playerId
    socket.emit('connected', {
        playerId: playerId,
        sessionToken: players[playerId].sessionToken,
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
    const player = players[playerId];

    if (!player) return;

    player.name = sanitizePlayerName(data?.name);

    socket.emit('name_set', {
        name: player.name
    });
});
    socket.on('create_room', () => {
        handleCreateRoom(socket, playerId);
    });

    socket.on('join_room', (data) => {
        handleJoinRoom(socket, playerId, data?.roomLink);
    });

    socket.on('quick_match', () => {
        handleFindGame(socket, playerId);
    });

    socket.on('cancel_find', () => {
        handleCancelFind(socket, playerId);
    });

    socket.on('place_tiles', (data) => {
        handlePlaceTiles(socket, playerId, data?.placements);
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
        handleChat(socket, playerId, data?.text);
    });

socket.on('typing', () => {
    const p = players[playerId];

    if (!p || !p.gameId) return;

    const now = Date.now();

    if (now - p.lastTypingTime < 700) {
        return;
    }

    p.lastTypingTime = now;

    socket.to(p.gameId).emit('opponent_typing');
});

    socket.on('request_rematch', () => {
        handleRematchRequest(socket, playerId);
    });

    socket.on('accept_rematch', (data) => {
        handleAcceptRematch(socket, playerId, data?.fromId);
    });

    socket.on('decline_rematch', (data) => {
        handleDeclineRematch(socket, playerId, data?.fromId);
    });

    socket.on('leave_game', () => {
        handleLeaveGame(socket, playerId);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('disconnect', () => {
        unregisterConnectionForIp(socket.data.clientIp, socket.id);
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

    // Ако играч већ има отворену собу, обриши је пре него што направи нову.
    // roomLink чистимо и ако је сам запис собе већ нестао.
    if (player.roomLink) {
        if (rooms[player.roomLink]) {
            delete rooms[player.roomLink];
        }
        player.roomLink = null;
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

    // Ако играч има своју стару собу, а сада улази у другу,
    // стара соба више не сме да остане активна.
    if (player.roomLink && player.roomLink !== roomLink) {
        if (rooms[player.roomLink]) {
            delete rooms[player.roomLink];
        }
        player.roomLink = null;
    }

    if (!roomLink || !rooms[roomLink]) {
        socket.emit('error', { message: 'Соба не постоји или је линк неважећи.' });
        return;
    }
    const room = rooms[roomLink];
    const ROOM_TTL_MS = 10 * 60 * 1000;

    // Не дозволи улазак у истеклу собу чак и ако cleanup interval
    // још није стигао да је обрише.
    if (
        !room ||
        typeof room.createdAt !== 'number' ||
        Date.now() - room.createdAt > ROOM_TTL_MS
    ) {
        delete rooms[roomLink];

        if (room && players[room.creatorId]?.roomLink === roomLink) {
            players[room.creatorId].roomLink = null;
        }

        socket.emit('error', {
            message: 'Соба је истекла или више није доступна.'
        });
        return;
    }

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

    // Ако је претходна игра завршена,
    // ослободи играча за нову брзу игру.
    if (player.gameId) {
        const existingGame = games[player.gameId];

        if (existingGame && existingGame.status === 'finished') {
            player.gameId = null;
            player.playerNum = null;
            player.roomLink = null;
        } else {
            socket.emit('error', {
                message: 'Већ си у игри.'
            });
            return;
        }
    }

    const remaining = getCooldownRemaining(player);
    if (remaining > 0) {
        socket.emit('error', { message: `Сачекај ${remaining} секунди пре нове претраге.`, cooldownSeconds: remaining });
        return;
    }

    // Quick Match и чекање у сопственој соби су међусобно искључиви.
    // Ако играч пређе на Quick Match, његова стара соба се гаси.
    if (player.roomLink) {
        if (rooms[player.roomLink]) {
            delete rooms[player.roomLink];
        }
        player.roomLink = null;

        console.log(
            `🏠 Стара соба играча ${playerId.substring(0,8)} ` +
            `обрисана због Quick Match-а.`
        );
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
            cooldownSeconds: COOLDOWN_MS / 1000
        });
    }
}
/*function handleChat(socket, playerId, text) {
    const player = players[playerId];
    if (!player) return;
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
    if (
    !Array.isArray(placements) ||
    placements.length < 1 ||
    placements.length > 8
) {
    socket.emit('error', {
        message: 'Неисправан број плочица.'
    });
    return;
}
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
    // Сачувај одиграни потез у историју чета.
// Ово омогућава да се потез види и после reconnect-а.
const moveChatMessage = {
    type: 'move',
    from: players[playerId].name,
    text: `🎯 игра: ${result.words.join(', ')} (+${result.score})`,
    timestamp: Date.now()
};

game.chatMessages.push(moveChatMessage);

// Максимално 100 chat/system порука.
if (game.chatMessages.length > 100) {
    game.chatMessages.shift();
}

// Пошаљи потез као праву chat поруку свим играчима.
for (const pid of Object.keys(game.players)) {
    const p = players[pid];

    if (p && p.socket) {
        p.socket.emit('chat_message', moveChatMessage);
    }
}
game.skipCount = 0;

const opponentId = Object.keys(game.players)
    .find(id => id !== playerId);

// Промена потеза мора бити урађена НА СЕРВЕРУ.
game.currentTurn = opponentId;

// Ново стање игре.
game.stateVersion = (game.stateVersion || 0) + 1;

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
        // Završni obračun po Scrabble pravilu:
        // igrač koji ostane bez pločica dobija vrednost svih
        // preostalih pločica protivnika, a protivniku se ta vrednost oduzima.
        if (p1Rack.length === 0) {
            game.players[playerId].score += p2Deduction;
            game.players[opponentId].score -= p2Deduction;
        } else if (p2Rack.length === 0) {
            game.players[opponentId].score += p1Deduction;
            game.players[playerId].score -= p1Deduction;
        }

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

    const opponentId = Object.keys(game.players)
    .find(id => id !== playerId);

    game.currentTurn = opponentId;

    game.lastMove = {
        playerId: playerId,
        words: [],
        score: 0,
        skipped: true
    };

    // Ново серверско стање.
    game.stateVersion = (game.stateVersion || 0) + 1;
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
                    ? 'Нема више добрих потеза, рачунам скор. Победио/ла си!🎉 '
                    : ' Нема више добрих потеза, рачунам скор. Изгубио/ла си. 😞';
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
    if (typeof text !== 'string' || text.trim().length === 0) return;

    const player = players[playerId];
    const now = Date.now();

if (now - player.lastChatTime < 700) {
    socket.emit('error', {
        message: 'Сачекај мало пре слања следеће поруке.'
    });
    return;
}

player.lastChatTime = now;
    //if (!player || !player.gameId) return;

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

    const now = Date.now();

    if (now - player.lastRematchTime < 3000) {
        socket.emit('error', {
            message: 'Сачекај мало пре новог захтева за реванш.'
        });
        return;
    }

    const opponentId = Object.keys(game.players)
        .find(id => id !== playerId);

    if (!opponentId || !players[opponentId]) return;

    player.lastRematchTime = now;

    game.rematchRequestedBy = playerId;

    sendToPlayer(opponentId, 'rematch_request', {
        fromId: playerId,
        fromName: player.name,
        message: `${player.name} жели реванш!`
    });

    socket.emit('rematch_sent', {
        message: 'Захтев за реванш је послат.'
    });

    console.log(
        `🔄 ${player.name} traži revanš od ${players[opponentId].name}`
    );
}
function handleAcceptRematch(socket, playerId, fromId) {
    const player = players[playerId];

    if (!player || !player.gameId) {
        socket.emit('error', {
            message: 'Ниси у завршеној игри.'
        });
        return;
    }

    const oldGame = games[player.gameId];

    if (!oldGame || oldGame.status !== 'finished') {
        socket.emit('error', {
            message: 'Реванш више није доступан.'
        });
        return;
    }

    const opponentId = Object.keys(oldGame.players)
        .find(id => id !== playerId);

    if (!opponentId) {
        socket.emit('error', {
            message: 'Противник није пронађен.'
        });
        return;
    }

    // КРИТИЧНА ПРОВЕРА:
    // fromId мора бити стварни противник у овој игри.
    if (fromId !== opponentId) {
        socket.emit('error', {
            message: 'Неважећи захтев за реванш.'
        });
        return;
    }

    // Мора постојати активан захтев
    if (oldGame.rematchRequestedBy !== fromId) {
        socket.emit('error', {
            message: 'Нема активног захтева за реванш.'
        });
        return;
    }

    if (oldGame.rematchStarted) {
        return;
    }

    oldGame.rematchStarted = true;

    const opponent = players[opponentId];

    if (!opponent) {
        socket.emit('error', {
            message: 'Противник више није доступан.'
        });
        oldGame.rematchStarted = false;
        return;
    }

    const newGame = createGame(opponentId, playerId);

    const state1 = getGameState(newGame, opponentId);
    state1.type = 'game_start';
    state1.opponentName = player.name;
    state1.yourPlayerNum = 1;
    state1.isRematch = true;

    sendToPlayer(
        opponentId,
        'game_start',
        state1
    );

    const state2 = getGameState(newGame, playerId);
    state2.type = 'game_start';
    state2.opponentName = opponent.name;
    state2.yourPlayerNum = 2;
    state2.isRematch = true;

    sendToPlayer(
        playerId,
        'game_start',
        state2
    );

    // Стару игру више не користимо.
    delete games[oldGame.id];

    console.log(`🔄 Revanš prihvaćen: ${newGame.id}`);
}

function handleDeclineRematch(socket, playerId, fromId) {
    const player = players[playerId];

    if (!player || !player.gameId) return;

    const game = games[player.gameId];

    if (!game || game.status !== 'finished') return;

    const opponentId = Object.keys(game.players)
        .find(id => id !== playerId);

    if (fromId !== opponentId) {
        socket.emit('error', {
            message: 'Неважећи захтев.'
        });
        return;
    }

    if (game.rematchRequestedBy !== fromId) {
        socket.emit('error', {
            message: 'Нема активног захтева за реванш.'
        });
        return;
    }

    game.rematchRequestedBy = null;

    sendToPlayer(fromId, 'rematch_declined', {
        message: `${player.name} је одбио реванш.`
    });

    socket.emit('rematch_declined', {
        message: 'Одбио/ла си реванш.'
    });

    console.log(
        `❌ ${player.name} odbija revanš`
    );
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
    const now = Date.now();
    if (player.lastCancelTime && (now - player.lastCancelTime) < COOLDOWN_MS) {
        return Math.ceil((COOLDOWN_MS - (now - player.lastCancelTime)) / 1000);
    }
    return 0;
}
// ==================== DISCONNECT SA GRACE PERIODOM ====================
function handleDisconnect(socket, playerId) {
    const player = players[playerId];

    if (!player) return;

    // Ако је овај socket већ стар и играч има нову активну
    // konekciju, ovaj disconnect ne sme da utiče na igrača.
    if (player.socket && player.socket.id !== socket.id) {
        console.log(
            `🔌 Stari socket ${socket.id} diskonektovan, ignorišem.`
        );
        return;
    }

    console.log(
        `🔌 Socket disconnected: ${socket.id} ` +
        `(playerId: ${playerId.substring(0, 8)})`
    );

    // Zabeleži poslednji trenutak kada je igrač bio viđen.
    player.lastSeen = Date.now();

    // Odmah označi igrača kao offline.
    player.socket = null;

    // Ukloni iz matchmaking reda.
    if (matchmaking.has(playerId)) {
        matchmaking.delete(playerId);

        console.log(
            `🔴 Igrač ${playerId.substring(0, 8)} ` +
            `uklonjen iz reda zbog diskonekcije.`
        );
    }

    if (!player.gameId) {
        return;
    }

    const gameIdAtDisconnect = player.gameId;
    const game = games[gameIdAtDisconnect];

    if (!game || game.status !== 'active') {
        return;
    }

    const opponentId = Object.keys(game.players)
        .find(id => id !== playerId);

    if (opponentId) {
        sendToPlayer(opponentId, 'opponent_disconnected', {
            message: `${player.name} је изгубио везу. Чекам повратак...`,
            graceSeconds: DISCONNECT_GRACE_MS / 1000
        });
    }

    console.log(
        `⏳ Igrač ${playerId.substring(0, 8)} je offline. ` +
        `Čekam ${DISCONNECT_GRACE_MS / 1000}s pre automatske predaje...`
    );

    // Ako postoji neki stari timer, ukloni ga.
    if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
    }

    player.disconnectTimer = setTimeout(() => {
        const currentPlayer = players[playerId];

        if (!currentPlayer) {
            return;
        }

        // KLJUČNA PROVERA:
        // Ako se igrač u međuvremenu reconnectovao,
        // socket više nije null i NE SME da bude predat.
        if (currentPlayer.socket !== null) {
            console.log(
                `✅ Igrač ${playerId.substring(0, 8)} se vratio. ` +
                `Automatska predaja otkazana.`
            );

            currentPlayer.disconnectTimer = null;
            return;
        }

        // Mora i dalje biti u istoj igri.
        if (currentPlayer.gameId !== gameIdAtDisconnect) {
            currentPlayer.disconnectTimer = null;
            return;
        }

        const currentGame = games[gameIdAtDisconnect];

        if (!currentGame || currentGame.status !== 'active') {
            currentPlayer.disconnectTimer = null;
            return;
        }

        console.log(
            `⏰ Grace period istekao. ` +
            `Automatska predaja igrača ${playerId.substring(0, 8)}.`
        );

        currentPlayer.disconnectTimer = null;

        handleResign(null, playerId);

    }, DISCONNECT_GRACE_MS);
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
            if (room && players[room.creatorId]?.roomLink === link) {
                players[room.creatorId].roomLink = null;
            }

            delete rooms[link];
            console.log(`🧹 Očišćena soba ${link}`);
        }
    }
    // NOVO: očisti igrače koji su offline duže od 1h i nisu u aktivnoj igri
    for (const [pid, player] of Object.entries(players)) {
        if (!player.socket && !player.gameId && !matchmaking.has(pid)) {
            const lastSeen = player.lastSeen || 0;
            if (now - lastSeen > 60 * 60 * 1000) {
                if (player.roomLink && rooms[player.roomLink]) {
                    delete rooms[player.roomLink];
                }

                delete players[pid];
            }
        }
    }
}, CLEANUP_INTERVAL_MS);
// ==================== GLOBALNA ZAŠTITA OD PADA SERVERA ====================
process.on('uncaughtException', (err) => {
    console.error('❌ NEUHVAĆENA GREŠKA:', err);
    // Server nastavlja da radi umesto da se ugasi
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ NEUHVAĆENO ODBIJANJE PROMISE-A:', reason);
});
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