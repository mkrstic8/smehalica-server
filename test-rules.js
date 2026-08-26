// Тестови за game-rules.js — чиста логика игре, без дизања сервера.
// Покретање:  npm run test:rules
//
// Ово су тестови који су недостајали да би даље дељење server.js-а
// на модуле било безбедно: ако бодовање или валидација потеза пукну,
// овде ће се видети одмах.

const {
    BOARD_SIZE,
    bonusBoard,
    letterValues,
    tileDistribution,
    createBag,
    drawTiles,
    createEmptyBoard,
    validateMove
} = require('./game-rules');

const CENTER = Math.floor(BOARD_SIZE / 2);

let passed = 0;
let failed = 0;

function ok(name, cond, extra = '') {
    if (cond) {
        passed++;
        console.log(`✅ ${name}`);
    } else {
        failed++;
        console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`);
    }
}

function eq(name, actual, expected) {
    ok(name, actual === expected, `очекивано ${expected}, добијено ${actual}`);
}

// Помоћна: прави активну игру спремну за потез
function makeGame(rackLetters, { isFirstMove = true, board = null } = {}) {
    return {
        id: 'TEST',
        board: board || createEmptyBoard(),
        bag: [],
        status: 'active',
        currentTurn: 'p1',
        isFirstMove,
        players: {
            p1: {
                rack: [...rackLetters],   // сталак = низ обичних слова
                score: 0
            },
            p2: { rack: [], score: 0 }
        }
    };
}

// Помоћна: постави реч на таблу као да је већ одиграна
function place(board, row, col, word, horizontal = true) {
    [...word].forEach((letter, i) => {
        const r = horizontal ? row : row + i;
        const c = horizontal ? col + i : col;
        board[r][c] = { letter, isNewlyPlaced: false };
    });
    return board;
}

function move(game, dict, placements) {
    return validateMove(game, 'p1', placements, dict);
}

console.log('\n═══ ТАБЛА И ВРЕЋА ═══');

eq(`Табла има ${BOARD_SIZE} редова`, createEmptyBoard().length, BOARD_SIZE);
eq(`Табла има ${BOARD_SIZE} колона`, createEmptyBoard()[0].length, BOARD_SIZE);
ok('Сваки ред табле је пуне ширине',
    createEmptyBoard().every(r => r.length === BOARD_SIZE));
ok('Празна табла нема плочица',
    createEmptyBoard().every(row => row.every(cell => !cell)));

eq(`Центар табле [${CENTER}][${CENTER}] је означен`, bonusBoard[CENTER][CENTER], '❖');
eq('Бонус табла има исти број редова као табла', bonusBoard.length, BOARD_SIZE);
ok('Сваки ред бонус табле је пуне ширине',
    bonusBoard.every(r => r.length === BOARD_SIZE));
ok('Бонус табла је симетрична',
    bonusBoard.every((row, r) =>
        row.every((cell, c) =>
            cell === bonusBoard[BOARD_SIZE - 1 - r][BOARD_SIZE - 1 - c])));

const distTotal = tileDistribution.reduce((sum, [, n]) => sum + n, 0);
const bag = createBag();
eq('Врећа има онолико плочица колико каже дистрибуција', bag.length, distTotal);
ok('Врећа садржи обична слова (не објекте)',
    bag.every(t => typeof t === 'string' && t.length === 1));
ok('Свако слово у врећи постоји у таблици вредности',
    bag.every(t => letterValues[t] !== undefined));

const bag2 = createBag();
const drawn = drawTiles(bag2, 8);
eq('drawTiles извлачи тражени број', drawn.length, 8);
eq('Извучене плочице су скинуте из вреће', bag2.length, distTotal - 8);

const smallBag = ['А', 'Б'];
eq('drawTiles не пуца кад врећа има мање него што се тражи',
    drawTiles(smallBag, 8).length, 2);
eq('Празна врећа враћа празан низ', drawTiles([], 5).length, 0);

console.log('\n═══ ОСНОВНА ВАЛИДАЦИЈА ═══');

const dict = new Set(['КОЊ', 'ОКО', 'КО', 'НОС', 'СОК', 'КОС', 'ОН', 'НО', 'СОКО']);

{
    const g = makeGame(['К', 'О', 'Њ']);
    g.currentTurn = 'p2';
    const r = move(g, dict, [{ row: CENTER, col: CENTER, letter: 'К' }]);
    ok('Одбија потез кад није твој ред', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    g.status = 'finished';
    const r = move(g, dict, [{ row: CENTER, col: CENTER, letter: 'К' }]);
    ok('Одбија потез у завршеној игри', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    ok('Одбија празан потез', move(g, dict, []).valid === false);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER, letter: 'О' }
    ]);
    ok('Одбија две плочице на исто поље', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [{ row: 99, col: CENTER, letter: 'К' }]);
    ok('Одбија поље ван табле', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [{ row: CENTER, col: CENTER, letter: 'Ж' }]);
    ok('Одбија слово које играч нема у сталку', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER + 1, letter: 'О' },
        { row: CENTER, col: CENTER + 2, letter: 'Њ' }
    ], new Set());
    ok('Одбија непостојећу реч', validateMove(g, 'p1', [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER + 1, letter: 'О' },
        { row: CENTER, col: CENTER + 2, letter: 'Њ' }
    ], new Set(['НЕШТО'])).valid === false);
}

console.log('\n═══ ПРВИ ПОТЕЗ ═══');

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER + 1, letter: 'О' },
        { row: CENTER, col: CENTER + 2, letter: 'Њ' }
    ]);
    ok('Прихвата исправан први потез кроз центар', r.valid === true, r.error);
    if (r.valid) {
        ok('Враћа састављену реч', r.words.includes('КОЊ'), JSON.stringify(r.words));
        ok('Враћа број поена', typeof r.score === 'number' && r.score > 0, String(r.score));
        // К=2, О=1, Њ=5 = 8 без множилаца. Бонус табла је тренутно празна
        // (попуњаваш је ручно), па се очекује 8 или 16 ако центар удвостручује.
        ok('Поени су у очекиваном опсегу (8 или 16)',
            r.score === 8 || r.score === 16, String(r.score));
    }
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: 0, col: 0, letter: 'К' },
        { row: 0, col: 1, letter: 'О' },
        { row: 0, col: 2, letter: 'Њ' }
    ]);
    ok('Одбија први потез који не додирује центар', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER + 2, letter: 'О' }
    ]);
    ok('Одбија потез са рупом између плочица', r.valid === false, r.error);
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER + 1, col: CENTER + 1, letter: 'О' }
    ]);
    ok('Одбија дијагонални потез', r.valid === false, r.error);
}

console.log('\n═══ НАСТАВАК ПАРТИЈЕ ═══');

{
    // На табли већ стоји КОЊ водоравно од (7,7)
    const board = place(createEmptyBoard(), CENTER, CENTER, 'КОЊ');
    const g = makeGame(['Н', 'О', 'С'], { isFirstMove: false, board });
    const r = move(g, dict, [
        { row: CENTER + 1, col: CENTER, letter: 'О' },
        { row: CENTER + 2, col: CENTER, letter: 'С' }
    ]);
    ok('Прихвата реч надовезану на постојећу', r.valid === true, r.error);
    if (r.valid) {
        ok('Препознаје укрштену реч КОС', r.words.includes('КОС'),
            JSON.stringify(r.words));
    }
}

{
    const board = place(createEmptyBoard(), CENTER, CENTER, 'КОЊ');
    const g = makeGame(['Н', 'О', 'С'], { isFirstMove: false, board });
    const r = move(g, dict, [
        { row: 0, col: 0, letter: 'Н' },
        { row: 0, col: 1, letter: 'О' },
        { row: 0, col: 2, letter: 'С' }
    ]);
    ok('Одбија изоловану реч која не додирује ништа', r.valid === false, r.error);
}

{
    const board = place(createEmptyBoard(), CENTER, CENTER, 'КОЊ');
    const g = makeGame(['С'], { isFirstMove: false, board });
    const r = move(g, dict, [{ row: CENTER, col: CENTER, letter: 'С' }]);
    ok('Одбија постављање преко заузетог поља', r.valid === false, r.error);
}

console.log('\n═══ БОДОВАЊЕ И БОНУСИ ═══');

{
    // На табли стоји КОЊ од (7,7). Додајемо С испод К (7,7) -> вертикално КС? Не.
    // Уместо тога: постојеће О на (7,8), додајемо К изнад и С испод -> КОС вертикално.
    const board = place(createEmptyBoard(), CENTER, CENTER, 'КОЊ');
    const g = makeGame(['К', 'С'], { isFirstMove: false, board });
    const r = move(g, dict, [
        { row: CENTER - 1, col: CENTER + 1, letter: 'К' },
        { row: CENTER + 1, col: CENTER + 1, letter: 'С' }
    ]);
    ok('Прихвата потез који хвата постојеће слово са обе стране',
        r.valid === true, r.error);
    if (r.valid) {
        ok('Бодује такав потез', r.score > 0, String(r.score));
        ok('Препознаје вертикалну реч КОС', r.words.includes('КОС'),
            JSON.stringify(r.words));
    }
}

{
    const g = makeGame(['К', 'О', 'Њ']);
    const r = move(g, dict, [
        { row: CENTER, col: CENTER, letter: 'К' },
        { row: CENTER, col: CENTER + 1, letter: 'О' },
        { row: CENTER, col: CENTER + 2, letter: 'Њ' }
    ]);
    if (r.valid) {
        ok('Враћа нови сталак после потеза', Array.isArray(r.newRack), typeof r.newRack);
        ok('Искоришћена слова су скинута са сталка',
            r.newRack.length === 0, `остало ${r.newRack.length}`);
    }
}

console.log('\n═══ ЗАШТИТА ОД НЕИСПРАВНОГ УЛАЗА ═══');

{
    const g = makeGame(['К', 'О', 'Њ']);
    ok('Не пуца на null у placements',
        move(g, dict, [null]).valid === false);
    ok('Не пуца на плочицу без слова',
        move(g, dict, [{ row: CENTER, col: CENTER }]).valid === false);
    ok('Не пуца кад речник није прослеђен',
        validateMove(g, 'p1', [{ row: CENTER, col: CENTER, letter: 'К' }], null).valid === false);
    ok('Не пуца на негативне координате',
        move(g, dict, [{ row: -1, col: CENTER, letter: 'К' }]).valid === false);
}

console.log('\n' + '─'.repeat(45));
console.log(`Прошло: ${passed}/${passed + failed}`);
console.log('─'.repeat(45));
process.exit(failed ? 1 : 0);
