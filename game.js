const Game = (() => {
    const CFG = {
        START_BPM: 60,
        BPM_STEP: 5,
        BEATS_PER_LEVEL: 10,
        MAX_BPM: 180,
        MAX_HITS: 3,
        PERFECT_WINDOW: 0.07,
        GOOD_WINDOW: 0.18,
        JUMP_DURATION: 0.30,
        JUMP_HEIGHT: 35,
        PRESS_COOLDOWN: 0.22,
        RESOLVE_DELAY: 0.30,
        SAFE_HEIGHT_RATIO: 0.66,
        COUNTDOWN_BEATS: 4,
    };

    // ---- State ----
    let mode = null;          // 'practice' | 'local' | 'online'
    let phase = 'menu';       // 'menu' | 'lobby' | 'countdown' | 'playing' | 'results'
    let bpm = CFG.START_BPM;
    let gameStartTime = 0;
    let countdownStartTime = 0;
    let lastResolvedBeat = -1;
    let lastTickBeat = -1;
    let lastFrameTime = 0;
    let pendulumAngle = 0;
    let shakeTimer = 0;
    let countdownDisplay = '';
    let players = [];
    let rafId = null;

    // BPM segments for speed ramp
    let bpmSegments = [];

    // ---- Impact cam (Peggle-style slow-mo hit) ----
    let impactCam = {
        active: false,
        phase: 'none',       // 'approach' | 'impact' | 'aftermath' | 'zoomout'
        startTime: 0,
        phaseTime: 0,
        playerIdx: -1,
        beatIdx: -1,
        startAngle: 0,
        angle: 0,
        zoom: 1,
        ragdoll: null,
        particles: [],
        splatters: [],
        hitApplied: false,
    };

    // ---- DOM refs ----
    const $ = (id) => document.getElementById(id);

    // ---- Player factory ----
    function makePlayer(idx) {
        return {
            index: idx,
            score: 0,
            streak: 0,
            bestStreak: 0,
            hits: 0,
            isJumping: false,
            jumpStartTime: 0,
            jumpY: 0,
            lastPressTime: 0,
            resolvedBeats: new Set(),
            judgmentText: '',
            judgmentTimer: 0,
            hitTimer: 0,
            bloodSpurt: [],
        };
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

    // ---- UI helpers ----
    function showScreen(name) {
        ['menu-screen', 'lobby-screen', 'results-screen', 'hud'].forEach((id) => {
            $(id).classList.add('hidden');
        });
        if (name) $(name).classList.remove('hidden');
    }

    function updateHUD() {
        players.forEach((p, i) => {
            const n = i + 1;
            $('score-p' + n).textContent = p.score;
            const full = CFG.MAX_HITS - p.hits;
            let hearts = '';
            for (let h = 0; h < CFG.MAX_HITS; h++) {
                hearts += h < full
                    ? '<span class="heart-full">&#9829;</span>'
                    : '<span class="heart-empty">&#9829;</span>';
            }
            $('hearts-p' + n).innerHTML = hearts;
            const streakEl = $('streak-p' + n);
            streakEl.textContent = p.streak > 1 ? p.streak + 'x STREAK' : '';
        });
    }

    // ---- Core game actions ----
    function handleJump(playerIdx) {
        if (phase !== 'playing' && !impactCam.active) return;
        const p = players[playerIdx];
        if (!p) return;

        const now = performance.now();

        if (impactCam.active && impactCam.phase === 'approach' && impactCam.playerIdx === playerIdx) {
            const camDuration = now - impactCam.startTime;
            gameStartTime += camDuration;
            impactCam.active = false;
            impactCam.phase = 'none';
        } else if (impactCam.active) {
            return;
        }
        if (now - p.lastPressTime < CFG.PRESS_COOLDOWN * 1000) return;
        p.lastPressTime = now;

        // Start jump animation
        p.isJumping = true;
        p.jumpStartTime = now;
        SFX.playJump();

        // Evaluate timing
        const totalBeats = currentBeatContinuous(now);
        const nearestBeat = Math.round(totalBeats);
        if (nearestBeat < 0 || p.resolvedBeats.has(nearestBeat)) return;

        const beatMs = beatTimeMs(nearestBeat);
        const offsetSec = Math.abs(now - beatMs) / 1000;

        // Outside timing window entirely - jump is cosmetic only
        if (offsetSec > CFG.GOOD_WINDOW) return;

        let judgment;
        if (offsetSec <= CFG.PERFECT_WINDOW) {
            judgment = 'PERFECT';
            p.score += 2;
            p.streak++;
            SFX.playPerfect();
        } else {
            judgment = 'GOOD';
            p.score += 1;
            p.streak++;
        }

        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.resolvedBeats.add(nearestBeat);
        p.judgmentText = judgment;
        p.judgmentTimer = 1.0;

        if (mode === 'online') {
            MP.send({
                type: 'action',
                beat: nearestBeat,
                judgment,
                score: p.score,
                hits: p.hits,
                streak: p.streak,
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

    function resolveUnpressedBeat(beatIdx) {
        players.forEach((p) => {
            if (p.resolvedBeats.has(beatIdx)) return;
            if (mode === 'online' && p.index === 1) return;

            p.resolvedBeats.add(beatIdx);

            // If the player was in the air when the blade passed, they're safe
            if (wasAirborneAtBeat(p, beatIdx)) {
                p.score += 1;
                p.streak++;
                p.bestStreak = Math.max(p.bestStreak, p.streak);
                p.judgmentText = 'GOOD';
                p.judgmentTimer = 1.0;
                if (mode === 'online') {
                    MP.send({
                        type: 'action',
                        beat: beatIdx,
                        judgment: 'GOOD',
                        score: p.score,
                        hits: p.hits,
                        streak: p.streak,
                    });
                }
                return;
            }

            // Player was on the ground when blade passed -- hit
            p.hits++;
            p.streak = 0;
            p.judgmentText = 'MISS';
            p.judgmentTimer = 1.0;
            p.hitTimer = 0.7;
            shakeTimer = 0.15;
            SFX.playHit();

            spawnBloodSpurt(p);

            if (mode === 'online') {
                MP.send({
                    type: 'action',
                    beat: beatIdx,
                    judgment: 'MISS',
                    score: p.score,
                    hits: p.hits,
                    streak: 0,
                });
            }
        });
    }

    function checkWin() {
        for (let i = 0; i < players.length; i++) {
            if (players[i].hits >= CFG.MAX_HITS) {
                endGame();
                return true;
            }
        }
        return false;
    }

    function endGame() {
        phase = 'results';

        let winner = -1;
        if (players.length > 1) {
            if (players[0].hits >= CFG.MAX_HITS && players[1].hits < CFG.MAX_HITS) winner = 1;
            else if (players[1].hits >= CFG.MAX_HITS && players[0].hits < CFG.MAX_HITS) winner = 0;
            else winner = players[0].score >= players[1].score ? 0 : 1;
        }

        if (winner >= 0) SFX.playWin(); else SFX.playGameOver();

        const title = $('results-title');
        if (mode === 'practice') {
            title.textContent = 'GAME OVER';
        } else if (winner === 0) {
            title.textContent = 'PLAYER 1 WINS';
        } else if (winner === 1) {
            title.textContent = 'PLAYER 2 WINS';
        } else {
            title.textContent = 'DRAW';
        }

        let body = '';
        players.forEach((p, i) => {
            const isWinner = i === winner;
            body += `<div class="result-col">
                <h3>P${i + 1}</h3>
                <div class="final-score">${p.score}</div>
                ${isWinner ? '<div class="winner-badge">WINNER</div>' : ''}
                <div class="stat">Best Streak: ${p.bestStreak}</div>
                <div class="stat">Hits Taken: ${p.hits}</div>
            </div>`;
        });
        $('results-body').innerHTML = body;
        showScreen('results-screen');

        if (mode === 'online') {
            MP.send({ type: 'gameover', winner });
        }
    }

    // ---- Mini blood spurt for non-fatal hits ----
    function spawnBloodSpurt(player) {
        const arenaW = (mode === 'practice') ? Renderer.CW : Renderer.CW / 2;
        const arenaX = (player.index === 1) ? Renderer.CW / 2 : 0;
        const cx = arenaX + arenaW / 2;
        const charSize = Sprites.spriteSize('idle');
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

    // ---- Impact cam system ----
    function easeInQuad(t) { return t * t; }
    function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
    function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

    function checkForImpactCam(now) {
        if (impactCam.active) return;
        if (mode === 'online') return;

        const nextBeat = lastResolvedBeat + 1;
        if (nextBeat < 1) return;

        const nextBeatTime = beatTimeMs(nextBeat);
        const timeUntilBeat = (nextBeatTime - now) / 1000;

        if (timeUntilBeat > 0.22 || timeUntilBeat < 0.03) return;

        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            if (p.resolvedBeats.has(nextBeat)) continue;
            if (p.hits < CFG.MAX_HITS - 1) continue;
            if (!wasAirborneAtBeat(p, nextBeat)) {
                startImpactCam(i, nextBeat, now);
                return;
            }
        }
    }

    function startImpactCam(playerIdx, beatIdx, now) {
        impactCam = {
            active: true,
            phase: 'approach',
            startTime: now,
            phaseTime: now,
            playerIdx,
            beatIdx,
            startAngle: pendulumAngle,
            angle: pendulumAngle,
            zoom: 1,
            ragdoll: null,
            particles: [],
            splatters: [],
            hitApplied: false,
        };
    }

    function updateImpactCam(dt, now) {
        const elapsed = (now - impactCam.phaseTime) / 1000;

        switch (impactCam.phase) {
            case 'approach': {
                const DUR = 0.8;
                const t = Math.min(1, elapsed / DUR);
                impactCam.angle = impactCam.startAngle * (1 - easeInQuad(t));
                impactCam.zoom = 1 + 1.5 * easeInOutQuad(t);
                if (t >= 1) {
                    impactCam.phase = 'impact';
                    impactCam.phaseTime = now;
                    impactCam.angle = 0;
                    triggerImpact(now);
                }
                break;
            }
            case 'impact': {
                const DUR = 0.15;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.5 + 0.3 * Math.sin(t * Math.PI * 6);
                shakeTimer = 0.15;
                if (t >= 1) {
                    impactCam.phase = 'aftermath';
                    impactCam.phaseTime = now;
                }
                break;
            }
            case 'aftermath': {
                const DUR = 1.2;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.5 - 0.5 * easeOutQuad(t);
                updateRagdoll(dt);
                updateBloodParticles(dt);
                if (t >= 1) {
                    impactCam.phase = 'zoomout';
                    impactCam.phaseTime = now;
                }
                break;
            }
            case 'zoomout': {
                const DUR = 0.5;
                const t = Math.min(1, elapsed / DUR);
                impactCam.zoom = 2.0 - 1.0 * easeInOutQuad(t);
                updateRagdoll(dt);
                updateBloodParticles(dt);
                if (t >= 1) {
                    endImpactCam(now);
                }
                break;
            }
        }

        pendulumAngle = impactCam.angle;

        if (shakeTimer > 0) shakeTimer -= dt;
    }

    function triggerImpact(now) {
        const beatIdx = impactCam.beatIdx;
        const p = players[impactCam.playerIdx];

        p.resolvedBeats.add(beatIdx);
        p.hits++;
        p.streak = 0;
        p.judgmentText = 'MISS';
        p.judgmentTimer = 1.0;
        p.hitTimer = 0;
        impactCam.hitApplied = true;
        SFX.playHit();

        players.forEach((other, idx) => {
            if (idx === impactCam.playerIdx) return;
            if (other.resolvedBeats.has(beatIdx)) return;
            if (wasAirborneAtBeat(other, beatIdx)) {
                other.resolvedBeats.add(beatIdx);
                other.score += 1;
                other.streak++;
                other.bestStreak = Math.max(other.bestStreak, other.streak);
                other.judgmentText = 'GOOD';
                other.judgmentTimer = 1.0;
            } else {
                other.resolvedBeats.add(beatIdx);
                other.hits++;
                other.streak = 0;
                other.judgmentText = 'MISS';
                other.judgmentTimer = 1.0;
                other.hitTimer = 0.7;
            }
        });

        lastResolvedBeat = Math.max(lastResolvedBeat, beatIdx);

        const arenaW = (mode === 'practice') ? Renderer.CW : Renderer.CW / 2;
        const arenaX = (impactCam.playerIdx === 1) ? Renderer.CW / 2 : 0;
        const cx = arenaX + arenaW / 2;
        const charSize = Sprites.spriteSize('idle');

        const bladeDir = impactCam.startAngle >= 0 ? 1 : -1;

        impactCam.ragdoll = {
            x: cx - charSize.w / 2,
            y: Renderer.PLATFORM_Y - charSize.h,
            vx: bladeDir * (180 + Math.random() * 80),
            vy: -220 - Math.random() * 80,
            rotation: 0,
            vr: bladeDir * (8 + Math.random() * 6),
            w: charSize.w,
            h: charSize.h,
            palette: impactCam.playerIdx === 0 ? 'blue' : 'red',
            onGround: false,
            bounces: 0,
        };

        const impactX = cx;
        const impactY = Renderer.PLATFORM_Y - charSize.h * 0.4;
        for (let i = 0; i < 30; i++) {
            const spread = (Math.random() - 0.5) * 2;
            impactCam.particles.push({
                x: impactX + spread * 10,
                y: impactY + (Math.random() - 0.5) * 16,
                vx: spread * 250 + bladeDir * 60,
                vy: -Math.random() * 280 - 40,
                life: 0.7 + Math.random() * 0.5,
                size: 1 + Math.random() * 3,
                gravity: 500 + Math.random() * 200,
                landed: false,
            });
        }
    }

    function updateRagdoll(dt) {
        const r = impactCam.ragdoll;
        if (!r || r.onGround) return;

        r.vy += 650 * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.rotation += r.vr * dt;

        if (r.y > Renderer.PLATFORM_Y - 8) {
            r.y = Renderer.PLATFORM_Y - 8;
            r.bounces++;
            if (r.bounces >= 3 || Math.abs(r.vy) < 30) {
                r.onGround = true;
                r.vy = 0;
                r.vx = 0;
                r.vr = 0;
            } else {
                r.vy = -r.vy * 0.35;
                r.vx *= 0.6;
                r.vr *= 0.5;
            }
        }
    }

    function updateBloodParticles(dt) {
        impactCam.particles.forEach(p => {
            if (p.landed) return;
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt * 0.6;

            if (p.y >= Renderer.PLATFORM_Y - 1) {
                p.y = Renderer.PLATFORM_Y - 1;
                p.landed = true;
                p.vx = 0;
                p.vy = 0;
                impactCam.splatters.push({
                    x: p.x, y: Renderer.PLATFORM_Y - 1,
                    size: p.size * 1.8,
                });
            }
        });
        impactCam.particles = impactCam.particles.filter(p => p.life > 0 || p.landed);
    }

    function endImpactCam(now) {
        const pauseDuration = now - impactCam.startTime;
        gameStartTime += pauseDuration;

        impactCam.active = false;
        impactCam.phase = 'none';
        shakeTimer = 0;

        updateHUD();
        checkWin();
    }

    // ---- Countdown & Start ----
    function startCountdown() {
        phase = 'countdown';
        countdownStartTime = performance.now();
        countdownDisplay = '';
        showScreen('hud');
        updateHUD();
    }

    function startPlaying() {
        phase = 'playing';
        gameStartTime = performance.now();
        lastResolvedBeat = -1;
        lastTickBeat = 0; // skip tick on beat 0 since GO sound covers it
        bpm = CFG.START_BPM;
        bpmSegments = [{ startBeat: 0, bpm, startTime: 0 }];
        $('bpm-display').textContent = bpm + ' BPM';
    }

    // ---- Update ----
    function update(dt) {
        const now = performance.now();

        if (impactCam.active) {
            updateImpactCam(dt, now);
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
                if (countdownDisplay !== newDisplay) {
                    countdownDisplay = newDisplay;
                    SFX.playCountdown();
                }
            } else if (remaining === 0) {
                if (countdownDisplay !== 'GO') {
                    countdownDisplay = 'GO';
                    SFX.playGo();
                }
            }

            // Pendulum preview during countdown
            const previewBeats = elapsed / beatInterval;
            pendulumAngle = Renderer.MAX_ANGLE * Math.sin(Math.PI * previewBeats);

            if (elapsed >= CFG.COUNTDOWN_BEATS * beatInterval) {
                startPlaying();
            }
            return;
        }

        if (phase !== 'playing') return;

        const totalBeats = currentBeatContinuous(now);
        const currentBeatInt = Math.floor(totalBeats);

        // Pendulum angle
        pendulumAngle = Renderer.MAX_ANGLE * Math.sin(Math.PI * totalBeats);

        // Metronome tick
        if (currentBeatInt > lastTickBeat) {
            lastTickBeat = currentBeatInt;
            SFX.playTick();
        }

        // Resolve past beats
        for (let b = lastResolvedBeat + 1; b <= currentBeatInt; b++) {
            const bTime = beatTimeMs(b);
            if (now - bTime > CFG.RESOLVE_DELAY * 1000) {
                resolveUnpressedBeat(b);
                lastResolvedBeat = b;
                if (checkWin()) return;
            }
        }

        // Check for imminent misses (Peggle-style slow-mo)
        checkForImpactCam(now);
        if (impactCam.active) return;

        // BPM ramp
        if (currentBeatInt > 0 && currentBeatInt % CFG.BEATS_PER_LEVEL === 0) {
            const expectedBpm = CFG.START_BPM + (currentBeatInt / CFG.BEATS_PER_LEVEL) * CFG.BPM_STEP;
            if (bpm < expectedBpm && bpm < CFG.MAX_BPM) {
                addBpmSegment(currentBeatInt, Math.min(expectedBpm, CFG.MAX_BPM));
            }
        }

        // Update player animations
        players.forEach((p) => {
            // Jump arc
            if (p.isJumping) {
                const jElapsed = (now - p.jumpStartTime) / 1000;
                const jProgress = jElapsed / CFG.JUMP_DURATION;
                if (jProgress >= 1) {
                    p.isJumping = false;
                    p.jumpY = 0;
                } else {
                    p.jumpY = CFG.JUMP_HEIGHT * Math.sin(Math.PI * jProgress);
                }
            }
            // Timers
            if (p.judgmentTimer > 0) p.judgmentTimer -= dt;
            if (p.hitTimer > 0) p.hitTimer -= dt;
            // Mini blood spurt
            if (p.bloodSpurt.length > 0) {
                p.bloodSpurt.forEach(b => {
                    b.vy += 400 * dt;
                    b.x += b.vx * dt;
                    b.y += b.vy * dt;
                    b.life -= dt * 1.5;
                });
                p.bloodSpurt = p.bloodSpurt.filter(b => b.life > 0);
            }
        });

        if (shakeTimer > 0) shakeTimer -= dt;

        updateHUD();
    }

    // ---- Main loop ----
    function loop(timestamp) {
        const dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
        lastFrameTime = timestamp;

        update(dt);

        // Gentle pendulum sway on menu/lobby screens
        let displayAngle = pendulumAngle;
        if (phase === 'menu' || phase === 'lobby' || phase === 'results') {
            displayAngle = Renderer.MAX_ANGLE * 0.4 * Math.sin(performance.now() / 1000);
        }

        Renderer.render({
            mode,
            phase,
            players,
            pendulumAngle: impactCam.active ? pendulumAngle : displayAngle,
            countdownDisplay,
            shakeTimer,
            impactCam: impactCam.active ? {
                playerIdx: impactCam.playerIdx,
                phase: impactCam.phase,
                zoom: impactCam.zoom,
                ragdoll: impactCam.ragdoll,
                particles: impactCam.particles,
                splatters: impactCam.splatters,
            } : null,
        });

        rafId = requestAnimationFrame(loop);
    }

    // ---- Online message handler ----
    function onRemoteMessage(data) {
        if (data.type === 'peer-connected') {
            // Guest connected to host
            if (MP.isHost) {
                setTimeout(() => {
                    MP.send({ type: 'start', bpm: CFG.START_BPM });
                    beginGame('online');
                }, 500);
            }
        }
        if (data.type === 'start') {
            beginGame('online');
        }
        if (data.type === 'action' && players[1]) {
            const p = players[1];
            const prevHits = p.hits;
            p.score = data.score;
            p.hits = data.hits;
            p.streak = data.streak;
            p.judgmentText = data.judgment;
            p.judgmentTimer = 1.0;
            if (p.hits > prevHits) {
                p.hitTimer = 0.5;
            }
            if (data.judgment !== 'MISS' && !p.isJumping) {
                p.isJumping = true;
                p.jumpStartTime = performance.now();
            }
            p.resolvedBeats.add(data.beat);
            if (p.hits >= CFG.MAX_HITS && phase === 'playing') {
                endGame();
            }
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

    // ---- Game start ----
    function beginGame(gameMode) {
        mode = gameMode;
        players = [makePlayer(0)];
        if (mode !== 'practice') players.push(makePlayer(1));

        // Show/hide P2 HUD
        const p2hud = $('hud-p2');
        p2hud.style.display = mode === 'practice' ? 'none' : '';

        pendulumAngle = 0;
        shakeTimer = 0;
        impactCam = { active: false, phase: 'none', startTime: 0, phaseTime: 0,
            playerIdx: -1, beatIdx: -1, startAngle: 0, angle: 0, zoom: 1,
            ragdoll: null, particles: [], splatters: [], hitApplied: false };
        bpm = CFG.START_BPM;
        bpmSegments = [{ startBeat: 0, bpm, startTime: 0 }];
        $('bpm-display').textContent = bpm + ' BPM';

        startCountdown();
    }

    // ---- Input ----
    function setupInput() {
        document.addEventListener('keydown', (e) => {
            if (phase !== 'playing' && !(impactCam.active && impactCam.phase === 'approach')) return;
            if (e.repeat) return;

            const key = e.key;
            if (key === ' ' || key === 'w' || key === 'W') {
                e.preventDefault();
                handleJump(0);
            }
            if (mode === 'local') {
                if (key === 'ArrowUp' || key === 'Enter') {
                    e.preventDefault();
                    handleJump(1);
                }
            }
        });

        // Touch support for mobile
        const canvas = $('game-canvas');
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (phase !== 'playing' && !(impactCam.active && impactCam.phase === 'approach')) return;
            if (mode === 'local') {
                const touch = e.touches[0];
                const rect = canvas.getBoundingClientRect();
                const x = touch.clientX - rect.left;
                if (x < rect.width / 2) handleJump(0);
                else handleJump(1);
            } else {
                handleJump(0);
            }
        });
    }

    // ---- Menu wiring ----
    function setupMenus() {
        $('btn-practice').addEventListener('click', () => {
            SFX.init();
            beginGame('practice');
        });

        $('btn-local').addEventListener('click', () => {
            SFX.init();
            beginGame('local');
        });

        $('btn-online').addEventListener('click', () => {
            SFX.init();
            phase = 'lobby';
            showScreen('lobby-screen');
            $('room-code-display').classList.add('hidden');
            $('lobby-status').textContent = '';
        });

        $('btn-create-room').addEventListener('click', async () => {
            $('lobby-status').textContent = 'Creating room...';
            MP.onMessage(onRemoteMessage);
            MP.onStatus((msg) => { $('lobby-status').textContent = msg; });
            try {
                const code = await MP.createRoom();
                $('room-code').textContent = code;
                $('room-code-display').classList.remove('hidden');
                $('lobby-status').textContent = '';
            } catch (err) {
                $('lobby-status').textContent = 'Failed: ' + err;
            }
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
            } catch (err) {
                $('lobby-status').textContent = 'Failed: ' + err;
            }
        });

        $('btn-lobby-back').addEventListener('click', () => {
            MP.disconnect();
            phase = 'menu';
            showScreen('menu-screen');
        });

        $('btn-play-again').addEventListener('click', () => {
            if (mode === 'online') {
                MP.send({ type: 'start', bpm: CFG.START_BPM });
                beginGame('online');
            } else {
                beginGame(mode);
            }
        });

        $('btn-back-menu').addEventListener('click', () => {
            MP.disconnect();
            phase = 'menu';
            showScreen('menu-screen');
        });
    }

    // ---- Init ----
    function init() {
        const canvas = $('game-canvas');
        Renderer.init(canvas);
        setupInput();
        setupMenus();
        showScreen('menu-screen');
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(loop);
    }

    document.addEventListener('DOMContentLoaded', init);

    return { CFG };
})();
