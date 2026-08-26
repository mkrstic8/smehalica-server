'use strict';

const { BOARD_SIZE } = require('./config');

/**
 * Tabla bonusa 15x15.
 * DL = duplo slovo, TL = triplo slovo,
 * DW = dupla reč,   TW = tripla reč,
 * ❖  = centar (računa se kao dupla reč).
 */
const bonusBoard = Object.freeze([
    ['TW', '', '', 'DL', '', '', '', 'TW', '', '', '', 'DL', '', '', 'TW'],
    ['', 'DW', '', '', '', 'TL', '', '', '', 'TL', '', '', '', 'DW', ''],
    ['', '', 'DW', '', '', '', 'DL', '', 'DL', '', '', '', 'DW', '', ''],
    ['DL', '', '', 'DW', '', '', '', 'DL', '', '', '', 'DW', '', '', 'DL'],
    ['', '', '', '', 'DW', '', '', '', '', '', 'DW', '', '', '', ''],
    ['', 'TL', '', '', '', 'TL', '', '', '', 'TL', '', '', '', 'TL', ''],
    ['', '', 'DL', '', '', '', 'DL', '', 'DL', '', '', '', 'DL', '', ''],
    ['TW', '', '', 'DL', '', '', '', '❖', '', '', '', 'DL', '', '', 'TW'],
    ['', '', 'DL', '', '', '', 'DL', '', 'DL', '', '', '', 'DL', '', ''],
    ['', 'TL', '', '', '', 'TL', '', '', '', 'TL', '', '', '', 'TL', ''],
    ['', '', '', '', 'DW', '', '', '', '', '', 'DW', '', '', '', ''],
    ['DL', '', '', 'DW', '', '', '', 'DL', '', '', '', 'DW', '', '', 'DL'],
    ['', '', 'DW', '', '', '', 'DL', '', 'DL', '', '', '', 'DW', '', ''],
    ['', 'DW', '', '', '', 'TL', '', '', '', 'TL', '', '', '', 'DW', ''],
    ['TW', '', '', 'DL', '', '', '', 'TW', '', '', '', 'DL', '', '', 'TW'],
].map(Object.freeze));

/** Vrednost svakog slova u poenima. NE MENJATI. */
const letterValues = Object.freeze({
    'А': 1, 'Б': 3, 'В': 2, 'Г': 3, 'Д': 2, 'Ђ': 8, 'Е': 1, 'Ж': 5, 'З': 3,
    'И': 1, 'Ј': 3, 'К': 2, 'Л': 2, 'Љ': 5, 'М': 2, 'Н': 1, 'Њ': 5, 'О': 1,
    'П': 2, 'Р': 1, 'С': 1, 'Т': 1, 'Ћ': 8, 'У': 1, 'Ф': 5, 'Х': 4, 'Ц': 4,
    'Ч': 4, 'Џ': 10, 'Ш': 4,
});

/**
 * Frekvencija pločica u vreći - ukupno 111 pločica.
 * NE MENJATI: ni slova, ni brojeve.
 */
const tileDistribution = Object.freeze([
    ['А',8], ['Б',2], ['В',3], ['Г',2], ['Д',3],
    ['Ђ',1], ['Е',8], ['Ж',1], ['З',2], ['И',8],
    ['Ј',3], ['К',3], ['Л',3], ['Љ',1], ['М',3],
    ['Н',5], ['Њ',1], ['О',6], ['П',3], ['Р',5],
    ['С',4], ['Т',4], ['Ћ',1], ['У',4], ['Ф',1],
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
