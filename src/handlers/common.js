'use strict';

const { games, players, releaseFromGame } = require('../store');

function emitError(socket, message, extra) {
    if (!socket) return;
    socket.emit('error', extra ? { message, ...extra } : { message });
}

/** Vraća { player, game } ili null uz poslatu grešku. */
function requireActiveGame(socket, playerId, { silent = false } = {}) {
    const player = players.get(playerId);
    if (!player || !player.gameId) {
        if (!silent) emitError(socket, 'Ниси у игри.');
        return null;
    }

    const game = games.get(player.gameId);
    if (!game) {
        releaseFromGame(player);
        if (!silent) emitError(socket, 'Игра више не постоји.');
        return null;
    }

    return { player, game };
}

/**
 * Igrač koji je i dalje "zakačen" za završenu igru ne sme da bude
 * zauvek zaključan van lobija.
 * Vraća true ako je igrač slobodan za novu akciju.
 */
function releaseIfFinished(socket, player) {
    if (!player.gameId) return true;

    const game = games.get(player.gameId);
    if (!game || game.status === 'finished') {
        releaseFromGame(player);
        return true;
    }

    emitError(socket, 'Већ си у игри.');
    return false;
}

module.exports = {
    emitError,
    requireActiveGame,
    releaseIfFinished,
};
