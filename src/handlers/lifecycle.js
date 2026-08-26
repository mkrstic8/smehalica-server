'use strict';

const { DISCONNECT_GRACE_MS } = require('../config');
const {
    games,
    players,
    rooms,
    matchmaking,
    createPlayer,
    releaseFromGame,
    isRoomAlive,
} = require('../store');
const {
    opponentOf,
    getGameState,
    buildGameOverState,
    emitToPlayer,
} = require('../game');
const { requireActiveGame } = require('./common');
const { handleResign } = require('./moves');

/**
 * Novi socket postaje jedini važeći socket za tog igrača.
 * Vraća zapis igrača.
 */
function attachSocket(socket, playerId) {
    const existing = players.get(playerId);

    if (!existing) {
        const player = createPlayer(socket);
        players.set(playerId, player);
        return player;
    }

    existing.socket = socket;
    existing.lastSeen = Date.now();

    if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
    }

    return existing;
}

/** Vraća igrača u Socket.IO sobu i javlja protivniku da je ponovo tu. */
function restoreGame(socket, playerId, player) {
    const game = games.get(player.gameId);

    if (!game) {
        releaseFromGame(player);
        socket.emit('error', { message: 'Претходна игра више не постоји.' });
        return;
    }

    socket.join(game.id);
    socket.data.gameId = game.id;

    if (!game.players.has(playerId)) {
        console.warn(`⚠️ Igrač ${playerId.slice(0, 8)} nije deo igre ${game.id}`);
        releaseFromGame(player);
        return;
    }

    const opponentId = opponentOf(game, playerId);

    if (game.status === 'active') {
        if (opponentId) {
            emitToPlayer(opponentId, 'opponent_reconnected', {
                message: `${player.name} се вратио у игру.`,
            });
        }

        const state = getGameState(game, playerId);
        state.type = 'game_state';
        socket.emit('game_state', state);

        console.log(
            `🔄 RECONNECT ${player.name} | igra=${game.id} | ` +
            `naPotezu=${game.currentTurn === playerId} | verzija=${game.stateVersion}`
        );
        return;
    }

    // Igra je već završena - pošalji rezultat da igrač ne ostane zaglavljen.
    socket.emit('game_over', buildGameOverState(game, playerId));

    // Ako je protivnik tražio revanš dok je ovaj igrač bio offline,
    // isporuči zahtev sada.
    if (game.isRoomGame && !game.abandoned && game.rematchRequestedBy === opponentId && opponentId) {
        const requester = players.get(opponentId);
        socket.emit('rematch_request', {
            fromId: opponentId,
            fromName: requester?.name || 'Играч',
            message: `${requester?.name || 'Играч'} жели реванш!`,
        });
        console.log(`🔄 Zahtev za revanš isporučen posle reconnect-a: -> ${player.name}`);
    }
}

/** Kreator se vraća u sobu dok igra još nije počela. */
function restoreRoom(socket, player) {
    const roomLink = player.roomLink;
    const room = rooms.get(roomLink);

    if (isRoomAlive(room) && room.creatorId === socket.data.playerId) {
        socket.emit('room_created', {
            roomLink,
            message: `Соба поново повезана! Пошаљи линк противнику: ${roomLink}`,
        });
        console.log(`🏠 RECONNECT u sobu ${roomLink} | ${player.name}`);
        return;
    }

    if (room && room.creatorId === socket.data.playerId) {
        rooms.delete(roomLink);
    }
    player.roomLink = null;

    socket.emit('error', {
        message: 'Соба је истекла или више није доступна. Направи нову собу.',
    });
}

function handleConnection(socket, playerId) {
    const player = attachSocket(socket, playerId);

    socket.emit('connected', {
        playerId,
        sessionToken: player.sessionToken,
        message: 'Повезан/а на сервер Смехалице!',
    });

    if (player.gameId) {
        restoreGame(socket, playerId, player);
    } else if (player.roomLink) {
        restoreRoom(socket, player);
    }
}

function handleDisconnect(socket, playerId) {
    const player = players.get(playerId);
    if (!player) return;

    // Ovaj socket je već zamenjen novijim - njegov disconnect ne sme
    // da utiče na igrača koji je u međuvremenu ponovo povezan.
    if (player.socket && player.socket.id !== socket.id) return;

    player.lastSeen = Date.now();
    player.socket = null;

    matchmaking.delete(playerId);

    if (!player.gameId) return;

    const gameIdAtDisconnect = player.gameId;
    const game = games.get(gameIdAtDisconnect);
    if (!game || game.status !== 'active') return;

    const opponentId = opponentOf(game, playerId);
    if (opponentId) {
        emitToPlayer(opponentId, 'opponent_disconnected', {
            message: `${player.name} је изгубио везу. Чекам повратак...`,
            graceSeconds: DISCONNECT_GRACE_MS / 1000,
        });
    }

    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

    console.log(
        `⏳ Igrač ${player.name} je offline. ` +
        `Čekam ${DISCONNECT_GRACE_MS / 1000}s pre automatske predaje...`
    );

    player.disconnectTimer = setTimeout(() => {
        const current = players.get(playerId);
        if (!current) return;

        current.disconnectTimer = null;

        // Vratio se u međuvremenu - predaja se otkazuje.
        if (current.socket) return;
        if (current.gameId !== gameIdAtDisconnect) return;

        const stillActive = games.get(gameIdAtDisconnect);
        if (!stillActive || stillActive.status !== 'active') return;

        console.log(`⏰ Grace period istekao — automatska predaja: ${current.name}`);
        handleResign(null, playerId);
    }, DISCONNECT_GRACE_MS);
}

/**
 * Napuštanje igre.
 *
 * Ranije je ovo brisalo celu partiju, pa je protivnik ostajao bez igre i
 * bez rezultata - odlazak usred partije je praktično poništavao pobedu.
 * Sada se odlazak iz ŽIVE partije računa kao predaja, a partija se briše
 * tek redovnim čišćenjem, da protivnik stigne da vidi konačan rezultat.
 */
function handleLeaveGame(socket, playerId) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;
    const opponentId = opponentOf(game, playerId);

    game.abandoned = true;
    game.rematchRequestedBy = null;

    if (opponentId) {
        const opponent = players.get(opponentId);
        if (opponent) opponent.rematchUnavailable = true;
    }

    if (game.status === 'active') {
        handleResign(null, playerId);
    }

    if (opponentId) {
        emitToPlayer(opponentId, 'opponent_left', {
            message: `${player.name} је напустио игру.`,
        });
    }

    if (socket) socket.leave(game.id);
    releaseFromGame(player);

    console.log(`🚪 ${player.name} napušta igru ${game.id}`);
}

module.exports = {
    handleConnection,
    handleDisconnect,
    handleLeaveGame,
};
