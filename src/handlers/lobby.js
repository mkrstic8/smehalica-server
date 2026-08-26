'use strict';

const { COOLDOWN_MS, LOBBY_MIN_INTERVAL_MS } = require('../config');
const {
    players,
    rooms,
    matchmaking,
    allowAction,
    cooldownRemaining,
    clearRoomOf,
    generateRoomLink,
    normalizeRoomLink,
    isRoomAlive,
    sanitizePlayerName,
} = require('../store');
const { createGame, getGameState, emitToPlayer } = require('../game');
const { emitError, releaseIfFinished } = require('./common');

function handleSetName(socket, playerId, data) {
    const player = players.get(playerId);
    if (!player) return;

    player.name = sanitizePlayerName(data?.name);
    socket.emit('name_set', { name: player.name });
}

/** Zajedničke provere pre bilo koje lobi akcije. */
function readyForLobbyAction(socket, playerId, actionName) {
    const player = players.get(playerId);
    if (!player) return null;

    if (!allowAction(player, actionName, LOBBY_MIN_INTERVAL_MS)) return null;
    if (!releaseIfFinished(socket, player)) return null;

    const remaining = cooldownRemaining(player);
    if (remaining > 0) {
        emitError(socket, `Сачекај ${remaining} секунди пре нове акције.`, {
            cooldownSeconds: remaining,
        });
        return null;
    }

    // Traženje protivnika i čekanje u sopstvenoj sobi se međusobno isključuju.
    matchmaking.delete(playerId);

    return player;
}

function handleCreateRoom(socket, playerId) {
    const player = readyForLobbyAction(socket, playerId, 'lobby');
    if (!player) return;

    // Stara soba se gasi pre nego što se napravi nova.
    clearRoomOf(player);

    const link = generateRoomLink();
    rooms.set(link, { creatorId: playerId, createdAt: Date.now() });
    player.roomLink = link;

    socket.emit('room_created', {
        roomLink: link,
        message: `Соба креирана! Пошаљи линк противнику: ${link}`,
    });

    console.log(`🏠 Soba ${link} — kreirao ${player.name}`);
}

function handleJoinRoom(socket, playerId, rawLink) {
    const player = readyForLobbyAction(socket, playerId, 'lobby');
    if (!player) return;

    const roomLink = normalizeRoomLink(rawLink);
    if (!roomLink) {
        emitError(socket, 'Линк собе је неважећи.');
        return;
    }

    // Ako igrač ulazi u tuđu sobu, njegova sopstvena više ne sme da stoji.
    if (player.roomLink && player.roomLink !== roomLink) {
        clearRoomOf(player);
    }

    const room = rooms.get(roomLink);

    if (!isRoomAlive(room)) {
        if (room) {
            const creator = players.get(room.creatorId);
            if (creator && creator.roomLink === roomLink) creator.roomLink = null;
            rooms.delete(roomLink);
        }
        emitError(socket, 'Соба не постоји, истекла је или је линк неважећи.');
        return;
    }

    const creatorId = room.creatorId;

    if (creatorId === playerId) {
        emitError(socket, 'Не можеш се придружити сопственој соби.');
        return;
    }

    const creator = players.get(creatorId);
    if (!creator || creator.gameId) {
        rooms.delete(roomLink);
        emitError(socket, 'Креатор собе више није доступан.');
        return;
    }

    rooms.delete(roomLink);
    creator.roomLink = null;

    const game = createGame(creatorId, playerId);
    game.isRoomGame = true;

    startBothPlayers(game);

    console.log(`🎮 Igra ${game.id}: ${creator.name} vs ${player.name} (soba ${roomLink})`);
}

function handleQuickMatch(socket, playerId) {
    const player = readyForLobbyAction(socket, playerId, 'lobby');
    if (!player) return;

    clearRoomOf(player);

    let opponentId = null;
    for (const candidateId of matchmaking) {
        const candidate = players.get(candidateId);
        if (candidateId !== playerId && candidate && !candidate.gameId) {
            opponentId = candidateId;
            break;
        }
        // Usput izbaci zastarele zapise iz reda.
        if (!candidate || candidate.gameId) matchmaking.delete(candidateId);
    }

    if (!opponentId) {
        matchmaking.add(playerId);
        socket.emit('finding_game', {
            message: 'Тражим противника... Само тренутак.',
            queuePosition: matchmaking.size,
        });
        console.log(`⏳ ${player.name} čeka protivnika (u redu: ${matchmaking.size})`);
        return;
    }

    matchmaking.delete(opponentId);

    const game = createGame(playerId, opponentId);
    startBothPlayers(game);

    console.log(`🎮 Igra ${game.id}: ${player.name} vs ${players.get(opponentId).name}`);
}

function handleCancelFind(socket, playerId) {
    const player = players.get(playerId);
    if (!player) return;

    let cancelled = matchmaking.delete(playerId);

    if (player.roomLink) {
        clearRoomOf(player);
        cancelled = true;
    }

    if (!cancelled) return;

    player.lastCancelTime = Date.now();
    socket.emit('find_cancelled', {
        message: 'Претрага отказана.',
        cooldownSeconds: COOLDOWN_MS / 1000,
    });
}

/** Šalje game_start obojici igrača. */
function startBothPlayers(game, { isRematch = false } = {}) {
    for (const playerId of game.playerIds) {
        const state = getGameState(game, playerId);
        state.type = 'game_start';
        if (isRematch) state.isRematch = true;
        emitToPlayer(playerId, 'game_start', state);
    }
}

module.exports = {
    handleSetName,
    handleCreateRoom,
    handleJoinRoom,
    handleQuickMatch,
    handleCancelFind,
    startBothPlayers,
};
