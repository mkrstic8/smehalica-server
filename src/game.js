'use strict';

const crypto = require('crypto');

const { RACK_SIZE, MAX_SKIPS, MAX_CHAT_HISTORY } = require('./config');
const { letterValues, ALPHABET, createEmptyBoard } = require('./board');
const { createBag, drawTiles, createSpecialTile, rackValue } = require('./bag');
const { randomDifferentItem } = require('./random');
const { games, players } = require('./store');

/**
 * IGRA
 *
 * Ranije su "završi igru", "sastavi konačan rezultat" i "pošalji svima"
 * bili prekopirani na pet mesta (potez, preskakanje, predaja, get_state,
 * ponovno povezivanje). Svaka ispravka je morala da se uradi pet puta.
 * Sada je logika na jednom mestu, a handleri je samo pozivaju.
 */

// ==================== PRAVLJENJE IGRE ====================

function createGame(player1Id, player2Id) {
    const gameId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const bag = createBag();
    const makeRack = () => drawTiles(bag, RACK_SIZE - 1).concat(createSpecialTile());

    const game = {
        id: gameId,
        board: createEmptyBoard(),
        bag,
        players: new Map([
            [player1Id, { rack: makeRack(), score: 0, playerNum: 1, lastSpecialLetter: null }],
            [player2Id, { rack: makeRack(), score: 0, playerNum: 2, lastSpecialLetter: null }],
        ]),
        playerIds: [player1Id, player2Id],
        currentTurn: player1Id,
        isFirstMove: true,
        status: 'active',
        winner: null,
        lastMove: null,
        stateVersion: 0,
        skipCount: 0,
        chatMessages: [],
        isRoomGame: false,
        rematchRequestedBy: null,
        rematchStarted: false,
        abandoned: false,
        resignedByName: null,
        createdAt: Date.now(),
        finishedAt: null,
    };

    games.set(gameId, game);

    game.playerIds.forEach((playerId, index) => {
        const player = players.get(playerId);
        if (!player) return;

        player.gameId = gameId;
        player.playerNum = index + 1;
        player.rematchUnavailable = false;

        if (player.socket) {
            player.socket.join(gameId);
            player.socket.data.gameId = gameId;
        }
    });

    return game;
}

function opponentOf(game, playerId) {
    return game.playerIds.find(id => id !== playerId) || null;
}

function bumpVersion(game) {
    game.stateVersion = (game.stateVersion || 0) + 1;
}

/**
 * Specijalno slovo menja se samo kada novi potez zaista počne.
 * Ne dira se tokom validacije, pa neuspešan potez ne može da ga promeni.
 * Kada se vreća isprazni, postojeće specijalno slovo ostaje zaključano.
 */
function refreshSpecialTileForTurn(game, playerId) {
    // Када нема више слова у врећици, специјално слово се више НЕ
    // ствара/мења. Ако је већ у руци, остаје са последњим словом до краја.
    if (game.bag.length === 0) return;

    const player = game.players.get(playerId);
    if (!player) return;

    const special = player.rack.find(tile => tile && typeof tile === 'object' && tile.special === true);

    // Ако је играч у претходном потезу ПОТРОШИО специјално слово, оно
    // тренутно није у руци. На почетку његовог новог потеза поново се
    // појављује као ново љубичасто слово, све док у врећи има слова.
    if (!special) {
        player.rack.push(createSpecialTile(player.lastSpecialLetter || null));
        return;
    }

    // Ако га није потрошио, само промени слово за нови потез.
    const previous = special.letter;
    special.letter = randomDifferentItem(ALPHABET.split(''), previous);
    player.lastSpecialLetter = special.letter;
}

// ==================== STANJE ZA KLIJENTA ====================

function getGameState(game, playerId) {
    const opponentId = opponentOf(game, playerId);
    const player = game.players.get(playerId);
    const opponent = opponentId ? game.players.get(opponentId) : null;

    return {
        gameId: game.id,
        board: game.board,
        yourRack: player ? player.rack : [],
        yourScore: player ? player.score : 0,
        yourPlayerNum: player ? player.playerNum : null,
        opponentScore: opponent ? opponent.score : 0,
        opponentRackCount: opponent ? opponent.rack.length : 0,
        opponentName: (opponentId && players.get(opponentId)?.name) || 'Противник',
        currentTurn: game.currentTurn,
        isYourTurn: game.currentTurn === playerId,
        isFirstMove: game.isFirstMove,
        stateVersion: game.stateVersion || 0,
        status: game.status,
        winner: game.winner,
        bagCount: game.bag.length,
        skipCount: game.skipCount || 0,
        lastMove: game.lastMove,
        chatMessages: game.chatMessages,
    };
}

function finalScores(game) {
    return game.playerIds.map(playerId => ({
        name: players.get(playerId)?.name || 'Играч',
        score: game.players.get(playerId)?.score ?? 0,
    }));
}

function defaultResultMessage(game, playerId) {
    if (game.winner === 'draw') return '🤝 Нерешено!';
    if (game.winner === playerId) return '🎉 Победио/ла си!';
    return '😞 Изгубио/ла си.';
}

/** Stanje koje se šalje uz game_over. */
function buildGameOverState(game, playerId, overrides = {}) {
    const state = getGameState(game, playerId);

    state.type = 'game_over';
    state.gameOver = true;
    state.resultMessage = overrides.resultMessageFor
        ? overrides.resultMessageFor(playerId)
        : defaultResultMessage(game, playerId);
    state.finalScores = finalScores(game);

    if (game.resignedByName) {
        state.resignedByName = game.resignedByName;
    }

    return state;
}

// ==================== SLANJE ====================

function emitToPlayer(playerId, event, data) {
    const player = players.get(playerId);
    if (player && player.socket) {
        player.socket.emit(event, data);
        return true;
    }
    return false;
}

/** Šalje svakom igraču njegovu verziju stanja. */
function emitStateToAll(game, type, decorate) {
    for (const playerId of game.playerIds) {
        const state = getGameState(game, playerId);
        state.type = type;
        if (decorate) decorate(state, playerId);
        emitToPlayer(playerId, type, state);
    }
}

function broadcastGameOver(game, overrides) {
    for (const playerId of game.playerIds) {
        emitToPlayer(playerId, 'game_over', buildGameOverState(game, playerId, overrides));
    }
}

// ==================== ZAVRŠETAK IGRE ====================

function finish(game, winner) {
    game.status = 'finished';
    game.winner = winner;
    game.finishedAt = Date.now();
    bumpVersion(game);
}

function winnerByScore(game) {
    const [firstId, secondId] = game.playerIds;
    const firstScore = game.players.get(firstId).score;
    const secondScore = game.players.get(secondId).score;

    if (firstScore > secondScore) return firstId;
    if (secondScore > firstScore) return secondId;
    return 'draw';
}

/**
 * Završni obračun kada neko ostane bez pločica, a vreća je prazna:
 * igrač koji je "izašao" dobija vrednost protivnikovih preostalih pločica,
 * a protivniku se ta vrednost oduzima.
 */
function settleGoingOut(game, outPlayerId) {
    const opponentId = opponentOf(game, outPlayerId);
    if (!opponentId) return;

    const penalty = rackValue(game.players.get(opponentId).rack, letterValues);

    game.players.get(outPlayerId).score += penalty;
    game.players.get(opponentId).score -= penalty;

    finish(game, winnerByScore(game));
}

/** Završetak posle MAX_SKIPS preskočenih poteza: oba igrača gube svoje pločice. */
function settleAfterSkips(game) {
    for (const playerId of game.playerIds) {
        const seat = game.players.get(playerId);
        seat.score -= rackValue(seat.rack, letterValues);
    }

    finish(game, winnerByScore(game));
}

/**
 * Da li potez koji je upravo odigran završava igru?
 * Igra se završava kada je vreća prazna, a neko ostane bez pločica.
 */
function shouldEndAfterMove(game, playerId) {
    if (game.bag.length > 0) return false;
    const seat = game.players.get(playerId);
    return Boolean(seat) && seat.rack.length === 0;
}

// ==================== ČET ====================

function pushChatMessage(game, message) {
    game.chatMessages.push(message);
    if (game.chatMessages.length > MAX_CHAT_HISTORY) {
        game.chatMessages.splice(0, game.chatMessages.length - MAX_CHAT_HISTORY);
    }
    return message;
}

module.exports = {
    createGame,
    opponentOf,
    bumpVersion,
    refreshSpecialTileForTurn,
    getGameState,
    finalScores,
    defaultResultMessage,
    buildGameOverState,
    emitToPlayer,
    emitStateToAll,
    broadcastGameOver,
    finish,
    winnerByScore,
    settleGoingOut,
    settleAfterSkips,
    shouldEndAfterMove,
    pushChatMessage,
    MAX_SKIPS,
};
