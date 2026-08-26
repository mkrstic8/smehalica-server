'use strict';

const {
    BOARD_SIZE,
    CENTER,
    RACK_SIZE,
    BINGO_BONUS,
    MIN_WORD_LENGTH,
} = require('./config');
const { bonusBoard, letterValues, isValidLetter } = require('./board');
const dictionary = require('./dictionary');
const { drawTiles } = require('./bag');

/**
 * VALIDACIJA POTEZA
 *
 * Najvažnija promena u odnosu na stariju verziju: ova funkcija više
 * NIŠTA NE MENJA.
 *
 * Ranije je validateMove upisivala pločice na pravu tablu da bi pročitala
 * reči, pa ih brisala na svakom mestu gde vraća grešku - a bilo je desetak
 * takvih mesta. Ako bi se dodala samo jedna nova provera bez ručnog čišćenja,
 * tabla bi zauvek ostala sa slovima od odbijenog poteza. Pored toga je vukla
 * nove pločice iz vreće JOŠ U TOKU PROVERE, pa bi svaki povratak pozivaoca
 * pre upisa trajno pojeo pločice iz vreće.
 *
 * Sada se tabla čita kroz letterAt(), koje gleda prvo nove pločice pa tek
 * onda pravu tablu. Prava tabla i vreća se diraju samo u applyMove(), i to
 * tek kada je potez potvrđen.
 */

const failure = (error) => ({ valid: false, error });

/**
 * Čita celu reč kroz zadatu tačku, u zadatom pravcu.
 * Vraća { word, cells } ili null ako na toj poziciji nema slova.
 */
function readWord(row, col, horizontal, letterAt) {
    const stepRow = horizontal ? 0 : 1;
    const stepCol = horizontal ? 1 : 0;

    if (letterAt(row, col) === null) return null;

    // Vrati se na početak reči.
    let startRow = row;
    let startCol = col;
    while (letterAt(startRow - stepRow, startCol - stepCol) !== null) {
        startRow -= stepRow;
        startCol -= stepCol;
    }

    let word = '';
    const cells = [];
    let currentRow = startRow;
    let currentCol = startCol;
    let letter;

    while ((letter = letterAt(currentRow, currentCol)) !== null) {
        word += letter;
        cells.push({ row: currentRow, col: currentCol });
        currentRow += stepRow;
        currentCol += stepCol;
    }

    return { word, cells };
}

function scoreWord(word, isFreshCell, letterAt) {
    let sum = 0;
    let wordMultiplier = 1;

    for (const cell of word.cells) {
        let value = letterValues[letterAt(cell.row, cell.col)] || 0;

        // Bonusi važe samo za pločice postavljene u ovom potezu.
        if (isFreshCell(cell.row, cell.col)) {
            const bonus = bonusBoard[cell.row][cell.col];
            if (bonus === 'DL') value *= 2;
            else if (bonus === 'TL') value *= 3;
            else if (bonus === 'DW' || bonus === '❖') wordMultiplier *= 2;
            else if (bonus === 'TW') wordMultiplier *= 3;
        }

        sum += value;
    }

    return sum * wordMultiplier;
}

/**
 * Proverava potez i vraća rezultat, BEZ ijedne izmene stanja igre.
 *
 * @returns {{valid:false, error:string} |
 *           {valid:true, score:number, bingo:boolean, words:string[],
 *            placements:Array, remainingRack:string[]}}
 */
function rackTileLetter(tile) {
    return tile && typeof tile === 'object' ? tile.letter : tile;
}

function rackTileIsSpecial(tile) {
    return Boolean(tile && typeof tile === 'object' && tile.special === true);
}

function findRackIndex(rack, letter, wantSpecial) {
    return rack.findIndex(tile =>
        rackTileLetter(tile) === letter && rackTileIsSpecial(tile) === wantSpecial
    );
}

function validateMove(game, playerId, rawPlacements) {
    if (!game || game.status !== 'active') {
        return failure('Игра је завршена.');
    }
    if (game.currentTurn !== playerId) {
        return failure('Није твој потез.');
    }

    const player = game.players.get(playerId);
    if (!player) {
        return failure('Ниси учесник ове игре.');
    }

    if (!Array.isArray(rawPlacements) || rawPlacements.length === 0) {
        return failure('Нема постављених слова.');
    }
    if (rawPlacements.length > RACK_SIZE) {
        return failure('Превише плочица у једном потезу.');
    }

    const board = game.board;
    const placedByKey = new Map();
    const remainingRack = player.rack.slice();
    const tiles = [];

    // --- 1. Provera svake pojedinačne pločice ---
    // Tip se proverava PRE nego što se pročita bilo koje polje, pa
    // pokvaren paket (null, string, broj) ne može da sruši server.
    for (const raw of rawPlacements) {
        if (!raw || typeof raw !== 'object') {
            return failure('Неисправан податак о плочици.');
        }

        const { row, col, letter } = raw;

        if (!Number.isInteger(row) || !Number.isInteger(col) ||
            row < 0 || row >= BOARD_SIZE ||
            col < 0 || col >= BOARD_SIZE) {
            return failure('Неважећа позиција плочице.');
        }
        if (!isValidLetter(letter)) {
            return failure('Неважеће слово.');
        }

        const key = row * BOARD_SIZE + col;
        if (placedByKey.has(key)) {
            return failure(`Две плочице на исто поље [${row + 1},${col + 1}].`);
        }
        if (board[row][col]) {
            return failure(`Поље [${row + 1},${col + 1}] је већ заузето.`);
        }

        const isSpecial = raw.special === true;
        const rackIndex = findRackIndex(remainingRack, letter, isSpecial);
        if (rackIndex === -1) {
            return failure(
                isSpecial
                    ? `Специјално слово тренутно није „${letter}“.`
                    : `Немаш слово „${letter}“ на сталку.`
            );
        }
        remainingRack.splice(rackIndex, 1);

        const tile = { row, col, letter, special: isSpecial };
        placedByKey.set(key, tile);
        tiles.push(tile);
    }

    // Pogled na tablu koji uključuje i pločice iz ovog poteza.
    const letterAt = (row, col) => {
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
        const fresh = placedByKey.get(row * BOARD_SIZE + col);
        if (fresh !== undefined) return fresh.letter;
        const cell = board[row][col];
        return cell ? cell.letter : null;
    };
    const isFreshCell = (row, col) => placedByKey.has(row * BOARD_SIZE + col);

    // --- 2. Sve pločice u istom redu ili istoj koloni ---
    const first = tiles[0];
    let sameRow = true;
    let sameCol = true;
    for (const tile of tiles) {
        if (tile.row !== first.row) sameRow = false;
        if (tile.col !== first.col) sameCol = false;
    }
    if (!sameRow && !sameCol) {
        return failure('Сва слова морају бити у истом реду или колони.');
    }
    const horizontal = sameRow;

    // --- 3. Bez rupa između postavljenih pločica ---
    if (horizontal) {
        let min = first.col;
        let max = first.col;
        for (const tile of tiles) {
            if (tile.col < min) min = tile.col;
            if (tile.col > max) max = tile.col;
        }
        for (let col = min; col <= max; col++) {
            if (letterAt(first.row, col) === null) {
                return failure(`Недостаје слово на [${first.row + 1},${col + 1}].`);
            }
        }
    } else {
        let min = first.row;
        let max = first.row;
        for (const tile of tiles) {
            if (tile.row < min) min = tile.row;
            if (tile.row > max) max = tile.row;
        }
        for (let row = min; row <= max; row++) {
            if (letterAt(row, first.col) === null) {
                return failure(`Недостаје слово на [${row + 1},${first.col + 1}].`);
            }
        }
    }

    // --- 4. Prvi potez preko centra, kasniji potezi povezani sa tablom ---
    if (game.isFirstMove) {
        const coversCenter = tiles.some(tile => tile.row === CENTER && tile.col === CENTER);
        if (!coversCenter) {
            return failure('Први потез мора покрити центар (❖).');
        }
    } else {
        // board sadrži samo ranije potvrđene pločice, pa je svaki pronađeni
        // sused po definiciji stara pločica - nema potrebe za isNewlyPlaced.
        const connected = tiles.some(tile =>
            Boolean(board[tile.row - 1]?.[tile.col]) ||
            Boolean(board[tile.row + 1]?.[tile.col]) ||
            Boolean(board[tile.row][tile.col - 1]) ||
            Boolean(board[tile.row][tile.col + 1])
        );
        if (!connected) {
            return failure('Мора бити повезано са постојећим речима.');
        }
    }

    // --- 5. Sve formirane reči ---
    // Glavna reč ide duž pravca poteza, unakrsne su okomite na njega,
    // pa se ne mogu poklopiti. Zato nema poređenja stringova - stara
    // provera `cw !== mainWord` je greškom brisala legitimnu unakrsnu reč
    // koja se slučajno piše isto kao glavna (i tako gubila poene).
    const words = [];

    const mainWord = readWord(first.row, first.col, horizontal, letterAt);
    if (mainWord && mainWord.cells.length >= MIN_WORD_LENGTH) {
        words.push(mainWord);
    }

    for (const tile of tiles) {
        const crossWord = readWord(tile.row, tile.col, !horizontal, letterAt);
        if (crossWord && crossWord.cells.length >= MIN_WORD_LENGTH) {
            words.push(crossWord);
        }
    }

    if (words.length === 0) {
        return failure('Мораш формирати реч од најмање 2 слова.');
    }

    // --- 6. Rečnik ---
    const invalid = new Set();
    for (const word of words) {
        if (!dictionary.has(word.word)) {
            invalid.add(word.word);
        }
    }
    if (invalid.size > 0) {
        const list = [...invalid].map(word => `„${word}“`).join(', ');
        return failure(`Није у речнику: ${list}.`);
    }

    // --- 7. Poeni ---
    let score = 0;
    for (const word of words) {
        score += scoreWord(word, isFreshCell, letterAt);
    }

    const bingo = tiles.length === RACK_SIZE;
    if (bingo) score += BINGO_BONUS;

    return {
        valid: true,
        score,
        bingo,
        words: words.map(word => word.word),
        placements: tiles,
        remainingRack,
    };
}

/**
 * Upisuje potvrđen potez u stanje igre.
 * Ovo je JEDINO mesto gde se menjaju tabla, stalak i vreća.
 */
function applyMove(game, playerId, move) {
    const player = game.players.get(playerId);

    for (const tile of move.placements) {
        game.board[tile.row][tile.col] = { letter: tile.letter };
    }

    const normalTilesUsed = move.placements.filter(tile => !tile.special).length;
    const usedSpecial = move.placements.some(tile => tile.special === true);

// Специјално слово није део вреће.
// Ако је употребљено, привремено нестаје из руке.
// Коначну одлуку о новом специјалном слову доноси
// updateSpecialTileAfterMove() одмах после допуњавања
// регуларних слова из вреће.
if (usedSpecial) {
    const used = move.placements.find(tile => tile.special === true);
    player.lastSpecialLetter = used.letter;
}

    player.rack = move.remainingRack.concat(
        drawTiles(game.bag, normalTilesUsed)
    );
    player.score += move.score;

    game.isFirstMove = false;
    game.skipCount = 0;
}

module.exports = {
    validateMove,
    applyMove,
};
