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
    let isPracticeMode = false;
    let currentSoloMode = 'practice';
    let lastPointerMoveAt = 0;
    const POINTER_MOVE_THROTTLE_MS = navigator.maxTouchPoints > 0 ? 16 : 0;
    let practiceRound = 0;
    let practiceMaxRounds = 3;
    let practiceLives = 3;
    let practiceTargetFrequency = 0;
    let practiceUserGuess = 0;
    let practiceAdvanceTimer = null;
    let practiceReturnTimer = null;
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
    let practiceListenMode = 'easy';

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
    const openPracticeButton = document.getElementById('open-practice-button');
    const practicePanel = document.getElementById('practice-panel');
    const practiceListenModeSetting = document.getElementById('practice-listen-mode-setting');
    const practiceRoundsSetting = document.getElementById('practice-rounds-setting');
    const practiceLivesSetting = document.getElementById('practice-lives-setting');
    const startPracticeButton = document.getElementById('start-practice-button');
    const backFromPracticeButton = document.getElementById('back-from-practice-button');
    const createRoomPanel = document.getElementById('create-room-panel');
    const joinRoomPanel = document.getElementById('join-room-panel');
    const openCreateRoomButton = document.getElementById('open-create-room-button');
    const openJoinRoomButton = document.getElementById('open-join-room-button');
    const backFromCreateButton = document.getElementById('back-from-create-button');
    const backFromJoinButton = document.getElementById('back-from-join-button');
    const createRoomButton = document.getElementById('create-room-button');
    const joinRoomButton = document.getElementById('join-room-button');
    const roomCodeInput = document.getElementById('room-code-input');
    const roomPasswordInput = document.getElementById('room-password-input');
    const roomPasswordEnabled = document.getElementById('room-password-enabled');
    const createRoomPasswordInput = document.getElementById('create-room-password-input');
    const createRoomSizeSetting = document.getElementById('create-room-size-setting');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const menuTestSoundButton = document.getElementById('menu-test-sound-button');
    const gameVolumeSlider = document.getElementById('game-volume-slider');
    const gameVolumeValue = document.getElementById('game-volume-value');

    // Lobby elements
    const roomCodeDisplay = document.getElementById('room-code-display');
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
    const exitPracticeButton = document.getElementById('exit-practice-button');
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
    const practiceEndActions = document.getElementById('practice-end-actions');
    const practiceRestartButton = document.getElementById('practice-restart-button');
    const practiceBackMenuButton = document.getElementById('practice-back-menu-button');
    const MAX_USERNAME_CHARS = 20;

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
        if (audioCtx.state === 'suspended') audioCtx.resume();
        stopTone();
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gainNode.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.015);
        oscillator.connect(gainNode);
        oscillator.start();
    }
    function stopTone() { if (oscillator) { oscillator.stop(); oscillator = null; } }

    function stopPreviewTone() {
        if (previewStopTimeout) {
            clearTimeout(previewStopTimeout);
            previewStopTimeout = null;
        }
        if (previewOscillator) {
            previewOscillator.stop();
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
        if (audioCtx.state === 'suspended') audioCtx.resume();

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
    }

    setMasterVolume(10);

    // --- WEBSOCKET ---
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        const { type, payload } = JSON.parse(event.data);
        handleServerMessage(type, payload);
    };

    function sendMessage(type, payload) {
        if (ws.readyState !== WebSocket.OPEN) {
            showToast('Connection is not ready. Please wait a moment.');
            return;
        }
        ws.send(JSON.stringify({ type, payload }));
    }

    // --- UI & GAME FLOW ---
    function showMainMenuView(view) {
        menuActions.classList.toggle('hidden', view !== 'actions');
        practicePanel.classList.toggle('hidden', view !== 'practice');
        createRoomPanel.classList.toggle('hidden', view !== 'create');
        joinRoomPanel.classList.toggle('hidden', view !== 'join');
    }

    function clampPracticeSetting(value, min, max, fallback) {
        const numericValue = parseInt(value, 10);
        if (!Number.isFinite(numericValue)) return fallback;
        return Math.max(min, Math.min(max, numericValue));
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
        practiceEndActions.classList.add('hidden');
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

    function setPracticeUiActive(isActive) {
        exitPracticeButton.classList.toggle('hidden', !isActive);
        if (isActive) {
            practiceEndActions.classList.add('hidden');
        }
    }

    function clearPracticeAdvanceTimer() {
        if (practiceAdvanceTimer) {
            clearTimeout(practiceAdvanceTimer);
            practiceAdvanceTimer = null;
        }
        if (practiceReturnTimer) {
            clearTimeout(practiceReturnTimer);
            practiceReturnTimer = null;
        }
    }

    function leavePracticeMode() {
        clearPracticeAdvanceTimer();
        cleanupActiveGameAudio();
        isPracticeMode = false;
        setPracticeUiActive(false);
        practiceEndActions.classList.add('hidden');
        switchScreen('mainMenu');
        showMainMenuView('actions');
        showToast('Left singleplayer mode.', 1600);
    }

    function startPracticeRound() {
        cleanupActiveGameAudio();
        switchScreen('game');
        setPracticeUiActive(true);
        opponentUsernameDisplay.textContent = 'Singleplayer';
        updateLives(opponentLivesContainer, 0);
        updateLives(myLivesContainer, practiceLives);
        roundIndicator.textContent = `${practiceRound}/${practiceMaxRounds}`;

        switchPhase('prep');
        resetGuessSubmissionState();
        practiceTargetFrequency = getSoloTargetFrequency();
        const prepMs = 3000;
        const listenMs = resolveListenDuration(practiceListenMode);
        const guessMs = 30000;

        prepTimerDisplay.textContent = 3;
        startSecondCountdown('prepCountdownTimer', prepTimerDisplay, prepMs, () => {
            switchPhase('listening');
            listenVisualizer.start(practiceTargetFrequency);
            playTone(practiceTargetFrequency);
            startSecondCountdown('listeningCountdownTimer', listenTimerDisplay, listenMs, () => {
                switchPhase('guessing');
                resetGuessSubmissionState();
                guessVisualizer.start(renderedFrequency);
                playTone(renderedFrequency);
                startSecondCountdown('guessCountdownTimer', guessTimerDisplay, guessMs, () => {
                    if (!hasSubmittedGuess) finishPracticeGuess(true);
                });
                isGuessingPhase = true;
            });
        });
    }

    function finishPracticeGuess(wasTimedOut = false) {
        if (!isPracticeMode) return;

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
        practiceUserGuess = targetFrequency;

        if (wasTimedOut) {
            practiceLives = Math.max(0, practiceLives - 1);
            updateLives(myLivesContainer, practiceLives);
        }

        resultTarget.textContent = practiceTargetFrequency.toFixed(2);
        resultYourGuess.textContent = practiceUserGuess.toFixed(2);
        resultOpponentGuess.textContent = '0.00';
        resultSummary.textContent = wasTimedOut
            ? 'Time ran out. You lost a life.'
            : `You were ${formatHzDelta(practiceTargetFrequency - practiceUserGuess)} away.`;
        switchPhase('result');
        showToast(wasTimedOut ? 'Time ran out.' : 'Practice round complete.', 1800);

        clearPracticeAdvanceTimer();
        practiceAdvanceTimer = setTimeout(() => {
            if (!isPracticeMode) return;

            if (practiceLives <= 0) {
                isPracticeMode = false;
                setPracticeUiActive(false);
                practiceEndActions.classList.remove('hidden');
                showStatus('Singleplayer over. Choose what to do next.', 1800);
                return;
            }

            if (practiceRound < practiceMaxRounds) {
                practiceRound += 1;
                startPracticeRound();
            } else {
                isPracticeMode = false;
                setPracticeUiActive(false);
                practiceEndActions.classList.remove('hidden');
                showStatus('Singleplayer complete. Choose next action.', 1800);
            }
        }, 4200);
    }

    function startPracticeMode() {
        isPracticeMode = true;
        practiceRound = 1;
        practiceMaxRounds = clampPracticeSetting(practiceRoundsSetting.value, 1, 20, 3);
        practiceLives = clampPracticeSetting(practiceLivesSetting.value, 1, 10, 3);
        practiceListenMode = String(practiceListenModeSetting?.value || 'easy');
        clearPracticeAdvanceTimer();
        cleanupActiveGameAudio();
        setMasterVolume(parseInt(volumeSlider.value, 10) || 10);
        switchScreen('game');
        myUsernameDisplay.textContent = 'You';
        opponentUsernameDisplay.textContent = 'Singleplayer';
        updateLives(myLivesContainer, practiceLives);
        updateLives(opponentLivesContainer, 0);
        roundIndicator.textContent = `1/${practiceMaxRounds}`;
        setPracticeUiActive(true);
        practiceEndActions.classList.add('hidden');
        startPracticeRound();
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
            heart.textContent = '♥';
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
        if (isPracticeMode || !isGuessingPhase || hasSubmittedGuess || ws.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        if (!force && now - lastDraftSyncAt < DRAFT_SYNC_INTERVAL_MS) return;
        lastDraftSyncAt = now;
        sendMessage('updateDraftGuess', { frequency: targetFrequency });
    }


    usernameInput.maxLength = MAX_USERNAME_CHARS;
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.slice(0, MAX_USERNAME_CHARS);
    });

    loginButton.addEventListener('click', () => { const username = usernameInput.value.trim().slice(0, MAX_USERNAME_CHARS); if (username) { initAudio(); sendMessage('login', { username }); welcomeMessage.textContent = `Welcome, ${username}!`; myUsernameDisplay.textContent = username; switchScreen('mainMenu'); } });

    volumeSlider.addEventListener('input', (e) => {
        setMasterVolume(parseInt(e.target.value, 10));
    });

    menuTestSoundButton.addEventListener('click', () => {
        playPreviewTone(440, 650);
    });

    gameVolumeSlider.addEventListener('input', (e) => {
        setMasterVolume(parseInt(e.target.value, 10));
    });

    openCreateRoomButton.addEventListener('click', () => {
        showMainMenuView('create');
    });

    openPracticeButton.addEventListener('click', () => {
        currentSoloMode = 'practice';
        showMainMenuView('practice');
    });

    startPracticeButton.addEventListener('click', () => {
        startPracticeMode();
    });

    backFromPracticeButton.addEventListener('click', () => {
        showMainMenuView('actions');
    });

    openJoinRoomButton.addEventListener('click', () => {
        showMainMenuView('join');
    });

    backFromCreateButton.addEventListener('click', () => {
        showMainMenuView('actions');
    });

    backFromJoinButton.addEventListener('click', () => {
        showMainMenuView('actions');
    });

    exitPracticeButton.addEventListener('click', () => {
        leavePracticeMode();
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
        clampMaxPlayersInput(createRoomSizeSetting);
        showStatus('Creating room...', 900);
        sendMessage('createRoom', {
            password,
            settings: {
                listenMode: 'easy',
                maxPlayers: createRoomSizeSetting.value,
            }
        });
    });
    joinRoomButton.addEventListener('click', () => { 
        const code = roomCodeInput.value.trim(); 
        if (code) { 
            sendMessage('joinRoom', { roomCode: code, password: roomPasswordInput.value.trim() }); 
        } 
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

    createRoomSizeSetting.addEventListener('change', () => {
        clampMaxPlayersInput(createRoomSizeSetting);
    });

    practiceRestartButton.addEventListener('click', () => {
        statusOverlay.classList.remove('active');
        startPracticeMode();
    });

    practiceBackMenuButton.addEventListener('click', () => {
        leavePracticeMode();
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

    startGameButton.addEventListener('click', () => { sendMessage('startGame', {}); });
    leaveLobbyButton.addEventListener('click', () => {
        sendMessage('leaveRoom', {});
        resetMainMenuInputs();
        switchScreen('mainMenu');
    });
    
    roundsSetting.addEventListener('change', () => sendMessage('updateSettings', { rounds: roundsSetting.value, lives: livesSetting.value, maxPlayers: maxPlayersSetting.value }));
    livesSetting.addEventListener('change', () => sendMessage('updateSettings', { rounds: roundsSetting.value, lives: livesSetting.value, maxPlayers: maxPlayersSetting.value }));
    maxPlayersSetting.addEventListener('change', () => sendMessage('updateSettings', { rounds: roundsSetting.value, lives: livesSetting.value, maxPlayers: maxPlayersSetting.value }));
    listenModeSetting.addEventListener('change', () => sendMessage('updateSettings', { rounds: roundsSetting.value, lives: livesSetting.value, maxPlayers: maxPlayersSetting.value, listenMode: listenModeSetting.value }));

    submitGuessButton.addEventListener('click', () => { 
        if (!isGuessingPhase) return;
        if (hasSubmittedGuess) return;
        if (isPracticeMode) {
            finishPracticeGuess();
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
                break;
            case 'statusUpdate': showStatus(payload.message); break;
            case 'gameStart': statusOverlay.classList.remove('active'); initAudio(); resetGuessSubmissionState(); practiceEndActions.classList.add('hidden'); opponent = payload.opponent; opponentUsernameDisplay.textContent = opponent.username; updateLives(myLivesContainer, payload.lives); updateLives(opponentLivesContainer, payload.opponentLives); switchScreen('game'); break;
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
                practiceEndActions.classList.add('hidden');
                break;
            case 'setResult': updateLives(myLivesContainer, payload.yourLives); updateLives(opponentLivesContainer, payload.opponentLives); let txt = "This set is a draw!"; if (payload.setWinnerId) txt = payload.setWinnerId === myPlayerId ? "You won this set!" : "Opponent won this set."; showStatus(txt, 5000); break;
            case 'gameOver': 
                cleanupActiveGameAudio();
                const winTxt = payload.winnerId === myPlayerId ? "YOU ARE THE WINNER!" : `${opponent.username} is the winner!`; 
                showStatus(winTxt, 4000); 
                setTimeout(() => { 
                    // We don't switch screen directly, we wait for the server to send a lobby update
                    // which will then switch the screen. This ensures the lobby is in a correct state.
                    statusOverlay.classList.remove('active'); 
                }, 4000); 
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
