'use strict';

const guard = require('../connection-guard');
const lobby = require('./lobby');
const moves = require('./moves');
const social = require('./social');
const lifecycle = require('./lifecycle');

/**
 * Sva veza između imena događaja i funkcije je na jednom mestu.
 * Svaki handler je obmotan u try/catch: greška u obradi jedne poruke
 * ne sme da obori server ni da prekine partiju drugim igračima.
 */
function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        const playerId = socket.data.playerId;

        guard.register(socket.data.clientIp, socket.id);
        lifecycle.handleConnection(socket, playerId);

        const on = (event, handler) => {
            socket.on(event, (data) => {
                try {
                    handler(socket, playerId, data);
                } catch (err) {
                    console.error(`❌ Greška u obradi "${event}" (${playerId.slice(0, 8)}):`, err);
                    socket.emit('error', { message: 'Дошло је до грешке на серверу.' });
                }
            });
        };

        // ---- Lobi ----
        on('set_name', (s, id, data) => lobby.handleSetName(s, id, data));
        on('create_room', (s, id) => lobby.handleCreateRoom(s, id));
        on('join_room', (s, id, data) => lobby.handleJoinRoom(s, id, data?.roomLink));
        on('quick_match', (s, id) => lobby.handleQuickMatch(s, id));
        on('cancel_find', (s, id) => lobby.handleCancelFind(s, id));

        // ---- Igra ----
        on('place_tiles', (s, id, data) => moves.handlePlaceTiles(s, id, data?.placements));
        on('skip_turn', (s, id) => moves.handleSkipTurn(s, id));
        on('get_state', (s, id) => moves.handleGetState(s, id));
        on('resign', (s, id) => moves.handleResign(s, id));

        // ---- Čet i revanš ----
        on('chat', (s, id, data) => social.handleChat(s, id, data?.text));
        on('typing', (s, id) => social.handleTyping(s, id));
        on('request_rematch', (s, id) => social.handleRematchRequest(s, id));
        on('accept_rematch', (s, id, data) => social.handleAcceptRematch(s, id, data?.fromId));
        on('decline_rematch', (s, id, data) => social.handleDeclineRematch(s, id, data?.fromId));

        // ---- Odlazak ----
        on('leave_game', (s, id) => lifecycle.handleLeaveGame(s, id));

        socket.on('ping', () => socket.emit('pong'));

        socket.on('disconnect', () => {
            guard.unregister(socket.data.clientIp, socket.id);
            try {
                lifecycle.handleDisconnect(socket, playerId);
            } catch (err) {
                console.error('❌ Greška pri diskonekciji:', err);
            }
        });

        socket.on('error', (err) => {
            console.error(`❌ Socket greška (${playerId.slice(0, 8)}):`, err?.message || err);
        });
    });
}

module.exports = { registerSocketHandlers };
