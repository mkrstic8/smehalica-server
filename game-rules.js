// ==================== ПРАВИЛА ИГРЕ (чиста логика) ====================
// Овај модул НЕМА никакве споредне ефекте: не отвара сокете, не чита фајлове,
// не дира глобално стање сервера. Зато може да се тестира изоловано
// (види test-rules.js) и зато `require('./game-rules')` не диже сервер.
//
// Извучено из server.js без измене логике — само су зависности
// (речник) сада експлицитан аргумент уместо глобалне променљиве.

const crypto = require('crypto');

// ЈЕДИНО МЕСТО ГДЕ СЕ МЕЊА ВЕЛИЧИНА ТАБЛЕ.
// config.js и server.js ово преузимају одавде.
// Ако промениш, мораш ускладити и bonusBoard испод,
// плус grid у style.css и петље у public/app.js.
const BOARD_SIZE = 13;

// Провера да ли је слово уопште из српске азбуке коју игра познаје.
// Живи овде јер је користи validateMove; server.js је увози из овог модула.
function isValidLetter(letter) {
    return typeof letter === 'string' &&
        letter.length === 1 &&
        Object.prototype.hasOwnProperty.call(letterValues, letter);
}

// ==================== БОНУС ТАБЛА 13x13 ====================
// ⚠ ПРИВРЕМЕНА — попуни је сам.
//
// Мора имати ТАЧНО 13 редова по 13 поља. Дозвољене вредности:
//   'TW' тројна реч | 'DW' двострука реч
//   'TL' тројно слово | 'DL' двоструко слово
//   '❖'  центар (поље [6][6], ту почиње први потез)
//   ''   обично поље
//
// Кад је попуниш, ИСТУ таблу залепи и у public/app.js у функцију
// renderBoardFromState — клијент има своју копију. Ако се две разликују,
// играч види једне бонусе а добија поене по другима.
//
// Провера симетрије: node -e "const{bonusBoard:b}=require('./game-rules');
//   console.log(b.every((r,i)=>r.every((c,j)=>c===b[12-i][12-j])))"
const bonusBoard = [
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','❖','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
    ['','','','','','','','','','','','',''],
];

const letterValues = {
    'А':1,'Б':3,'В':2,'Г':3,'Д':2,'Ђ':8,'Е':1,'Ж':5,'З':3,
    'И':1,'Ј':3,'К':2,'Л':2,'Љ':5,'М':2,'Н':1,'Њ':5,'О':1,
    'П':2,'Р':1,'С':1,'Т':1,'Ћ':8,'У':1,'Ф':5,'Х':4,'Ц':4,
    'Ч':4,'Џ':10,'Ш':4
};

const tileDistribution = Object.freeze([
    ['А',8], ['Б',2], ['В',3], ['Г',2], ['Д',3],
    ['Ђ',1], ['Е',8], ['Ж',1], ['З',2], ['И',8],
    ['Ј',3], ['К',3], ['Л',3], ['Љ',1], ['М',3],
    ['Н',5], ['Њ',1], ['О',6], ['П',3], ['Р',5],
    ['С',4], ['Т',4], ['Ћ',1], ['У',4], ['Ф',1],
    ['Х',1], ['Ц',1], ['Ч',1], ['Џ',1], ['Ш',1],
]);

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

    // Ретка/тешка слова се ИЗВОДЕ из дистрибуције, не куцају ручно.
    // Раније је ово била фиксна листа која је застаревала сваки пут
    // кад се tileDistribution промени (нпр. Ж, Ч и Ш су пали са 2 на 1
    // плочицу, али су остали ван листе).
    // Праг: слово је „ретко" ако га у врећи има највише једном.
    const RARE_THRESHOLD = 1;
    const rareLetters = new Set(
        tileDistribution
            .filter(([letter, count]) => count <= RARE_THRESHOLD && !vowels.has(letter))
            .map(([letter]) => letter)
    );

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

// Речник се прослеђује као аргумент (Set великих слова).
// Раније је читао глобални DICTIONARY из server.js.
function validateMove(game, playerId, placements, dictionary) {
    const DICTIONARY = dictionary;

    if (!DICTIONARY || typeof DICTIONARY.has !== 'function') {
        return { valid: false, error: 'Речник није учитан на серверу.' };
    }

    if (!Array.isArray(placements)) {
        return { valid: false, error: 'Неисправан облик потеза.' };
    }

    const seen = new Set();

    for (const p of placements) {
        // ВАЖНО: провера облика мора да иде ПРЕ читања p.row/p.col.
        // Раније је овде пуцало на null/undefined у низу (клијент може
        // да пошаље било шта преко сокета).
        if (!p || typeof p !== 'object') {
            return { valid: false, error: 'Неисправан податак о плочици.' };
        }

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
        // Центар табле: код 13x13 то је (6,6). Изводи се из BOARD_SIZE
    // да не заостане ако опет промениш величину.
    const CENTER = Math.floor(BOARD_SIZE / 2);
    const coversCenter = tempBoard.some(p => p.row === CENTER && p.col === CENTER);
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


module.exports = {
    BOARD_SIZE,
    isValidLetter,
    bonusBoard,
    letterValues,
    tileDistribution,
    createBag,
    drawTiles,
    createEmptyBoard,
    validateMove
};
