'use strict';

const fs = require('fs');
const path = require('path');
const {
    DICTIONARY_FILE,
    WATCH_DICTIONARY,
    DICTIONARY_WATCH_INTERVAL_MS,
    DICTIONARY_RELOAD_DEBOUNCE_MS,
    MIN_WORD_LENGTH,
    MAX_WORD_LENGTH,
} = require('./config');
const { ALPHABET } = require('./board');

/**
 * REČNIK - sadržaj se NE dira, menja se samo način čuvanja u memoriji.
 *
 * Ranije: new Set(...) sa 1.52 miliona stringova  ->  ~157 MB heap-a.
 * Sada:   reči grupisane po dužini i spojene u jedan "pakovani" string po
 *         dužini, sortirane, pa se traži binarnom pretragom -> ~27 MB heap-a.
 *
 * Pošto sve reči iste dužine imaju isti korak u stringu, ne treba nikakav
 * indeks - pozicija reči broj i je tačno i * duzina. Poređenje ide preko
 * charCodeAt, dakle bez ijedne nove alokacije po pretrazi.
 *
 * Rezultat: ~6x manja potrošnja memorije (bitno za Render free tier),
 * brže učitavanje, i i dalje 100% tačna pretraga (bez lažnih pogodaka).
 */

const ALLOWED_CHARS = new Set(ALPHABET);
const LF = 10;
const CR = 13;

/** Map<duzinaReci, pakovaniSortiraniString> */
let blocks = new Map();
let wordCount = 0;
let loadedAt = 0;

const dictionaryPath = path.isAbsolute(DICTIONARY_FILE)
    ? DICTIONARY_FILE
    : path.join(__dirname, '..', DICTIONARY_FILE);

function isAllowedWord(word) {
    for (let i = 0; i < word.length; i++) {
        if (!ALLOWED_CHARS.has(word[i])) return false;
    }
    return true;
}

/**
 * Jedan prolaz kroz bafer, bez pravljenja međunizova od 1.5M elemenata
 * (stari kod je pravio četiri takva niza: split -> map -> filter -> filter).
 */
function parseWordsByLength(buffer) {
    const byLength = new Map();
    const end = buffer.length;
    let lineStart = 0;

    for (let i = 0; i <= end; i++) {
        const byte = i < end ? buffer[i] : LF;
        if (byte !== LF && byte !== CR) continue;

        if (i > lineStart) {
            const word = buffer.toString('utf8', lineStart, i).trim().toUpperCase();
            const length = word.length;

            if (length >= MIN_WORD_LENGTH && length <= MAX_WORD_LENGTH && isAllowedWord(word)) {
                let bucket = byLength.get(length);
                if (bucket === undefined) {
                    bucket = [];
                    byLength.set(length, bucket);
                }
                bucket.push(word);
            }
        }

        lineStart = i + 1;
    }

    return byLength;
}

function packBuckets(byLength) {
    const packed = new Map();
    let total = 0;

    for (const length of [...byLength.keys()].sort((a, b) => a - b)) {
        const bucket = byLength.get(length);
        bucket.sort();

        // Ukloni duplikate u mestu (niz je već sortiran).
        let unique = 0;
        for (let i = 0; i < bucket.length; i++) {
            if (i === 0 || bucket[i] !== bucket[i - 1]) {
                bucket[unique++] = bucket[i];
            }
        }
        bucket.length = unique;

        packed.set(length, bucket.join(''));
        total += unique;

        // Oslobodi niz odmah - da se veliki privremeni nizovi ne gomilaju.
        byLength.set(length, null);
    }

    return { packed, total };
}

function load() {
    const startedAt = Date.now();

    try {
        const buffer = fs.readFileSync(dictionaryPath);
        const byLength = parseWordsByLength(buffer);
        const { packed, total } = packBuckets(byLength);

        if (total === 0) {
            console.error('❌ Рečnik je prazan ili nema ni jednu validnu reč - zadržavam prethodni.');
            return false;
        }

        const previous = wordCount;
        blocks = packed;
        wordCount = total;
        loadedAt = Date.now();

        console.log(
            `📚 Rečnik učitan: ${total.toLocaleString('sr-RS')} reči ` +
            `(prethodno: ${previous.toLocaleString('sr-RS')}) za ${Date.now() - startedAt}ms`
        );
        return true;
    } catch (err) {
        console.error(`❌ Ne mogu da učitam ${dictionaryPath}:`, err.message);
        return false;
    }
}

/**
 * Binarna pretraga nad pakovanim blokom fiksnog koraka.
 * Bez substring-a, bez alokacija.
 */
function has(word) {
    if (typeof word !== 'string') return false;

    const length = word.length;
    const block = blocks.get(length);
    if (block === undefined) return false;

    let low = 0;
    let high = (block.length / length) - 1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const offset = mid * length;

        let comparison = 0;
        for (let i = 0; i < length; i++) {
            const fromBlock = block.charCodeAt(offset + i);
            const fromWord = word.charCodeAt(i);
            if (fromBlock !== fromWord) {
                comparison = fromBlock < fromWord ? -1 : 1;
                break;
            }
        }

        if (comparison === 0) return true;
        if (comparison < 0) low = mid + 1;
        else high = mid - 1;
    }

    return false;
}

/** Hot-reload rečnika bez restarta servera. */
function watch() {
    if (!WATCH_DICTIONARY) return;

    console.log('👀 Slušam promene u rečniku...');

    let debounceTimer = null;

    fs.watchFile(
        dictionaryPath,
        { interval: DICTIONARY_WATCH_INTERVAL_MS },
        (current, previous) => {
            if (current.mtimeMs === previous.mtimeMs) return;

            // Editori često snimaju u više koraka - sačekaj da se smiri.
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                console.log('🔄 Rečnik se promenio, učitavam ponovo...');
                load();
            }, DICTIONARY_RELOAD_DEBOUNCE_MS);
        }
    );
}

module.exports = {
    load,
    watch,
    has,
    get size() { return wordCount; },
    get loadedAt() { return loadedAt; },
    get path() { return dictionaryPath; },
};
