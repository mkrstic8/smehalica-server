'use strict';

const {
    RACK_SIZE,
    BAG_MIN_VOWELS_PER_DRAW,
    BAG_MAX_VOWELS_PER_DRAW,
    BAG_MAX_RARE_PER_DRAW,
} = require('./config');
const { tileDistribution, ALPHABET, isVowel, isRare } = require('./board');
const { randomBelow, randomDifferentItem, shuffleInPlace } = require('./random');

/**
 * VREĆA
 *
 * Sadržaj vreće se NE dira - ista slova, iste frekvencije, istih 111 pločica.
 * Menja se samo REDOSLED izvlačenja.
 *
 * Zašto uopšte dirati redosled:
 * čisto nasumično mešanje povremeno da stalak od 8 suglasnika ili 7
 * samoglasnika, a to je potez koji se ne može odigrati.
 *
 * Kako je bilo ranije:
 * vreća se mešala 101 put i računala se "kazna" preko celog niza, pa se
 * biralo najbolje mešanje. To je ~11.000 poziva ka generatoru slučajnih
 * brojeva i 101 prolaz kroz niz po partiji - a garancije nije bilo nikakve,
 * jer je kazna bila zbir preko cele vreće, ne po stalku.
 *
 * Kako je sada:
 * jedno mešanje, pa ciljane zamene. Vreća se gleda kao niz "prozora" od
 * RACK_SIZE pločica, redom kojim će biti izvučene, i svaki prozor se dovede
 * u igriv opseg (2-5 samoglasnika, najviše 2 retka slova). Zamene su uvek
 * unutar iste vreće, pa se sadržaj matematički ne može promeniti.
 *
 * Rezultat: jedan prolaz umesto 101, i stvarna garancija umesto proseka.
 */

/** Pločice se izvlače sa kraja niza (pop), pa je poslednji prozor prvi na redu. */
function drawWindows(bag) {
    const windows = [];
    for (let end = bag.length; end - RACK_SIZE >= 0; end -= RACK_SIZE) {
        windows.push({ start: end - RACK_SIZE, end });
    }
    return windows;
}

function countMatching(bag, window, predicate) {
    let count = 0;
    for (let i = window.start; i < window.end; i++) {
        if (predicate(bag[i])) count++;
    }
    return count;
}

/** Nasumična pozicija u prozoru čije slovo zadovoljava uslov, ili -1. */
function findIndex(bag, window, predicate) {
    const matches = [];
    for (let i = window.start; i < window.end; i++) {
        if (predicate(bag[i])) matches.push(i);
    }
    if (matches.length === 0) return -1;
    return matches[randomBelow(matches.length)];
}

function swap(bag, a, b) {
    const temporary = bag[a];
    bag[a] = bag[b];
    bag[b] = temporary;
}

/** Prozori u nasumičnom redosledu - da davalac uvek ne bude isti. */
function shuffledOrder(length) {
    const order = new Array(length);
    for (let i = 0; i < length; i++) order[i] = i;
    return shuffleInPlace(order);
}

/**
 * Svaki prozor dovodi u opseg [min, max] samoglasnika.
 * Razmenjuje se samoglasnik za suglasnik, pa ukupan broj slova ostaje isti.
 */
function balanceVowels(bag, windows) {
    const vowelCounts = windows.map(window => countMatching(bag, window, isVowel));

    for (let pass = 0; pass < 2; pass++) {
        for (let index = 0; index < windows.length; index++) {

            // Premalo samoglasnika: uzmi jedan od prozora koji ima viška.
            while (vowelCounts[index] < BAG_MIN_VOWELS_PER_DRAW) {
                let donor = -1;
                for (const candidate of shuffledOrder(windows.length)) {
                    if (candidate !== index && vowelCounts[candidate] > BAG_MIN_VOWELS_PER_DRAW) {
                        donor = candidate;
                        break;
                    }
                }
                if (donor === -1) break;

                const needyIndex = findIndex(bag, windows[index], letter => !isVowel(letter));
                const donorIndex = findIndex(bag, windows[donor], isVowel);
                if (needyIndex === -1 || donorIndex === -1) break;

                swap(bag, needyIndex, donorIndex);
                vowelCounts[index]++;
                vowelCounts[donor]--;
            }

            // Previše samoglasnika: pošalji jedan prozoru koji ima manjka.
            while (vowelCounts[index] > BAG_MAX_VOWELS_PER_DRAW) {
                let receiver = -1;
                for (const candidate of shuffledOrder(windows.length)) {
                    if (candidate !== index && vowelCounts[candidate] < BAG_MAX_VOWELS_PER_DRAW) {
                        receiver = candidate;
                        break;
                    }
                }
                if (receiver === -1) break;

                const surplusIndex = findIndex(bag, windows[index], isVowel);
                const receiverIndex = findIndex(bag, windows[receiver], letter => !isVowel(letter));
                if (surplusIndex === -1 || receiverIndex === -1) break;

                swap(bag, surplusIndex, receiverIndex);
                vowelCounts[index]--;
                vowelCounts[receiver]++;
            }
        }
    }
}

/**
 * Ograničava broj retkih slova po prozoru.
 * Menja se ISKLJUČIVO suglasnik za suglasnik (sva retka slova su suglasnici),
 * pa balans samoglasnika iz prethodnog koraka ostaje netaknut.
 */
function spreadRareLetters(bag, windows) {
    const rareCounts = windows.map(window => countMatching(bag, window, isRare));

    for (let index = 0; index < windows.length; index++) {
        while (rareCounts[index] > BAG_MAX_RARE_PER_DRAW) {
            let receiver = -1;
            for (const candidate of shuffledOrder(windows.length)) {
                if (candidate !== index && rareCounts[candidate] < BAG_MAX_RARE_PER_DRAW) {
                    receiver = candidate;
                    break;
                }
            }
            if (receiver === -1) break;

            const rareIndex = findIndex(bag, windows[index], isRare);
            const plainIndex = findIndex(
                bag,
                windows[receiver],
                letter => !isRare(letter) && !isVowel(letter)
            );
            if (rareIndex === -1 || plainIndex === -1) break;

            swap(bag, rareIndex, plainIndex);
            rareCounts[index]--;
            rareCounts[receiver]++;
        }
    }
}

/**
 * Pravi novu vreću: ista slova i iste količine kao u tileDistribution,
 * samo raspoređene tako da svako izvlačenje bude igrivo.
 */
function createBag() {
    const bag = [];

    for (const [letter, count] of tileDistribution) {
        for (let i = 0; i < count; i++) {
            bag.push(letter);
        }
    }

    shuffleInPlace(bag);

    const windows = drawWindows(bag);
    balanceVowels(bag, windows);
    spreadRareLetters(bag, windows);

    return bag;
}

/** Izvlači do `count` pločica sa vrha vreće. */
function createSpecialTile(previousLetter = null) {
    return {
        letter: randomDifferentItem(ALPHABET.split(''), previousLetter),
        special: true,
    };
}

function drawTiles(bag, count) {
    const drawn = [];
    const take = Math.min(count, bag.length);
    for (let i = 0; i < take; i++) {
        drawn.push(bag.pop());
    }
    return drawn;
}

/** Zbir poena preostalih pločica na stalku (za završni obračun). */
function rackValue(rack, letterValues) {
    let total = 0;
    for (const tile of rack) {
        const letter = tile && typeof tile === 'object' ? tile.letter : tile;
        total += letterValues[letter] || 0;
    }
    return total;
}

module.exports = {
    createBag,
    drawTiles,
    createSpecialTile,
    rackValue,
};
