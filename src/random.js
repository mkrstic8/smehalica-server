'use strict';

const crypto = require('crypto');

/**
 * Kriptografski siguran, ali jeftin izvor slučajnih brojeva.
 *
 * crypto.randomInt() se poziva jednom po broju i svaki put traži nove
 * nasumične bajtove. Mešanje vreće od 111 pločica to radi 110 puta,
 * a stari createBag() je mešao 101 put -> preko 11.000 poziva po partiji.
 *
 * Ovde se nasumični bajtovi vade unapred, u bloku, pa se troše jedan po
 * jedan. Uniformnost se čuva odbacivanjem vrednosti iz nepotpunog opsega
 * (rejection sampling), tako da nema pristrasnosti po modulu.
 */

const POOL_SIZE = 1024;

let pool = crypto.randomBytes(POOL_SIZE);
let poolOffset = 0;

function nextByte() {
    if (poolOffset >= pool.length) {
        pool = crypto.randomBytes(POOL_SIZE);
        poolOffset = 0;
    }
    return pool[poolOffset++];
}

/** Uniforman ceo broj u opsegu [0, max). */
function randomBelow(max) {
    if (!Number.isInteger(max) || max <= 1) return 0;
    if (max > 256) return crypto.randomInt(max);

    // Odbaci bajtove iznad poslednjeg punog kruga da modulo ne bude pristrasan.
    const limit = 256 - (256 % max);
    let byte;
    do {
        byte = nextByte();
    } while (byte >= limit);

    return byte % max;
}

/** Nasumičan element niza. */
function randomItem(array) {
    return array[randomBelow(array.length)];
}

/** Nasumičan element koji se razlikuje od prethodnog. */
function randomDifferentItem(array, previous) {
    if (!Array.isArray(array) || array.length === 0) return previous;
    if (array.length === 1) return array[0];

    let item;
    do {
        item = randomItem(array);
    } while (item === previous);

    return item;
}

/** Fisher–Yates mešanje u mestu. */
function shuffleInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = randomBelow(i + 1);
        const temporary = array[i];
        array[i] = array[j];
        array[j] = temporary;
    }
    return array;
}

/** Nasumičan heksadecimalni token (za sesije). */
function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
    randomBelow,
    randomItem,
    randomDifferentItem,
    shuffleInPlace,
    randomToken,
};
