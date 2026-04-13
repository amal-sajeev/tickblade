const Game = (() => {
    const CFG = {
        START_BPM: 60,
        BPM_STEP: 5,
        BEATS_PER_LEVEL: 10,
        MAX_BPM: 180,
        MAX_HITS: 3,
        PERFECT_WINDOW: 0.07,
        GOOD_WINDOW: 0.09,
        JUMP_DURATION: 0.25,
        JUMP_HEIGHT: 35,
        PRESS_COOLDOWN: 0.32,
        RESOLVE_DELAY: 0.30,
        SAFE_HEIGHT_RATIO: 0.66,
        COUNTDOWN_BEATS: 4,
    };

    // ---- State ----
    let mode = null;
    let phase = 'menu';
    let bpm = CFG.START_BPM;
    let gameStartTime = 0;
    let countdownStartTime = 0;
    let lastResolvedBeat = -1;
    let lastTickBeat = -1;
    let lastFrameTime = 0;
    let gameNow = 0;
    let pendulumAngle = 0;
    let shakeTimer = 0;
    let countdownDisplay = '';
    let players = [];
    let localPlayerIdx = 0;
    let rafId = null;

    // BPM segments for speed ramp
    let bpmSegments = [];

    // ---- Pause ----
    let pauseStartTime = 0;

    // ---- Survival ----
    let survivalStartTime = 0;
    let gameOverPlayed = false;
    let classicPendingEntry = null;
    let pendingResults = null;
    let resultsRevealAt = 0;
    let characterSelectMode = null;
    let characterSelectSlot = 0;
    let characterPreviewRaf = null;
    let characterSelections = { p1: 'knight', p2: 'knight' };
    let onlineRemoteSelections = { p1: 'knight', p2: 'knight' };
    let onlineLocalReady = false;
    let onlinePeerReady = false;
    let onlineMatchStartPending = false;

    // ---- Difficulty ----
    let selectedDifficulty = 'normal';
    let pendingMode = null;
    const DIFFICULTY_PRESETS = {
        easy:   { START_BPM: 40, MAX_BPM: 120, PERFECT_WINDOW: 0.10, GOOD_WINDOW: 0.14, MAX_HITS: 5, BPM_STEP: 3 },
        normal: {},
        hard:   { START_BPM: 80, MAX_BPM: 220, PERFECT_WINDOW: 0.05, GOOD_WINDOW: 0.07, MAX_HITS: 2, BPM_STEP: 8 },
    };
    let mutators = { oneHitKO: false, doubleRamp: false, invisibleBlade: false };
    let classicBpm = 60;

    // ---- Rematch / best-of-3 ----
    let seriesWins = [0, 0];
    let seriesRound = 0;
    const SERIES_MAX = 3;

    // ---- Settings ----
    let settings = {
        shakeEnabled: true,
        cameraEnabled: true,
    };

    // ---- Red flash for screen effects ----
    let redFlashTimer = 0;

    // ---- Announcer state ----
    let lastDangerAnnounce = -1;
    let lastStreakAnnounce = 0;

    // ---- Power-ups / Hazards ----
    let powerUps = [];
    let lastPowerUpBeat = 0;
    const POWERUP_INTERVAL = 12;
    const POWERUP_TYPES = ['shield', 'slow', 'doublePoints', 'spike'];

    // ---- Variable pendulum patterns ----
    let pendulumPattern = 'normal';
    let patternStartBeat = 0;

    // ---- Tutorial ----
    let tutorialStep = -1;
    let tutorialActive = false;

    // ---- Emotes ----
    const EMOTE_LIST = ['!', 'GG', 'Nice!', '...'];

    // ---- Impact cam ----
    let impactCam = {
        active: false, phase: 'none', startTime: 0, phaseTime: 0,
        playerIdx: -1, beatIdx: -1, startAngle: 0, angle: 0, zoom: 1,
        ragdoll: null, particles: [], splatters: [], hitApplied: false,
    };

    const CHARACTER_IDS = ['knight', 'peppers'];
    const CHARACTER_META = {
        knight: { label: 'KNIGHT', p1: 'knight_blue', p2: 'knight_red' },
        peppers: { label: 'PEPPERS', p1: 'pepper_orange', p2: 'pepper_blue' },
    };

    const $ = (id) => document.getElementById(id);

    function makePlayer(idx) {
        return {
            index: idx, score: 0, streak: 0, bestStreak: 0, combo: 0,
            hits: 0, isJumping: false, jumpStartTime: 0, jumpY: 0,
            lastPressTime: 0, resolvedBeats: new Set(),
            judgmentText: '', judgmentTimer: 0, hitTimer: 0, bloodSpurt: [],
            emote: null, emoteTimer: 0,
            shield: false, shieldTimer: 0, doublePoints: 0,
            spriteVariant: null,
        };
    }

    function isClassicMode() { return mode === 'classic'; }

    function normalizeCharacterId(id) {
        return CHARACTER_META[id] ? id : 'knight';
    }

    function characterLabel(id) {
        return CHARACTER_META[normalizeCharacterId(id)].label;
    }

    function characterVariant(id, slotKey) {
        const meta = CHARACTER_META[normalizeCharacterId(id)];
        return slotKey === 'p2' ? meta.p2 : meta.p1;
    }

    function slotKeyFromIndex(idx) {
        return idx === 1 ? 'p2' : 'p1';
    }

    function getLocalSlotKey() {
        if (characterSelectMode === 'online') {
            return MP.isHost ? 'p1' : 'p2';
        }
        return slotKeyFromIndex(localPlayerIdx);
    }

    // ---- Pendulum phase offset ----
    const BLADE_HALF = 32;
    let pendulumLead = 0;

    function computePendulumLead() {
        const charHalf = Sprites.spriteSize('knight_blue', 'idle').w / 2;
        const contactDist = BLADE_HALF + charHalf;
        const ratio = Math.min(1, contactDist / Renderer.ARM_LEN);
        const contactAngle = Math.asin(ratio);
        const fraction = Math.min(1, contactAngle / Renderer.MAX_ANGLE);
        pendulumLead = Math.asin(fraction) / Math.PI;
    }

    // ---- Timing ----
    function currentBeatContinuous(now) {
        const seg = bpmSegments[bpmSegments.length - 1];
        const elapsed = (now - gameStartTime - seg.startTime) / 1000;
        return seg.startBeat + elapsed * seg.bpm / 60;
    }

    function beatTimeMs(beatIdx) {
        for (let i = bpmSegments.length - 1; i >= 0; i--) {
            if (beatIdx >= bpmSegments[i].startBeat) {
                return gameStartTime + bpmSegments[i].startTime +
                    (beatIdx - bpmSegments[i].startBeat) * 60000 / bpmSegments[i].bpm;
            }
        }
        return gameStartTime;
    }

    function addBpmSegment(atBeat, newBpm) {
        const now = beatTimeMs(atBeat);
        bpmSegments.push({ startBeat: atBeat, bpm: newBpm, startTime: now - gameStartTime });
        bpm = newBpm;
        $('bpm-display').textContent = bpm + ' BPM';
        if (mode === 'online') {
            MP.send({ type: 'bpm', beat: atBeat, bpm: newBpm });
        }
    }

    // ---- Variable pendulum patterns ----
    function getPendulumPhase(totalBeats) {
        if (pendulumPattern === 'normal' || bpm < 140) {
            return totalBeats;
        }
        const localBeat = totalBeats - patternStartBeat;
        if (pendulumPattern === 'double') {
            // Two quick swings then a pause: compress 2 beats into 1 period, then hold
            const cycle = localBeat % 3;
            if (cycle < 2) return patternStartBeat + (localBeat - (localBeat % 3)) + cycle * 1.5;
            return patternStartBeat + (localBeat - (localBeat % 3)) + 3;
        }
        if (pendulumPattern === 'syncopation') {
            return totalBeats + 0.25 * Math.sin(totalBeats * Math.PI * 0.5);
        }
        if (pendulumPattern === 'pause') {
            const cycle = localBeat % 4;
            if (cycle < 3) return totalBeats;
            // Hold at apex for the 4th beat
            return patternStartBeat + (localBeat - cycle) + 3;
        }
        return totalBeats;
    }

    // ---- UI helpers ----
    function showScreen(name) {
        ['menu-screen', 'lobby-screen', 'results-screen', 'hud', 'debug-hud',
         'classic-hud', 'leaderboard-screen', 'character-select-screen', 'pause-screen', 'difficulty-screen', 'settings-screen', 'tutorial-overlay'].forEach((id) => {
            $(id).classList.add('hidden');
        });
        if (name) $(name).classList.remove('hidden');
    }

    function hideOverlay(name) {
        $(name).classList.add('hidden');
    }

    function showModeSetup(gameMode) {
        pendingMode = gameMode;
        showScreen('difficulty-screen');
        $('difficulty-title').textContent = gameMode === 'classic' ? 'CLASSIC MODE' : 'SELECT DIFFICULTY';
        const showClassic = gameMode === 'classic';
        $('classic-options').classList.toggle('hidden', !showClassic);
        const mutatorsEl = document.querySelector('.mutators');
        if (mutatorsEl) mutatorsEl.classList.toggle('hidden', showClassic);
        ['easy', 'normal', 'hard'].forEach((d) => {
            $('btn-diff-' + d).classList.toggle('hidden', showClassic);
        });
        updateDifficultyUI();
        if (showClassic) {
            $('diff-bpm').value = classicBpm;
            $('diff-bpm-val').textContent = classicBpm;
        }
    }

    function selectedCharacterForSlot(slotKey) {
        return normalizeCharacterId(characterSelections[slotKey] || onlineRemoteSelections[slotKey] || 'knight');
    }

    function setCharacterForSlot(slotKey, delta) {
        const current = selectedCharacterForSlot(slotKey);
        const idx = CHARACTER_IDS.indexOf(current);
        const next = CHARACTER_IDS[(idx + delta + CHARACTER_IDS.length) % CHARACTER_IDS.length];
        characterSelections[slotKey] = next;
        if (characterSelectMode === 'online' && slotKey === getLocalSlotKey()) {
            onlineLocalReady = false;
            MP.send({ type: 'character', slot: slotKey, character: next, ready: false });
        }
        renderCharacterSelect();
    }

    function renderCharacterPreview(canvasId, slotKey, characterId) {
        const canvas = $(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const variant = characterVariant(characterId, slotKey);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        const frame = Sprites.previewFrame(variant);
        const size = Sprites.spriteSize(variant, 'idle');
        const scale = Math.min((canvas.width - 16) / size.w, (canvas.height - 16) / size.h);
        const dw = Math.round(size.w * scale);
        const dh = Math.round(size.h * scale);
        const dx = Math.round((canvas.width - dw) / 2);
        const dy = Math.round((canvas.height - dh) / 2);
        ctx.drawImage(frame, dx, dy, dw, dh);
    }

    function renderCharacterSelect() {
        const p1Id = selectedCharacterForSlot('p1');
        const p2Id = selectedCharacterForSlot('p2');
        $('char-name-p1').textContent = characterLabel(p1Id);
        $('char-name-p2').textContent = characterLabel(p2Id);
        $('char-note-p1').textContent = characterVariant(p1Id, 'p1');
        $('char-note-p2').textContent = characterVariant(p2Id, 'p2');

        renderCharacterPreview('char-preview-p1', 'p1', p1Id);
        renderCharacterPreview('char-preview-p2', 'p2', p2Id);

        const showP2 = characterSelectMode === 'local' || characterSelectMode === 'online';
        $('char-card-p2').classList.toggle('hidden', !showP2);
        $('char-controls-p2').classList.toggle('hidden', !showP2);
        $('char-card-p1').classList.remove('hidden');
        $('char-controls-p1').classList.remove('hidden');

        const online = characterSelectMode === 'online';
        const localSlotKey = getLocalSlotKey();
        $('char-controls-p1').classList.toggle('locked', online && localSlotKey !== 'p1');
        $('char-controls-p2').classList.toggle('locked', online && localSlotKey !== 'p2');
        $('char-p1-prev').disabled = online && localSlotKey !== 'p1';
        $('char-p1-next').disabled = online && localSlotKey !== 'p1';
        $('char-p2-prev').disabled = online && localSlotKey !== 'p2';
        $('char-p2-next').disabled = online && localSlotKey !== 'p2';

        if (online) {
            if (onlineLocalReady && onlinePeerReady) {
                $('char-select-note').textContent = 'READY TO START.';
            } else if (onlineLocalReady) {
                $('char-select-note').textContent = 'WAITING FOR OPPONENT...';
            } else if (onlinePeerReady) {
                $('char-select-note').textContent = 'OPPONENT READY. READY UP.';
            } else {
                $('char-select-note').textContent = 'PICK YOUR CHARACTER AND READY UP.';
            }
        } else {
            $('char-select-note').textContent = 'CHOOSE YOUR HERO.';
        }
        $('btn-character-start').textContent = online
            ? (onlineLocalReady ? 'UNREADY' : 'READY')
            : 'START';
        $('btn-character-start').disabled = false;
    }

    function startCharacterPreviewLoop() {
        stopCharacterPreviewLoop();
        const tick = () => {
            if ($('character-select-screen').classList.contains('hidden')) return;
            renderCharacterSelect();
            characterPreviewRaf = requestAnimationFrame(tick);
        };
        characterPreviewRaf = requestAnimationFrame(tick);
    }

    function stopCharacterPreviewLoop() {
        if (characterPreviewRaf) cancelAnimationFrame(characterPreviewRaf);
        characterPreviewRaf = null;
    }

    function showCharacterSelect(gameMode) {
        pendingMode = gameMode;
        characterSelectMode = gameMode;
        characterSelectSlot = 0;
        if (gameMode === 'online') {
            onlineLocalReady = false;
            onlinePeerReady = false;
            onlineMatchStartPending = false;
            onlineRemoteSelections = { p1: 'knight', p2: 'knight' };
            const remoteSlotKey = getLocalSlotKey() === 'p1' ? 'p2' : 'p1';
            characterSelections[remoteSlotKey] = 'knight';
        }
        $('character-select-title').textContent = 'SELECT CHARACTER';
        $('char-p2-wrap').classList.toggle('hidden', gameMode !== 'local' && gameMode !== 'online');
        $('char-select-note').textContent = 'CHOOSE YOUR HERO.';
        showScreen('character-select-screen');
        renderCharacterSelect();
        syncOnlineCharacterState();
        startCharacterPreviewLoop();
    }

    function exitCharacterSelect() {
        characterSelectMode = null;
        stopCharacterPreviewLoop();
        $('character-select-screen').classList.add('hidden');
    }

    function maybeStartOnlineMatch() {
        if (characterSelectMode !== 'online') return;
        if (!MP.isHost || !onlineLocalReady || !onlinePeerReady) return;
        if (onlineMatchStartPending) return;
        onlineMatchStartPending = true;
        setTimeout(() => {
            onlineMatchStartPending = false;
            if (characterSelectMode !== 'online' || !onlineLocalReady || !onlinePeerReady) return;
            MP.send({ type: 'start', bpm: CFG.START_BPM });
            beginGame('online');
        }, 250);
    }

    function syncOnlineCharacterState() {
        if (characterSelectMode !== 'online' || !MP.connected()) return;
        const slotKey = getLocalSlotKey();
        MP.send({
            type: 'character',
            slot: slotKey,
            character: selectedCharacterForSlot(slotKey),
            ready: onlineLocalReady,
        });
    }

    function updateHUD() {
        if (isClassicMode()) {
            const elapsedMs = phase === 'playing' ? Math.max(0, gameNow - gameStartTime) : 0;
            $('classic-timer').textContent = formatClassicTime(elapsedMs);
            $('classic-combo-value').textContent = players[0] ? players[0].combo : 0;
            $('classic-points-value').textContent = players[0] ? players[0].score : 0;
            return;
        }

        players.forEach((p, i) => {
            const n = i + 1;
            $('score-p' + n).textContent = p.score;
            const maxH = CFG.MAX_HITS;
            const full = maxH - p.hits;
            let hearts = '';
            for (let h = 0; h < maxH; h++) {
                hearts += h < full
                    ? '<span class="heart-full">&#9829;</span>'
                    : '<span class="heart-empty">&#9829;</span>';
            }
            $('hearts-p' + n).innerHTML = hearts;
            const streakEl = $('streak-p' + n);
            let streakText = '';
            if (p.combo > 1) streakText = p.combo + 'x COMBO';
            else if (p.streak > 1) streakText = p.streak + 'x STREAK';
            streakEl.textContent = streakText;
        });
    }

    function formatClassicTime(elapsedMs) {
        const totalTenths = Math.floor(elapsedMs / 100);
        const tenths = totalTenths % 10;
        const totalSeconds = Math.floor(totalTenths / 10);
        const seconds = totalSeconds % 60;
        const minutes = Math.floor(totalSeconds / 60);
        const mm = String(minutes).padStart(2, '0');
        const ss = String(seconds).padStart(2, '0');
        return `${mm}:${ss}.${tenths}`;
    }

    // ---- Scoring helpers ----
    function scoreBase(p) { return p.doublePoints > 0 ? 2 : 1; }

    // ---- Core game actions ----
    function handleJump(playerIdx) {
        if (phase !== 'playing' || impactCam.active) return;
        const p = players[playerIdx];
        if (!p) return;

        const now = gameNow;
        if (now - p.lastPressTime < CFG.PRESS_COOLDOWN * 1000) return;
        p.lastPressTime = now;

        p.isJumping = true;
        p.jumpStartTime = now;
        SFX.playJump();
        haptic(20);

        const totalBeats = currentBeatContinuous(now);
        const nearestBeat = Math.round(totalBeats);
        if (nearestBeat < 0 || p.resolvedBeats.has(nearestBeat)) return;

        const beatMs = beatTimeMs(nearestBeat);
        const offsetSec = Math.abs(now - beatMs) / 1000;
        if (offsetSec > CFG.GOOD_WINDOW) return;

        let judgment;
        if (offsetSec <= CFG.PERFECT_WINDOW) {
            judgment = 'PERFECT';
            if (!isClassicMode()) {
                p.combo++;
                p.score += 2 * p.combo * scoreBase(p);
                SFX.playPerfect(p.combo);
            } else {
                p.combo++;
                p.score += 2;
                SFX.playAnnouncerPerfect();
            }
            p.streak++;
            if (p.combo >= 5 && p.combo > lastStreakAnnounce) {
                SFX.playAnnouncerStreak();
                lastStreakAnnounce = p.combo;
            }
        } else {
            judgment = 'GOOD';
            p.combo = 0;
            p.score += isClassicMode() ? 1 : 1 * scoreBase(p);
            p.streak++;
        }

        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.resolvedBeats.add(nearestBeat);
        p.judgmentText = judgment;
        p.judgmentTimer = 1.0;

        if (mode === 'online') {
            MP.send({
                type: 'action', beat: nearestBeat, judgment,
                score: p.score, hits: p.hits, streak: p.streak,
            });
        }
    }

    function wasAirborneAtBeat(player, beatIdx) {
        if (player.jumpStartTime <= 0) return false;
        const bTime = beatTimeMs(beatIdx);
        const jumpElapsed = (bTime - player.jumpStartTime) / 1000;
        if (jumpElapsed < 0 || jumpElapsed > CFG.JUMP_DURATION) return false;
        const height = CFG.JUMP_HEIGHT * Math.sin(Math.PI * (jumpElapsed / CFG.JUMP_DURATION));
        return height >= CFG.JUMP_HEIGHT * CFG.SAFE_HEIGHT_RATIO;
    }

    function applyHit(p, beatIdx) {
        if (isDebugInvincible()) return;
        if (isClassicMode()) {
            p.hits++;
            p.streak = 0;
            p.combo = 0;
            p.judgmentText = 'MISS';
            p.judgmentTimer = 1.0;
            SFX.playHit();
            Renderer.addBladeBlood();
            redFlashTimer = 0.3;
            haptic(50);
            if (p.hits >= CFG.MAX_HITS) {
                endGame(p.index);
            }
            return;
        }
        if (p.shield) {
            p.shield = false;
            p.shieldTimer = 0;
            p.judgmentText = 'BLOCKED';
            p.judgmentTimer = 1.0;
            return;
        }
        p.hits++;
        if (isDebugMode() && debugInfHearts) p.hits = Math.min(p.hits, CFG.MAX_HITS - 1);
        p.streak = 0;
        p.combo = 0;
        p.judgmentText = 'MISS';
        p.judgmentTimer = 1.0;
        SFX.playHit();
        Renderer.addBladeBlood();
        redFlashTimer = 0.3;
        haptic(50);

        // Danger announcer
        if (p.hits === CFG.MAX_HITS - 1 && lastDangerAnnounce !== p.hits) {
            SFX.playAnnouncerDanger();
            lastDangerAnnounce = p.hits;
        }
    }

    function resolveUnpressedBeat(beatIdx) {
        players.forEach((p) => {
            if (p.resolvedBeats.has(beatIdx)) return;
            if (mode === 'online' && p.index !== localPlayerIdx) return;

            p.resolvedBeats.add(beatIdx);

            if (wasAirborneAtBeat(p, beatIdx)) {
                p.combo = 0;
                p.score += 1 * scoreBase(p);
                p.streak++;
                p.bestStreak = Math.max(p.bestStreak, p.streak);
                p.judgmentText = 'GOOD';
                p.judgmentTimer = 1.0;
                if (mode === 'online') {
                    MP.send({ type: 'action', beat: beatIdx, judgment: 'GOOD',
                        score: p.score, hits: p.hits, streak: p.streak });
                }
                return;
            }

            applyHit(p, beatIdx);
            p.hitTimer = 0.7;
            shakeTimer = settings.shakeEnabled ? 0.15 : 0;
            spawnBloodSpurt(p);

            if (mode === 'online') {
                MP.send({ type: 'action', beat: beatIdx, judgment: 'MISS',
                    score: p.score, hits: p.hits, streak: 0 });
            }
        });
    }

    function checkWin() {
        for (let i = 0; i < players.length; i++) {
            if (players[i].hits >= CFG.MAX_HITS) {
                endGame(i);
                return true;
            }
        }
        return false;
    }

    function endGame(loserIdx) {
        if (phase === 'results' || gameOverPlayed) return;
        gameOverPlayed = true;
        phase = 'ending';
        SFX.stopMusic();

        let winner = -1;
        if (players.length > 1) {
            if (players[0].hits >= CFG.MAX_HITS && players[1].hits < CFG.MAX_HITS) winner = 1;
            else if (players[1].hits >= CFG.MAX_HITS && players[0].hits < CFG.MAX_HITS) winner = 0;
            else winner = players[0].score >= players[1].score ? 0 : 1;
        }

        if (winner >= 0) {
            SFX.playWin();
            seriesWins[winner]++;
        } else {
            SFX.playGameOver();
        }
        seriesRound++;
        const titleText = (() => {
            if (mode === 'survival') return 'GAME OVER';
            if (mode === 'classic' || mode === 'debug') return 'GAME OVER';
            if (winner === 0) return 'PLAYER 1 WINS';
            if (winner === 1) return 'PLAYER 2 WINS';
            return 'DRAW';
        })();
        const elapsed = (gameNow - gameStartTime) / 1000;
        const currentEntry = mode === 'classic' ? {
            score: players[0].score,
            time: elapsed,
            bpm,
            date: Date.now(),
            name: '',
        } : null;
        pendingResults = { winner, titleText, elapsed, currentEntry };
        resultsRevealAt = gameNow + 900;

        if (mode === 'online') {
            MP.send({ type: 'gameover', winner });
        }
    }

    function finalizeGameOver() {
        if (!pendingResults) return;
        const { winner, titleText, elapsed, currentEntry } = pendingResults;
        pendingResults = null;

        const title = $('results-title');
        title.textContent = titleText;
        if (mode === 'survival') {
            saveSurvivalHighScore(players[0].score, elapsed, bpm);
        }

        let body = '';
        if (mode === 'survival') {
            const hs = getSurvivalHighScore();
            body += `<div class="result-col">
                <div class="final-score">${players[0].score}</div>
                <div class="stat">Time: ${elapsed.toFixed(1)}s</div>
                <div class="stat">Final BPM: ${bpm}</div>
                <div class="stat">Best Combo: ${players[0].bestStreak > 1 ? players[0].bestStreak + 'x' : '-'}</div>
                <div class="stat" style="color:#FFD633">High Score: ${hs.score}</div>
            </div>`;
        } else if (mode === 'classic') {
            body += `<div class="result-col">
                <div class="final-score">${players[0].score}</div>
                <div class="stat">Time: ${elapsed.toFixed(1)}s</div>
                <div class="stat">Points: ${players[0].score}</div>
                <div class="stat">BPM: ${bpm}</div>
                <div class="stat">Hits Taken: ${players[0].hits}</div>
            </div>`;
            classicPendingEntry = currentEntry;
            showClassicEntryPrompt(currentEntry);
        } else {
            players.forEach((p, i) => {
                const isWinner = i === winner;
                body += `<div class="result-col">
                    <h3>P${i + 1}</h3>
                    <div class="final-score">${p.score}</div>
                    ${isWinner ? '<div class="winner-badge">WINNER</div>' : ''}
                    <div class="stat">Best Combo: ${p.bestStreak > 1 ? p.bestStreak + 'x' : '-'}</div>
                    <div class="stat">Hits Taken: ${p.hits}</div>
                </div>`;
            });
        }

        // Series info
        if (seriesRound > 0 && players.length > 1 && mode !== 'survival') {
            const s0 = seriesWins[0], s1 = seriesWins[1];
            body += `<div class="series-info">Round ${seriesRound} of ${SERIES_MAX} &mdash; P1 ${s0} : ${s1} P2</div>`;
        }

        $('results-body').innerHTML = body;

        // Update play again button text
        const playAgainBtn = $('btn-play-again');
        if (players.length > 1 && seriesRound < SERIES_MAX) {
            playAgainBtn.textContent = 'NEXT ROUND';
        } else if (seriesRound >= SERIES_MAX) {
            playAgainBtn.textContent = 'REMATCH';
        } else {
            playAgainBtn.textContent = 'PLAY AGAIN';
        }

        showScreen('results-screen');
    }

    // ---- Survival high score ----
    function saveSurvivalHighScore(score, time, finalBpm) {
        try {
            const hs = getSurvivalHighScore();
            if (score > (hs.score || 0)) {
                localStorage.setItem('clocksim_survival_hs', JSON.stringify({ score, time, bpm: finalBpm }));
            }
        } catch (e) { /* ignore */ }
    }

    function getSurvivalHighScore() {
        try {
            const raw = localStorage.getItem('clocksim_survival_hs');
            if (!raw) return { score: 0, time: 0, bpm: 0 };
            return JSON.parse(raw);
        } catch (e) { return { score: 0, time: 0, bpm: 0 }; }
    }

    // ---- Classic leaderboard ----
    const CLASSIC_LB_KEY = 'clocksim_classic_lb';
    const CLASSIC_LB_MAX = 10;

    function getClassicLeaderboard() {
        try {
            const raw = localStorage.getItem(CLASSIC_LB_KEY);
            const rows = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(rows)) return [];
            return rows.filter((row) => row
                && typeof row.time === 'number'
                && typeof row.score === 'number'
                && typeof row.name === 'string');
        } catch (e) {
            return [];
        }
    }

    function normalizeClassicName(raw) {
        return String(raw || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 6);
    }

    function dedupeClassicLeaderboard(rows) {
        const map = new Map();
        rows.forEach((row) => {
            const name = normalizeClassicName(row.name);
            if (!name) return;
            const candidate = { ...row, name };
            const existing = map.get(name);
            if (!existing || candidate.time > existing.time || (candidate.time === existing.time && candidate.score > existing.score)) {
                map.set(name, candidate);
            }
        });
        return [...map.values()];
    }

    function sortClassicLeaderboard(rows) {
        return rows.sort((a, b) => {
            if (b.time !== a.time) return b.time - a.time;
            if (b.score !== a.score) return b.score - a.score;
            return (a.date || 0) - (b.date || 0);
        });
    }

    function saveClassicLeaderboardEntry(entry) {
        try {
            const name = normalizeClassicName(entry.name);
            if (!name) return { saved: false, leaderboard: getClassicLeaderboard() };

            const rows = dedupeClassicLeaderboard(getClassicLeaderboard());
            const current = { ...entry, name };
            const existingIndex = rows.findIndex((row) => row.name === name);
            const sortedBefore = sortClassicLeaderboard([...rows]);
            const qualifies = existingIndex >= 0
                || sortedBefore.length < CLASSIC_LB_MAX
                || current.time > sortedBefore[sortedBefore.length - 1].time;

            if (!qualifies) {
                return { saved: false, leaderboard: sortedBefore.slice(0, CLASSIC_LB_MAX) };
            }

            if (existingIndex >= 0) {
                const existing = rows[existingIndex];
                if (current.time <= existing.time) {
                    return { saved: false, leaderboard: sortClassicLeaderboard([...rows]).slice(0, CLASSIC_LB_MAX) };
                }
                rows[existingIndex] = current;
            } else {
                rows.push(current);
            }

            const trimmed = sortClassicLeaderboard(dedupeClassicLeaderboard(rows)).slice(0, CLASSIC_LB_MAX);
            localStorage.setItem(CLASSIC_LB_KEY, JSON.stringify(trimmed));
            return { saved: true, leaderboard: trimmed };
        } catch (e) { /* ignore */ }
        return { saved: false, leaderboard: [] };
    }

    function formatClassicLeaderboardTime(time) {
        return `${time.toFixed(1)}s`;
    }

    function renderClassicLeaderboard(currentEntry) {
        const rows = sortClassicLeaderboard(dedupeClassicLeaderboard(getClassicLeaderboard()));
        let html = '<div class="leaderboard-panel"><div class="leaderboard-title">GLOBAL LEADERBOARD</div>';
        if (rows.length === 0) {
            html += '<div class="leaderboard-empty">NO RUNS YET</div>';
        } else {
            html += '<div class="leaderboard-head"><span>RANK</span><span>NAME</span><span>TIME</span><span>POINTS</span><span>BPM</span></div>';
            rows.forEach((row, index) => {
                const isCurrent = currentEntry
                    && normalizeClassicName(row.name) === normalizeClassicName(currentEntry.name)
                    && row.time === currentEntry.time
                    && row.score === currentEntry.score
                    && row.bpm === currentEntry.bpm
                    && row.date === currentEntry.date;
                html += `<div class="leaderboard-row${isCurrent ? ' leaderboard-current' : ''}">
                    <span>#${index + 1}</span>
                    <span>${row.name}</span>
                    <span>${formatClassicLeaderboardTime(row.time)}</span>
                    <span>${row.score}</span>
                    <span>${row.bpm}</span>
                </div>`;
            });
        }
        html += '</div>';
        return html;
    }

    function showClassicEntryPrompt(entry) {
        classicPendingEntry = entry;
        $('classic-entry-panel').classList.remove('hidden');
        $('classic-leaderboard-panel').classList.add('hidden');
        $('classic-leaderboard-panel').innerHTML = '';
        $('classic-name-input').value = '';
        $('classic-entry-note').textContent = 'ENTER 1-6 CHAR NAME. ONLY NEW HIGH SCORES SAVE.';
        $('btn-classic-submit').classList.remove('hidden');
        setTimeout(() => {
            const input = $('classic-name-input');
            if (input) input.focus();
        }, 0);
    }

    function showClassicLeaderboard(entry) {
        $('classic-entry-panel').classList.add('hidden');
        const panel = $('classic-leaderboard-panel');
        panel.innerHTML = renderClassicLeaderboard(entry);
        panel.classList.remove('hidden');
    }

    function resetClassicResultsUI() {
        classicPendingEntry = null;
        $('classic-entry-panel').classList.add('hidden');
        $('classic-leaderboard-panel').classList.add('hidden');
        $('classic-leaderboard-panel').innerHTML = '';
        $('classic-name-input').value = '';
        $('classic-entry-note').textContent = 'ENTER 1-6 CHAR NAME. ONLY NEW HIGH SCORES SAVE.';
        $('btn-classic-submit').classList.remove('hidden');
    }

    function showGlobalLeaderboard() {
        $('leaderboard-body').innerHTML = renderClassicLeaderboard(null);
        showScreen('leaderboard-screen');
    }

    // ---- Mini blood spurt for non-fatal hits ----
    function spawnBloodSpurt(player) {
        const arenaW = isSinglePlayer() ? Renderer.CW : Renderer.CW / 2;
        const arenaX = (player.index === 1) ? Renderer.CW / 2 : 0;
        const cx = arenaX + arenaW / 2;
        const variant = player.spriteVariant || (player.index === 0 ? 'knight_blue' : 'knight_red');
        const charSize = Sprites.spriteSize(variant, 'idle');
        const originX = cx;
        const originY = Renderer.PLATFORM_Y - charSize.h * 0.4;
        for (let i = 0; i < 8; i++) {
            player.bloodSpurt.push({
                x: originX + (Math.random() - 0.5) * 6,
                y: originY + (Math.random() - 0.5) * 10,
                vx: (Math.random() - 0.5) * 120,
                vy: -Math.random() * 140 - 30,
                life: 0.4 + Math.random() * 0.3,
                size: 1 + Math.random() * 2,
            });
        }
    }

    function isSinglePlayer() {
        return mode === 'classic' || mode === 'debug' || mode === 'survival';
    }

    // ---- Impact cam system ----
    function easeInQuad(t) { return t * t; }
    function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
    function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function startImpactCam(playerIdx, beatIdx) {
        impactCam = {
            active: true, phase: 'zoomin', startTime: gameNow, phaseTime: gameNow,
            playerIdx, beatIdx, startAngle: pendulumAngle, angle: pendulumAngle,
            zoom: 1, ragdoll: null, particles: [], splatters: [], hitApplied: false,
        };
    }

    function updateImpactCam(dt, now) {
        const elapsed = (now - impactCam.phaseTime) / 1000;
        switch (impactCam.phase) {
            case 'zoomin': {
                const DUR = 0.25;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 1 + 1.5 * easeInOutQuad(t);
                if (t >= 1) { impactCam.phase = 'impact'; impactCam.phaseTime = now; spawnImpactEffects(); }
                break;
            }
            case 'impact': {
                const DUR = 0.15;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.5 + 0.3 * Math.sin(t * Math.PI * 6);
                shakeTimer = 0.15;
                if (t >= 1) { impactCam.phase = 'aftermath'; impactCam.phaseTime = now; }
                break;
            }
            case 'aftermath': {
                const DUR = 1.3;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.5 - 0.5 * easeOutQuad(t);
                updateRagdoll(dt);
                updateBloodParticles(dt);
                if (t >= 1) { impactCam.phase = 'zoomout'; impactCam.phaseTime = now; }
                break;
            }
            case 'zoomout': {
                const DUR = 0.5;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.0 - 1.0 * easeInOutQuad(t);
                updateRagdoll(dt);
                updateBloodParticles(dt);
                if (t >= 1) endImpactCam(now);
                break;
            }
        }
        if (shakeTimer > 0) shakeTimer -= dt;
    }

    function spawnImpactEffects() {
        const arenaW = isSinglePlayer() ? Renderer.CW : Renderer.CW / 2;
        const arenaX = (impactCam.playerIdx === 1) ? Renderer.CW / 2 : 0;
        const cx = arenaX + arenaW / 2;
        const variant = players[impactCam.playerIdx].spriteVariant || (impactCam.playerIdx === 0 ? 'knight_blue' : 'knight_red');
        const charSize = Sprites.spriteSize(variant, 'death');
        const bladeDir = impactCam.startAngle >= 0 ? 1 : -1;
        const slideDir = -bladeDir;

        impactCam.ragdoll = {
            x: cx - charSize.w / 2, y: Renderer.PLATFORM_Y - charSize.h,
            vx: slideDir * (140 + Math.random() * 60), vy: -(200 + Math.random() * 80),
            rotation: 0, vr: 0, w: charSize.w, h: charSize.h,
            palette: variant, state: 'death',
            onGround: false, sliding: false, slideDir, hitProgress: 0,
            slideSpeed: 0, trail: [], trailTimer: 0,
        };

        const impactX = cx;
        const impactY = Renderer.PLATFORM_Y - charSize.h * 0.4;
        for (let i = 0; i < 40; i++) {
            const spread = (Math.random() - 0.5) * 2;
            impactCam.particles.push({
                x: impactX + spread * 14, y: impactY + (Math.random() - 0.5) * 20,
                vx: spread * 300 + bladeDir * 120, vy: -Math.random() * 350 - 60,
                life: 0.8 + Math.random() * 0.6, size: 1.5 + Math.random() * 4,
                gravity: 500 + Math.random() * 200, landed: false,
            });
        }
    }

    function updateRagdoll(dt) {
        const r = impactCam.ragdoll;
        if (!r) return;

        if (r.sliding) {
            r.y = Renderer.PLATFORM_Y - r.w / 2 - r.h / 2;
            const friction = 220;
            if (Math.abs(r.slideSpeed) > 5) {
                r.slideSpeed -= Math.sign(r.slideSpeed) * friction * dt;
                r.x += r.slideSpeed * dt;
                r.trailTimer -= dt;
                if (r.trailTimer <= 0) {
                    r.trailTimer = 0.015;
                    r.trail.push({
                        x: r.x + r.w / 2 - r.slideDir * r.w * 0.4,
                        y: Renderer.PLATFORM_Y - 2,
                        size: 2 + Math.random() * 2.5,
                    });
                }
            } else {
                r.slideSpeed = 0; r.onGround = true;
            }
            r.hitProgress = 1;
            return;
        }

        r.vy += 800 * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;

        r.hitProgress = Math.min(1, r.hitProgress + dt / 0.3);
        const targetRot = r.slideDir * (Math.PI / 2);
        r.rotation += (targetRot - r.rotation) * Math.min(1, dt * 10);

        if (r.y >= Renderer.PLATFORM_Y - r.h) {
            r.y = Renderer.PLATFORM_Y - r.h; r.vy = 0; r.vx = 0;
            r.rotation = targetRot; r.sliding = true;
            r.slideSpeed = r.slideDir * (200 + Math.random() * 60);
            r.hitProgress = 1; shakeTimer = 0.1;
        }
    }

    function updateBloodParticles(dt) {
        impactCam.particles.forEach(p => {
            if (p.landed) return;
            p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt;
            p.life -= dt * 0.6;
            if (p.y >= Renderer.PLATFORM_Y - 1) {
                p.y = Renderer.PLATFORM_Y - 1; p.landed = true; p.vx = 0; p.vy = 0;
                impactCam.splatters.push({ x: p.x, y: Renderer.PLATFORM_Y - 1, size: p.size * 1.8 });
            }
        });
        impactCam.particles = impactCam.particles.filter(p => p.life > 0 || p.landed);
    }

    function endImpactCam(now) {
        gameStartTime += now - impactCam.startTime;
        impactCam.active = false;
        impactCam.phase = 'none';
        shakeTimer = 0;
        updateHUD();
        checkWin();
    }

    // ---- Power-ups ----
    function spawnPowerUp(beatIdx) {
        if (mode === 'online' || isClassicMode()) return;
        if (beatIdx - lastPowerUpBeat < POWERUP_INTERVAL) return;
        if (Math.random() > 0.4) return;

        lastPowerUpBeat = beatIdx;
        const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        const arenaW = isSinglePlayer() ? Renderer.CW : Renderer.CW / 2;

        for (let pi = 0; pi < players.length; pi++) {
            const arenaX = pi === 1 ? Renderer.CW / 2 : 0;
            const cx = arenaX + arenaW / 2;
            const offset = (Math.random() - 0.5) * arenaW * 0.4;
            powerUps.push({
                x: cx + offset, y: Renderer.PLATFORM_Y - 10,
                type, life: 8, playerArena: pi,
            });
        }
    }

    function updatePowerUps(dt) {
        if (isClassicMode()) return;
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const pu = powerUps[i];
            pu.life -= dt;
            if (pu.life <= 0) { powerUps.splice(i, 1); continue; }

            const p = players[pu.playerArena];
            if (!p) continue;

            const arenaW = isSinglePlayer() ? Renderer.CW : Renderer.CW / 2;
            const arenaX = pu.playerArena === 1 ? Renderer.CW / 2 : 0;
            const px = arenaX + arenaW / 2;

            // When player is grounded, slide the power-up toward them
            if (!p.isJumping) {
                const dx = px - pu.x;
                pu.x += dx * Math.min(1, dt * 4);
            }

            if (Math.abs(px - pu.x) < 8) {
                collectPowerUp(p, pu);
                powerUps.splice(i, 1);
            }
        }
    }

    function collectPowerUp(player, pu) {
        if (isClassicMode()) return;
        switch (pu.type) {
            case 'shield':
                player.shield = true;
                player.shieldTimer = 10;
                break;
            case 'slow':
                if (bpm > CFG.START_BPM) {
                    const totalBeats = currentBeatContinuous(gameNow);
                    addBpmSegment(Math.floor(totalBeats), Math.max(CFG.START_BPM, bpm * 0.5));
                }
                break;
            case 'doublePoints':
                player.doublePoints = 5;
                break;
            case 'spike':
                if (!isDebugInvincible() && !player.shield) {
                    applyHit(player, -1);
                    player.hitTimer = 0.7;
                    shakeTimer = settings.shakeEnabled ? 0.15 : 0;
                    spawnBloodSpurt(player);
                }
                break;
        }
    }

    // ---- Countdown & Start ----
    function startCountdown() {
        phase = 'countdown';
        countdownStartTime = gameNow;
        countdownDisplay = '';
        computePendulumLead();
        showScreen(isClassicMode() ? 'classic-hud' : 'hud');
        if (mode === 'debug') showDebugHUD();
        updateHUD();
    }

    function startPlaying() {
        phase = 'playing';
        gameStartTime = gameNow;
        survivalStartTime = gameNow;
        lastResolvedBeat = -1;
        lastTickBeat = 0;
        bpm = CFG.START_BPM;
        bpmSegments = [{ startBeat: 0, bpm, startTime: 0 }];
        $('bpm-display').textContent = bpm + ' BPM';
        SFX.startMusic();
        lastDangerAnnounce = -1;
        lastStreakAnnounce = 0;
        powerUps = [];
        lastPowerUpBeat = 0;
        pendulumPattern = 'normal';
        patternStartBeat = 0;
        updateHUD();
    }

    // ---- Update ----
    function update(dt) {
        const now = gameNow;

        if (impactCam.active) { updateImpactCam(dt, now); return; }

        if (phase === 'ending') {
            players.forEach((p) => {
                if (p.isJumping) {
                    const jElapsed = (now - p.jumpStartTime) / 1000;
                    const jProgress = jElapsed / CFG.JUMP_DURATION;
                    if (jProgress >= 1) { p.isJumping = false; p.jumpY = 0; }
                    else { p.jumpY = CFG.JUMP_HEIGHT * Math.sin(Math.PI * jProgress); }
                }
                if (p.judgmentTimer > 0) p.judgmentTimer -= dt;
                if (p.hitTimer > 0) p.hitTimer -= dt;
                if (p.emoteTimer > 0) p.emoteTimer -= dt;
                if (p.emoteTimer <= 0) p.emote = null;
                if (p.shieldTimer > 0) { p.shieldTimer -= dt; if (p.shieldTimer <= 0) p.shield = false; }
                if (p.doublePoints > 0) p.doublePoints -= dt;
                if (p.bloodSpurt.length > 0) {
                    p.bloodSpurt.forEach(b => {
                        b.vy += 400 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt * 1.5;
                    });
                    p.bloodSpurt = p.bloodSpurt.filter(b => b.life > 0);
                }
            });

            if (shakeTimer > 0) shakeTimer -= dt;
            if (redFlashTimer > 0) redFlashTimer -= dt;

            if (gameNow >= resultsRevealAt) {
                phase = 'results';
                finalizeGameOver();
            }
            updateHUD();
            return;
        }

        // Countdown
        if (phase === 'countdown') {
            const elapsed = (now - countdownStartTime) / 1000;
            const beatInterval = 60 / CFG.START_BPM;
            const countBeat = Math.floor(elapsed / beatInterval);
            const remaining = CFG.COUNTDOWN_BEATS - 1 - countBeat;

            if (remaining >= 1) {
                const newDisplay = String(remaining);
                if (countdownDisplay !== newDisplay) { countdownDisplay = newDisplay; SFX.playCountdown(); }
            } else if (remaining === 0) {
                if (countdownDisplay !== 'GO') { countdownDisplay = 'GO'; SFX.playGo(); }
            }

            const previewBeats = elapsed / beatInterval;
            pendulumAngle = Renderer.MAX_ANGLE * Math.sin(Math.PI * (previewBeats - pendulumLead));

            if (elapsed >= CFG.COUNTDOWN_BEATS * beatInterval) startPlaying();
            return;
        }

        if (phase !== 'playing') return;

        const totalBeats = currentBeatContinuous(now);
        const currentBeatInt = Math.floor(totalBeats);

        // Pendulum with variable patterns
        const displayBeats = getPendulumPhase(totalBeats);
        pendulumAngle = Renderer.MAX_ANGLE * Math.sin(Math.PI * (displayBeats - pendulumLead));

        // Music beat
        if (currentBeatInt > lastTickBeat) {
            SFX.musicBeat(currentBeatInt, bpm);
        }

        // Metronome tick
        if (currentBeatInt > lastTickBeat) {
            lastTickBeat = currentBeatInt;
            SFX.playTick();

            if (mode !== 'online' && currentBeatInt > 0) {
                for (let i = 0; i < players.length; i++) {
                    const p = players[i];
                    if (p.resolvedBeats.has(currentBeatInt)) continue;

                    if (wasAirborneAtBeat(p, currentBeatInt)) {
                        p.resolvedBeats.add(currentBeatInt);
                        p.combo = 0;
                        p.score += 1 * scoreBase(p);
                        p.streak++;
                        p.bestStreak = Math.max(p.bestStreak, p.streak);
                        p.judgmentText = 'GOOD';
                        p.judgmentTimer = 1.0;
                        continue;
                    }

                    p.resolvedBeats.add(currentBeatInt);
                    applyHit(p, currentBeatInt);

                    if (p.hits >= CFG.MAX_HITS) {
                        startImpactCam(i, currentBeatInt);
                        return;
                    }

                    p.hitTimer = 0.7;
                    shakeTimer = settings.shakeEnabled ? 0.15 : 0;
                    spawnBloodSpurt(p);
                }
                lastResolvedBeat = Math.max(lastResolvedBeat, currentBeatInt);
                if (checkWin()) return;
            }

            // Power-up spawning
            if (!isClassicMode()) spawnPowerUp(currentBeatInt);
        }

        // Safety net
        for (let b = lastResolvedBeat + 1; b < currentBeatInt; b++) {
            resolveUnpressedBeat(b);
            lastResolvedBeat = b;
            if (checkWin()) return;
        }

        if (!isClassicMode()) {
            // BPM ramp
            const maxBpm = mode === 'survival' ? Infinity : CFG.MAX_BPM;
            if (currentBeatInt > 0 && currentBeatInt % CFG.BEATS_PER_LEVEL === 0) {
                const step = mutators.doubleRamp ? CFG.BPM_STEP * 2 : CFG.BPM_STEP;
                const expectedBpm = CFG.START_BPM + (currentBeatInt / CFG.BEATS_PER_LEVEL) * step;
                if (bpm < expectedBpm && bpm < maxBpm) {
                    addBpmSegment(currentBeatInt, Math.min(expectedBpm, maxBpm));
                }
            }

            // Variable pendulum pattern switching at high BPM
            if (bpm >= 140 && currentBeatInt > 0 && currentBeatInt % 16 === 0 && pendulumPattern === 'normal') {
                const patterns = ['double', 'syncopation', 'pause'];
                pendulumPattern = patterns[Math.floor(Math.random() * patterns.length)];
                patternStartBeat = currentBeatInt;
            } else if (pendulumPattern !== 'normal' && currentBeatInt - patternStartBeat >= 8) {
                pendulumPattern = 'normal';
            }
        }

        // Power-ups update
        if (!isClassicMode()) updatePowerUps(dt);

        // Update player animations
        players.forEach((p) => {
            if (p.isJumping) {
                const jElapsed = (now - p.jumpStartTime) / 1000;
                const jProgress = jElapsed / CFG.JUMP_DURATION;
                if (jProgress >= 1) { p.isJumping = false; p.jumpY = 0; }
                else { p.jumpY = CFG.JUMP_HEIGHT * Math.sin(Math.PI * jProgress); }
            }
            if (p.judgmentTimer > 0) p.judgmentTimer -= dt;
            if (p.hitTimer > 0) p.hitTimer -= dt;
            if (p.emoteTimer > 0) p.emoteTimer -= dt;
            if (p.emoteTimer <= 0) p.emote = null;
            if (p.shieldTimer > 0) { p.shieldTimer -= dt; if (p.shieldTimer <= 0) p.shield = false; }
            if (p.doublePoints > 0) p.doublePoints -= dt;

            if (p.bloodSpurt.length > 0) {
                p.bloodSpurt.forEach(b => {
                    b.vy += 400 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt * 1.5;
                });
                p.bloodSpurt = p.bloodSpurt.filter(b => b.life > 0);
            }
        });

        if (shakeTimer > 0) shakeTimer -= dt;
        if (redFlashTimer > 0) redFlashTimer -= dt;

        updateHUD();
    }

    // ---- Main loop ----
    function loop(timestamp) {
        const rawDt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
        lastFrameTime = timestamp;

        const speed = isDebugMode() ? debugSpeed : 1;
        const dt = rawDt * speed;
        gameNow += dt * 1000;

        update(dt);

        let displayAngle = pendulumAngle;
        if (phase === 'menu' || phase === 'lobby' || phase === 'results' || phase === 'paused') {
            displayAngle = Renderer.MAX_ANGLE * 0.4 * Math.sin(performance.now() / 1000);
        }

        Renderer.render({
            mode, phase, players, bpm, maxBpm: CFG.MAX_BPM,
            pendulumAngle: impactCam.active ? pendulumAngle : displayAngle,
            countdownDisplay, shakeTimer: settings.shakeEnabled ? shakeTimer : 0,
            redFlashTimer,
            invisibleBlade: mutators.invisibleBlade && bpm > 120,
            powerUps: isClassicMode() ? [] : powerUps,
            impactCam: impactCam.active ? {
                playerIdx: impactCam.playerIdx, phase: impactCam.phase,
                zoom: impactCam.zoom, ragdoll: impactCam.ragdoll,
                particles: impactCam.particles, splatters: impactCam.splatters,
            } : null,
            cameraEnabled: settings.cameraEnabled,
        });

        rafId = requestAnimationFrame(loop);
    }

    // ---- Pause ----
    function pauseGame() {
        if (phase !== 'playing' || mode === 'online') return;
        phase = 'paused';
        pauseStartTime = gameNow;
        $('pause-screen').classList.remove('hidden');
    }

    function resumeGame() {
        if (phase !== 'paused') return;
        const pauseDuration = gameNow - pauseStartTime;
        gameStartTime += pauseDuration;
        phase = 'playing';
        hideOverlay('pause-screen');
    }

    // ---- Online message handler ----
    function onRemoteMessage(data) {
        if (data.type === 'peer-connected') {
            if (MP.isHost) {
                if (characterSelectMode !== 'online') {
                    showCharacterSelect('online');
                } else {
                    onlinePeerReady = false;
                    renderCharacterSelect();
                }
                syncOnlineCharacterState();
            }
        }
        if (data.type === 'start') {
            beginGame('online');
        }
        if (data.type === 'character') {
            const slotKey = data.slot === 'p2' ? 'p2' : 'p1';
            const characterId = normalizeCharacterId(data.character);
            characterSelections[slotKey] = characterId;
            if (slotKey !== getLocalSlotKey()) {
                onlineRemoteSelections[slotKey] = characterId;
                onlinePeerReady = !!data.ready;
            } else {
                onlineLocalReady = !!data.ready;
            }
            renderCharacterSelect();
            maybeStartOnlineMatch();
        }
        const remoteIdx = 1 - localPlayerIdx;
        if (data.type === 'action' && players[remoteIdx]) {
            const p = players[remoteIdx];
            const prevHits = p.hits;
            p.score = data.score;
            p.hits = data.hits;
            p.streak = data.streak;
            p.judgmentText = data.judgment;
            p.judgmentTimer = 1.0;
            if (p.hits > prevHits) p.hitTimer = 0.5;
            if (data.judgment !== 'MISS' && !p.isJumping) {
                p.isJumping = true;
                p.jumpStartTime = gameNow;
            }
            p.resolvedBeats.add(data.beat);
            if (p.hits >= CFG.MAX_HITS && phase === 'playing') endGame();
        }
        if (data.type === 'emote' && players[remoteIdx]) {
            players[remoteIdx].emote = EMOTE_LIST[data.emote] || '!';
            players[remoteIdx].emoteTimer = 1.5;
        }
        if (data.type === 'bpm' && !MP.isHost) {
            bpmSegments.push({ startBeat: data.beat, bpm: data.bpm, startTime: beatTimeMs(data.beat) - gameStartTime });
            bpm = data.bpm;
            $('bpm-display').textContent = bpm + ' BPM';
        }
        if (data.type === 'gameover') {
            if (phase === 'playing') endGame();
        }
    }

    // ---- Apply difficulty ----
    function applyDifficulty() {
        Object.assign(CFG, CFG_DEFAULTS);
        const preset = DIFFICULTY_PRESETS[selectedDifficulty];
        if (preset) Object.assign(CFG, preset);
        if (mutators.oneHitKO) CFG.MAX_HITS = 1;
    }

    // ---- Game start ----
    function beginGame(gameMode) {
        mode = gameMode;
        characterSelectMode = null;
        onlineMatchStartPending = false;
        stopCharacterPreviewLoop();
        pendingResults = null;
        resultsRevealAt = 0;
        localPlayerIdx = (mode === 'online' && !MP.isHost) ? 1 : 0;
        players = [makePlayer(0)];
        if (mode !== 'classic' && mode !== 'debug' && mode !== 'survival') players.push(makePlayer(1));
        if (mode === 'classic') CFG.MAX_HITS = 1;
        players.forEach((p) => {
            const slotKey = slotKeyFromIndex(p.index);
            p.spriteVariant = characterVariant(selectedCharacterForSlot(slotKey), slotKey);
        });

        const p2hud = $('hud-p2');
        p2hud.style.display = isSinglePlayer() ? 'none' : '';
        if (mode === 'debug') showDebugHUD();
        else $('debug-hud').classList.add('hidden');

        pendulumAngle = 0;
        shakeTimer = 0;
        redFlashTimer = 0;
        Renderer.resetRope();
        Renderer.resetBladeBlood();
        Renderer.resetEffects();
        impactCam = {
            active: false, phase: 'none', startTime: 0, phaseTime: 0,
            playerIdx: -1, beatIdx: -1, startAngle: 0, angle: 0, zoom: 1,
            ragdoll: null, particles: [], splatters: [], hitApplied: false,
        };
        bpm = CFG.START_BPM;
        bpmSegments = [{ startBeat: 0, bpm, startTime: 0 }];
        $('bpm-display').textContent = bpm + ' BPM';
        gameOverPlayed = false;

        startCountdown();
    }

    // ---- Mobile haptic ----
    function haptic(ms) {
        if (navigator.vibrate) navigator.vibrate(ms);
    }

    // ---- Input ----
    function setupInput() {
        document.addEventListener('keydown', (e) => {
            // Pause
            if (e.key === 'Escape') {
                if (phase === 'playing' && mode !== 'online') { e.preventDefault(); pauseGame(); return; }
                if (phase === 'paused') { e.preventDefault(); resumeGame(); return; }
            }

            if (phase === 'paused') return;
            if (phase !== 'playing') return;
            if (e.repeat) return;

            const key = e.key;
            if (key === ' ' || key === 'w' || key === 'W') {
                e.preventDefault();
                handleJump(mode === 'online' ? localPlayerIdx : 0);
            }
            if (mode === 'local') {
                if (key === 'ArrowUp' || key === 'Enter') {
                    e.preventDefault();
                    handleJump(1);
                }
            }

            // Emotes (1-4)
            if (key >= '1' && key <= '4') {
                const idx = parseInt(key) - 1;
                const pIdx = mode === 'online' ? localPlayerIdx : 0;
                const p = players[pIdx];
                if (p) {
                    p.emote = EMOTE_LIST[idx];
                    p.emoteTimer = 1.5;
                    if (mode === 'online') MP.send({ type: 'emote', emote: idx });
                }
            }
        });

        const canvas = $('game-canvas');
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (phase !== 'playing') return;
            if (mode === 'local') {
                const touch = e.touches[0];
                const rect = canvas.getBoundingClientRect();
                const x = touch.clientX - rect.left;
                if (x < rect.width / 2) handleJump(0);
                else handleJump(1);
            } else {
                handleJump(mode === 'online' ? localPlayerIdx : 0);
            }
        });
    }

    // ---- Menu wiring ----
    function setupMenus() {
        // Difficulty flow: clicking Practice/Local/Survival shows difficulty screen
        $('btn-classic').addEventListener('click', () => {
            SFX.init();
            if (shouldShowTutorial()) {
                pendingMode = 'classic';
                startTutorial();
                return;
            }
            showCharacterSelect('classic');
        });

        $('btn-leaderboards').addEventListener('click', () => {
            SFX.init();
            showGlobalLeaderboard();
        });

        $('classic-name-input').addEventListener('input', (e) => {
            const normalized = normalizeClassicName(e.target.value);
            if (e.target.value !== normalized) e.target.value = normalized;
        });

        $('classic-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                $('btn-classic-submit').click();
            }
        });

        $('btn-survival').addEventListener('click', () => {
            SFX.init();
            showCharacterSelect('survival');
        });

        $('btn-local').addEventListener('click', () => {
            SFX.init();
            showCharacterSelect('local');
        });

        $('btn-online').addEventListener('click', () => {
            SFX.init();
            phase = 'lobby';
            showScreen('lobby-screen');
            $('room-code-display').classList.add('hidden');
            $('lobby-status').textContent = '';
        });

        // Difficulty screen
        ['easy', 'normal', 'hard'].forEach(d => {
            $('btn-diff-' + d).addEventListener('click', () => {
                selectedDifficulty = d;
                updateDifficultyUI();
                // Sync BPM slider to the preset's starting BPM
                const preset = DIFFICULTY_PRESETS[d];
                const presetBpm = preset.START_BPM || CFG_DEFAULTS.START_BPM;
                if (!$('classic-options').classList.contains('hidden')) {
                    classicBpm = presetBpm;
                    $('diff-bpm').value = presetBpm;
                    $('diff-bpm-val').textContent = presetBpm;
                }
            });
        });

        $('diff-bpm').addEventListener('input', (e) => {
            classicBpm = parseInt(e.target.value, 10);
            $('diff-bpm-val').textContent = classicBpm;
        });

        $('btn-diff-start').addEventListener('click', () => {
            if (pendingMode === 'classic') {
                mutators.oneHitKO = false;
                mutators.doubleRamp = false;
                mutators.invisibleBlade = false;
                Object.assign(CFG, CFG_DEFAULTS);
                CFG.MAX_HITS = 1;
                CFG.START_BPM = classicBpm;
                CFG.MAX_BPM = classicBpm;
            } else {
                mutators.oneHitKO = $('mut-onehit').checked;
                mutators.doubleRamp = $('mut-doubleramp').checked;
                mutators.invisibleBlade = $('mut-invisible').checked;
                applyDifficulty();
            }
            seriesWins = [0, 0];
            seriesRound = 0;
            beginGame(pendingMode);
        });

        $('btn-diff-back').addEventListener('click', () => {
            if (pendingMode) showCharacterSelect(pendingMode);
            else showScreen('menu-screen');
        });

        $('char-p1-prev').addEventListener('click', () => setCharacterForSlot('p1', -1));
        $('char-p1-next').addEventListener('click', () => setCharacterForSlot('p1', 1));
        $('char-p2-prev').addEventListener('click', () => setCharacterForSlot('p2', -1));
        $('char-p2-next').addEventListener('click', () => setCharacterForSlot('p2', 1));

        $('btn-character-start').addEventListener('click', () => {
            if (!characterSelectMode) return;
            if (characterSelectMode === 'online') {
                onlineLocalReady = !onlineLocalReady;
                syncOnlineCharacterState();
                renderCharacterSelect();
                maybeStartOnlineMatch();
                return;
            }

            const nextMode = characterSelectMode;
            exitCharacterSelect();
            showModeSetup(nextMode);
        });

        $('btn-character-back').addEventListener('click', () => {
            if (characterSelectMode === 'online') {
                MP.disconnect();
                phase = 'menu';
                onlineMatchStartPending = false;
            }
            exitCharacterSelect();
            showScreen('menu-screen');
        });

        // Online lobby
        $('btn-create-room').addEventListener('click', async () => {
            $('lobby-status').textContent = 'Creating room...';
            MP.onMessage(onRemoteMessage);
            MP.onStatus((msg) => { $('lobby-status').textContent = msg; });
            try {
                const code = await MP.createRoom();
                $('room-code').textContent = code;
                $('room-code-display').classList.remove('hidden');
                $('lobby-status').textContent = '';
                showCharacterSelect('online');
            } catch (err) { $('lobby-status').textContent = 'Failed: ' + err; }
        });

        $('btn-join-room').addEventListener('click', async () => {
            const code = $('join-code-input').value.trim();
            if (!code) { $('lobby-status').textContent = 'Enter a room code'; return; }
            $('lobby-status').textContent = 'Joining...';
            MP.onMessage(onRemoteMessage);
            MP.onStatus((msg) => { $('lobby-status').textContent = msg; });
            try {
                await MP.joinRoom(code);
                $('lobby-status').textContent = 'Connected! Waiting for host...';
                showCharacterSelect('online');
            } catch (err) { $('lobby-status').textContent = 'Failed: ' + err; }
        });

        $('btn-lobby-back').addEventListener('click', () => {
            MP.disconnect();
            phase = 'menu';
            showScreen('menu-screen');
        });

        $('btn-classic-submit').addEventListener('click', () => {
            if (!classicPendingEntry) return;
            const name = normalizeClassicName($('classic-name-input').value);
            if (!name) {
                $('classic-entry-note').textContent = 'ENTER 1-6 LETTERS OR NUMBERS.';
                return;
            }
            const entry = { ...classicPendingEntry, name };
            const result = saveClassicLeaderboardEntry(entry);
            classicPendingEntry = null;
            $('classic-entry-note').textContent = result.saved ? 'SAVED TO LEADERBOARD.' : 'NOT A NEW HIGH SCORE.';
            showClassicLeaderboard(result.saved ? entry : null);
        });

        $('btn-classic-skip').addEventListener('click', () => {
            classicPendingEntry = null;
            showClassicLeaderboard(null);
        });

        $('btn-play-again').addEventListener('click', () => {
            if (seriesRound >= SERIES_MAX && players.length > 1) {
                seriesWins = [0, 0];
                seriesRound = 0;
            }
            resetClassicResultsUI();
            if (mode === 'online') {
                MP.send({ type: 'start', bpm: CFG.START_BPM });
                beginGame('online');
            } else {
                beginGame(mode);
            }
        });

        $('btn-back-menu').addEventListener('click', () => {
            MP.disconnect();
            SFX.stopMusic();
            Object.assign(CFG, CFG_DEFAULTS);
            seriesWins = [0, 0];
            seriesRound = 0;
            resetClassicResultsUI();
            phase = 'menu';
            showScreen('menu-screen');
        });

        // Pause
        $('btn-resume').addEventListener('click', resumeGame);
        $('btn-pause-quit').addEventListener('click', () => {
            SFX.stopMusic();
            Object.assign(CFG, CFG_DEFAULTS);
            resetClassicResultsUI();
            phase = 'menu';
            showScreen('menu-screen');
        });

        // Settings
        $('btn-settings').addEventListener('click', () => {
            SFX.init();
            showScreen('settings-screen');
            syncSettingsUI();
        });

        $('btn-settings-back').addEventListener('click', () => {
            showScreen('menu-screen');
        });

        $('btn-leaderboard-back').addEventListener('click', () => {
            showScreen('menu-screen');
        });

        $('set-master').addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) / 100;
            SFX.setMasterVolume(v);
            $('set-master-val').textContent = e.target.value + '%';
        });

        $('set-sfx').addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) / 100;
            SFX.setSfxVolume(v);
            $('set-sfx-val').textContent = e.target.value + '%';
        });

        $('set-music').addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) / 100;
            SFX.setMusicVolume(v);
            $('set-music-val').textContent = e.target.value + '%';
        });

        $('set-shake').addEventListener('click', () => {
            settings.shakeEnabled = !settings.shakeEnabled;
            $('set-shake').textContent = settings.shakeEnabled ? 'ON' : 'OFF';
            $('set-shake').style.color = settings.shakeEnabled ? '#44dd66' : '#888';
            saveUserSettings();
        });

        $('set-camera').addEventListener('click', () => {
            settings.cameraEnabled = !settings.cameraEnabled;
            $('set-camera').textContent = settings.cameraEnabled ? 'ON' : 'OFF';
            $('set-camera').style.color = settings.cameraEnabled ? '#44dd66' : '#888';
            saveUserSettings();
        });
    }

    function updateDifficultyUI() {
        ['easy', 'normal', 'hard'].forEach(d => {
            $('btn-diff-' + d).classList.toggle('btn-diff-selected', d === selectedDifficulty);
        });
    }

    function syncSettingsUI() {
        $('set-master').value = Math.round(SFX.getMasterVolume() * 100);
        $('set-master-val').textContent = Math.round(SFX.getMasterVolume() * 100) + '%';
        $('set-sfx').value = Math.round(SFX.getSfxVolume() * 100);
        $('set-sfx-val').textContent = Math.round(SFX.getSfxVolume() * 100) + '%';
        $('set-music').value = Math.round(SFX.getMusicVolume() * 100);
        $('set-music-val').textContent = Math.round(SFX.getMusicVolume() * 100) + '%';
        $('set-shake').textContent = settings.shakeEnabled ? 'ON' : 'OFF';
        $('set-shake').style.color = settings.shakeEnabled ? '#44dd66' : '#888';
        $('set-camera').textContent = settings.cameraEnabled ? 'ON' : 'OFF';
        $('set-camera').style.color = settings.cameraEnabled ? '#44dd66' : '#888';
    }

    function saveUserSettings() {
        try {
            const existing = JSON.parse(localStorage.getItem('clocksim_settings') || '{}');
            existing.shakeEnabled = settings.shakeEnabled;
            existing.cameraEnabled = settings.cameraEnabled;
            localStorage.setItem('clocksim_settings', JSON.stringify(existing));
        } catch (e) { /* ignore */ }
    }

    function loadUserSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('clocksim_settings') || '{}');
            if (s.shakeEnabled != null) settings.shakeEnabled = s.shakeEnabled;
            if (s.cameraEnabled != null) settings.cameraEnabled = s.cameraEnabled;
        } catch (e) { /* ignore */ }
    }

    // ---- Tutorial ----
    const TUTORIAL_STEPS = [
        'The blade swings like a pendulum.\nDodge it by jumping at the right time!',
        'Press SPACE or tap to jump.\nTry it now!',
        'Time your jump for PERFECT!\nPERFECT hits score extra points.',
        'Survive as long as you can!\nGood luck!',
    ];

    function startTutorial() {
        tutorialActive = true;
        tutorialStep = 0;
        showTutorialStep();
        $('tutorial-overlay').classList.remove('hidden');
    }

    function showTutorialStep() {
        $('tutorial-text').textContent = TUTORIAL_STEPS[tutorialStep];
        $('btn-tutorial-next').textContent = tutorialStep < TUTORIAL_STEPS.length - 1 ? 'NEXT' : 'START';
    }

    function setupTutorial() {
        $('btn-tutorial-next').addEventListener('click', () => {
            tutorialStep++;
            if (tutorialStep >= TUTORIAL_STEPS.length) {
                endTutorial();
                return;
            }
            showTutorialStep();
        });

        $('btn-tutorial-skip').addEventListener('click', endTutorial);
    }

    function endTutorial() {
        tutorialActive = false;
        tutorialStep = -1;
        hideOverlay('tutorial-overlay');
        try { localStorage.setItem('clocksim_tutorial_done', '1'); } catch (e) { /* ignore */ }
        if (pendingMode) {
            showCharacterSelect(pendingMode);
            return;
        }
        applyDifficulty();
        beginGame('classic');
    }

    function shouldShowTutorial() {
        try { return !localStorage.getItem('clocksim_tutorial_done'); } catch (e) { return false; }
    }

    // ---- Debug mode ----
    let debugUnlocked = false;
    let debugDamageEnabled = false;
    let debugInfHearts = true;
    let debugSpeed = 1.0;
    let debugKeyBuffer = '';

    function isDebugMode() { return mode === 'debug'; }

    function setupDebug() {
        document.addEventListener('keydown', (e) => {
            if (phase !== 'menu' && phase !== 'results') { debugKeyBuffer = ''; return; }
            if (e.key.length === 1) {
                debugKeyBuffer += e.key.toLowerCase();
                if (debugKeyBuffer.length > 10) debugKeyBuffer = debugKeyBuffer.slice(-10);
                if (debugKeyBuffer.endsWith('debug')) {
                    debugKeyBuffer = '';
                    debugUnlocked = !debugUnlocked;
                    $('btn-debug-mode').classList.toggle('hidden', !debugUnlocked);
                }
            }
        });

        $('btn-debug-mode').addEventListener('click', () => {
            SFX.init();
            debugDamageEnabled = false;
            debugInfHearts = true;
            debugSpeed = 1.0;
            beginGame('debug');
        });

        $('debug-speed').addEventListener('input', (e) => {
            debugSpeed = parseInt(e.target.value, 10) / 100;
            $('debug-speed-val').textContent = debugSpeed.toFixed(1) + 'x';
        });

        $('debug-bpm').addEventListener('input', (e) => {
            const newBpm = parseInt(e.target.value, 10);
            $('debug-bpm-val').textContent = newBpm;
            if (phase === 'playing' && !impactCam.active) {
                const totalBeats = currentBeatContinuous(gameNow);
                addBpmSegment(Math.floor(totalBeats), newBpm);
            }
        });

        $('debug-toggle-damage').addEventListener('click', () => { debugDamageEnabled = !debugDamageEnabled; syncDebugToggles(); });
        $('debug-toggle-infhearts').addEventListener('click', () => { debugInfHearts = !debugInfHearts; syncDebugToggles(); });

        $('debug-kill').addEventListener('click', () => {
            if (phase === 'playing' && players[0] && !impactCam.active) debugKillPlayer(0);
        });
        $('debug-restart').addEventListener('click', () => beginGame('debug'));
        $('debug-quit').addEventListener('click', () => {
            $('debug-hud').classList.add('hidden');
            SFX.stopMusic();
            phase = 'menu';
            showScreen('menu-screen');
        });
        $('debug-cfg-reset').addEventListener('click', () => { Object.assign(CFG, CFG_DEFAULTS); buildCfgInputs(); });
        buildCfgInputs();
    }

    const CFG_DEFAULTS = Object.assign({}, CFG);

    function buildCfgInputs() {
        const list = $('debug-cfg-list');
        list.innerHTML = '';
        Object.keys(CFG).forEach(key => {
            const row = document.createElement('div');
            row.className = 'debug-cfg-row';
            const label = document.createElement('label');
            label.textContent = key; label.title = key;
            const input = document.createElement('input');
            input.type = 'number'; input.value = CFG[key];
            input.step = Number.isInteger(CFG_DEFAULTS[key]) ? '1' : '0.01';
            input.addEventListener('change', () => { const v = parseFloat(input.value); if (!isNaN(v)) CFG[key] = v; });
            row.appendChild(label); row.appendChild(input);
            list.appendChild(row);
        });
    }

    function syncDebugToggles() {
        const dmgBtn = $('debug-toggle-damage');
        dmgBtn.textContent = debugDamageEnabled ? 'ON' : 'OFF';
        dmgBtn.style.color = debugDamageEnabled ? '#ee4444' : '#44dd66';
        const ihBtn = $('debug-toggle-infhearts');
        ihBtn.textContent = debugInfHearts ? 'ON' : 'OFF';
        ihBtn.style.color = debugInfHearts ? '#44dd66' : '#888';
    }

    function showDebugHUD() {
        $('debug-hud').classList.remove('hidden');
        $('debug-speed').value = Math.round(debugSpeed * 100);
        $('debug-speed-val').textContent = debugSpeed.toFixed(1) + 'x';
        $('debug-bpm').value = bpm;
        $('debug-bpm-val').textContent = bpm;
        syncDebugToggles();
    }

    function debugKillPlayer(idx) {
        const p = players[idx];
        p.hits = CFG.MAX_HITS; p.streak = 0;
        p.judgmentText = 'MISS'; p.judgmentTimer = 1.0;
        SFX.playHit(); Renderer.addBladeBlood();
        startImpactCam(idx, Math.round(currentBeatContinuous(gameNow)));
    }

    function isDebugInvincible() { return isDebugMode() && !debugDamageEnabled; }

    // ---- Init ----
    function init() {
        const canvas = $('game-canvas');
        Renderer.init(canvas);
        loadUserSettings();
        setupInput();
        setupMenus();
        setupDebug();
        setupTutorial();
        showScreen('menu-screen');
        lastFrameTime = performance.now();
        gameNow = performance.now();
        rafId = requestAnimationFrame(loop);

    }

    document.addEventListener('DOMContentLoaded', init);

    return { CFG };
})();
