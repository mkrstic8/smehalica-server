/* =========================================================
   СМЕХАЛИЦА УКРШТЕНИЦА — клијент

   Издвојено из index.html без иједне измене понашања, да би
   Content-Security-Policy могао да одбаци 'unsafe-inline' за скрипте.
   Адреса сервера се и даље мења САМО у config.js.
   ========================================================= */

        // ==================== KONEKCIJA ====================
        // Празно у config.js = исти origin са кога је страница учитана
        // (локално: http://localhost:3000). За Render само упиши адресу у
        // public/config.js — овде не треба ништа дирати.
        const SERVER_URL =
            (window.SMEHALICA_CONFIG && window.SMEHALICA_CONFIG.SERVER_URL) ||
            window.location.origin;
        
        // Trajni playerId i playerName
        let playerId = localStorage.getItem('smehalica_playerId');
        let sessionToken = localStorage.getItem('smehalica_sessionToken');
        let myName = localStorage.getItem('smehalica_playerName') || 'Играч';

        const socket = io(SERVER_URL, {
            auth: {
                sessionToken: sessionToken || null
            },
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: Infinity,
            timeout: 10000
        });

        // ==================== STANJE ====================
        let gameId = null;
        let myRack = [];
        let isMyTurn = false;
        let lastServerStateVersion = -1;
        let selectedTileIndex = null;
        let newlyPlacedCells = [];
        let gameActive = false;
        let gameIsOver = false;
        let lastMoveCells = [];
        let currentBoardState = null;
        let myRoomLink = null;


        // ==================== СРПСКЕ ИЗРЕКЕ ====================
        let poslovice = [];

        async function ucitajIzreke() {
            try {
                const response = await fetch('izreke.txt');

                if (!response.ok) {
                    throw new Error('Фајл izreke.txt није пронађен');
                }

                const text = await response.text();

                poslovice = text
                    .split(/\r?\n/)
                    .map(izreka => izreka.trim())
                    .filter(izreka => izreka.length > 0);

                console.log(`✅ Учитано изрека: ${poslovice.length}`);
            } catch (error) {
                console.error('❌ Грешка при учитавању изрека:', error);
            }
        }
        const letterValues = {
            'А': 1, 'Б': 3, 'В': 2, 'Г': 3, 'Д': 2, 'Ђ': 6, 'Е': 1, 'Ж': 4, 'З': 3,
            'И': 1, 'Ј': 2, 'К': 2, 'Л': 2, 'Љ': 4, 'М': 2, 'Н': 1, 'Њ': 5, 'О': 1,
            'П': 2, 'Р': 1, 'С': 1, 'Т': 1, 'Ћ': 5, 'У': 2, 'Ф': 8, 'Х': 6, 'Ц': 4,
            'Ч': 4, 'Џ': 10, 'Ш': 4
        };

                // ==================== COOLDOWN SISTEM ====================
        let cooldownEndTime = 0;
        let cooldownInterval = null;

        function getCooldownButtons() {
            return [
                document.getElementById('btnQuickMatch'),
                document.getElementById('btnCreateRoom'),
                document.getElementById('btnJoinRoomMenu')
            ].filter(Boolean);
        }

        function startCooldown(seconds) {
            cooldownEndTime = Date.now() + seconds * 1000;
            localStorage.setItem('smehalica_cooldownEnd', String(cooldownEndTime));
            tickCooldown();
        }

        function tickCooldown() {
            const buttons = getCooldownButtons();
            const remaining = Math.ceil((cooldownEndTime - Date.now()) / 1000);

            if (remaining > 0) {
                buttons.forEach(b => {
                    if (!b.dataset.originalText) b.dataset.originalText = b.textContent;
                    b.disabled = true;
                    b.textContent = `⏳ Сачекај ${remaining}с`;
                });
                if (!cooldownInterval) {
                    cooldownInterval = setInterval(tickCooldown, 500);
                }
            } else {
                clearInterval(cooldownInterval);
                cooldownInterval = null;
                localStorage.removeItem('smehalica_cooldownEnd');
                buttons.forEach(b => {
                    b.disabled = false;
                    if (b.dataset.originalText) b.textContent = b.dataset.originalText;
                });
            }
        }

        function restoreCooldownFromStorage() {
            const saved = parseInt(localStorage.getItem('smehalica_cooldownEnd') || '0', 10);
            if (saved > Date.now()) {
                cooldownEndTime = saved;
                tickCooldown();
            }
        }
            // ==================== AdMob MONETIZACIJA ====================
        const TEST_MODE = true;
        let adMobInitialized = false;
        let interstitialReady = false;

        async function initAdMob() {
            try {
                console.log('📱 Inicijalizacija AdMob...');
                const { AdMob } = Capacitor.Plugins;
                await AdMob.initialize();
                adMobInitialized = true;
                console.log('✅ AdMob inicijalizovan');
            } catch (error) {
                console.error('❌ AdMob init greška:', error);
            }
        }

        async function showInterstitial() {
    if (!adMobInitialized) {
        console.warn('⚠️ AdMob još nije inicijalizovan, preskačem reklamu.');
        return;
    }
    try {
        console.log('📱 Prikazujem interstitial...');
        const { AdMob } = Capacitor.Plugins;
        await AdMob.prepareInterstitial({
            adId: TEST_MODE 
                ? 'ca-app-pub-3940256099942544/1033173712'
                : 'ca-app-pub-7529348168507963/2173800368',
            isTesting: TEST_MODE,
        });
        await AdMob.showInterstitial();
        console.log('✅ Interstitial prikazan!');
    } catch (error) {
        console.error('❌ Interstitial greška:', error);
    }
}
        // Pokreni AdMob samo na native platformi (Android/iOS)
        document.addEventListener('DOMContentLoaded', () => {
            if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
                initAdMob();
            } else {
                console.log('ℹ️ Nije native platforma — AdMob preskočen');
            }
        });
        // ==================== POMOĆNE FUNKCIJE ====================
        function sendMessage(type, data = {}) {
            if (socket.connected) {
                socket.emit(type, data);
            } else {
                console.warn('Socket nije povezan');
            }
        }

        function showScreen(screenId) {
            document.body.classList.toggle('game-active', screenId === 'game');
            document.querySelectorAll('.overlay-content').forEach(el => el.style.display = 'none');
            document.getElementById('nameOverlay').style.display = 'none';
            document.getElementById('gameContainer').style.display = 'none';
            
            if (screenId === 'game') {
                document.getElementById('gameContainer').style.display = 'flex';
                document.getElementById('nameOverlay').style.display = 'none';
            } else {
                document.getElementById('nameOverlay').style.display = 'flex';
                if (screenId) {
                    document.getElementById(screenId).style.display = 'block';
                }
            }
        }

        // ==================== SOCKET EVENTI ====================
socket.on('connect', () => {

    console.log('🟢 Socket повезан');

    document.getElementById('connectionStatus').innerHTML =
        '<span class="connection-dot connected"></span> Повезан';

    if (myName && myName !== 'Играч') {
        sendMessage('set_name', {
            name: myName
        });
    }

    // Ако је Android направио потпуно нови Socket.IO
    // након што је апликација враћена из background-а,
    // socket.io.on('reconnect') не мора бити позван.
    //
    // Зато и овде тражимо стање.
    if (
        wasInActiveGameBeforeDisconnect &&
        !gameIsOver
    ) {
        console.log(
            '📡 CONNECT после прекида — тражим актуелно стање.'
        );

        setTimeout(() => {
            requestStateFromServer();
        }, 300);
    }
});

let wasInActiveGameBeforeDisconnect = false;

socket.on('disconnect', (reason) => {
    console.log('🔴 Socket diskonektovan:', reason);

    // Запамти да смо били у активној игри.
    // НЕ постављај gameActive = false!
    if (gameActive && !gameIsOver) {
        wasInActiveGameBeforeDisconnect = true;
    }

    document.getElementById('connectionStatus').innerHTML =
        '<span class="connection-dot disconnected"></span> Веза прекинута...';
});

socket.on('connected', (data) => {
    playerId = data.playerId;
    sessionToken = data.sessionToken;
    socket.auth.sessionToken = sessionToken;   // ← ДОДАТИ
    localStorage.setItem(
        'smehalica_playerId',
        playerId
    );

    localStorage.setItem(
        'smehalica_sessionToken',
        sessionToken
    );

    console.log('🔑 Играч повезан');
});

        socket.on('error', (data) => {
            console.error('Server greška:', data.message);
            errorMsg(data.message);
            if (data.cooldownSeconds) {
                startCooldown(data.cooldownSeconds);
            }
            if (moveInFlight) {                // ← ДОДАТИ
                 moveInFlight = false;
                requestStateFromServer();
            }
        });

        socket.on('game_start', (msg) => {
            startGame(msg);
        });
        socket.on('find_cancelled', (msg) => {
                startCooldown(msg.cooldownSeconds || 10);       
         });

        socket.on('move_result', (msg) => {
    moveInFlight = false;
    updateGameState(msg);
    if (msg.lastMoveWords && msg.lastMoveWords.length > 0) {
        const isMyMove = msg.lastMovePlayerName === myName;
        if (isMyMove) {
            sfxValid();
            if (msg.lastMove && msg.lastMove.placements) {
                msg.lastMove.placements.forEach(p => {
                    animateCell(p.row, p.col, 'bounce');
                });
            }
        } else {
            sfxOpponent();
        }
    }
});

        socket.on('move_invalid', (msg) => {
            moveInFlight = false;
            sfxInvalid();
            submittedCells.forEach(p => animateCell(p.row, p.col, 'shake'));            errorMsg('❌' + msg.error);
            requestStateFromServer();
        });

        socket.on('turn_skipped', (msg) => {
            updateGameState(msg);
            addChatSystemMsg(`${msg.skippedByName} прескаче потез.`);
        });

        socket.on('game_over', (msg) => {
            moveInFlight = false;
            if (!gameActive && !gameIsOver) {
                // Igra je završena dok nismo bili povezani - prikaži je sada
                showScreen('game');
                document.getElementById('yourNameLabel').textContent = '👤 ' + myName;
                document.getElementById('opponentNameLabel').textContent = '🤖 ' + (msg.opponentName || 'Противник');
            }
            updateGameState(msg);
            showGameOver(msg);
            if (msg.resultMessage && msg.resultMessage.includes('Победио')) {
                sfxWin();
                setTimeout(spawnConfetti, 500);
            }
        });
        socket.on('game_state', (msg) => {
            if (msg.status === 'active' && !gameActive) {
                // Ovo je rekonекcija — prikaži tablu bez poruke "Игра почиње"
                startGame(msg, true);
            } else {
                // Inače samo osveži stanje
                updateGameState(msg);
            }
        });

        socket.on('opponent_typing', () => {
            const el = document.getElementById('typingIndicator');
            el.style.display = 'block';
            if (window.typingTimeout) clearTimeout(window.typingTimeout);
            window.typingTimeout = setTimeout(() => { el.style.display = 'none'; }, 3000);
        });

        socket.on('chat_message', (msg) => {
            // Proveri da li poruka već postoji u istoriji (deduplikacija)
            const exists = chatHistory.some(m =>
                m.timestamp === msg.timestamp &&
                m.from === msg.from &&
                m.text === msg.text
            );

            if (!exists) {
                chatHistory.push(msg);
                addChatMessage(msg.from, msg.text);
            }
        });
        socket.on('room_created', (msg) => {
            myRoomLink = msg.roomLink;
            document.getElementById('roomLinkDisplay').textContent = msg.roomLink;
            document.getElementById('roomStatus').textContent = msg.message;
            document.getElementById('copyLinkBtn').style.display = 'block';
        });

        socket.on('opponent_left', (msg) => {
            removeRematchButton();
            const oldMenuBtn3 = document.getElementById('menuBtn');
            if (oldMenuBtn3) oldMenuBtn3.remove();
            const controls = document.querySelector('.controls');
            let menuBtn2 = document.getElementById('menuBtn');
            if (!menuBtn2) {
                menuBtn2 = document.createElement('button');
                menuBtn2.id = 'menuBtn';
                menuBtn2.className = 'btn-light';
                menuBtn2.textContent = '🏠 ПОЧЕТНИ МЕНИ';
                menuBtn2.onclick = () => goToMainMenu();
                controls.appendChild(menuBtn2);
            }
            permanentMsg('🚪 Противник је напустио игру.');
        });

        socket.on('rematch_request', (msg) => {
            showRematchRequest(msg);
        });

        socket.on('rematch_accepted', (msg) => {
            hideRematchRequest();
            addChatSystemMsg('🔄 Реванш прихваћен! Нова игра почиње.');
            removeRematchButton();
        });

        socket.on('rematch_declined', (msg) => {
            hideRematchRequest();
            addChatSystemMsg('❌ Реванш одбијен.');
            setMessage('❌ ' + msg.message, 'info', 3000);
            removeRematchButton(); // уклања се реванш, остаје menuBtn
        });
        socket.on('rematch_sent', (msg) => {
            setMessage(msg.message, 'info', 2000);
        });

        socket.on('pong', () => {});

        socket.io.on('reconnect_attempt', (attempt) => {
            document.getElementById('connectionStatus').innerHTML =
                `<span class="connection-dot disconnected"></span> Покушавам поновну везу (${attempt})...`;
        });

socket.io.on('reconnect', () => {

    document.getElementById('connectionStatus').innerHTML =
        '<span class="connection-dot connected"></span> Веза обновљена!';

    console.log('🔄 Socket.IO reconnect успешан.');

    if (
        wasInActiveGameBeforeDisconnect &&
        !gameIsOver
    ) {

        // Одмах тражимо серверско стање.
        requestStateFromServer();

        // Додатна провера након кратког времена.
        setTimeout(() => {
            if (
                socket.connected &&
                gameActive &&
                !gameIsOver
            ) {
                requestStateFromServer();
            }
        }, 1000);
    }
});
        
        socket.on('opponent_disconnected', (msg) => {
            permanentMsg('⚠ ' + msg.message);
        });

        socket.on('opponent_reconnected', (msg) => {
            successMsg('✅ ' + msg.message);
        });

        // ==================== INICIJALIZACIJA ====================
        function initialSetup() {
            // Ako imamo sačuvano ime, automatski pošalji i preskoči ekran za ime
            if (myName && myName !== 'Играч') {
                document.getElementById('nameInput').value = myName;
                showScreen('optionsScreen');
                sendMessage('set_name', { name: myName });
            } else {
                showScreen('nameScreen');
            }
        restoreCooldownFromStorage();   // <-- DODATO
        }

        // ==================== UI FUNKCIJE ====================
        function showGameOptions() {
            sfxMenuClick();
            myName = document.getElementById('nameInput').value.trim() || 'Играч';
            localStorage.setItem('smehalica_playerName', myName);
            sendMessage('set_name', { name: myName });
            showScreen('optionsScreen');
        }
        
        function goBackToName() {
            sfxMenuClick();
            showScreen('nameScreen');
        }
        
        function goBackToOptions() {
            sfxMenuClick();
            document.getElementById('btnQuickMatch').disabled = false;   // ✅ dodato
            showScreen('optionsScreen');
        }
        
        async function quickMatch() {
            sfxMenuClick();
            document.getElementById('optionsScreen').style.display = 'none';
            document.getElementById('findingScreen').style.display = 'block';
            showScreen('findingScreen');

            // Учитај изреке
            if (poslovice.length === 0) {
                await ucitajIzreke();
            }

            // Прикажи насумичну изреку
            if (poslovice.length > 0) {
                const randomIzreka =
                    poslovice[Math.floor(Math.random() * poslovice.length)];
                    document.getElementById('proverbText').innerHTML = `<strong>„${randomIzreka}“</strong><br>Народна изрека`;
            }

            // Тражи противника
            sendMessage('quick_match');
        }
        
        function showCreateRoom() {
            sfxMenuClick();
            showScreen('createRoomScreen');
            document.getElementById('roomStatus').textContent = 'Креирам собу...';
            sendMessage('create_room');
        }
        
        function showJoinRoom() {
            sfxMenuClick();
            showScreen('joinRoomScreen');
            document.getElementById('roomLinkInput').value = '';
            document.getElementById('joinStatus').textContent = '';
        }
        
        function joinRoom() {
            const link = document.getElementById('roomLinkInput').value.trim().toUpperCase();
            if (link.length !== 5) {
                document.getElementById('joinStatus').textContent = 'Линк мора имати 5 слова!';
                return;
            }
            document.getElementById('joinStatus').textContent = 'Придруживање...';
            sendMessage('join_room', { roomLink: link });
        }
        
        function copyRoomLink() {
            if (myRoomLink) {
                navigator.clipboard.writeText(myRoomLink).then(() => {
                    document.getElementById('roomStatus').textContent = 'Линк копиран! ✓';
                }).catch(() => {
                    document.getElementById('roomStatus').textContent = 'Линк: ' + myRoomLink;
                });
            }
        }
        
        function cancelRoom() {
            sendMessage('cancel_find');
            showScreen('optionsScreen');
            myRoomLink = null;
            }   

        function cancelFind() {
            sendMessage('cancel_find');
            showScreen('optionsScreen');
        }

function startGame(msg, isResume = false) {

    // Потпуно ресетуј локално стање за нову игру
    lastServerStateVersion = -1;
    currentBoardState = null;
    newlyPlacedCells = [];
    selectedTileIndex = null;
    myRack = [];
    isMyTurn = false;
    gameIsOver = false;
    gameActive = true;

    removeRematchButton();

    const oldMenuBtn = document.getElementById('menuBtn');
    if (oldMenuBtn) oldMenuBtn.remove();

    showAllActionButtons();

    showScreen('game');

    gameId = msg.gameId;

    document.getElementById('yourNameLabel').textContent = '👤 ' + myName;
    document.getElementById('opponentNameLabel').textContent =
    '🤖 ' + msg.opponentName;
    document.getElementById('opponentNameLabel').textContent =
        '🤖 ' + msg.opponentName;

    updateGameState(msg);

    if (isResume) {
        setMessage(
            '🔄 Веза обновљена, игра настављена.',
            'info',
            3000
        );
    } else {
        setMessage(
            '🎮 Игра почиње! ' +
            (msg.isYourTurn
                ? 'Ти си на потезу.'
                : 'Противник је на потезу.'),
            'info',
            3000
        );
    }

    if (!isResume &&
        msg.lastMove &&
        msg.lastMove.words &&
        msg.lastMove.words.length > 0) {

        const isMyLastMove = msg.lastMove.playerId === playerId;

        if (isMyLastMove) {
            addChatSystemMsg(
                `🎯 Ти играш: ${msg.lastMove.words.join(', ')} (+${msg.lastMove.score})`
            );
        } else {
            addChatSystemMsg(
                `${msg.opponentName || 'Противник'} игра: ${msg.lastMove.words.join(', ')} (+${msg.lastMove.score})`
            );
        }
    }
}
 function updateGameState(msg) {

    // ---------------------------------------------
    // ЗАШТИТА ОД СТАРОГ СТАЊА
    // ---------------------------------------------

    if (msg.stateVersion !== undefined) {

        // Ако је нова игра, ресетуј бројач.
        if (msg.gameId && msg.gameId !== gameId) {
            lastServerStateVersion = -1;
        }

        const incomingVersion = Number(msg.stateVersion);

        // Не прихватај старије стање.
        if (
            Number.isFinite(incomingVersion) &&
            incomingVersion < lastServerStateVersion
        ) {
            console.warn(
                '⚠️ Игнорисано старо game_state:',
                incomingVersion,
                '<',
                lastServerStateVersion
            );
            return;
        }

        lastServerStateVersion = incomingVersion;

        console.log(
            `📥 SERVER STATE | game=${msg.gameId} | ` +
            `version=${incomingVersion} | ` +
            `isYourTurn=${msg.isYourTurn} | ` +
            `currentTurn=${msg.currentTurn}`
        );
    }

    // ---------------------------------------------
    // ТАБЛА
    // ---------------------------------------------

    if (msg.board) {
        renderBoardFromState(msg.board);
    }

    // ---------------------------------------------
    // РУКА
    // ---------------------------------------------

    if (msg.yourRack) {
        myRack = [...msg.yourRack];
    }

    // ---------------------------------------------
    // ПОЕНИ
    // ---------------------------------------------

    if (msg.yourScore !== undefined) {
        document.getElementById('yourScore').textContent =
            msg.yourScore;
    }

    if (msg.opponentScore !== undefined) {
        document.getElementById('opponentScore').textContent =
            msg.opponentScore;
    }

    if (msg.bagCount !== undefined) {
        document.getElementById('tilesLeft').textContent =
            msg.bagCount;
    }

    // ---------------------------------------------
    // ПОТЕЗ
    // ---------------------------------------------

    if (msg.isYourTurn !== undefined) {

        // ЈЕДИНИ извор истине је сервер.
        isMyTurn = Boolean(msg.isYourTurn);

        updateTurnIndicator(isMyTurn);

        const btnSubmit =
            document.getElementById('btnSubmit');

        const btnSkip =
            document.getElementById('btnSkip');

        const btnRecall =
            document.getElementById('btnRecall');

        if (btnSubmit) {
            btnSubmit.disabled = !isMyTurn;
        }

        if (btnSkip) {
            btnSkip.disabled = !isMyTurn;
        }

        if (btnRecall) {
            btnRecall.disabled = !isMyTurn;
        }
    }

    // ---------------------------------------------
    // CHAT
    // ---------------------------------------------

    if (msg.chatMessages) {
        chatHistory = msg.chatMessages;
        renderChatHistory();
    }

    // ---------------------------------------------
    // GAME OVER
    // ---------------------------------------------

    if (msg.gameOver) {
        gameIsOver = true;
        gameActive = false;

        document.getElementById('btnSubmit').disabled = true;
        document.getElementById('btnSkip').disabled = true;
        document.getElementById('btnRecall').disabled = true;
    }

    // ---------------------------------------------
    // ПОСЛЕДЊИ ПОТЕЗ
    // ---------------------------------------------

    if (msg.lastMove && msg.lastMove.placements) {
        lastMoveCells = msg.lastMove.placements.map(
            p => ({
                row: p.row,
                col: p.col
            })
        );
    } else {
        lastMoveCells = [];
    }

    newlyPlacedCells = [];
    selectedTileIndex = null;

    renderMyRack();
}
        function renderBoardFromState(boardState) {
            currentBoardState = boardState;
            const boardEl = document.getElementById('board');
            boardEl.innerHTML = '';

            const bonusBoard = [
    ['', 'TW', '', '', '', '', '', 'DW', '', '', '', '', '', 'TW', ''],
    ['TW', '', '', '', 'DW', '', '', '', '', '', 'DW', '', '', '', 'TW'],
    ['', '', '', 'DW', '', '', 'TL', '', 'TL', '', '', 'DW', '', '', ''],
    ['', '', 'DW', '', '', 'DL', '', '', '', 'DL', '', '', 'DW', '', ''],
    ['', 'DW', '', '', 'TL', '', '', '', '', '', 'TL', '', '', 'DW', ''],
    ['', '', '', 'DL', '', '', 'DL', '', 'DL', '', '', 'DL', '', '', ''],
    ['', '', 'TL', '', '', 'DL', '', '', '', 'DL', '', '', 'TL', '', ''],
    ['DW', '', '', '', '', '', '', '❖', '', '', '', '', '', '', 'DW'],
    ['', '', 'TL', '', '', 'DL', '', '', '', 'DL', '', '', 'TL', '', ''],
    ['', '', '', 'TL', '', '', 'DL', '', 'DL', '', '', 'DL', '', '', ''],
    ['', 'DW', '', '', 'TL', '', '', '', '', '', 'TL', '', '', 'DW', ''],
    ['', '', 'DW', '', '', 'DL', '', '', '', 'DL', '', '', 'DW', '', ''],
    ['', '', '', 'DW', '', '', 'TL', '', 'TL', '', '', 'DW', '', '', ''],
    ['TW', '', '', '', 'DW', '', '', '', '', '', 'DW', '', '', '', 'TW'],
    ['', 'TW', '', '', '', '', '', 'DW', '', '', '', '', '', 'TW', ''],
];

            for (let r = 0; r < 15; r++) {
                for (let c = 0; c < 15; c++) {
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    const bonus = bonusBoard[r][c];
                    if (bonus === 'TW') cell.classList.add('tw');
                    else if (bonus === 'DW') cell.classList.add('dw');
                    else if (bonus === 'TL') cell.classList.add('tl');
                    else if (bonus === 'DL') cell.classList.add('dl');
                    else if (bonus === '❖') cell.classList.add('star');

                    if (boardState[r] && boardState[r][c]) {
                        cell.textContent = boardState[r][c].letter;
                        cell.classList.add('occupied');
                        const pointSpan = document.createElement('span');
                        pointSpan.className = 'cell-point';
                        pointSpan.textContent = letterValues[boardState[r][c].letter] || 0;
                        cell.appendChild(pointSpan);
                    }

                    cell.dataset.row = r;
                    cell.dataset.col = c;
                    cell.addEventListener('click', () => onCellClick(r, c));
                    boardEl.appendChild(cell);
                }
            }
            
            for (const p of newlyPlacedCells) {
                const cell = boardEl.querySelector(`[data-row="${p.row}"][data-col="${p.col}"]`);
                if (cell) {
                    cell.textContent = p.letter;
                    cell.classList.add('occupied', 'newly-placed');
                    let pointSpan = cell.querySelector('.cell-point');
                    if (!pointSpan) {
                        pointSpan = document.createElement('span');
                        pointSpan.className = 'cell-point';
                        cell.appendChild(pointSpan);
                    }
                    pointSpan.textContent = letterValues[p.letter] || 0;
                }
            }
        }

        function rackTileLetter(tile) {
            return tile && typeof tile === 'object' ? tile.letter : tile;
        }

        function rackTileIsSpecial(tile) {
            return Boolean(tile && typeof tile === 'object' && tile.special === true);
        }

        function renderMyRack() {
            const rackEl = document.getElementById('rack');
            rackEl.innerHTML = '';
            myRack.forEach((rackTile, index) => {
                const letter = rackTileLetter(rackTile);
                const isSpecial = rackTileIsSpecial(rackTile);
                const wrapper = document.createElement('div');
                wrapper.className = 'tile-wrapper';
                const tile = document.createElement('div');
                tile.className = 'tile';
                if (isSpecial) tile.classList.add('special-tile');
                if (index === selectedTileIndex) tile.classList.add('selected');
                tile.textContent = letter;
                tile.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onRackClick(index);
                });
                const points = document.createElement('div');
                points.className = 'tile-point';
                points.textContent = letterValues[letter] || 0;

                wrapper.appendChild(tile);
                wrapper.appendChild(points);
                rackEl.appendChild(wrapper);
            });
        }

        function updateTurnIndicator(myTurn) {
            const indicator = document.getElementById('turnIndicator');
            const yBox = document.getElementById('yourScoreBox');
            const oBox = document.getElementById('opponentScoreBox');
            indicator.classList.remove('your-turn', 'opponent-turn', 'game-over-state');
            if (gameIsOver) {
                indicator.textContent = '🏁 КРАЈ ИГРЕ';
                indicator.classList.add('game-over-state');

                yBox.classList.remove('active-player');
                oBox.classList.remove('active-player');

            } else if (myTurn) {
                indicator.textContent = '🔵 ТВОЈ ПОТЕЗ';
                indicator.classList.add('your-turn');

                yBox.classList.add('active-player');
                oBox.classList.remove('active-player');

            } else {
                indicator.textContent = '🔴 ПРОТИВНИК НА ПОТЕЗУ';
                indicator.classList.add('opponent-turn');

                yBox.classList.remove('active-player');
                oBox.classList.add('active-player');
            }
}

        let messageTimeout = null;
        function setMessage(msg, type, duration = 3000) {
            const el = document.getElementById('message');
            el.textContent = msg;
            el.className = 'message-box';
            if (type) el.classList.add(type);
            if (messageTimeout) clearTimeout(messageTimeout);
            if (duration > 0) {
                messageTimeout = setTimeout(() => {
                    el.textContent = '';
                    el.className = 'message-box';
                }, duration);
            }
        }
        function quickMsg(msg) { setMessage(msg, '', 1500); }
        function successMsg(msg) { setMessage(msg, 'success', 3000); }
        function errorMsg(msg) { setMessage(msg, 'error', 3000); }
        function permanentMsg(msg, type = 'info') { setMessage(msg, type, 0); }

        // ==================== INTERAKCIJE ====================

    function animateCell(row, col, animation = 'bounce') {
        const cell = document.querySelector(
            `.cell[data-row="${row}"][data-col="${col}"]`
        );

        if (!cell) return;

        // Ukloni prethodnu animaciju ako postoji
        cell.classList.remove('cell-bounce', 'cell-shake');

        // Omogući ponovno pokretanje iste animacije
        void cell.offsetWidth;

        if (animation === 'shake') {
            cell.classList.add('cell-shake');

            setTimeout(() => {
                cell.classList.remove('cell-shake');
            }, 400);

        } else {
            cell.classList.add('cell-bounce');

            setTimeout(() => {
                cell.classList.remove('cell-bounce');
            }, 300);
        }
    }
    // ==================== KONFETE ====================

    function spawnConfetti() {
        const container = document.createElement('div');

        container.className = 'confetti-container';

        Object.assign(container.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: '99999'
        });

        document.body.appendChild(container);

        const pieces = 80;

        for (let i = 0; i < pieces; i++) {
            const piece = document.createElement('div');

            piece.className = 'confetti-piece';

            const size = 6 + Math.random() * 7;
            const left = Math.random() * 100;
            const duration = 1.5 + Math.random() * 2;
            const delay = Math.random() * 0.5;
            const rotation = Math.random() * 360;

            Object.assign(piece.style, {
                position: 'absolute',
                left: `${left}%`,
                top: '-20px',
                width: `${size}px`,
                height: `${size * 1.5}px`,
                background: `hsl(${Math.random() * 360}, 80%, 60%)`,
                transform: `rotate(${rotation}deg)`,
                animation: `confettiFall ${duration}s ease-out ${delay}s forwards`
            });

            container.appendChild(piece);
        }

        setTimeout(() => {
            container.remove();
        }, 4500);
    }
    function onRackClick(index) {
                if (!isMyTurn || !gameActive || gameIsOver) return;
                selectedTileIndex = (selectedTileIndex === index) ? null : index;
                renderMyRack();
            }

    function onCellClick(row, col) {
                if (!isMyTurn || !gameActive || gameIsOver) {
                    setMessage('⏳ Није твој потез!', 'error');
                    return;
                }
                const boardState = currentBoardState;
                const isOccupiedPermanently = boardState && boardState[row] && boardState[row][col];
                const isNewlyPlacedByMe = newlyPlacedCells.some(p => p.row === row && p.col === col);

                if (selectedTileIndex === null) {
                    if (isNewlyPlacedByMe) {
                        const existingIdx = newlyPlacedCells.findIndex(p => p.row === row && p.col === col);
                        if (existingIdx >= 0) {
                            myRack.push(newlyPlacedCells[existingIdx].special
                                ? { letter: newlyPlacedCells[existingIdx].letter, special: true }
                                : newlyPlacedCells[existingIdx].letter);
                            newlyPlacedCells.splice(existingIdx, 1);
                            renderBoardFromState(boardState);
                            renderMyRack();
                            quickMsg('↩ Плочица враћена на таблу.');
                        }
                    } else if (isOccupiedPermanently) {
                        errorMsg('⚠ То поље је већ заузето.');
                    } else {
                        errorMsg('👆 Прво изабери плочицу са табле!');
                    }
                    return;
                }
                if (isOccupiedPermanently && !isNewlyPlacedByMe) {
                    errorMsg('⚠ То поље је већ заузето.');
                    return;
                }
                if (isNewlyPlacedByMe) {
                    const existingIdx = newlyPlacedCells.findIndex(p => p.row === row && p.col === col);
                    if (existingIdx >= 0) {
                        myRack.push(newlyPlacedCells[existingIdx].special
                                ? { letter: newlyPlacedCells[existingIdx].letter, special: true }
                                : newlyPlacedCells[existingIdx].letter);
                        newlyPlacedCells.splice(existingIdx, 1);
                    }
                }
                const rackTile = myRack[selectedTileIndex];
                const letter = rackTileLetter(rackTile);
                const special = rackTileIsSpecial(rackTile);
                newlyPlacedCells.push({ row, col, letter, special });
                myRack.splice(selectedTileIndex, 1);
                selectedTileIndex = null;
                renderBoardFromState(boardState);
                renderMyRack();
                sfxPlace();
                animateCell(row, col, 'bounce');
                successMsg(`✅ Постављено "${letter}" (${letterValues[letter] || 0} поен${letterValues[letter] === 1 ? '' : 'а'}).`);
            }

    function recallTiles() {
                if (!isMyTurn || !gameActive || gameIsOver) return;
                if (newlyPlacedCells.length === 0) {
                    quickMsg('ℹ Нема новопостављених плочица.');
                    return;
                }
                for (const p of [...newlyPlacedCells]) myRack.push(p.special ? { letter: p.letter, special: true } : p.letter);
                newlyPlacedCells = [];
                selectedTileIndex = null;
                renderBoardFromState(currentBoardState);
                renderMyRack();
                quickMsg('↩ Све плочице враћене на таблу.');
            }

    function shuffleRack() {
                if (!gameActive || gameIsOver) return;
                for (let i = myRack.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [myRack[i], myRack[j]] = [myRack[j], myRack[i]];
                }
                selectedTileIndex = null;
                renderMyRack();
                quickMsg('🔀 Плочице промешане.');
            }

            let moveInFlight = false;
//d//
function submitMove() {

    if (!isMyTurn || !gameActive || gameIsOver || moveInFlight) return;

    if (newlyPlacedCells.length === 0) {
        errorMsg('⚠ Постави бар једно слово на таблу!');
        return;
    }

    const placements = newlyPlacedCells.map(p => ({
        row: p.row,
        col: p.col,
        letter: p.letter,
        special: p.special === true
    }));

    submittedCells = [...newlyPlacedCells];

    moveInFlight = true;
    document.getElementById('btnSubmit').disabled = true;
    isMyTurn = false;
    updateTurnIndicator(false);

    sendMessage('place_tiles', { placements });

    newlyPlacedCells = [];
    selectedTileIndex = null;

    quickMsg('⏳ Шаљем потез на проверу...');
}

    function skipTurn() {
                if (!isMyTurn || !gameActive || gameIsOver) return;
                if (newlyPlacedCells.length > 0) {
                    if (!confirm('Имаш постављене плочице. Сигуран/на да желиш да прескочиш?')) return;
                    recallTiles();
                }
                sendMessage('skip_turn');
                quickMsg('⏭ Прескачеш потез...');
            }

    function resignGame() {
                if (!gameActive) return;
                if (!confirm('Сигуран/на да желиш да се предаш?')) return;
                sendMessage('resign');
                    // showInterstitial() uklonjen — game_over event (showGameOver) će je već pokrenuti
            }

    function removeRematchButton() {
        const btn = document.getElementById('rematchBtn');
        if (btn) btn.remove();
    }

    function goToMainMenu() {
        sfxMenuClick();
        sendMessage('leave_game');
        
        removeRematchButton();
        const menuBtn = document.getElementById('menuBtn');
        if (menuBtn) menuBtn.remove();
        
        // Врати акциона дугмад пре одласка у мени
        showAllActionButtons();
        
        gameActive = false;
        gameIsOver = false;
        myRack = [];
        newlyPlacedCells = [];
        selectedTileIndex = null;
        document.getElementById('btnQuickMatch').disabled = false;   // ✅ dodato
        showScreen('optionsScreen');
    }
    function hideAllActionButtons() {
        ['btnSubmit', 'btnRecall', 'btnShuffle', 'btnSkip', 'btnResign'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = 'none';
        });
    }

    function showAllActionButtons() {
        ['btnSubmit', 'btnRecall', 'btnShuffle', 'btnSkip', 'btnResign'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = '';
        });
    }
    function showGameOver(msg) {
        gameActive = false;
        gameIsOver = true;

        // Сакриј сва акциона дугмад
        hideAllActionButtons();

        updateTurnIndicator(false);
let message = '🏁 ' + (msg.resultMessage || 'Игра је завршена.');

if (msg.resignedByName) {
    if (msg.resignedByName !== myName) {
        message = '🏁 Победио/ла си предајом противника';
    } else {
        message = '🏁 Предао/ла си се.';
    }
} else if (Array.isArray(msg.finalScores)) {
    const scoreText = msg.finalScores
        .map(player => `${player.name}: ${player.score}`)
        .join('  |  ');

    if (scoreText) {
        message += '  ' + scoreText;
    }
}

setMessage(message, 'info', 0);
        
        setTimeout(() => {
            showInterstitial();
        }, 1500);
        
        const controls = document.querySelector('.controls');
        
        // Уклони постојеће динамичке дугмиће ако постоје
        removeRematchButton();
        const oldMenuBtn = document.getElementById('menuBtn');
        if (oldMenuBtn) oldMenuBtn.remove();
        
        // Додај дугме за реванш
        const rematchBtn = document.createElement('button');
        rematchBtn.id = 'rematchBtn';
        rematchBtn.className = 'btn-primary';
        rematchBtn.textContent = '🔄 ПОНУДИ РЕВАНШ';
        rematchBtn.onclick = () => {
            sendMessage('request_rematch');
            rematchBtn.disabled = true;
            rematchBtn.textContent = '⏳ Чекам одговор...';
            setMessage('⏳ Захтев за реванш послат...', 'info', 0);
        };
        controls.appendChild(rematchBtn);
        
        // Додај дугме за почетни мени
        const menuBtn = document.createElement('button');
        menuBtn.id = 'menuBtn';
        menuBtn.className = 'btn-light';
        menuBtn.textContent = '🏠 ПОЧЕТНИ МЕНИ';
        menuBtn.onclick = () => goToMainMenu();
        controls.appendChild(menuBtn);
    }

        function showRematchRequest(msg) {
    hideRematchRequest();

    const overlay = document.createElement('div');
    overlay.id = 'rematchOverlay';
    overlay.className = 'overlay';

    const content = document.createElement('div');
    content.className = 'overlay-content';

    const title = document.createElement('h2');
    title.textContent = '🔄 Реванш?';

    const message = document.createElement('p');
    message.style.marginBottom = '15px';

    const name = document.createElement('strong');
    name.textContent = msg.fromName || 'Противник';

    message.appendChild(name);
    message.appendChild(
        document.createTextNode(' жели реванш!')
    );

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn-success';
    acceptBtn.id = 'acceptRematchBtn';
    acceptBtn.style.width = '100%';
    acceptBtn.style.padding = '12px';
    acceptBtn.style.marginBottom = '8px';
    acceptBtn.textContent = '✅ ПРИХВАТИ';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'btn-danger';
    declineBtn.id = 'declineRematchBtn';
    declineBtn.style.width = '100%';
    declineBtn.style.padding = '12px';
    declineBtn.textContent = '❌ ОДБИЈ';

    content.appendChild(title);
    content.appendChild(message);
    content.appendChild(acceptBtn);
    content.appendChild(declineBtn);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    acceptBtn.onclick = () => {
        sendMessage('accept_rematch', {
            fromId: msg.fromId
        });

        hideRematchRequest();
        successMsg('🔄 Реванш прихваћен!');
    };

    declineBtn.onclick = () => {
        sendMessage('decline_rematch', {
            fromId: msg.fromId
        });

        hideRematchRequest();
    };
}

        function hideRematchRequest() {
            const overlay = document.getElementById('rematchOverlay');
            if (overlay) overlay.remove();
        }

        // ==================== CHAT ====================
        let lastTypingSent = 0;

        function sendChat() {
            const input = document.getElementById('chatInput');
            const text = input.value.trim();
            if (!text) return;
            sendMessage('chat', { text });
            input.value = '';
        }

        document.getElementById('chatInput').addEventListener('input', () => {
            const now = Date.now();
            if (now - lastTypingSent > 1500) {
                sendMessage('typing');
                lastTypingSent = now;
            }
        });
        function addChatMessage(from, text) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.innerHTML = `<strong>${escapeHtml(from)}:</strong> ${escapeHtml(text)}`;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }
        function renderChatHistory() {
            const container = document.getElementById('chatMessages');
            container.innerHTML = '';
            chatHistory.forEach(msg => {
                addChatMessage(msg.from, msg.text);
            });
            container.scrollTop = container.scrollHeight;
        }
        function addChatSystemMsg(text) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.style.opacity = '0.7';
            div.style.fontStyle = 'italic';
            div.textContent = '🔹 ' + text;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showRules() {
            sfxMenuClick();
            showScreen('rulesScreen');
        }
        
        function hideRules() {
            sfxMenuClick();
            showScreen('optionsScreen');
        }

        function requestStateFromServer() {
            sendMessage('get_state');
        }

         // ==================== ZVUCI (Web Audio API) ====================
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        let audioCtx = null;

        function getAudioCtx() {
            if (!audioCtx) audioCtx = new AudioCtx();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return audioCtx;
        }

        function playTone(freq, duration, type = 'sine', vol = 0.1, delay = 0) {
            try {
                const ctx = getAudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                const startTime = ctx.currentTime + delay;

                osc.type = type;
                osc.frequency.setValueAtTime(freq, startTime);

                // Благи ADSR
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + duration);
            } catch(e) {}
        }

        function sfxMenuClick() {
            playTone(800, 0.08, 'sine', 0.08);
            playTone(1000, 0.08, 'sine', 0.06, 0.04);
        }

        function sfxPlace() {
            playTone(600, 0.07, 'sine', 0.09);
            playTone(800, 0.06, 'triangle', 0.06, 0.04);
        }

        function sfxValid() {
            const notes = [523, 659, 784];
            notes.forEach((n, i) => {
                playTone(n, 0.18, 'sine', 0.11, i * 0.1);
                playTone(n * 2, 0.1, 'triangle', 0.05, i * 0.1);
            });
            playTone(1047, 0.35, 'sine', 0.1, 0.3);
        }

        function sfxInvalid() {
            playTone(220, 0.15, 'sawtooth', 0.05);
            playTone(180, 0.22, 'sawtooth', 0.05, 0.1);
        }

        function sfxWin() {
            const melody = [523, 659, 784, 1047];
            melody.forEach((n, i) => {
                playTone(n, 0.3, 'sine', 0.12, i * 0.18);
                playTone(n / 2, 0.3, 'triangle', 0.07, i * 0.18);
            });
            playTone(1319, 0.5, 'sine', 0.12, melody.length * 0.18);
        }

        function sfxOpponent() {
            playTone(440, 0.09, 'triangle', 0.08);
            playTone(380, 0.1, 'triangle', 0.08, 0.09);
            playTone(320, 0.12, 'triangle', 0.06, 0.18);
        }

        // Capacitor appStateChange (ako postoji)
        try {
            if (window.Capacitor && Capacitor.Plugins.App) {
                const { App } = Capacitor.Plugins;
                App.addListener('appStateChange', ({ isActive }) => {

                    if (!isActive) {
                        console.log(
                            '📱 Aplikacija u pozadini. ' +
                            'Ne napuštam igru i ne šaljem resign.'
                        );

                        return;
                    }

                    console.log('📱 Aplikacija ponovo aktivna.');

                    // Ako je socket prekinut, pokreni reconnect.
                    if (!socket.connected) {
                        console.log('🔄 Pokrećem Socket.IO reconnect...');
                        socket.connect();
                    }

                    // Ako smo bili u aktivnoj igri,
                    // odmah tražimo kompletno stanje sa servera.
                    if (wasInActiveGameBeforeDisconnect && !gameIsOver) {

                        setTimeout(() => {

                            if (socket.connected) {
                                console.log(
                                    '🔄 Tražim stanje igre nakon povratka u aplikaciju...'
                                );

                                requestStateFromServer();
                            }

                        }, 500);
                    }
                });
            }
        } catch (e) {
            console.warn('Capacitor App plugin nije dostupan');
        }

        // Početna inicijalizacija
        initialSetup();
        console.log('🎯 Смехалица укрштеница — Socket.IO klijent spreman!');


/* =========================================================
   ПОВЕЗИВАЊЕ ДУГМАДИ

   Раније је свако дугме имало onclick="" у HTML-у, због чега је CSP
   морао да дозволи 'unsafe-inline' за скрипте — а то поништава главну
   заштиту од XSS-а. Сада дугмад носе data-action, а један ослушкивач
   на документу их повезује. Ради и за дугмад направљена накнадно.
   ========================================================= */

const ACTIONS = {
    cancelFind,
    cancelRoom,
    copyRoomLink,
    goBackToName,
    goBackToOptions,
    hideRules,
    joinRoom,
    quickMatch,
    recallTiles,
    resignGame,
    sendChat,
    showCreateRoom,
    showGameOptions,
    showJoinRoom,
    showRules,
    shuffleRack,
    skipTurn,
    submitMove
};

function runAction(name, event) {
    const action = ACTIONS[name];
    if (typeof action !== 'function') {
        console.warn('Непозната акција:', name);
        return;
    }
    try {
        action(event);
    } catch (err) {
        console.error('Грешка у акцији "' + name + '":', err);
    }
}

document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target && !target.disabled) runAction(target.dataset.action, event);
});

document.addEventListener('keypress', (event) => {
    if (event.key !== 'Enter') return;
    const target = event.target.closest('[data-enter]');
    if (target) runAction(target.dataset.enter, event);
});
