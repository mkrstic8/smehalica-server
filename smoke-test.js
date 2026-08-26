// Аутоматска провера да локална поставка ради: диже сервер, повеже два
// клијента, спари их, одигра потез и провери HTTP руте.
// Покретање: node smoke-test.js

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const results = [];

function ok(name, cond, extra = '') {
    results.push({ name, cond });
    console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

function get(p) {
    return new Promise((resolve) => {
        http.get(`${BASE}${p}`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', (e) => resolve({ status: 0, headers: {}, body: String(e) }));
    });
}

function waitForServer(timeoutMs = 30000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        (function poll() {
            get('/health').then(r => {
                if (r.status === 200) return resolve();
                if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
                setTimeout(poll, 300);
            });
        })();
    });
}

(async () => {
    server = spawn('node', ['server.js', '--dev'], {
        cwd: __dirname,
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let serverLog = '';
    server.stdout.on('data', d => serverLog += d);
    server.stderr.on('data', d => serverLog += d);

    try {
        await waitForServer();
    } catch (e) {
        console.error('❌ Сервер се није подигао:\n', serverLog);
        process.exit(1);
    }

    // ---------- HTTP руте ----------
    const routes = [
        ['/', 200], ['/index.html', 200], ['/style.css', 200],
        ['/izreke.txt', 200], ['/favicon.ico', 200],
        ['/menu-background.png', 200], ['/pravilaigre.png', 200],
        ['/status', 200], ['/health', 200], ['/nepostoji', 404]
    ];
    for (const [p, expected] of routes) {
        const r = await get(p);
        ok(`HTTP ${p} → ${expected}`, r.status === expected, `добијено ${r.status}`);
    }

    // ---------- Path traversal ----------
    // НАПОМЕНА: не користи /../config.js — public/config.js стварно постоји,
    // па HTTP клијент нормализује путању у /config.js и добије тај фајл.
    // То није пробој, али тест би лажно пао. Мете морају бити фајлови
    // којих НЕМА у public/.
    for (const p of ['/../server.js', '/..%2fserver.js', '/../../etc/passwd', '/../game-rules.js']) {
        const r = await get(p);
        ok(`Блокиран traversal ${p}`, r.status !== 200, `статус ${r.status}`);
    }

    // ---------- Header-и ----------
    const root = await get('/');
    const csp = root.headers['content-security-policy'] || '';
    ok('CSP дозвољава ws: у DEV режиму', csp.includes('ws:'));
    ok('HSTS искључен у DEV режиму', !root.headers['strict-transport-security']);
    ok('index.html се не кешира', /no-store/.test(root.headers['cache-control'] || ''));

    const status = JSON.parse((await get('/status')).body);
    ok('/status враћа режим "development"', status.mode === 'development');
    ok('/status има учитан речник', status.dictionarySize > 0, `${status.dictionarySize} речи`);

    // ---------- Socket.IO: два играча ----------
    const io = require('socket.io-client');

    function connect(label) {
        return new Promise((resolve) => {
            const s = io(BASE, { auth: { sessionToken: null }, transports: ['websocket'] });
            s.on('connected', (data) => resolve({ socket: s, data, label }));
        });
    }

    const p1 = await connect('Играч 1');
    const p2 = await connect('Играч 2');

    ok('Оба клијента добила playerId', !!p1.data.playerId && !!p2.data.playerId);
    ok('Играчи имају РАЗЛИЧИТЕ sessionToken-е',
        p1.data.sessionToken !== p2.data.sessionToken);

    p1.socket.emit('set_name', { name: 'Пера' });
    p2.socket.emit('set_name', { name: 'Мика' });

    // Брзо спаривање
    const started = new Promise((resolve) => {
        let count = 0;
        const onStart = (d) => { if (++count === 2) resolve(d); };
        p1.socket.on('game_start', onStart);
        p2.socket.on('game_start', onStart);
    });

    p1.socket.emit('quick_match');
    setTimeout(() => p2.socket.emit('quick_match'), 200);

    const timeout = new Promise(r => setTimeout(() => r(null), 8000));
    const startData = await Promise.race([started, timeout]);

    ok('Брзо спаривање покренуло партију', !!startData);

    if (startData) {
        // Ко је на потезу
        const state1 = await new Promise(r => {
            p1.socket.once('game_state', r);
            p1.socket.emit('get_state');
        });
        const { BOARD_SIZE } = require('./game-rules');
        ok(`game_state садржи таблу ${BOARD_SIZE}x${BOARD_SIZE}`,
            Array.isArray(state1.board) &&
            state1.board.length === BOARD_SIZE &&
            state1.board.every(r => r.length === BOARD_SIZE));
        ok('Играч има 8 плочица у сталку',
            Array.isArray(state1.yourRack) && state1.yourRack.length === 8,
            `${state1.yourRack ? state1.yourRack.length : '?'}`);

        // Проба преласка реда (skip) — најбезбеднији потез за аутоматски тест
        const mover = state1.isYourTurn ? p1 : p2;
        const turnBefore = state1.currentTurn;

        // Сервер одговара догађајем 'turn_skipped' (или 'game_over')
        const afterSkip = await new Promise((resolve) => {
            const t = setTimeout(() => resolve(null), 5000);
            const done = (s) => { clearTimeout(t); resolve(s); };
            mover.socket.once('turn_skipped', done);
            mover.socket.once('game_over', done);
            mover.socket.emit('skip_turn');
        });

        ok('skip_turn враћа ново стање', !!afterSkip);
        ok('skip_turn мења ред противнику',
            !!afterSkip && afterSkip.currentTurn !== turnBefore);

        // Чет
        const chatPromise = new Promise(r => {
            p2.socket.once('chat_message', r);
            setTimeout(() => r(null), 3000);
        });
        p1.socket.emit('chat', { text: 'Здраво!' });
        const chat = await chatPromise;
        ok('Чет порука стиже до противника', !!chat);
    }

    p1.socket.close();
    p2.socket.close();

    setTimeout(() => {
        server.kill('SIGKILL');
        const failed = results.filter(r => !r.cond).length;
        console.log('\n' + '─'.repeat(45));
        console.log(`Прошло: ${results.length - failed}/${results.length}`);
        if (failed) {
            console.log('\nЛог сервера:\n' + serverLog.slice(-2000));
        }
        console.log('─'.repeat(45));
        process.exit(failed ? 1 : 0);
    }, 500);
})();
