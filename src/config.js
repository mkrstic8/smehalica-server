'use strict';

/**
 * Sva podešavanja na jednom mestu.
 * Sve vrednosti se mogu pregaziti preko environment promenljivih
 * (lokalno kroz .env vrednosti u shell-u, na Render-u kroz dashboard).
 */

function envNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function envFlag(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return raw !== '0' && raw.toLowerCase() !== 'false';
}

module.exports = {
    // ---------- Server ----------
    PORT: envNumber('PORT', 3000),
    HOST: process.env.HOST || '0.0.0.0',
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

    // ---------- Pravila igre ----------
    BOARD_SIZE: 13,
    CENTER: 6,   // sredina table 13x13; rules.js proverava prvi potez ovim
    RACK_SIZE: 8,              // igra se sa 8 slova na stalku
    BINGO_BONUS: 50,           // bonus kad se u jednom potezu odigraju sva slova
    MAX_SKIPS: 4,              // posle 4 preskočena poteza igra se završava
    MIN_WORD_LENGTH: 2,
    MAX_WORD_LENGTH: 15,

    // ---------- Raspored izvlačenja iz vreće ----------
    // NE menja ni frekvenciju slova ni ukupan broj pločica - samo redosled,
    // tako da svaka grupa od RACK_SIZE izvučenih pločica bude igriva.
    BAG_MIN_VOWELS_PER_DRAW: 2,
    BAG_MAX_VOWELS_PER_DRAW: 5,
    BAG_MAX_RARE_PER_DRAW: 2,

    // ---------- Tajmeri ----------
    DISCONNECT_GRACE_MS: envNumber('DISCONNECT_GRACE_MS', 5 * 60 * 1000),
    CLEANUP_INTERVAL_MS: envNumber('CLEANUP_INTERVAL_MS', 5 * 60 * 1000),
    COOLDOWN_MS: envNumber('COOLDOWN_MS', 10 * 1000),
    ROOM_TTL_MS: envNumber('ROOM_TTL_MS', 10 * 60 * 1000),
    FINISHED_GAME_TTL_MS: envNumber('FINISHED_GAME_TTL_MS', 30 * 60 * 1000),
    IDLE_PLAYER_TTL_MS: envNumber('IDLE_PLAYER_TTL_MS', 60 * 60 * 1000),

    // ---------- Zaštita od spama po igraču ----------
    CHAT_MIN_INTERVAL_MS: 700,
    TYPING_MIN_INTERVAL_MS: 700,
    REMATCH_MIN_INTERVAL_MS: 3000,
    MOVE_MIN_INTERVAL_MS: 250,
    LOBBY_MIN_INTERVAL_MS: 500,
    MAX_CHAT_LENGTH: 200,
    MAX_CHAT_HISTORY: 100,
    MAX_NAME_LENGTH: 20,
    ROOM_LINK_LENGTH: 5,

    // ---------- Zaštita od masovnih konekcija (DoS) ----------
    MAX_CONCURRENT_PER_IP: envNumber('MAX_CONCURRENT_PER_IP', 20),
    MAX_NEW_CONN_PER_WINDOW: envNumber('MAX_NEW_CONN_PER_WINDOW', 30),
    CONN_WINDOW_MS: envNumber('CONN_WINDOW_MS', 60 * 1000),
    MAX_TOTAL_CONCURRENT: envNumber('MAX_TOTAL_CONCURRENT', 500),
    MAX_SOCKET_PAYLOAD: envNumber('MAX_SOCKET_PAYLOAD', 16 * 1024),

    // ---------- Rečnik ----------
    DICTIONARY_FILE: process.env.DICTIONARY_FILE || 'serbian-words.txt',
    WATCH_DICTIONARY: envFlag('WATCH_DICTIONARY', true),
    DICTIONARY_WATCH_INTERVAL_MS: 1000,
    DICTIONARY_RELOAD_DEBOUNCE_MS: 300,

    // ---------- Logovanje ----------
    VERBOSE: envFlag('VERBOSE', true),
};
