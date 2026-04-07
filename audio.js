const SFX = (() => {
    let ctx = null;
    let noiseBuffer = null;

    function init() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const sr = ctx.sampleRate;
        const len = sr; // 1 second of noise
        noiseBuffer = ctx.createBuffer(1, len, sr);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    function ensureCtx() {
        if (!ctx) init();
        if (ctx.state === 'suspended') ctx.resume();
    }

    function osc(freq, type, duration, gainVal, startTime) {
        ensureCtx();
        const t = startTime || ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(gainVal || 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + duration);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + duration);
    }

    function noise(duration, gainVal, filterFreq) {
        ensureCtx();
        const t = ctx.currentTime;
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
        g.connect(ctx.destination);
        src.start(t);
        src.stop(t + duration);
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
        o.frequency.setValueAtTime(300, t);
        o.frequency.exponentialRampToValueAtTime(800, t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.15);
        noise(0.1, 0.08, 2000);
    }

    function playHit() {
        osc(150, 'sawtooth', 0.25, 0.3);
        osc(80, 'square', 0.2, 0.2);
        noise(0.15, 0.2, 800);
    }

    function playPerfect() {
        osc(1200, 'sine', 0.12, 0.2);
        osc(1500, 'sine', 0.15, 0.15);
    }

    function playGameOver() {
        ensureCtx();
        const t = ctx.currentTime;
        [400, 350, 300, 200].forEach((f, i) => {
            osc(f, 'square', 0.25, 0.15, t + i * 0.2);
        });
    }

    function playWin() {
        ensureCtx();
        const t = ctx.currentTime;
        [600, 800, 1000, 1200].forEach((f, i) => {
            osc(f, 'sine', 0.2, 0.18, t + i * 0.12);
        });
    }

    return { init, playTick, playCountdown, playGo, playJump, playHit, playPerfect, playGameOver, playWin };
})();
