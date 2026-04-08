const Sprites = (() => {
    const SCALE = 1;
    const ANIM_FPS = 12;

    const Palettes = {
        blue: {
            helmet: '#4466BB', helmetLight: '#5588DD', helmetDark: '#334499',
            visor: '#FFD633', armor: '#3355AA', armorLight: '#4477CC',
            armorDark: '#2B4488', skin: '#FFCC88', cape: '#2244BB',
            capeDark: '#113399', belt: '#887755', buckle: '#FFD633',
            boots: '#554433', bootsDark: '#332211',
        },
        red: {
            helmet: '#BB4466', helmetLight: '#DD5588', helmetDark: '#993344',
            visor: '#FFD633', armor: '#AA3355', armorLight: '#CC4477',
            armorDark: '#882B44', skin: '#FFCC88', cape: '#BB2244',
            capeDark: '#991133', belt: '#887755', buckle: '#FFD633',
            boots: '#554433', bootsDark: '#332211',
        },
    };

    const W_FALLBACK = 12;
    const H_FALLBACK = 18;
    const SCALE_FALLBACK = 4;

    const sheets = {};
    const fallbackCache = {};
    let sheetsReady = false;

    // ---- Spritesheet loading ----
    const SHEET_DEFS = {
        blue_idle: 'assets/blue_idle.png',
        blue_jump: 'assets/blue_jump.png',
        red_idle:  'assets/red_idle.png',
        red_jump:  'assets/red_jump.png',
    };

    function extractFrames(img) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const pixels = data.data;
        const w = img.width;
        const h = img.height;

        const colHas = new Uint8Array(w);
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                if (pixels[(y * w + x) * 4 + 3] > 0) {
                    colHas[x] = 1;
                    break;
                }
            }
        }

        const runs = [];
        let start = -1;
        for (let x = 0; x < w; x++) {
            if (colHas[x] && start < 0) start = x;
            else if (!colHas[x] && start >= 0) {
                runs.push({ x: start, w: x - start });
                start = -1;
            }
        }
        if (start >= 0) runs.push({ x: start, w: w - start });

        const frames = runs.filter(r => r.w > 4);

        return frames.map(f => {
            const fc = document.createElement('canvas');
            fc.width = f.w;
            fc.height = h;
            fc.getContext('2d').drawImage(img, f.x, 0, f.w, h, 0, 0, f.w, h);
            return fc;
        });
    }

    function loadAllSheets() {
        const entries = Object.entries(SHEET_DEFS);
        let loaded = 0;
        entries.forEach(([key, src]) => {
            const img = new Image();
            img.onload = () => {
                sheets[key] = extractFrames(img);
                loaded++;
                if (loaded === entries.length) sheetsReady = true;
            };
            img.onerror = () => {
                sheets[key] = null;
                loaded++;
                if (loaded === entries.length) sheetsReady = true;
            };
            img.src = src;
        });
    }

    loadAllSheets();

    // ---- Fallback programmatic sprites (used for 'hit' state) ----
    function makeCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    function rect(ctx, x, y, w, h, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
    }

    function buildIdle(p) {
        const c = makeCanvas(W_FALLBACK, H_FALLBACK);
        const ctx = c.getContext('2d');
        rect(ctx, 3, 0, 6, 1, p.helmetLight);
        rect(ctx, 2, 1, 8, 2, p.helmet);
        rect(ctx, 2, 3, 1, 1, p.helmetDark);
        rect(ctx, 9, 3, 1, 1, p.helmetDark);
        rect(ctx, 3, 3, 6, 1, p.visor);
        rect(ctx, 3, 4, 6, 1, p.helmetDark);
        rect(ctx, 5, 5, 2, 1, p.skin);
        rect(ctx, 0, 6, 2, 4, p.cape);
        rect(ctx, 0, 10, 2, 1, p.capeDark);
        rect(ctx, 1, 6, 10, 1, p.armorLight);
        rect(ctx, 3, 7, 6, 4, p.armor);
        rect(ctx, 1, 7, 2, 2, p.armorLight);
        rect(ctx, 9, 7, 2, 2, p.armorLight);
        rect(ctx, 1, 9, 2, 1, p.skin);
        rect(ctx, 9, 9, 2, 1, p.skin);
        rect(ctx, 3, 11, 6, 1, p.belt);
        rect(ctx, 5, 11, 2, 1, p.buckle);
        rect(ctx, 3, 12, 3, 3, p.armorDark);
        rect(ctx, 6, 12, 3, 3, p.armorDark);
        rect(ctx, 2, 15, 4, 2, p.boots);
        rect(ctx, 6, 15, 4, 2, p.boots);
        rect(ctx, 2, 17, 4, 1, p.bootsDark);
        rect(ctx, 6, 17, 4, 1, p.bootsDark);
        return c;
    }

    function buildJump(p) {
        const c = makeCanvas(W_FALLBACK, H_FALLBACK);
        const ctx = c.getContext('2d');
        rect(ctx, 3, 0, 6, 1, p.helmetLight);
        rect(ctx, 2, 1, 8, 2, p.helmet);
        rect(ctx, 2, 3, 1, 1, p.helmetDark);
        rect(ctx, 9, 3, 1, 1, p.helmetDark);
        rect(ctx, 3, 3, 6, 1, p.visor);
        rect(ctx, 3, 4, 6, 1, p.helmetDark);
        rect(ctx, 1, 3, 2, 2, p.armorLight);
        rect(ctx, 9, 3, 2, 2, p.armorLight);
        rect(ctx, 1, 2, 2, 1, p.skin);
        rect(ctx, 9, 2, 2, 1, p.skin);
        rect(ctx, 0, 5, 1, 3, p.cape);
        rect(ctx, 0, 8, 1, 1, p.capeDark);
        rect(ctx, 1, 6, 10, 1, p.armorLight);
        rect(ctx, 3, 7, 6, 4, p.armor);
        rect(ctx, 3, 11, 6, 1, p.belt);
        rect(ctx, 5, 11, 2, 1, p.buckle);
        rect(ctx, 4, 12, 4, 3, p.armorDark);
        rect(ctx, 3, 15, 6, 2, p.boots);
        rect(ctx, 3, 17, 6, 1, p.bootsDark);
        return c;
    }

    function buildHit(p) {
        const c = makeCanvas(W_FALLBACK + 2, H_FALLBACK);
        const ctx = c.getContext('2d');
        rect(ctx, 4, 0, 6, 1, p.helmetLight);
        rect(ctx, 3, 1, 8, 2, p.helmet);
        rect(ctx, 4, 3, 6, 1, p.visor);
        rect(ctx, 4, 4, 6, 1, p.helmetDark);
        rect(ctx, 2, 5, 10, 1, p.armorLight);
        rect(ctx, 4, 6, 6, 4, p.armor);
        rect(ctx, 0, 6, 3, 1, p.armorLight);
        rect(ctx, 0, 7, 1, 1, p.skin);
        rect(ctx, 10, 6, 3, 1, p.armorLight);
        rect(ctx, 12, 7, 1, 1, p.skin);
        rect(ctx, 4, 10, 6, 1, p.belt);
        rect(ctx, 4, 11, 3, 3, p.armorDark);
        rect(ctx, 7, 11, 3, 3, p.armorDark);
        rect(ctx, 3, 14, 4, 2, p.boots);
        rect(ctx, 7, 14, 4, 2, p.boots);
        rect(ctx, 3, 16, 4, 1, p.bootsDark);
        rect(ctx, 7, 16, 4, 1, p.bootsDark);
        return c;
    }

    function getFallback(paletteName, state) {
        const key = paletteName + '_' + state;
        if (!fallbackCache[key]) {
            const p = Palettes[paletteName];
            if (state === 'idle') fallbackCache[key] = buildIdle(p);
            else if (state === 'jump') fallbackCache[key] = buildJump(p);
            else if (state === 'hit') fallbackCache[key] = buildHit(p);
        }
        return fallbackCache[key];
    }

    // ---- Public API ----
    function getIdleH() {
        const f = sheets['blue_idle'];
        return f && f.length ? f[0].height : H_FALLBACK * SCALE_FALLBACK;
    }

    function getFrame(paletteName, state, frameIdx) {
        if (state === 'hit') {
            return getScaledHitFallback(paletteName);
        }

        const key = paletteName + '_' + state;
        const frameList = sheets[key];
        if (frameList && frameList.length > 0) {
            const i = (frameIdx || 0) % frameList.length;
            return frameList[i];
        }
        return getFallback(paletteName, state);
    }

    function getScaledHitFallback(paletteName) {
        const key = paletteName + '_hit_scaled';
        if (fallbackCache[key]) return fallbackCache[key];

        const raw = getFallback(paletteName, 'hit');
        if (!sheetsReady) return raw;

        const targetH = getIdleH();
        const s = targetH / raw.height;
        const c = document.createElement('canvas');
        c.width = Math.round(raw.width * s);
        c.height = Math.round(raw.height * s);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(raw, 0, 0, c.width, c.height);
        fallbackCache[key] = c;
        return c;
    }

    function frameCount(paletteName, state) {
        if (state === 'hit') return 1;
        const key = paletteName + '_' + state;
        const frameList = sheets[key];
        return (frameList && frameList.length > 0) ? frameList.length : 1;
    }

    // jumpProgress: 0–1 fraction through the jump arc (used for jump animation sync)
    function draw(ctx, x, y, paletteName, state, scaleOverride, jumpProgress) {
        const totalFrames = frameCount(paletteName, state);
        let frameIdx;
        if (state === 'jump' && totalFrames > 1 && jumpProgress != null) {
            frameIdx = Math.min(totalFrames - 1, Math.floor(jumpProgress * totalFrames));
        } else {
            frameIdx = totalFrames > 1
                ? Math.floor((performance.now() / 1000) * ANIM_FPS) % totalFrames
                : 0;
        }

        const frame = getFrame(paletteName, state, frameIdx);

        // Normalise all states to idle height so characters stay consistent in size
        const targetH = getIdleH();
        const displayH = targetH;
        const displayW = Math.round(frame.width * (targetH / frame.height));

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(frame, x, y, displayW, displayH);
    }

    function spriteSize(state) {
        const frame = getFrame('blue', state || 'idle', 0);
        const targetH = getIdleH();
        return {
            w: Math.round(frame.width * (targetH / frame.height)),
            h: targetH,
        };
    }

    return { draw, spriteSize, frameCount, Palettes, SCALE, W: W_FALLBACK, H: H_FALLBACK };
})();
