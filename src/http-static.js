'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * HTTP DEO SERVERA
 *
 * Ranije je ovo bio jedan dugačak if/else lanac u kome je svaka putanja
 * imala svoj prekopiran blok sa fs.readFileSync i ručno ispisanim
 * zaglavljima. Svaki zahtev je čitao ceo fajl sa diska i pritom blokirao
 * event loop - index.html (59 KB), style.css (25 KB) i izreke.txt (61 KB)
 * ponovo i ponovo, za svakog igrača.
 *
 * Sada je to tabela ruta plus keš u memoriji. Keš se proverava preko mtime
 * fajla, pa i dalje možeš da menjaš index.html ili style.css i samo osvežiš
 * stranicu - bez restarta servera - ali se fajl čita s diska tek kad se
 * stvarno promeni. Uz to ide i ETag, pa pregledač na drugom učitavanju
 * dobija 304 i ne skida ništa.
 */

// Podesivo: ako klijent i server nisu na istom domenu (Capacitor aplikacija
// koja se povezuje na Render), ovde se odobrava odredište WebSocket veze.
const CONNECT_SRC = process.env.CSP_CONNECT_SRC || "'self' ws: wss:";

const SECURITY_HEADERS = Object.freeze({
    'Content-Security-Policy': [
        "default-src 'self'",
        // Bez 'unsafe-inline': sav JS je u zasebnim fajlovima, a dugmad
        // se povezuju preko data-action atributa. Ovo je glavna zaštita
        // od XSS-a — ubačena skripta se više ne izvršava.
        "script-src 'self' https://cdn.socket.io",
        // 'unsafe-inline' ovde ostaje zbog preostalih style="" atributa
        // u index.html; da bi i ovo palo, ti stilovi bi morali u style.css.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src ${CONNECT_SRC}`,
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=15552000',
});

// no-cache ne znači "ne čuvaj" nego "pitaj pre upotrebe": pregledač zadrži
// kopiju i uz ETag dobije 304 bez ijednog bajta sadržaja. Ranije je bilo
// no-store, pa se index.html (59 KB) i style.css (25 KB) skidali iznova
// pri svakom otvaranju.
const REVALIDATE = 'no-cache';
const LONG_CACHE = 'public, max-age=86400';

/**
 * Bela lista posluženih fajlova.
 * Pošto se putanja NIKAD ne pravi od korisničkog unosa, izlazak iz
 * direktorijuma (../../etc/passwd) nije moguć.
 */
const ROUTES = new Map([
    ['/', { file: 'index.html', type: 'text/html; charset=utf-8', cache: REVALIDATE }],
    ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', cache: REVALIDATE }],
    ['/config.js', { file: 'config.js', type: 'text/javascript; charset=utf-8', cache: REVALIDATE }],
    ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8', cache: REVALIDATE }],
    ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8', cache: REVALIDATE }],
    ['/izreke.txt', { file: 'izreke.txt', type: 'text/plain; charset=utf-8', cache: 'public, max-age=300' }],
    ['/favicon.ico', { file: 'favicon.ico', type: 'image/x-icon', cache: LONG_CACHE }],
    ['/pravilaigre.png', { file: 'pravilaigre.png', type: 'image/png', cache: LONG_CACHE }],
    ['/menu-background.png', { file: 'menu-background.png', type: 'image/png', cache: LONG_CACHE }],
]);

/** filename -> { mtimeMs, size, body, etag } */
const cache = new Map();

function readCached(filename) {
    const fullPath = path.join(PUBLIC_DIR, filename);
    const stats = fs.statSync(fullPath);
    const cached = cache.get(filename);

    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached;
    }

    const entry = {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        body: fs.readFileSync(fullPath),
        etag: `W/"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`,
    };

    cache.set(filename, entry);
    return entry;
}

function sendJson(res, statusCode, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(statusCode, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': REVALIDATE,
    });
    res.end(body);
}

function sendText(res, statusCode, text) {
    const body = Buffer.from(text, 'utf8');
    res.writeHead(statusCode, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
    });
    res.end(body);
}

function createHttpServer({ statusPayload }) {
    return http.createServer((req, res) => {
        let pathname;
        try {
            pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        } catch {
            sendText(res, 400, 'Неисправна путања');
            return;
        }

        const isHead = req.method === 'HEAD';
        if (req.method !== 'GET' && !isHead) {
            res.writeHead(405, { ...SECURITY_HEADERS, 'Allow': 'GET, HEAD' });
            res.end();
            return;
        }

        // Render i slični PaaS-ovi zovu health check putanju.
        if (pathname === '/healthz') {
            sendText(res, 200, 'ok');
            return;
        }

        if (pathname === '/status') {
            sendJson(res, 200, statusPayload());
            return;
        }

        const route = ROUTES.get(pathname);
        if (!route) {
            sendText(res, 404, 'Страница не постоји');
            return;
        }

        let entry;
        try {
            entry = readCached(route.file);
        } catch (err) {
            console.error(`❌ Ne mogu da poslužim ${route.file}:`, err.message);
            sendText(res, 404, `${route.file} није пронађен`);
            return;
        }

        // Nepromenjeno od poslednjeg puta - pregledač već ima kopiju.
        if (req.headers['if-none-match'] === entry.etag) {
            res.writeHead(304, { ...SECURITY_HEADERS, 'ETag': entry.etag, 'Cache-Control': route.cache });
            res.end();
            return;
        }

        res.writeHead(200, {
            ...SECURITY_HEADERS,
            'Content-Type': route.type,
            'Content-Length': entry.body.length,
            'Cache-Control': route.cache,
            'ETag': entry.etag,
        });

        res.end(isHead ? undefined : entry.body);
    });
}

module.exports = {
    createHttpServer,
    SECURITY_HEADERS,
    PUBLIC_DIR,
};
