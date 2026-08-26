'use strict';

const {
    CHAT_MIN_INTERVAL_MS,
    TYPING_MIN_INTERVAL_MS,
    REMATCH_MIN_INTERVAL_MS,
} = require('../config');
const { games, players, allowAction, sanitizeChatText } = require('../store');
const { createGame, opponentOf, emitToPlayer, pushChatMessage } = require('../game');
const { emitError, requireActiveGame } = require('./common');
const { startBothPlayers } = require('./lobby');

// ==================== ČET ====================

function handleChat(socket, playerId, rawText) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;

    const text = sanitizeChatText(rawText);
    if (text.length === 0) return;

    if (!allowAction(player, 'chat', CHAT_MIN_INTERVAL_MS)) {
        emitError(socket, 'Сачекај мало пре слања следеће поруке.');
        return;
    }

    const message = pushChatMessage(game, {
        from: player.name,
        text,
        timestamp: Date.now(),
    });

    for (const id of game.playerIds) {
        emitToPlayer(id, 'chat_message', message);
    }
}

function handleTyping(socket, playerId) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;
    if (!allowAction(player, 'typing', TYPING_MIN_INTERVAL_MS)) return;

    socket.to(game.id).emit('opponent_typing');
}

// ==================== REVANŠ ====================

function handleRematchRequest(socket, playerId) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;
    if (game.status !== 'finished') return;

    if (game.abandoned) {
        emitError(socket, 'Противник је напустио игру — реванш није могућ.');
        return;
    }

    if (!allowAction(player, 'rematch', REMATCH_MIN_INTERVAL_MS)) {
        emitError(socket, 'Сачекај мало пре новог захтева за реванш.');
        return;
    }

    const opponentId = opponentOf(game, playerId);
    const opponent = opponentId ? players.get(opponentId) : null;
    if (!opponent) {
        emitError(socket, 'Противник више није доступан.');
        return;
    }

    game.rematchRequestedBy = playerId;

    // U igri iz sobe zahtev preživi prekid veze i biće isporučen kad se
    // protivnik vrati (vidi lifecycle.js).
    if (game.isRoomGame && !opponent.socket) {
        socket.emit('rematch_sent', {
            message: '⏳ Противник тренутно није повезан. Захтев за реванш је сачуван и биће му послат када се врати.',
        });
        console.log(`🔄 ${player.name} traži revanš (protivnik offline, čeka reconnect)`);
        return;
    }

    emitToPlayer(opponentId, 'rematch_request', {
        fromId: playerId,
        fromName: player.name,
        message: `${player.name} жели реванш!`,
    });

    socket.emit('rematch_sent', { message: 'Захтев за реванш је послат.' });
    console.log(`🔄 ${player.name} traži revanš od ${opponent.name}`);
}

function handleAcceptRematch(socket, playerId, fromId) {
    const player = players.get(playerId);
    if (!player) return;

    if (player.rematchUnavailable) {
        player.rematchUnavailable = false;
        emitError(socket, 'Реванш више није доступан.');
        return;
    }

    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) {
        emitError(socket, 'Реванш више није доступан.');
        return;
    }

    const oldGame = context.game;

    if (oldGame.status !== 'finished' || oldGame.abandoned) {
        emitError(socket, 'Реванш више није доступан.');
        return;
    }

    const opponentId = opponentOf(oldGame, playerId);

    // fromId mora biti stvarni protivnik u OVOJ igri, i zahtev mora postojati.
    if (!opponentId || fromId !== opponentId) {
        emitError(socket, 'Неважећи захтев за реванш.');
        return;
    }
    if (oldGame.rematchRequestedBy !== fromId) {
        emitError(socket, 'Нема активног захтева за реванш.');
        return;
    }
    if (oldGame.rematchStarted) return;

    const opponent = players.get(opponentId);
    if (!opponent) {
        emitError(socket, 'Противник више није доступан.');
        return;
    }

    oldGame.rematchStarted = true;

    // Klijent već ume da obradi ovaj događaj (sklanja dugme i dijalog),
    // ali ga stari server nikada nije slao.
    for (const id of oldGame.playerIds) {
        emitToPlayer(id, 'rematch_accepted', { message: 'Реванш прихваћен!' });
    }

    // U revanšu prvi igra onaj ko je revanš tražio.
    const newGame = createGame(opponentId, playerId);
    newGame.isRoomGame = oldGame.isRoomGame;

    startBothPlayers(newGame, { isRematch: true });

    games.delete(oldGame.id);

    console.log(`🔄 Revanš prihvaćen: ${newGame.id}`);
}

function handleDeclineRematch(socket, playerId, fromId) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;
    if (game.status !== 'finished') return;

    const opponentId = opponentOf(game, playerId);

    if (!opponentId || fromId !== opponentId) {
        emitError(socket, 'Неважећи захтев.');
        return;
    }
    if (game.rematchRequestedBy !== fromId) {
        emitError(socket, 'Нема активног захтева за реванш.');
        return;
    }

    game.rematchRequestedBy = null;

    emitToPlayer(opponentId, 'rematch_declined', { message: 'Противник је одбио реванш.' });
    socket.emit('rematch_declined', { message: 'Одбио/ла си реванш.' });

    console.log(`❌ ${player.name} odbija revanš`);
}

module.exports = {
    handleChat,
    handleTyping,
    handleRematchRequest,
    handleAcceptRematch,
    handleDeclineRematch,
};
