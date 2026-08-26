// ==================== ЦЕНТРАЛНА КОНФИГУРАЦИЈА ====================
// Све подесиве вредности су на једном месту, са различитим подразумеваним
// вредностима за локални развој и за продукцију.
//
// DEV режим се укључује на било који од ова три начина:
//   node server.js --dev
//   NODE_ENV=development node server.js
//   SMEHALICA_DEV=1 node server.js

const path = require('path');

const IS_DEV =
    process.argv.includes('--dev') ||
    process.env.NODE_ENV === 'development' ||
    process.env.SMEHALICA_DEV === '1';

// Помоћне: чита env вредност ако постоји, иначе враћа подразумевану
function num(envName, fallback) {
    const raw = process.env[envName];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(envName, fallback) {
    const raw = process.env[envName];
    if (raw === undefined || raw === '') return fallback;
    return raw === '1' || raw.toLowerCase() === 'true';
}

// ==================== ПУТАЊЕ ====================
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// Речник: у DEV режиму подразумевано користи мали serbian-words-dev.txt
// ради бржег стартовања. Прекидач --full-dict тера пун речник и у DEV-у
// (нпр. кад тестираш да ли се неке речи признају).
const FORCE_FULL_DICT = process.argv.includes('--full-dict');

const DEFAULT_DICT = (IS_DEV && !FORCE_FULL_DICT)
    ? 'serbian-words-dev.txt'
    : 'serbian-words.txt';

const DICT_PATH = path.resolve(
    ROOT_DIR,
    process.env.DICT_PATH || DEFAULT_DICT
);

// Ако DEV речник не постоји, сервер ће пасти назад на пуни (види dictionary fallback у server.js)
const DICT_FALLBACK_PATH = path.join(ROOT_DIR, 'serbian-words.txt');

// ==================== МРЕЖА ====================
// HOST '0.0.0.0' значи да можеш да отвориш игру и са телефона на истом Wi-Fi-ју
const PORT = num('PORT', 3000);
const HOST = process.env.HOST || (IS_DEV ? '0.0.0.0' : '0.0.0.0');

// ==================== ПРАВИЛА ИГРЕ / ТАЈМИНЗИ ====================
// Величина табле се НЕ дефинише овде — то је правило игре, не подешавање.
// Извор истине је game-rules.js; овде се само прослеђује даље.
const { BOARD_SIZE } = require('./game-rules');

// Колико сервер чека пре аутоматске предаје након прекида везе.
// У DEV-у кратко, да не чекаш 5 минута при тестирању reconnect-а.
const DISCONNECT_GRACE_MS = num(
    'DISCONNECT_GRACE_MS',
    IS_DEV ? 20 * 1000 : 5 * 60 * 1000
);

const CLEANUP_INTERVAL_MS = num(
    'CLEANUP_INTERVAL_MS',
    IS_DEV ? 60 * 1000 : 5 * 60 * 1000
);

// Пауза између тражења нове партије. У DEV-у 0 да можеш да спамујеш дугме.
const COOLDOWN_MS = num('COOLDOWN_MS', IS_DEV ? 0 : 10 * 1000);

// ==================== ЛИМИТИ КОНЕКЦИЈА (DoS заштита) ====================
// У DEV-у су по-IP лимити практично искључени јер све конекције долазе
// са исте адресе (127.0.0.1) — иначе би те блокирало већ после неколико табова.
const MAX_CONCURRENT_PER_IP = num(
    'MAX_CONCURRENT_PER_IP',
    IS_DEV ? 1000 : 20
);

const MAX_NEW_CONN_PER_WINDOW = num(
    'MAX_NEW_CONN_PER_WINDOW',
    IS_DEV ? 1000 : 30
);

const CONN_WINDOW_MS = num('CONN_WINDOW_MS', 60 * 1000);

const MAX_TOTAL_CONCURRENT = num(
    'MAX_TOTAL_CONCURRENT',
    IS_DEV ? 5000 : 500
);

// Потпуно прескакање по-IP провере у DEV режиму
const ENFORCE_IP_LIMITS = bool('ENFORCE_IP_LIMITS', !IS_DEV);

// ==================== РЕЧНИК ====================
// Hot-reload речника: гледање 26MB фајла сваке секунде је непотребно у продукцији,
// али је корисно локално док додајеш речи.
const WATCH_DICTIONARY = bool('WATCH_DICTIONARY', IS_DEV);
const DICT_WATCH_INTERVAL_MS = num('DICT_WATCH_INTERVAL_MS', 1000);

// ==================== БЕЗБЕДНОСНИ HEADER-И ====================
// НАПОМЕНА: 'unsafe-inline' је и даље неопходан јер index.html користи
// inline onclick="" атрибуте и inline <script> блокове. XSS је затворен
// escape-овањем у addChatMessage() и белом листом у sanitizePlayerName().
//
// У DEV-у connect-src мора да дозволи ws://localhost, иначе браузер
// блокира WebSocket ка локалном серверу.
function buildSecurityHeaders() {
    // У DEV-у се додаје https://cdn.socket.io јер DevTools покушава да
    // повуче socket.io.min.js.map (source map) преко fetch-а, што пада
    // под connect-src. Без овога конзола је пуна CSP грешака иако игра
    // ради нормално — само отежава уочавање правих грешака.
    const connectSrc = IS_DEV
        ? "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://cdn.socket.io"
        : "connect-src 'self'";

    const headers = {
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.socket.io",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            connectSrc,
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'"
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
    };

    // HSTS има смисла само преко HTTPS-а. Локално преко http:// само смета
    // (браузер запамти домен и после одбија http на localhost).
    if (!IS_DEV) {
        headers['Strict-Transport-Security'] = 'max-age=15552000';
    }

    return headers;
}

module.exports = {
    IS_DEV,
    ROOT_DIR,
    PUBLIC_DIR,
    DICT_PATH,
    DICT_FALLBACK_PATH,
    PORT,
    HOST,
    BOARD_SIZE,
    DISCONNECT_GRACE_MS,
    CLEANUP_INTERVAL_MS,
    COOLDOWN_MS,
    MAX_CONCURRENT_PER_IP,
    MAX_NEW_CONN_PER_WINDOW,
    CONN_WINDOW_MS,
    MAX_TOTAL_CONCURRENT,
    ENFORCE_IP_LIMITS,
    WATCH_DICTIONARY,
    DICT_WATCH_INTERVAL_MS,
    SECURITY_HEADERS: buildSecurityHeaders()
};
