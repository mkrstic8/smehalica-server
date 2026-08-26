'use strict';

const {
    COOLDOWN_MS,
    ROOM_TTL_MS,
    FINISHED_GAME_TTL_MS,
    IDLE_PLAYER_TTL_MS,
    MAX_NAME_LENGTH,
    MAX_CHAT_LENGTH,
    ROOM_LINK_LENGTH,
} = require('./config');
const { ALPHABET } = require('./board');
const { randomBelow, randomToken } = require('./random');

/**
 * STANJE
 *
 * Sve tri kolekcije su Map, a ne obični objekti.
 * Sa običnim objektom `rooms['__proto__']` vraća Object.prototype - dakle
 * nešto "istinito" za polje koje nikada nije napravljeno - pa provere tipa
 * `if (rooms[link])` prolaze za ključeve koje niko nije upisao. Map nema
 * prototip lanac i takav ključ jednostavno ne postoji.
 */

/** gameId -> game */
const games = new Map();
/** playerId -> player */
const players = new Map();
/** roomLink -> { creatorId, createdAt } */
const rooms = new Map();
/** Set playerId-jeva koji čekaju protivnika */
const matchmaking = new Set();

// ==================== IGRAČI ====================

function createPlayer(socket) {
    return {
        socket,
        sessionToken: randomToken(32),
        gameId: null,
        playerNum: null,
        name: 'Играч',
        disconnectTimer: null,
        roomLink: null,
        lastSeen: Date.now(),
        lastCancelTime: 0,
        rematchUnavailable: false,
        // Vremena poslednjih akcija, za zaštitu od spama.
        throttles: Object.create(null),
    };
}

function findPlayerBySessionToken(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) return null;
    for (const [playerId, player] of players) {
        if (player.sessionToken === sessionToken) return playerId;
    }
    return null;
}

/**
 * Jedinstvena zaštita od spama za sve akcije.
 * Vraća true ako akciju treba propustiti.
 */
function allowAction(player, action, minIntervalMs) {
    const now = Date.now();
    const last = player.throttles[action] || 0;
    if (now - last < minIntervalMs) return false;
    player.throttles[action] = now;
    return true;
}

function cooldownRemaining(player) {
    const elapsed = Date.now() - (player.lastCancelTime || 0);
    if (player.lastCancelTime && elapsed < COOLDOWN_MS) {
        return Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    }
    return 0;
}

/** Oslobađa igrača posle završene igre, da može da započne novu. */
function releaseFromGame(player) {
    player.gameId = null;
    player.playerNum = null;
    player.rematchUnavailable = false;
}

function clearRoomOf(player) {
    if (!player.roomLink) return;
    const room = rooms.get(player.roomLink);
    if (room) rooms.delete(player.roomLink);
    player.roomLink = null;
}

// ==================== SOBE ====================

function generateRoomLink() {
    for (let attempt = 0; attempt < 50; attempt++) {
        let link = '';
        for (let i = 0; i < ROOM_LINK_LENGTH; i++) {
            link += ALPHABET[randomBelow(ALPHABET.length)];
        }
        if (!rooms.has(link)) return link;
    }
    // Praktično nedostižno (30^5 kombinacija), ali bolje nego beskonačna rekurzija.
    return `${Date.now().toString(36).toUpperCase()}`;
}

/** Klijent može poslati kod malim slovima ili sa razmacima - normalizuj. */
function normalizeRoomLink(raw) {
    if (typeof raw !== 'string') return null;
    const clean = raw.normalize('NFC').trim().toUpperCase();
    if (clean.length === 0 || clean.length > 32) return null;
    return clean;
}

function isRoomAlive(room) {
    return Boolean(room) &&
        typeof room.createdAt === 'number' &&
        Date.now() - room.createdAt <= ROOM_TTL_MS;
}

// ==================== ČIŠĆENJE TEKSTA ====================

function sanitizePlayerName(name) {
    if (typeof name !== 'string') return 'Играч';

    const clean = name
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F]/g, '')        // kontrolni karakteri
        .replace(/[^\p{L}\p{N} ._!?-]/gu, '')          // beli spisak dozvoljenog
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_NAME_LENGTH);

    return clean || 'Играч';
}

function sanitizeChatText(text) {
    if (typeof text !== 'string') return '';

    return text
        .normalize('NFC')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CHAT_LENGTH);
}

// ==================== PERIODIČNO ČIŠĆENJE ====================

function cleanup() {
    const now = Date.now();

    // Završene igre koje su odležale svoje.
    for (const [gameId, game] of games) {
        const finishedAt = game.finishedAt || game.createdAt;
        if (game.status === 'finished' && now - finishedAt > FINISHED_GAME_TTL_MS) {
            games.delete(gameId);
        }
    }

    // Istekle sobe.
    for (const [link, room] of rooms) {
        if (now - room.createdAt > ROOM_TTL_MS) {
            const creator = players.get(room.creatorId);
            if (creator && creator.roomLink === link) creator.roomLink = null;
            rooms.delete(link);
        }
    }

    for (const [playerId, player] of players) {
        // Igrač pokazuje na igru koje više nema.
        // Bez ovoga gameId zauvek ostane postavljen posle brisanja igre, pa
        // provera ispod nikad ne prođe i zapis igrača curi u memoriji.
        if (player.gameId && !games.has(player.gameId)) {
            releaseFromGame(player);
        }

        if (player.socket || player.gameId || matchmaking.has(playerId)) continue;

        if (now - (player.lastSeen || 0) > IDLE_PLAYER_TTL_MS) {
            if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
            clearRoomOf(player);
            players.delete(playerId);
        }
    }
}

module.exports = {
    games,
    players,
    rooms,
    matchmaking,
    createPlayer,
    findPlayerBySessionToken,
    allowAction,
    cooldownRemaining,
    releaseFromGame,
    clearRoomOf,
    generateRoomLink,
    normalizeRoomLink,
    isRoomAlive,
    sanitizePlayerName,
    sanitizeChatText,
    cleanup,
};
