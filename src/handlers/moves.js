'use strict';

const { MOVE_MIN_INTERVAL_MS, MAX_SKIPS } = require('../config');
const { players, allowAction } = require('../store');
const { validateMove, applyMove } = require('../rules');
const {
    opponentOf,
    bumpVersion,
    refreshSpecialTileForTurn,
    getGameState,
    emitToPlayer,
    emitStateToAll,
    buildGameOverState,
    broadcastGameOver,
    finish,
    settleGoingOut,
    settleAfterSkips,
    shouldEndAfterMove,
    pushChatMessage,
} = require('../game');
const { emitError, requireActiveGame } = require('./common');

function handlePlaceTiles(socket, playerId, placements) {
    const context = requireActiveGame(socket, playerId);
    if (!context) return;

    const { player, game } = context;

    // Odgovara se i kad je potez odbijen zbog brzine, jer klijent drži
    // dugme "потврди" zaključano dok ne dobije odgovor.
    if (!allowAction(player, 'move', MOVE_MIN_INTERVAL_MS)) {
        socket.emit('move_invalid', { error: 'Мало спорије — потез је послат преброзо.' });
        return;
    }

    // Provera je čista funkcija - ako padne, tabla i vreća su netaknute.
    const move = validateMove(game, playerId, placements);
    if (!move.valid) {
        socket.emit('move_invalid', { error: move.error });
        return;
    }

    applyMove(game, playerId, move);

    game.lastMove = {
        playerId,
        words: move.words,
        score: move.score,
        bingo: move.bingo,
        placements: move.placements,
    };

    const opponentId = opponentOf(game, playerId);
    game.currentTurn = opponentId;

    // Нови потез је прихваћен: сада, и само сада, припреми
    // специјално слово играча који је на реду.
    refreshSpecialTileForTurn(game, opponentId);
    bumpVersion(game);

    // Odigran potez ide i u istoriju četa, da se vidi i posle reconnect-a.
    const moveMessage = pushChatMessage(game, {
        type: 'move',
        from: player.name,
        text: `🎯 игра: ${move.words.join(', ')} (+${move.score})${move.bingo ? ' 🎉 БИНГО!' : ''}`,
        timestamp: Date.now(),
    });

    for (const id of game.playerIds) {
        emitToPlayer(id, 'chat_message', moveMessage);
    }

    if (shouldEndAfterMove(game, playerId)) {
        settleGoingOut(game, playerId);
        broadcastGameOver(game);
    } else {
        emitStateToAll(game, 'move_result', (state) => {
            state.lastMovePlayerName = player.name;
            state.lastMoveWords = move.words;
            state.lastMoveScore = move.score;
        });
    }

    console.log(
        `🎯 Igra ${game.id}: ${player.name} igra ${move.words.join(', ')} (+${move.score})`
    );
}

function handleSkipTurn(socket, playerId) {
    const context = requireActiveGame(socket, playerId, { silent: true });
    if (!context) return;

    const { player, game } = context;

    // Bez ove provere je igrač na potezu mogao da "preskoči" i posle
    // završetka igre i time ponovo menja rezultat.
    if (game.status !== 'active' || game.currentTurn !== playerId) return;
    if (!allowAction(player, 'move', MOVE_MIN_INTERVAL_MS)) return;

    game.currentTurn = opponentOf(game, playerId);
    refreshSpecialTileForTurn(game, game.currentTurn);
    game.lastMove = { playerId, words: [], score: 0, skipped: true };
    game.skipCount = (game.skipCount || 0) + 1;
    bumpVersion(game);

    if (game.skipCount >= MAX_SKIPS) {
        settleAfterSkips(game);
        broadcastGameOver(game, {
            resultMessageFor: () =>
                game.winner === 'draw'
                    ? `🤝 Игра је завршена након ${MAX_SKIPS} прескочена потеза. Нерешено!`
                    : `Игра је завршена након ${MAX_SKIPS} прескочена потеза — побеђује играч са више поена.`,
        });
    } else {
        emitStateToAll(game, 'turn_skipped', (state) => {
            state.skippedByName = player.name;
        });
    }

    console.log(`⏭ Igra ${game.id}: ${player.name} preskače (${game.skipCount}/${MAX_SKIPS})`);
}

function handleGetState(socket, playerId) {
    const context = requireActiveGame(socket, playerId);
    if (!context) return;

    const { game } = context;

    if (game.status === 'finished') {
        socket.emit('game_over', buildGameOverState(game, playerId));
        return;
    }

    const state = getGameState(game, playerId);
    state.type = 'game_state';
    socket.emit('game_state', state);
}

/**
 * Predaja. Poziva se i iz socket handlera i iz tajmera za istekli grace
 * period, pa socket sme da bude null.
 */
function handleResign(socket, playerId) {
    const context = requireActiveGame(socket, playerId, { silent: !socket });
    if (!context) return;

    const { player, game } = context;
    if (game.status !== 'active') return;

    const opponentId = opponentOf(game, playerId);

    game.resignedByName = player.name;
    finish(game, opponentId);

    broadcastGameOver(game, {
        resultMessageFor: (id) =>
            id === opponentId
                ? '🎉 Противник је одустао! Победио/ла си!'
                : '🏳 Предао/ла си се.',
    });

    console.log(`🏳 Igra ${game.id}: ${player.name} se predaje`);
}

module.exports = {
    handlePlaceTiles,
    handleSkipTurn,
    handleGetState,
    handleResign,
};
