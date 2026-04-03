document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let myPlayerId = null, opponent = null, isGuessingPhase = false, isHost = false;
    let targetFrequency = 100.0, renderedFrequency = 100.0;
    let isDragging = false, lastPointerY = 0;
    let smoothingFrameId = null;
    let prepCountdownTimer = null;
    let listeningCountdownTimer = null;
    let guessCountdownTimer = null;
    let masterVolume = 0.1;
    let hasSubmittedGuess = false;
    let isSingleplayerMode = false;
    let currentSoloMode = 'singleplayer';
    let lastPointerMoveAt = 0;
    const POINTER_MOVE_THROTTLE_MS = navigator.maxTouchPoints > 0 ? 16 : 0;
    let singleplayerRound = 0;
    let singleplayerMaxRounds = 3;
    let singleplayerLives = 3;
    let singleplayerTargetFrequency = 0;
    let singleplayerUserGuess = 0;
    let singleplayerAdvanceTimer = null;
    let singleplayerReturnTimer = null;
    let isConnectionReady = false;
    let previewOscillator = null, previewGain = null;
    let previewStopTimeout = null;
    let audioCtx, oscillator, gainNode;
    const MIN_FREQ = 100, MAX_FREQ = 1000;
    const DEFAULT_GUESS_FREQUENCY = 550;
    const DRAG_SENSITIVITY = 1.1;
    const SMOOTHING_FACTOR = 0.2;
    const DRAFT_SYNC_INTERVAL_MS = 280;
    const LISTEN_MODE_DURATIONS = {
        noob: 5000,
        easy: 2500,
        hard: [1000, 670],
    };
    let lastDraftSyncAt = 0;
    let singleplayerListenMode = 'easy';
    let pendingLoginUsername = '';

    const screens = { 
        login: document.getElementById('login-screen'), 
        mainMenu: document.getElementById('main-menu-screen'), 
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen')
    };
    const phases = {
        prep: document.getElementById('prep-phase'),
        listening: document.getElementById('listening-phase'),
        guessing: document.getElementById('guessing-phase'),
        result: document.getElementById('result-phase')
    };
    
    const usernameInput = document.getElementById('username-input'), loginButton = document.getElementById('login-button');
    const welcomeMessage = document.getElementById('welcome-message');
    const menuActions = document.getElementById('menu-actions');
    const openSingleplayerButton = document.getElementById('open-practice-button');
    const singleplayerPanel = document.getElementById('practice-panel');
    const singleplayerListenModeSetting = document.getElementById('practice-listen-mode-setting');
    const singleplayerRoundsSetting = document.getElementById('practice-rounds-setting');
    const singleplayerLivesSetting = document.getElementById('practice-lives-setting');
    const startSingleplayerButton = document.getElementById('start-practice-button');
    const backFromSingleplayerButton = document.getElementById('back-from-practice-button');
    const createRoomPanel = document.getElementById('create-room-panel');
    const joinRoomPanel = document.getElementById('join-room-panel');
    const openCreateRoomButton = document.getElementById('open-create-room-button');
    const openJoinRoomButton = document.getElementById('open-join-room-button');
    const changeUsernameButton = document.getElementById('change-username-button');
    const backFromCreateButton = document.getElementById('back-from-create-button');
    const backFromJoinButton = document.getElementById('back-from-join-button');
    const createRoomButton = document.getElementById('create-room-button');
    const joinRoomButton = document.getElementById('join-room-button');
    const roomCodeInput = document.getElementById('room-code-input');
    const roomPasswordInput = document.getElementById('room-password-input');
    const roomPasswordEnabled = document.getElementById('room-password-enabled');
    const createRoomPasswordInput = document.getElementById('create-room-password-input');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const menuTestSoundButton = document.getElementById('menu-test-sound-button');
    const gameVolumeSlider = document.getElementById('game-volume-slider');
    const gameVolumeValue = document.getElementById('game-volume-value');

    // Lobby elements
    const roomCodeDisplay = document.getElementById('room-code-display');
    const lobbyLastMatch = document.getElementById('lobby-last-match');
    const playerList = document.getElementById('player-list');
    const roundsSetting = document.getElementById('rounds-setting');
    const livesSetting = document.getElementById('lives-setting');
    const maxPlayersSetting = document.getElementById('max-players-setting');
    const listenModeSetting = document.getElementById('listen-mode-setting');
    const startGameButton = document.getElementById('start-game-button');
    const leaveLobbyButton = document.getElementById('leave-lobby-button');
    const gameSettingsDiv = document.getElementById('game-settings');
    const waitingForHostText = document.getElementById('waiting-for-host-text');

    // Game elements
    const myUsernameDisplay = document.getElementById('my-username'), opponentUsernameDisplay = document.getElementById('opponent-username');
    const myLivesContainer = document.getElementById('my-lives');
    const opponentLivesContainer = document.getElementById('opponent-lives');
    const roundIndicator = document.getElementById('round-indicator');
    const prepTimerDisplay = document.getElementById('prep-timer');
    const listenTimerDisplay = document.getElementById('listen-timer');
    const guessValueDisplay = document.getElementById('guess-value');
    const guessTimerDisplay = document.getElementById('guess-timer');
    const hurryUpNotice = document.getElementById('hurry-up-notice');
    const frequencySlider = document.getElementById('frequency-slider');
    const guessingPhase = document.getElementById('guessing-phase');
    const submitGuessButton = document.getElementById('submit-guess-button');
    const exitSingleplayerButton = document.getElementById('exit-practice-button');
    const statusOverlay = document.getElementById('status-overlay');
    const statusText = document.getElementById('status-text');
    const toast = document.getElementById('toast');
    const privacyToggle = document.getElementById('privacy-toggle');
    const privacyModal = document.getElementById('privacy-modal');
    const privacyClose = document.getElementById('privacy-close');
    
    // Result displays
    const resultTarget = document.getElementById('result-target');
    const resultSummary = document.getElementById('result-summary');
    const resultYourGuess = document.getElementById('result-your-guess');
    const resultOpponentGuess = document.getElementById('result-opponent-guess');
    const yourResultRow = document.querySelector('.your-result');
    const opponentResultRow = document.querySelector('.opponent-result');
    const singleplayerEndActions = document.getElementById('practice-end-actions');
    const singleplayerRestartButton = document.getElementById('practice-restart-button');
    const singleplayerBackMenuButton = document.getElementById('practice-back-menu-button');
    const MAX_USERNAME_CHARS = 20;
    const USERNAME_COOKIE_KEY = 'mtf_username';
    const USERNAME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
    const VOLUME_COOKIE_KEY = 'mtf_volume';
    const VOLUME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

    async function ensureAudioReady() {
        initAudio();
        if (!audioCtx) return false;
        if (audioCtx.state === 'suspended') {
            try {
                await audioCtx.resume();
            } catch (error) {
                return false;
            }
        }
        return audioCtx.state === 'running';
    }

    function unlockAudioOnFirstGesture() {
        ensureAudioReady();
    }

    document.addEventListener('pointerdown', unlockAudioOnFirstGesture, { once: true });
    document.addEventListener('keydown', unlockAudioOnFirstGesture, { once: true });

    function setCookie(name, value, maxAgeSeconds) {
        document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
    }

    function getCookie(name) {
        const prefix = `${name}=`;
        const cookies = document.cookie ? document.cookie.split(';') : [];
        for (let index = 0; index < cookies.length; index += 1) {
            const entry = cookies[index].trim();
            if (entry.startsWith(prefix)) {
                return decodeURIComponent(entry.slice(prefix.length));
            }
        }
        return '';
    }

    function applyLoginUsername(username) {
        const normalizedUsername = String(username || '').trim().slice(0, MAX_USERNAME_CHARS);
        if (!normalizedUsername) return;

        initAudio();
        if (!sendMessage('login', { username: normalizedUsername })) {
            pendingLoginUsername = normalizedUsername;
        }
        setCookie(USERNAME_COOKIE_KEY, normalizedUsername, USERNAME_COOKIE_MAX_AGE_SECONDS);
        welcomeMessage.textContent = `Welcome, ${normalizedUsername}!`;
        myUsernameDisplay.textContent = normalizedUsername;
        switchScreen('mainMenu');
    }

    // --- AUDIO ---
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = masterVolume;
            gainNode.connect(audioCtx.destination);
        }
    }
    function playTone(freq) {
        if (!audioCtx) initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {
                showToast('Tap screen once to enable audio.');
            });
        }
        stopTone();
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gainNode.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.015);
        oscillator.connect(gainNode);
        oscillator.start();
    }
    function stopTone() {
        if (!oscillator) return;
        try {
            oscillator.stop();
        } catch (error) {
            // Ignore InvalidStateError when oscillator already stopped.
        }
        oscillator.disconnect();
        oscillator = null;
    }

    function stopPreviewTone() {
        if (previewStopTimeout) {
            clearTimeout(previewStopTimeout);
            previewStopTimeout = null;
        }
        if (previewOscillator) {
            try {
                previewOscillator.stop();
            } catch (error) {
                // Ignore InvalidStateError when preview oscillator already stopped.
            }
            previewOscillator.disconnect();
            previewOscillator = null;
        }
        if (previewGain) {
            previewGain.disconnect();
            previewGain = null;
        }
    }

    function playPreviewTone(freq = 440, durationMs = 550) {
        if (isGuessingPhase) {
            showToast('Use game tone during guessing');
            return;
        }

        initAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {
                showToast('Tap screen once to enable audio.');
            });
        }

        stopPreviewTone();
        previewOscillator = audioCtx.createOscillator();
        previewGain = audioCtx.createGain();
        previewOscillator.type = 'sine';
        previewOscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
        previewGain.gain.setValueAtTime(masterVolume, audioCtx.currentTime);
        previewOscillator.connect(previewGain);
        previewGain.connect(audioCtx.destination);
        previewOscillator.start();

        previewStopTimeout = setTimeout(() => {
            stopPreviewTone();
        }, durationMs);
    }

    function setMasterVolume(percent) {
        const numericPercent = Number(percent);
        const fallbackPercent = Number.isFinite(masterVolume) ? Math.round(masterVolume * 100) : 10;
        const clampedPercent = Math.max(0, Math.min(100, Number.isFinite(numericPercent) ? numericPercent : fallbackPercent));
        masterVolume = clampedPercent / 100;
        const percentText = `${clampedPercent}%`;

        if (volumeSlider) volumeSlider.value = String(clampedPercent);
        if (volumeValue) volumeValue.textContent = percentText;
        if (gameVolumeSlider) gameVolumeSlider.value = String(clampedPercent);
        if (gameVolumeValue) gameVolumeValue.textContent = percentText;

        if (audioCtx && gainNode) {
            gainNode.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.02);
        }

        setCookie(VOLUME_COOKIE_KEY, String(clampedPercent), VOLUME_COOKIE_MAX_AGE_SECONDS);
    }

    const rememberedVolume = Number(getCookie(VOLUME_COOKIE_KEY));
    setMasterVolume(Number.isFinite(rememberedVolume) ? rememberedVolume : 10);

    // --- WEBSOCKET ---
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    function setMultiplayerReadyState(isReady) {
        isConnectionReady = isReady;
        openCreateRoomButton.disabled = !isReady;
        openJoinRoomButton.disabled = !isReady;
        createRoomButton.disabled = !isReady;
        joinRoomButton.disabled = !isReady;
    }

    // Prevent early multiplayer clicks while websocket is still connecting.
    setMultiplayerReadyState(false);

    ws.onopen = () => {
        setMultiplayerReadyState(true);
        if (pendingLoginUsername) {
            sendMessage('login', { username: pendingLoginUsername });
            pendingLoginUsername = '';
        }
    };

    ws.onclose = () => {
        setMultiplayerReadyState(false);
        showStatus('Connection lost. Please refresh.', 2600);
    };

    ws.onmessage = (event) => {
        const { type, payload } = JSON.parse(event.data);
        handleServerMessage(type, payload);
    };

    function sendMessage(type, payload) {
        if (ws.readyState !== WebSocket.OPEN) {
            showToast('Connection is not ready. Please wait a moment.');
            return false;
        }
        ws.send(JSON.stringify({ type, payload }));
        return true;
    }

    // --- UI & GAME FLOW ---
    function showMainMenuView(view) {
        menuActions.classList.toggle('hidden', view !== 'actions');
        singleplayerPanel.classList.toggle('hidden', view !== 'singleplayer');
        createRoomPanel.classList.toggle('hidden', view !== 'create');
        joinRoomPanel.classList.toggle('hidden', view !== 'join');
    }

    function clampSingleplayerSetting(value, min, max, fallback) {
        const numericValue = parseInt(value, 10);
        if (!Number.isFinite(numericValue)) return fallback;
        return Math.max(min, Math.min(max, numericValue));
    }

    function sanitizeBoundedIntegerInput(inputEl, min, max, fallback = min) {
        const rawValue = String(inputEl?.value ?? '');
        const digitsOnly = rawValue.replace(/\D+/g, '');
        if (!digitsOnly) {
            inputEl.value = String(fallback);
            return fallback;
        }

        const parsed = parseInt(digitsOnly, 10);
        const clamped = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
        inputEl.value = String(clamped);
        return clamped;
    }

    function sendLobbySettingsUpdate() {
        const rounds = sanitizeBoundedIntegerInput(roundsSetting, 1, 10, 3);
        const lives = sanitizeBoundedIntegerInput(livesSetting, 1, 10, 3);
        sendMessage('updateSettings', { rounds, lives, maxPlayers: maxPlayersSetting.value, listenMode: listenModeSetting.value });
    }

    function setLobbySettingsReadOnly(isReadOnly) {
        roundsSetting.disabled = isReadOnly;
        livesSetting.disabled = isReadOnly;
        maxPlayersSetting.disabled = isReadOnly;
        listenModeSetting.disabled = isReadOnly;
    }

    function resetMainMenuInputs() {
        roomCodeInput.value = '';
        roomPasswordInput.value = '';
        createRoomPasswordInput.value = '';
        roomPasswordEnabled.checked = false;
        createRoomPasswordInput.disabled = true;
        singleplayerEndActions.classList.add('hidden');
    }

    function getSoloTargetFrequency() {
        return Math.floor(Math.random() * (MAX_FREQ - MIN_FREQ + 1)) + MIN_FREQ;
    }

    function resolveListenDuration(listenMode) {
        if (listenMode === 'hard') {
            return Math.random() < 0.5 ? LISTEN_MODE_DURATIONS.hard[0] : LISTEN_MODE_DURATIONS.hard[1];
        }
        if (listenMode === 'noob') return LISTEN_MODE_DURATIONS.noob;
        return LISTEN_MODE_DURATIONS.easy;
    }

    function enterGuessingPhase() {
        if (isGuessingPhase) return;
        if (listeningCountdownTimer) {
            clearInterval(listeningCountdownTimer);
            listeningCountdownTimer = null;
        }
        stopTone();
        listenVisualizer.stop();
        switchPhase('guessing');
        guessVisualizer.start(renderedFrequency);
        playTone(renderedFrequency);
        isGuessingPhase = true;
    }

    function setSingleplayerUiActive(isActive) {
        exitSingleplayerButton.classList.toggle('hidden', !isActive);
        if (!isActive) {
            singleplayerEndActions.classList.add('hidden');
            singleplayerEndActions.style.display = 'none';
        } else {
            singleplayerEndActions.style.display = '';
        }
    }

    function clearSingleplayerAdvanceTimer() {
        if (singleplayerAdvanceTimer) {
            clearTimeout(singleplayerAdvanceTimer);
            singleplayerAdvanceTimer = null;
        }
        if (singleplayerReturnTimer) {
            clearTimeout(singleplayerReturnTimer);
            singleplayerReturnTimer = null;
        }
    }

    function leaveSingleplayerMode() {
        clearSingleplayerAdvanceTimer();
        cleanupActiveGameAudio();
        isSingleplayerMode = false;
        setSingleplayerUiActive(false);
        singleplayerEndActions.classList.add('hidden');
        switchScreen('mainMenu');
        showMainMenuView('actions');
        showToast('Left singleplayer mode.', 1600);
    }

    function leaveMultiplayerRoom() {
        clearSingleplayerAdvanceTimer();
        cleanupActiveGameAudio();
        isSingleplayerMode = false;
        setSingleplayerUiActive(false);
        singleplayerEndActions.classList.add('hidden');
        sendMessage('leaveRoom', {});
        resetMainMenuInputs();
        switchScreen('mainMenu');
        showMainMenuView('actions');
        showToast('Left room.', 1600);
    }

    function startSingleplayerRound() {
        cleanupActiveGameAudio();
        switchScreen('game');
        setSingleplayerUiActive(true);
        opponentUsernameDisplay.textContent = 'Singleplayer';
        updateLives(opponentLivesContainer, 0);
        updateLives(myLivesContainer, singleplayerLives);
        roundIndicator.textContent = `${singleplayerRound}/${singleplayerMaxRounds}`;

        switchPhase('prep');
        resetGuessSubmissionState();
        singleplayerTargetFrequency = getSoloTargetFrequency();
        const prepMs = 3000;
        const listenMs = resolveListenDuration(singleplayerListenMode);
        const guessMs = 30000;

        prepTimerDisplay.textContent = 3;
        startSecondCountdown('prepCountdownTimer', prepTimerDisplay, prepMs, () => {
            switchPhase('listening');
            listenVisualizer.start(singleplayerTargetFrequency);
            playTone(singleplayerTargetFrequency);
            startSecondCountdown('listeningCountdownTimer', listenTimerDisplay, listenMs, () => {
                switchPhase('guessing');
                resetGuessSubmissionState();
                guessVisualizer.start(renderedFrequency);
                playTone(renderedFrequency);
                startSecondCountdown('guessCountdownTimer', guessTimerDisplay, guessMs, () => {
                    if (!hasSubmittedGuess) finishSingleplayerGuess(true);
                });
                isGuessingPhase = true;
            });
        });
    }

    function finishSingleplayerGuess(wasTimedOut = false) {
        if (!isSingleplayerMode) return;

        hasSubmittedGuess = true;
        submitGuessButton.disabled = true;
        clearNamedCountdown('prepCountdownTimer');
        clearNamedCountdown('listeningCountdownTimer');
        clearNamedCountdown('guessCountdownTimer');
        resetGuessAudio();
        stopTone();
        stopPreviewTone();
        listenVisualizer.stop();
        guessVisualizer.stop();
        singleplayerUserGuess = targetFrequency;

        if (wasTimedOut) {
            singleplayerLives = Math.max(0, singleplayerLives - 1);
            updateLives(myLivesContainer, singleplayerLives);
        }

        resultTarget.textContent = singleplayerTargetFrequency.toFixed(2);
        resultYourGuess.textContent = singleplayerUserGuess.toFixed(2);
        resultOpponentGuess.textContent = '0.00';
        resultSummary.textContent = wasTimedOut
            ? 'Time ran out. You lost a life.'
            : `You were ${formatHzDelta(singleplayerTargetFrequency - singleplayerUserGuess)} away.`;
        switchPhase('result');
        showToast(wasTimedOut ? 'Time ran out.' : 'Singleplayer round complete.', 1800);

        clearSingleplayerAdvanceTimer();
        singleplayerAdvanceTimer = setTimeout(() => {
            if (!isSingleplayerMode) return;

            if (singleplayerLives <= 0) {
                isSingleplayerMode = false;
                setSingleplayerUiActive(false);
                singleplayerEndActions.classList.remove('hidden');
                singleplayerEndActions.style.display = '';
                showStatus('Singleplayer over. Choose what to do next.', 1800);
                return;
            }

            if (singleplayerRound < singleplayerMaxRounds) {
                singleplayerRound += 1;
                startSingleplayerRound();
            } else {
                isSingleplayerMode = false;
                setSingleplayerUiActive(false);
                singleplayerEndActions.classList.remove('hidden');
                singleplayerEndActions.style.display = '';
            }
        }, 4200);
    }

    function startSingleplayerMode() {
        isSingleplayerMode = true;
        singleplayerRound = 1;
        singleplayerMaxRounds = clampSingleplayerSetting(singleplayerRoundsSetting.value, 1, 10, 3);
        singleplayerLives = clampSingleplayerSetting(singleplayerLivesSetting.value, 1, 10, 3);
        singleplayerListenMode = String(singleplayerListenModeSetting?.value || 'easy');
        clearSingleplayerAdvanceTimer();
        cleanupActiveGameAudio();
        setMasterVolume(parseInt(volumeSlider.value, 10) || 10);
        switchScreen('game');
        myUsernameDisplay.textContent = 'You';
        opponentUsernameDisplay.textContent = 'Singleplayer';
        updateLives(myLivesContainer, singleplayerLives);
        updateLives(opponentLivesContainer, 0);
        roundIndicator.textContent = `1/${singleplayerMaxRounds}`;
        setSingleplayerUiActive(true);
        singleplayerEndActions.classList.add('hidden');
        singleplayerEndActions.style.display = '';
        startSingleplayerRound();
    }

    function resetGuessSubmissionState() {
        hasSubmittedGuess = false;
        submitGuessButton.disabled = false;
        hurryUpNotice.classList.remove('active');
    }

    function clearNamedCountdown(timerRefName) {
        if (timerRefName === 'prepCountdownTimer' && prepCountdownTimer) {
            clearInterval(prepCountdownTimer);
            prepCountdownTimer = null;
        }
        if (timerRefName === 'listeningCountdownTimer' && listeningCountdownTimer) {
            clearInterval(listeningCountdownTimer);
            listeningCountdownTimer = null;
        }
        if (timerRefName === 'guessCountdownTimer' && guessCountdownTimer) {
            clearInterval(guessCountdownTimer);
            guessCountdownTimer = null;
        }
    }

    function setNamedCountdown(timerRefName, intervalId) {
        if (timerRefName === 'prepCountdownTimer') prepCountdownTimer = intervalId;
        if (timerRefName === 'listeningCountdownTimer') listeningCountdownTimer = intervalId;
        if (timerRefName === 'guessCountdownTimer') guessCountdownTimer = intervalId;
    }

    function startSecondCountdown(timerRefName, displayElement, durationMs, onFinish) {
        clearNamedCountdown(timerRefName);

        let secondsLeft = Math.max(0, Math.ceil(durationMs / 1000));
        displayElement.textContent = String(secondsLeft);

        const intervalId = setInterval(() => {
            secondsLeft -= 1;
            displayElement.textContent = String(Math.max(0, secondsLeft));
            if (secondsLeft <= 0) {
                clearNamedCountdown(timerRefName);
                if (onFinish) onFinish();
            }
        }, 1000);

        setNamedCountdown(timerRefName, intervalId);
    }

    function cleanupActiveGameAudio() {
        if (listeningCountdownTimer) {
            clearInterval(listeningCountdownTimer);
            listeningCountdownTimer = null;
        }
        if (prepCountdownTimer) {
            clearInterval(prepCountdownTimer);
            prepCountdownTimer = null;
        }
        if (guessCountdownTimer) {
            clearInterval(guessCountdownTimer);
            guessCountdownTimer = null;
        }
        isGuessingPhase = false;
        lastDraftSyncAt = 0;
        resetGuessSubmissionState();
        resetGuessAudio();
        stopPreviewTone();
        stopTone();
        listenVisualizer.stop();
        guessVisualizer.stop();
    }

    function switchScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName].classList.add('active');

        if (screenName !== 'game') {
            cleanupActiveGameAudio();
            setSingleplayerUiActive(false);
            singleplayerEndActions.classList.add('hidden');
        }

        if (screenName === 'mainMenu') {
            showMainMenuView('actions');
        }
    }
    function switchPhase(phaseName) { 
        Object.values(phases).forEach(p => p.classList.remove('active')); 
        if (phases[phaseName]) phases[phaseName].classList.add('active'); 

        if (phaseName !== 'listening' && listeningCountdownTimer) {
            clearInterval(listeningCountdownTimer);
            listeningCountdownTimer = null;
        }

        if (phaseName !== 'prep' && prepCountdownTimer) {
            clearInterval(prepCountdownTimer);
            prepCountdownTimer = null;
        }

        if (phaseName !== 'guessing' && guessCountdownTimer) {
            clearInterval(guessCountdownTimer);
            guessCountdownTimer = null;
        }

        if (phaseName !== 'guessing') {
            isGuessingPhase = false;
            resetGuessAudio();
        }
        
        // Stop any active visualizers
        listenVisualizer.stop();
        guessVisualizer.stop();
    }
    function showStatus(message, duration) { statusText.textContent = message; statusOverlay.classList.add('active'); if (duration) setTimeout(() => statusOverlay.classList.remove('active'), duration); }
    function showToast(message, duration = 1800) {
        toast.textContent = message;
        toast.classList.add('active');
        window.clearTimeout(showToast.hideTimer);
        showToast.hideTimer = window.setTimeout(() => toast.classList.remove('active'), duration);
    }
    function updateLives(container, lives) {
        container.replaceChildren();
        for (let index = 0; index < lives; index++) {
            const heart = document.createElement('span');
            heart.className = 'heart';
            heart.textContent = '\u2665';
            container.appendChild(heart);
        }
    }
    function updateFrequencyDisplay() {
        guessValueDisplay.textContent = `${renderedFrequency.toFixed(2)} Hz`;
    }

    function formatHzDelta(value) {
        return `${Math.abs(value).toFixed(2)} Hz`;
    }

    function describeResult(target, yourGuess, opponentGuess, roundWinnerId) {
        const yourDiff = Math.abs(target - yourGuess);
        const opponentDiff = Math.abs(target - opponentGuess);

        if (!Number.isFinite(yourGuess) || !Number.isFinite(opponentGuess)) {
            return 'Result is ready.';
        }

        if (roundWinnerId === myPlayerId) {
            return `You were closer by ${formatHzDelta(opponentDiff - yourDiff)}.`;
        }

        if (roundWinnerId && roundWinnerId !== myPlayerId) {
            return `Opponent was closer by ${formatHzDelta(yourDiff - opponentDiff)}.`;
        }

        return `It was a tie. You were ${formatHzDelta(yourDiff)} away.`;
    }

    function clampFrequency(freq) {
        return Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
    }

    function clampMaxPlayersInput(inputEl) {
        const parsed = parseInt(inputEl.value, 10);
        const clamped = Number.isFinite(parsed) ? Math.max(2, Math.min(2, parsed)) : 2;
        inputEl.value = String(clamped);
    }

    function cancelSmoothing() {
        if (smoothingFrameId) {
            cancelAnimationFrame(smoothingFrameId);
            smoothingFrameId = null;
        }
    }

    function resetGuessAudio(stopOscillator = true) {
        isDragging = false;
        cancelSmoothing();
        if (stopOscillator) {
            stopTone();
        }
    }

    function setTargetFrequency(freq, immediate = false) {
        targetFrequency = clampFrequency(freq);
        frequencySlider.value = targetFrequency.toFixed(1);
        maybeSyncDraftGuess();

        if (immediate) {
            renderedFrequency = targetFrequency;
            updateFrequencyDisplay();
            guessVisualizer.setFrequency(renderedFrequency);
            return;
        }

        if (!smoothingFrameId) {
            smoothingFrameId = requestAnimationFrame(smoothFrequencyStep);
        }
    }

    function smoothFrequencyStep() {
        const diff = targetFrequency - renderedFrequency;
        renderedFrequency += diff * SMOOTHING_FACTOR;

        if (Math.abs(diff) < 0.02) {
            renderedFrequency = targetFrequency;
        }

        updateFrequencyDisplay();
        guessVisualizer.setFrequency(renderedFrequency);
        updateToneFrequency(renderedFrequency);

        if (isGuessingPhase || Math.abs(targetFrequency - renderedFrequency) >= 0.02) {
            smoothingFrameId = requestAnimationFrame(smoothFrequencyStep);
        } else {
            smoothingFrameId = null;
        }
    }

    function maybeSyncDraftGuess(force = false) {
        if (isSingleplayerMode || !isGuessingPhase || hasSubmittedGuess || ws.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        if (!force && now - lastDraftSyncAt < DRAFT_SYNC_INTERVAL_MS) return;
        lastDraftSyncAt = now;
        sendMessage('updateDraftGuess', { frequency: targetFrequency });
    }


    usernameInput.maxLength = MAX_USERNAME_CHARS;
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.slice(0, MAX_USERNAME_CHARS);
    });

    loginButton.addEventListener('click', () => {
        ensureAudioReady();
        const username = usernameInput.value.trim().slice(0, MAX_USERNAME_CHARS);
        if (username) {
            applyLoginUsername(username);
        }
    });

    const rememberedUsername = getCookie(USERNAME_COOKIE_KEY).trim().slice(0, MAX_USERNAME_CHARS);
    if (rememberedUsername) {
        usernameInput.value = rememberedUsername;
        applyLoginUsername(rememberedUsername);
    }

    volumeSlider.addEventListener('input', (e) => {
        setMasterVolume(parseInt(e.target.value, 10));
    });

    menuTestSoundButton.addEventListener('click', () => {
        ensureAudioReady();
        playPreviewTone(440, 650);
    });

    gameVolumeSlider.addEventListener('input', (e) => {
        setMasterVolume(parseInt(e.target.value, 10));
    });

    openCreateRoomButton.addEventListener('click', () => {
        if (!isConnectionReady) {
            showToast('Connecting to server, please wait...');
            return;
        }
        showMainMenuView('create');
    });

    openSingleplayerButton.addEventListener('click', () => {
        currentSoloMode = 'singleplayer';
        showMainMenuView('singleplayer');
    });

    startSingleplayerButton.addEventListener('click', () => {
        ensureAudioReady();
        startSingleplayerMode();
    });

    backFromSingleplayerButton.addEventListener('click', () => {
        showMainMenuView('actions');
    });

    openJoinRoomButton.addEventListener('click', () => {
        if (!isConnectionReady) {
            showToast('Connecting to server, please wait...');
            return;
        }
        showMainMenuView('join');
    });

    changeUsernameButton.addEventListener('click', () => {
        const currentName = (myUsernameDisplay.textContent || getCookie(USERNAME_COOKIE_KEY) || '').trim().slice(0, MAX_USERNAME_CHARS);
        usernameInput.value = currentName;
        switchScreen('login');
        usernameInput.focus();
        usernameInput.select();
        showToast('Enter new username, then press Continue.', 1800);
    });

    backFromCreateButton.addEventListener('click', () => {
        createRoomButton.disabled = false;
        showMainMenuView('actions');
    });

    backFromJoinButton.addEventListener('click', () => {
        joinRoomButton.disabled = false;
        showMainMenuView('actions');
    });

    exitSingleplayerButton.addEventListener('click', () => {
        if (isSingleplayerMode) {
            leaveSingleplayerMode();
            return;
        }
        leaveMultiplayerRoom();
    });
    
    roomPasswordEnabled.addEventListener('change', () => {
        createRoomPasswordInput.disabled = !roomPasswordEnabled.checked;
        if (!roomPasswordEnabled.checked) {
            createRoomPasswordInput.value = '';
        }
    });

    createRoomButton.addEventListener('click', () => {
        const password = roomPasswordEnabled.checked ? createRoomPasswordInput.value.trim() : '';
        if (roomPasswordEnabled.checked && !password) {
            showStatus('Please set a room password or disable protection.', 2500);
            return;
        }
        if (createRoomButton.disabled) return;
        
        createRoomButton.disabled = true;
        showStatus('Creating room...', 900);
        const sent = sendMessage('createRoom', {
            password,
            settings: {
                listenMode: 'easy',
                maxPlayers: 2,
            }
        });
        if (!sent) {
            createRoomButton.disabled = false;
            return;
        }
        
        // Re-enable button after 3 seconds if error occurs (server will respond with error message)
        setTimeout(() => {
            createRoomButton.disabled = false;
        }, 3000);
    });

    joinRoomButton.addEventListener('click', () => { 
        const code = roomCodeInput.value.trim(); 
        if (!code) {
            showStatus('Please enter a room code.', 2500);
            return;
        }
        
        if (joinRoomButton.disabled) return;
        joinRoomButton.disabled = true;
        showStatus('Joining room...', 900);
        const sent = sendMessage('joinRoom', { roomCode: code, password: roomPasswordInput.value.trim() }); 
        if (!sent) {
            joinRoomButton.disabled = false;
            return;
        }
        
        // Re-enable button after 3 seconds if error occurs
        setTimeout(() => {
            joinRoomButton.disabled = false;
        }, 3000);
    });
    
    roomCodeInput.addEventListener('input', () => {
        roomCodeInput.value = roomCodeInput.value.toUpperCase();
    });

    roomCodeDisplay.addEventListener('click', () => {
        const code = roomCodeDisplay.textContent;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(() => {
                showToast('Room code copied');
            });
        }
    });

    singleplayerRestartButton.addEventListener('click', () => {
        statusOverlay.classList.remove('active');
        singleplayerRestartButton.textContent = 'Next';
        startSingleplayerMode();
    });

    singleplayerBackMenuButton.addEventListener('click', () => {
        leaveSingleplayerMode();
    });

    const boundedSettings = [
        [singleplayerRoundsSetting, 1, 10, 3],
        [singleplayerLivesSetting, 1, 10, 3],
        [roundsSetting, 1, 10, 3],
        [livesSetting, 1, 10, 3],
    ];
    boundedSettings.forEach(([inputEl, min, max, fallback]) => {
        inputEl.addEventListener('input', () => sanitizeBoundedIntegerInput(inputEl, min, max, fallback));
        inputEl.addEventListener('blur', () => sanitizeBoundedIntegerInput(inputEl, min, max, fallback));
        sanitizeBoundedIntegerInput(inputEl, min, max, fallback);
    });

    maxPlayersSetting.addEventListener('change', () => {
        clampMaxPlayersInput(maxPlayersSetting);
    });

    privacyToggle.addEventListener('click', () => {
        privacyModal.classList.add('active');
        privacyModal.setAttribute('aria-hidden', 'false');
    });

    privacyClose.addEventListener('click', () => {
        privacyModal.classList.remove('active');
        privacyModal.setAttribute('aria-hidden', 'true');
    });

    privacyModal.addEventListener('click', (event) => {
        if (event.target === privacyModal) {
            privacyModal.classList.remove('active');
            privacyModal.setAttribute('aria-hidden', 'true');
        }
    });

    startGameButton.addEventListener('click', () => {
        ensureAudioReady();
        sendMessage('startGame', {});
    });
    leaveLobbyButton.addEventListener('click', () => {
        cleanupActiveGameAudio();
        sendMessage('leaveRoom', {});
        resetMainMenuInputs();
        switchScreen('mainMenu');
    });
    
    roundsSetting.addEventListener('change', sendLobbySettingsUpdate);
    livesSetting.addEventListener('change', sendLobbySettingsUpdate);
    maxPlayersSetting.addEventListener('change', sendLobbySettingsUpdate);
    listenModeSetting.addEventListener('change', sendLobbySettingsUpdate);

    submitGuessButton.addEventListener('click', () => { 
        if (!isGuessingPhase) return;
        if (hasSubmittedGuess) return;
        if (isSingleplayerMode) {
            finishSingleplayerGuess();
            return;
        }
        hasSubmittedGuess = true;
        submitGuessButton.disabled = true;
        hurryUpNotice.classList.remove('active');
        isGuessingPhase = false; 
        resetGuessAudio();
        guessVisualizer.stop();
        maybeSyncDraftGuess(true);
        sendMessage('submitGuess', { frequency: targetFrequency }); 
        showStatus('Guess submitted! Waiting for opponent...'); 
    });

    function updateToneFrequency(freq) {
        if (oscillator && audioCtx) {
            oscillator.frequency.linearRampToValueAtTime(freq, audioCtx.currentTime + 0.03);
        }
    }

    function startDragging(pointerY) {
        if (!isGuessingPhase) return;
        isDragging = true;
        lastPointerY = pointerY;
    }

    function applyDrag(pointerY) {
        if (!isDragging || !isGuessingPhase) return;
        const deltaY = lastPointerY - pointerY;
        setTargetFrequency(targetFrequency + deltaY * DRAG_SENSITIVITY);
        lastPointerY = pointerY;
    }

    function stopDragging() {
        isDragging = false;
    }

    frequencySlider.addEventListener('input', (e) => {
        setTargetFrequency(parseFloat(e.target.value));
    });

    guessingPhase.addEventListener('pointerdown', (e) => {
        if (e.target === frequencySlider || e.target === submitGuessButton) return;
        startDragging(e.clientY);
        guessingPhase.setPointerCapture(e.pointerId);
    });

    guessingPhase.addEventListener('pointermove', (e) => {
        const now = Date.now();
        if (now - lastPointerMoveAt >= POINTER_MOVE_THROTTLE_MS) {
            applyDrag(e.clientY);
            lastPointerMoveAt = now;
        }
    });

    guessingPhase.addEventListener('pointerup', () => {
        stopDragging();
    });

    guessingPhase.addEventListener('pointercancel', () => {
        stopDragging();
    });

    // --- SERVER MESSAGE HANDLER ---
    function handleServerMessage(type, payload) {
        switch (type) {
            case 'assignId': myPlayerId = payload.playerId; break;
            case 'roomCreated':
                resetMainMenuInputs();
                switchScreen('lobby');
                break;
            case 'lobbyUpdate':
                cleanupActiveGameAudio();
                isHost = payload.ownerId === myPlayerId;
                roomCodeDisplay.textContent = payload.roomCode;
                roomCodeDisplay.title = payload.hasPassword ? 'Password protected room' : 'Open room';
                if (payload.lastMatchSummary) {
                    lobbyLastMatch.textContent = payload.lastMatchSummary;
                    lobbyLastMatch.classList.remove('hidden');
                } else {
                    lobbyLastMatch.textContent = '';
                    lobbyLastMatch.classList.add('hidden');
                }
                playerList.replaceChildren();
                payload.players.forEach((player) => {
                    const row = document.createElement('div');
                    row.className = 'player-list-item';
                    row.appendChild(document.createTextNode(player.username || 'Player'));

                    if (player.id === payload.ownerId) {
                        const hostTag = document.createElement('span');
                        hostTag.className = 'host-tag';
                        hostTag.textContent = ' (Host)';
                        row.appendChild(hostTag);
                    }

                    playerList.appendChild(row);
                });
                
                // Update settings only if they are sent
                if (payload.settings) {
                    roundsSetting.value = payload.settings.rounds;
                    livesSetting.value = payload.settings.lives;
                    maxPlayersSetting.value = payload.settings.maxPlayers || 2;
                    listenModeSetting.value = payload.settings.listenMode || (payload.settings.hardMode ? 'hard' : 'easy');
                }
                
                setLobbySettingsReadOnly(!isHost);

                if (isHost) {
                    gameSettingsDiv.style.display = 'flex';
                    startGameButton.style.display = 'block';
                    waitingForHostText.style.display = 'none';
                    startGameButton.disabled = payload.players.length < 2 || payload.players.length > 2;
                } else {
                    gameSettingsDiv.style.display = 'flex';
                    startGameButton.style.display = 'none';
                    waitingForHostText.style.display = 'block';
                }
                switchScreen('lobby');
                break;
            case 'error': 
                showStatus(String(payload.message || 'Error'), 3000);
                createRoomButton.disabled = false;
                joinRoomButton.disabled = false;
                break;
            case 'statusUpdate': showStatus(payload.message); break;
            case 'gameStart':
                statusOverlay.classList.remove('active');
                initAudio();
                resetGuessSubmissionState();
                isSingleplayerMode = false;
                setSingleplayerUiActive(false);
                singleplayerEndActions.classList.add('hidden');
                singleplayerEndActions.style.display = 'none';
                opponent = payload.opponent;
                {
                    const rawOpponentName = String(opponent?.username || '').trim();
                    const myLabel = String(myUsernameDisplay.textContent || '').trim().toLowerCase();
                    const candidate = rawOpponentName || 'Opponent';
                    opponentUsernameDisplay.textContent = candidate.toLowerCase() === myLabel || candidate.toLowerCase() === 'you'
                        ? 'Opponent'
                        : candidate;
                }
                updateLives(myLivesContainer, payload.lives);
                updateLives(opponentLivesContainer, payload.opponentLives);
                switchScreen('game');
                break;
            case 'roundPrepStart':
                cleanupActiveGameAudio();
                switchPhase('prep');
                roundIndicator.textContent = `${payload.round}/${payload.maxRounds}`; 
                resetGuessSubmissionState();
                startSecondCountdown('prepCountdownTimer', prepTimerDisplay, Number.isFinite(payload.prepMs) ? payload.prepMs : 3000);
                break;
            case 'listenPhaseStart':
                switchPhase('listening');
                resetGuessSubmissionState();
                resetGuessAudio(false);
                setTargetFrequency(DEFAULT_GUESS_FREQUENCY, true);
                listenVisualizer.start(payload.targetFrequency);
                playTone(payload.targetFrequency);

                const listenMs = Number.isFinite(payload.listenMs) ? payload.listenMs : 5000;
                startSecondCountdown('listeningCountdownTimer', listenTimerDisplay, listenMs);
                break;
            case 'guessPhaseStart':
                resetGuessSubmissionState();
                enterGuessingPhase();
                maybeSyncDraftGuess(true);
                startSecondCountdown('guessCountdownTimer', guessTimerDisplay, Number.isFinite(payload.guessMs) ? payload.guessMs : 30000);
                break;
            case 'hurryUp':
                if (hasSubmittedGuess) break;
                hurryUpNotice.textContent = payload.message || 'Opponent submitted. You only have 5 seconds left!';
                hurryUpNotice.classList.add('active');
                showToast(payload.message || 'Hurry up! 5 seconds left.', 2600);
                startSecondCountdown('guessCountdownTimer', guessTimerDisplay, Number.isFinite(payload.remainingMs) ? payload.remainingMs : 5000);
                break;
            case 'roundResult':
                statusOverlay.classList.remove('active');
                hurryUpNotice.textContent = 'Opponent submitted. 5 seconds left!';
                hurryUpNotice.classList.remove('active');
                switchPhase('result');
                resultTarget.textContent = Number(payload.target || 0).toFixed(2);
                resultYourGuess.textContent = (Number.isFinite(Number(payload.yourGuess)) ? Number(payload.yourGuess) : DEFAULT_GUESS_FREQUENCY).toFixed(2);
                resultOpponentGuess.textContent = (Number.isFinite(Number(payload.opponentGuess)) ? Number(payload.opponentGuess) : DEFAULT_GUESS_FREQUENCY).toFixed(2);
                resultSummary.textContent = describeResult(payload.target, payload.yourGuess, payload.opponentGuess, payload.roundWinnerId);
                if (payload.yourTimedOut) {
                    resultSummary.textContent += ' You timed out, so your latest slider value was used.';
                }
                if (payload.opponentTimedOut) {
                    resultSummary.textContent += ' Opponent timed out.';
                }
                yourResultRow.classList.remove('winner');
                opponentResultRow.classList.remove('winner');
                if (payload.roundWinnerId) {
                    (payload.roundWinnerId === myPlayerId ? yourResultRow : opponentResultRow).classList.add('winner');
                }
                if (!isSingleplayerMode) {
                    singleplayerEndActions.classList.add('hidden');
                    singleplayerEndActions.style.display = 'none';
                }
                break;
            case 'setResult': updateLives(myLivesContainer, payload.yourLives); updateLives(opponentLivesContainer, payload.opponentLives); let txt = "This set is a draw!"; if (payload.setWinnerId) txt = payload.setWinnerId === myPlayerId ? "You won this set!" : "Opponent won this set."; showStatus(txt, 5000); break;
            case 'gameOver': 
                cleanupActiveGameAudio();
                showStatus('Match finished. Returning to lobby...', 2200);
                setTimeout(() => { 
                    // We don't switch screen directly, we wait for the server to send a lobby update
                    // which will then switch the screen. This ensures the lobby is in a correct state.
                    statusOverlay.classList.remove('active'); 
                }, 2200); 
                break;
            case 'opponentDisconnected': 
                cleanupActiveGameAudio();
                showStatus("Opponent disconnected. You win!", 4000); 
                setTimeout(() => { 
                    switchScreen('lobby'); 
                    statusOverlay.classList.remove('active');
                }, 4000); 
                break;
        }
    }
});

