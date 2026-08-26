'use strict';

const { BOARD_SIZE } = require('./config');

/**
 * Tabla bonusa 13x13.
 *
 * Dobijena sečenjem originalne 15x15 table: izbačeni su redovi i kolone
 * sa indeksom 1 i 13. Tako spoljni prsten (TW uglovi i ivice) ostaje ceo,
 * a centar pada tačno na [6][6]. Prosto skraćivanje na prvih 13 pomerilo
 * bi centar na DL polje i pokvarilo simetriju.
 *
 * Izgubljeno sečenjem: DW 16->12, TL 12->4. TW (8) i DL (24) netaknuti.
 * DL = duplo slovo, TL = triplo slovo,
 * DW = dupla reč,   TW = tripla reč,
 * ❖  = centar (računa se kao dupla reč).
 */
const bonusBoard = Object.freeze([
    ['TW', '', '', '', 'DL', '', '', '', 'DL', '', '', '', 'TW'],
    ['', '', 'DW', '', '', 'DL', '', 'DL', '', '', 'DW', '', ''],
    ['', 'DW', '', '', '', '', 'DL', '', '', '', '', 'DW', ''],
    ['', '', '', 'TL', '', '', '', '', '', 'TL', '', '', ''],
    ['DL', '', '', '', 'DW', '', '', '', 'DW', '', '', '', 'DL'],
    ['', '', 'DL', '', '', 'TL', '', 'TL', '', '', 'DL', '', ''],
    ['', 'DL', '', '', '', '', '❖', '', '', '', '', 'DL', ''],
    ['', '', 'DL', '', '', 'TL', '', 'TL', '', '', 'DL', '', ''],
    ['DL', '', '', '', 'DW', '', '', '', 'DW', '', '', '', 'DL'],
    ['', '', '', 'TL', '', '', '', '', '', 'TL', '', '', ''],
    ['', 'DW', '', '', '', '', 'DL', '', '', '', '', 'DW', ''],
    ['', '', 'DW', '', '', 'DL', '', 'DL', '', '', 'DW', '', ''],
    ['TW', '', '', '', 'DL', '', '', '', 'DL', '', '', '', 'TW'],
].map(Object.freeze));

/** Vrednost svakog slova u poenima. NE MENJATI. */
const letterValues = Object.freeze({
    'А': 1, 'Б': 3, 'В': 2, 'Г': 3, 'Д': 2, 'Ђ': 6, 'Е': 1, 'Ж': 4, 'З': 3,
    'И': 1, 'Ј': 2, 'К': 2, 'Л': 2, 'Љ': 4, 'М': 2, 'Н': 1, 'Њ': 5, 'О': 1,
    'П': 2, 'Р': 1, 'С': 1, 'Т': 1, 'Ћ': 5, 'У': 1, 'Ф': 8, 'Х': 6, 'Ц': 4,
    'Ч': 4, 'Џ': 10, 'Ш': 4,
});

/**
 * Frekvencija pločica u vreći - ukupno 68 pločica.
 * NE MENJATI: ni slova, ni brojeve.
 */
const tileDistribution = Object.freeze([
    ['А',7], ['Б',1], ['В',2], ['Г',1], ['Д',2],
    ['Ђ',1], ['Е',6], ['Ж',1], ['З',1], ['И',6],
    ['Ј',2], ['К',2], ['Л',2], ['Љ',1], ['М',2],
    ['Н',4], ['Њ',1], ['О',5], ['П',2], ['Р',3],
    ['С',3], ['Т',3], ['Ћ',1], ['У',3], ['Ф',1],
    ['Х',1], ['Ц',1], ['Ч',1], ['Џ',1], ['Ш',1],
]);

/** Srpska ćirilična azbuka - koristi se i za generisanje kodova soba. */
const ALPHABET = 'АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ';

const VOWELS = Object.freeze(new Set(['А', 'Е', 'И', 'О', 'У']));

/** Retka/teška slova - gomilanje u istom izvlačenju čini potez neigrivim. */
const RARE_LETTERS = Object.freeze(new Set(['Ђ', 'Љ', 'Њ', 'Ћ', 'Џ', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Ж']));

const VALID_LETTERS = Object.freeze(new Set(Object.keys(letterValues)));

function isValidLetter(letter) {
    return typeof letter === 'string' && VALID_LETTERS.has(letter);
}

function isVowel(letter) {
    return VOWELS.has(letter);
}

function isRare(letter) {
    return RARE_LETTERS.has(letter);
}

function createEmptyBoard() {
    const board = new Array(BOARD_SIZE);
    for (let row = 0; row < BOARD_SIZE; row++) {
        board[row] = new Array(BOARD_SIZE).fill(null);
    }
    return board;
}

module.exports = {
    bonusBoard,
    letterValues,
    tileDistribution,
    ALPHABET,
    VOWELS,
    RARE_LETTERS,
    isValidLetter,
    isVowel,
    isRare,
    createEmptyBoard,
};
