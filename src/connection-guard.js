'use strict';

const {
    MAX_CONCURRENT_PER_IP,
    MAX_NEW_CONN_PER_WINDOW,
    CONN_WINDOW_MS,
    MAX_TOTAL_CONCURRENT,
} = require('./config');

/**
 * ZAŠTITA OD MASOVNIH KONEKCIJA
 *
 * Globalni limit važi za sve - to je čista zaštita kapaciteta servera.
 * Limiti po IP adresi važe SAMO za nove igrače (bez prepoznatog session
 * token-a), jer je to stvarni napad: skriptovano pravljenje beskonačno
 * novih zapisa u memoriji. Igrač koji se vraća sa validnim tokenom - na
 * primer telefon koji je izašao iz aplikacije pa se vratio - ne pravi novi
 * zapis i ne sme da bude odbijen.
 */

/** ip -> Set<socket.id> */
const connectionsByIp = new Map();
/** ip -> niz vremena otvaranja veze */
const attemptsByIp = new Map();

function getClientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.length > 0) {
        const parts = forwarded.split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length > 0) {
            // Render i slični PaaS-ovi dodaju STVARNU adresu na kraj liste;
            // sve pre poslednje stavke klijent može sam da izmisli.
            return parts[parts.length - 1];
        }
    }

    return socket.handshake.address || 'unknown';
}

function register(ip, socketId) {
    let sockets = connectionsByIp.get(ip);
    if (!sockets) {
        sockets = new Set();
        connectionsByIp.set(ip, sockets);
    }
    sockets.add(socketId);
}

function unregister(ip, socketId) {
    const sockets = connectionsByIp.get(ip);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) connectionsByIp.delete(ip);
}

function pruneAttempts(attempts, now) {
    let firstValid = 0;
    while (firstValid < attempts.length && now - attempts[firstValid] > CONN_WINDOW_MS) {
        firstValid++;
    }
    // splice jednom umesto shift() u petlji (shift pomera ceo niz svaki put).
    if (firstValid > 0) attempts.splice(0, firstValid);
}

function isRateLimited(ip) {
    const now = Date.now();
    let attempts = attemptsByIp.get(ip);

    if (!attempts) {
        attempts = [];
        attemptsByIp.set(ip, attempts);
    }

    pruneAttempts(attempts, now);

    if (attempts.length >= MAX_NEW_CONN_PER_WINDOW) return true;

    attempts.push(now);
    return false;
}

function sweep() {
    const now = Date.now();
    for (const [ip, attempts] of attemptsByIp) {
        pruneAttempts(attempts, now);
        if (attempts.length === 0) attemptsByIp.delete(ip);
    }
}

/** Socket.IO middleware koji odbija konekciju preko limita. */
function middleware(io) {
    return (socket, next) => {
        const ip = getClientIp(socket);
        socket.data.clientIp = ip;

        if (io.engine.clientsCount >= MAX_TOTAL_CONCURRENT) {
            return next(new Error('Сервер је тренутно пун. Покушај поново за који минут.'));
        }

        if (socket.data.isNewPlayer) {
            const active = connectionsByIp.get(ip);
            if (active && active.size >= MAX_CONCURRENT_PER_IP) {
                return next(new Error('Превише активних веза са ове адресе.'));
            }
            if (isRateLimited(ip)) {
                return next(new Error('Превише покушаја повезивања. Сачекај мало па пробај поново.'));
            }
        }

        next();
    };
}

module.exports = {
    getClientIp,
    register,
    unregister,
    sweep,
    middleware,
};
