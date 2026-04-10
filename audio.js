const SFX = (() => {
    let ctx = null;
    let noiseBuffer = null;
    let masterGain = null;
    let sfxGain = null;
    let musicGain = null;

    // Persistent settings (loaded from localStorage in init)
    let sfxVolume = 1.0;
    let musicVolume = 0.5;
    let masterVolume = 1.0;

    function init() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const sr = ctx.sampleRate;
        const len = sr;
        noiseBuffer = ctx.createBuffer(1, len, sr);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        masterGain = ctx.createGain();
        masterGain.connect(ctx.destination);

        sfxGain = ctx.createGain();
        sfxGain.connect(masterGain);

        musicGain = ctx.createGain();
        musicGain.connect(masterGain);

        loadVolumeSettings();
    }

    function loadVolumeSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('clocksim_settings') || '{}');
            if (s.masterVolume != null) masterVolume = s.masterVolume;
            if (s.sfxVolume != null) sfxVolume = s.sfxVolume;
            if (s.musicVolume != null) musicVolume = s.musicVolume;
        } catch (e) { /* ignore */ }
        applyVolumes();
    }

    function applyVolumes() {
        if (masterGain) masterGain.gain.value = masterVolume;
        if (sfxGain) sfxGain.gain.value = sfxVolume;
        if (musicGain) musicGain.gain.value = musicVolume;
    }

    function setMasterVolume(v) { masterVolume = v; applyVolumes(); saveSettings(); }
    function setSfxVolume(v) { sfxVolume = v; applyVolumes(); saveSettings(); }
    function setMusicVolume(v) { musicVolume = v; applyVolumes(); saveSettings(); }
    function getMasterVolume() { return masterVolume; }
    function getSfxVolume() { return sfxVolume; }
    function getMusicVolume() { return musicVolume; }

    function saveSettings() {
        try {
            const existing = JSON.parse(localStorage.getItem('clocksim_settings') || '{}');
            existing.masterVolume = masterVolume;
            existing.sfxVolume = sfxVolume;
            existing.musicVolume = musicVolume;
            localStorage.setItem('clocksim_settings', JSON.stringify(existing));
        } catch (e) { /* ignore */ }
    }

    function ensureCtx() {
        if (!ctx) init();
        if (ctx.state === 'suspended') ctx.resume();
    }

    function sfxDest() { return sfxGain || (masterGain || ctx.destination); }
    function musicDest() { return musicGain || (masterGain || ctx.destination); }

    function osc(freq, type, duration, gainVal, startTime, dest) {
        ensureCtx();
        const t = startTime || ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(gainVal || 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        o.connect(g);
        g.connect(dest || sfxDest());
        o.start(t);
        o.stop(t + duration);
    }

    function noise(duration, gainVal, filterFreq, dest, startTime) {
        ensureCtx();
        const t = startTime || ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = filterFreq || 1000;
        filt.Q.value = 1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gainVal || 0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        src.connect(filt);
        filt.connect(g);
        g.connect(dest || sfxDest());
        src.start(t);
        src.stop(t + duration);
    }

    // Pitch variation helper
    function randDetune() { return (Math.random() - 0.5) * 80; }

    const VOWEL_FORMANTS = {
        a: { f1: 850, q1: 8, f2: 1200, q2: 7 },
        e: { f1: 500, q1: 9, f2: 1800, q2: 8 },
        i: { f1: 300, q1: 10, f2: 2200, q2: 9 },
        o: { f1: 500, q1: 8, f2: 900, q2: 7 },
        u: { f1: 350, q1: 8, f2: 700, q2: 7 },
        er: { f1: 450, q1: 9, f2: 1500, q2: 8 },
        ah: { f1: 700, q1: 8, f2: 1150, q2: 7 },
        uh: { f1: 500, q1: 8, f2: 1100, q2: 7 },
    };

    const CONSONANT_NOISE = {
        p: 2300, b: 1900, t: 3000, d: 2500, k: 2100, g: 1800,
        f: 4200, v: 3200, s: 5200, z: 4200, sh: 3600, ch: 3300,
        m: 900, n: 1200, r: 1500, l: 1300,
    };

    function getVowelFormants(vowel) {
        return VOWEL_FORMANTS[vowel] || VOWEL_FORMANTS.a;
    }

    function playConsonantBurst(consonant, startTime, accent) {
        if (!consonant) return;
        const t = startTime;
        const freq = CONSONANT_NOISE[consonant] || 2400;
        const gain = 0.04 + 0.04 * (accent || 1);
        noise(0.03, gain, freq, sfxDest(), t);
    }

    function playVoiceChunk(chunk, startTime) {
        ensureCtx();
        const t = startTime || ctx.currentTime;
        const duration = chunk.duration || 0.14;
        const pitch = chunk.pitch || 170;
        const accent = chunk.accent || 1;
        const vowel = chunk.vowel || 'a';
        const glide = chunk.glide == null ? 0.06 : chunk.glide;
        const formants = getVowelFormants(vowel);

        playConsonantBurst(chunk.consonant, t, accent);

        const carrier = ctx.createOscillator();
        carrier.type = 'sawtooth';
        carrier.frequency.setValueAtTime(pitch, t);
        carrier.frequency.exponentialRampToValueAtTime(pitch * (1 + glide), t + duration * 0.7);

        const voiceFilter = ctx.createBiquadFilter();
        voiceFilter.type = 'bandpass';
        voiceFilter.frequency.value = formants.f1;
        voiceFilter.Q.value = formants.q1;

        const voiceFilter2 = ctx.createBiquadFilter();
        voiceFilter2.type = 'bandpass';
        voiceFilter2.frequency.value = formants.f2;
        voiceFilter2.Q.value = formants.q2;

        const voiceGain = ctx.createGain();
        voiceGain.gain.setValueAtTime(0.0001, t);
        voiceGain.gain.linearRampToValueAtTime(0.42 * accent, t + 0.015);
        voiceGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        const voiceBlend = ctx.createGain();
        voiceBlend.gain.value = 0.85;

        carrier.connect(voiceFilter);
        carrier.connect(voiceFilter2);
        voiceFilter.connect(voiceBlend);
        voiceFilter2.connect(voiceBlend);
        voiceBlend.connect(voiceGain);
        voiceGain.connect(sfxDest());
        carrier.start(t);
        carrier.stop(t + duration);

        const breath = ctx.createBiquadFilter();
        breath.type = 'bandpass';
        breath.frequency.value = formants.f2;
        breath.Q.value = formants.q2;

        const supportGain = ctx.createGain();
        supportGain.gain.setValueAtTime(0.0001, t);
        supportGain.gain.linearRampToValueAtTime(0.14 * accent, t + 0.01);
        supportGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        const support = ctx.createOscillator();
        support.type = 'triangle';
        support.frequency.setValueAtTime(pitch * 1.98, t);
        support.frequency.exponentialRampToValueAtTime(pitch * 2.05, t + duration * 0.7);
        support.connect(breath);
        breath.connect(supportGain);
        supportGain.connect(sfxDest());
        support.start(t);
        support.stop(t + duration);
    }

    function playRetroPhrase(chunks, gap) {
        ensureCtx();
        const start = ctx.currentTime;
        const step = gap == null ? 0.065 : gap;
        chunks.forEach((chunk, i) => {
            playVoiceChunk(chunk, start + i * step);
        });
    }

    function playTick() {
        osc(800, 'sine', 0.06, 0.25);
        osc(1600, 'sine', 0.03, 0.1);
    }

    function playCountdown() {
        osc(600, 'square', 0.1, 0.15);
    }

    function playGo() {
        osc(800, 'square', 0.08, 0.2);
        osc(1200, 'square', 0.12, 0.15);
    }

    function playJump() {
        ensureCtx();
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(300 + randDetune(), t);
        o.frequency.exponentialRampToValueAtTime(800 + randDetune(), t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g);
        g.connect(sfxDest());
        o.start(t);
        o.stop(t + 0.15);
        noise(0.1, 0.08, 2000);
    }

    function playHit() {
        const d = randDetune() * 0.5;
        osc(150 + d, 'sawtooth', 0.25, 0.3);
        osc(80 + d * 0.3, 'square', 0.2, 0.2);
        noise(0.15, 0.2, 800 + d * 2);
    }

    function playPerfect(combo) {
        const c = combo || 1;
        const shift = Math.min(c - 1, 8) * 40;
        osc(1200 + shift + randDetune(), 'sine', 0.12, 0.2);
        osc(1500 + shift + randDetune(), 'sine', 0.15, 0.15);
        if (c >= 3) {
            osc(1800 + shift, 'sine', 0.08, 0.1);
        }
    }

    function playGameOver() {
        ensureCtx();
        const t = ctx.currentTime;
        [420, 360, 300, 220].forEach((f, i) => {
            osc(f, 'square', 0.18, 0.15, t + i * 0.12);
        });
    }

    function playWin() {
        ensureCtx();
        const t = ctx.currentTime;
        [600, 800, 1000, 1200].forEach((f, i) => {
            osc(f, 'sine', 0.2, 0.18, t + i * 0.12);
        });
    }

    // ---- Announcer callouts (synthesized) ----
    function playAnnouncerPerfect() {
        ensureCtx();
        const t = ctx.currentTime;
        [1400, 1700, 2100].forEach((f, i) => {
            osc(f, 'sine', 0.06, 0.12, t + i * 0.05);
        });
    }

    function playAnnouncerStreak() {
        ensureCtx();
        const t = ctx.currentTime;
        [800, 1000, 1200, 1600].forEach((f, i) => {
            osc(f, 'sine', 0.1, 0.14, t + i * 0.08);
        });
        osc(1600, 'square', 0.15, 0.06, t + 0.32);
    }

    function playAnnouncerDanger() {
        ensureCtx();
        const t = ctx.currentTime;
        for (let i = 0; i < 3; i++) {
            osc(200, 'sawtooth', 0.1, 0.2, t + i * 0.15);
        }
    }

    function playAnnouncerGameOver() {
        playRetroPhrase([
            { consonant: 'g', vowel: 'a', pitch: 170, duration: 0.2, accent: 1.15, glide: -0.03 },
            { consonant: 'm', vowel: 'e', pitch: 150, duration: 0.18, accent: 1.05, glide: -0.04 },
            { consonant: 'v', vowel: 'o', pitch: 130, duration: 0.2, accent: 1.0, glide: -0.05 },
            { consonant: 'r', vowel: 'er', pitch: 114, duration: 0.22, accent: 0.95, glide: -0.07 },
        ], 0.075);
    }

    // ---- Procedural music engine ----
    let musicPlaying = false;
    let lastMusicBeat = -1;

    function musicBeat(beatIdx, currentBpm) {
        if (!musicPlaying || !ctx) return;
        ensureCtx();
        const t = ctx.currentTime;
        const beatInBar = beatIdx % 4;

        // Kick on 0, 2
        if (beatInBar === 0 || beatInBar === 2) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(150, t);
            o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
            g.gain.setValueAtTime(0.35, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
            o.connect(g);
            g.connect(musicDest());
            o.start(t);
            o.stop(t + 0.2);
        }

        // Snare on 1, 3
        if (beatInBar === 1 || beatInBar === 3) {
            const src = ctx.createBufferSource();
            src.buffer = noiseBuffer;
            const filt = ctx.createBiquadFilter();
            filt.type = 'highpass';
            filt.frequency.value = 2000;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.18, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            src.connect(filt);
            filt.connect(g);
            g.connect(musicDest());
            src.start(t);
            src.stop(t + 0.12);

            osc(180, 'triangle', 0.06, 0.08, t, musicDest());
        }

        // Hihat on every beat
        {
            const src = ctx.createBufferSource();
            src.buffer = noiseBuffer;
            const filt = ctx.createBiquadFilter();
            filt.type = 'highpass';
            filt.frequency.value = 6000;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.08, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
            src.connect(filt);
            filt.connect(g);
            g.connect(musicDest());
            src.start(t);
            src.stop(t + 0.05);
        }

        lastMusicBeat = beatIdx;
    }

    function startMusic() { musicPlaying = true; lastMusicBeat = -1; }
    function stopMusic() { musicPlaying = false; lastMusicBeat = -1; }
    function isMusicPlaying() { return musicPlaying; }

    return {
        init, playTick, playCountdown, playGo, playJump, playHit, playPerfect, playGameOver, playWin,
        setMasterVolume, setSfxVolume, setMusicVolume,
        getMasterVolume, getSfxVolume, getMusicVolume,
        playAnnouncerPerfect, playAnnouncerStreak, playAnnouncerDanger, playAnnouncerGameOver,
        musicBeat, startMusic, stopMusic, isMusicPlaying,
    };
})();
