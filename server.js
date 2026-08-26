'use strict';

/**
 * СМЕХАЛИЦА УКРШТЕНИЦА — сервер
 *
 * Ovaj fajl samo sastavlja delove i pokreće server.
 * Logika je u src/:
 *
 *   src/config.js            sva podešavanja
 *   src/board.js             tabla, vrednosti slova, frekvencija pločica
 *   src/dictionary.js        rečnik (učitavanje, pretraga, hot-reload)
 *   src/bag.js               vreća i izvlačenje pločica
 *   src/rules.js             provera i upis poteza
 *   src/game.js              tok partije i stanje za klijenta
 *   src/store.js             igrači, igre, sobe, čišćenje
 *   src/http-static.js       posluživanje public/ fajlova
 *   src/connection-guard.js  limiti konekcija
 *   src/handlers/            obrada Socket.IO događaja
 */

const crypto = require('crypto');
const { Server } = require('socket.io');

const config = require('./src/config');
const dictionary = require('./src/dictionary');
const store = require('./src/store');
const guard = require('./src/connection-guard');
const { createHttpServer } = require('./src/http-static');
const { registerSocketHandlers } = require('./src/handlers');

// ==================== REČNIK ====================
if (!dictionary.load()) {
    console.error('❌ Server se ne može pokrenuti bez rečnika.');
    process.exit(1);
}
dictionary.watch();

// ==================== HTTP ====================
const httpServer = createHttpServer({
    statusPayload: () => ({
        server: 'Смехалица укрштеница',
        version: require('./package.json').version,
        uptimeSeconds: Math.round(process.uptime()),
        activeGames: store.games.size,
        playersOnline: store.players.size,
        waitingPlayers: store.matchmaking.size,
        dictionarySize: dictionary.size,
        rackSize: config.RACK_SIZE,
        memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    }),
});

// ==================== SOCKET.IO ====================
const io = new Server(httpServer, {
    cors: {
        origin: config.CORS_ORIGIN,
        methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // Nijedna legitimna poruka nije ni blizu ovoga; smanjuje površinu za DoS.
    maxHttpBufferSize: config.MAX_SOCKET_PAYLOAD,
});

/**
 * Identitet igrača.
 * Ide PRE limita konekcija namerno: mora prvo da se zna da li je u pitanju
 * poznat igrač, da limit ne bi blokirao njegovu legitimnu rekonekciju.
 * Igrač se prepoznaje ISKLJUČIVO po session token-u koji je server izdao,
 * nikad po playerId-ju koji klijent sam pošalje.
 */
io.use((socket, next) => {
    try {
        const sessionToken = socket.handshake.auth?.sessionToken;
        const knownPlayerId = store.findPlayerBySessionToken(sessionToken);

        socket.data.isNewPlayer = !knownPlayerId;
        socket.data.playerId = knownPlayerId || crypto.randomUUID();

        next();
    } catch (err) {
        console.error('❌ Greška u autentifikaciji:', err);
        next(new Error('Аутентификација није успела.'));
    }
});

io.use(guard.middleware(io));

registerSocketHandlers(io);

// ==================== PERIODIČNO ČIŠĆENJE ====================
const cleanupTimer = setInterval(() => {
    try {
        store.cleanup();
        guard.sweep();
    } catch (err) {
        console.error('❌ Greška pri čišćenju:', err);
    }
}, config.CLEANUP_INTERVAL_MS);

cleanupTimer.unref();

// ==================== ZAŠTITA OD PADA ====================
process.on('uncaughtException', (err) => {
    console.error('❌ NEUHVAĆENA GREŠKA:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ NEUHVAĆENO ODBIJANJE PROMISE-A:', reason);
});

// ==================== UREDNO GAŠENJE ====================
let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n🛑 ${signal} — gasim server...`);

    io.close(() => {
        httpServer.close(() => process.exit(0));
    });

    // Ako neka veza zaglavi, ne čekaj zauvek.
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ==================== POKRETANJE ====================
httpServer.listen(config.PORT, config.HOST, () => {
    console.log('═══════════════════════════════════════════');
    console.log('🎯 СМЕХАЛИЦА УКРШТЕНИЦА — СЕРВЕР (Socket.IO)');
    console.log('═══════════════════════════════════════════');
    console.log(`🚀 Port:      ${config.PORT}`);
    console.log(`🌐 Otvori:    http://localhost:${config.PORT}`);
    console.log(`📚 Rečnik:    ${dictionary.size.toLocaleString('sr-RS')} reči`);
    console.log(`🔠 Stalak:    ${config.RACK_SIZE} slova`);
    console.log(`💾 Memorija:  ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
    console.log('═══════════════════════════════════════════');
});
