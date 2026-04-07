const Sprites = (() => {
    const SCALE = 4;
    const W = 12;
    const H = 18;

    // --- Idle spritesheet (PNG extracted from reference art) ---
    // These values are set by tools/extract_sprites.py output.
    // Update if the spritesheet is regenerated with different dimensions.
    const IDLE_FRAME_W     = 64;   // frame width in px
    const IDLE_FRAME_H     = 62;   // frame height in px
    const IDLE_FRAME_COUNT = 16;   // 16-frame idle breathing animation
    const IDLE_FPS         = 10;   // animation speed (frames per second)

    const idleSheets = {};
    const idleSheetsLoaded = {};

    (['blue', 'red']).forEach(pal => {
        const img = new Image();
        img.onload = () => { idleSheets[pal] = img; idleSheetsLoaded[pal] = true; };
        img.onerror = () => { /* falls back to procedural sprite */ };
        img.src = `assets/${pal}_idle.png`;
    });

    // --- Jump spritesheet ---
    const JUMP_FRAME_W     = 51;
    const JUMP_FRAME_H     = 58;
    const JUMP_FRAME_COUNT = 20;
    // Scale jump frames up so they display at the same height as idle frames
    const JUMP_DISPLAY_H = IDLE_FRAME_H;
    const JUMP_DISPLAY_W = Math.round(JUMP_FRAME_W * (IDLE_FRAME_H / JUMP_FRAME_H));

    const jumpSheets = {};
    const jumpSheetsLoaded = {};

    (['blue', 'red']).forEach(pal => {
        const img = new Image();
        img.onload = () => { jumpSheets[pal] = img; jumpSheetsLoaded[pal] = true; };
        img.onerror = () => { /* falls back to procedural sprite */ };
        img.src = `assets/${pal}_jump.png`;
    });

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

    const cache = {};

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
        const c = makeCanvas(W, H);
        const ctx = c.getContext('2d');

        // Helmet
        rect(ctx, 3, 0, 6, 1, p.helmetLight);
        rect(ctx, 2, 1, 8, 2, p.helmet);
        rect(ctx, 2, 3, 1, 1, p.helmetDark);
        rect(ctx, 9, 3, 1, 1, p.helmetDark);
        rect(ctx, 3, 3, 6, 1, p.visor);
        rect(ctx, 3, 4, 6, 1, p.helmetDark);
        // Neck
        rect(ctx, 5, 5, 2, 1, p.skin);
        // Cape
        rect(ctx, 0, 6, 2, 4, p.cape);
        rect(ctx, 0, 10, 2, 1, p.capeDark);
        // Shoulders
        rect(ctx, 1, 6, 10, 1, p.armorLight);
        // Body
        rect(ctx, 3, 7, 6, 4, p.armor);
        // Arms
        rect(ctx, 1, 7, 2, 2, p.armorLight);
        rect(ctx, 9, 7, 2, 2, p.armorLight);
        rect(ctx, 1, 9, 2, 1, p.skin);
        rect(ctx, 9, 9, 2, 1, p.skin);
        // Belt
        rect(ctx, 3, 11, 6, 1, p.belt);
        rect(ctx, 5, 11, 2, 1, p.buckle);
        // Legs
        rect(ctx, 3, 12, 3, 3, p.armorDark);
        rect(ctx, 6, 12, 3, 3, p.armorDark);
        // Boots
        rect(ctx, 2, 15, 4, 2, p.boots);
        rect(ctx, 6, 15, 4, 2, p.boots);
        rect(ctx, 2, 17, 4, 1, p.bootsDark);
        rect(ctx, 6, 17, 4, 1, p.bootsDark);

        return c;
    }

    function buildJump(p) {
        const c = makeCanvas(W, H);
        const ctx = c.getContext('2d');

        // Helmet
        rect(ctx, 3, 0, 6, 1, p.helmetLight);
        rect(ctx, 2, 1, 8, 2, p.helmet);
        rect(ctx, 2, 3, 1, 1, p.helmetDark);
        rect(ctx, 9, 3, 1, 1, p.helmetDark);
        rect(ctx, 3, 3, 6, 1, p.visor);
        rect(ctx, 3, 4, 6, 1, p.helmetDark);
        // Arms raised
        rect(ctx, 1, 3, 2, 2, p.armorLight);
        rect(ctx, 9, 3, 2, 2, p.armorLight);
        rect(ctx, 1, 2, 2, 1, p.skin);
        rect(ctx, 9, 2, 2, 1, p.skin);
        // Cape upward
        rect(ctx, 0, 5, 1, 3, p.cape);
        rect(ctx, 0, 8, 1, 1, p.capeDark);
        // Shoulders
        rect(ctx, 1, 6, 10, 1, p.armorLight);
        // Body
        rect(ctx, 3, 7, 6, 4, p.armor);
        // Belt
        rect(ctx, 3, 11, 6, 1, p.belt);
        rect(ctx, 5, 11, 2, 1, p.buckle);
        // Legs together
        rect(ctx, 4, 12, 4, 3, p.armorDark);
        // Boots together
        rect(ctx, 3, 15, 6, 2, p.boots);
        rect(ctx, 3, 17, 6, 1, p.bootsDark);

        return c;
    }

    function buildHit(p) {
        const c = makeCanvas(W + 2, H);
        const ctx = c.getContext('2d');

        // Shifted right and leaning
        rect(ctx, 4, 0, 6, 1, p.helmetLight);
        rect(ctx, 3, 1, 8, 2, p.helmet);
        rect(ctx, 4, 3, 6, 1, p.visor);
        rect(ctx, 4, 4, 6, 1, p.helmetDark);
        // Body shifted
        rect(ctx, 2, 5, 10, 1, p.armorLight);
        rect(ctx, 4, 6, 6, 4, p.armor);
        // Arms flung out
        rect(ctx, 0, 6, 3, 1, p.armorLight);
        rect(ctx, 0, 7, 1, 1, p.skin);
        rect(ctx, 10, 6, 3, 1, p.armorLight);
        rect(ctx, 12, 7, 1, 1, p.skin);
        // Belt
        rect(ctx, 4, 10, 6, 1, p.belt);
        // Legs
        rect(ctx, 4, 11, 3, 3, p.armorDark);
        rect(ctx, 7, 11, 3, 3, p.armorDark);
        // Boots
        rect(ctx, 3, 14, 4, 2, p.boots);
        rect(ctx, 7, 14, 4, 2, p.boots);
        rect(ctx, 3, 16, 4, 1, p.bootsDark);
        rect(ctx, 7, 16, 4, 1, p.bootsDark);

        return c;
    }

    function getSprite(paletteName, state) {
        const key = paletteName + '_' + state;
        if (!cache[key]) {
            const p = Palettes[paletteName];
            if (state === 'idle') cache[key] = buildIdle(p);
            else if (state === 'jump') cache[key] = buildJump(p);
            else if (state === 'hit') cache[key] = buildHit(p);
        }
        return cache[key];
    }

    function draw(ctx, x, y, paletteName, state, scale, jumpProgress) {
        ctx.imageSmoothingEnabled = false;

        if (state === 'idle' && idleSheetsLoaded[paletteName]) {
            const frame = IDLE_FRAME_COUNT > 1
                ? Math.floor(Date.now() / (1000 / IDLE_FPS)) % IDLE_FRAME_COUNT
                : 0;
            ctx.drawImage(
                idleSheets[paletteName],
                frame * IDLE_FRAME_W, 0, IDLE_FRAME_W, IDLE_FRAME_H,
                x, y, IDLE_FRAME_W, IDLE_FRAME_H
            );
            return;
        }

        if (state === 'jump' && jumpSheetsLoaded[paletteName]) {
            const frame = Math.min(
                JUMP_FRAME_COUNT - 1,
                Math.floor((jumpProgress || 0) * JUMP_FRAME_COUNT)
            );
            ctx.drawImage(
                jumpSheets[paletteName],
                frame * JUMP_FRAME_W, 0, JUMP_FRAME_W, JUMP_FRAME_H,
                x, y, JUMP_DISPLAY_W, JUMP_DISPLAY_H
            );
            return;
        }

        const s = scale || SCALE;
        const sprite = getSprite(paletteName, state);
        ctx.drawImage(sprite, x, y, sprite.width * s, sprite.height * s);
    }

    function spriteSize(state, scale) {
        if (state === 'idle' && idleSheetsLoaded['blue']) {
            return { w: IDLE_FRAME_W, h: IDLE_FRAME_H };
        }
        if (state === 'jump' && jumpSheetsLoaded['blue']) {
            return { w: JUMP_DISPLAY_W, h: JUMP_DISPLAY_H };
        }
        const s = scale || SCALE;
        const sprite = getSprite('blue', state || 'idle');
        return { w: sprite.width * s, h: sprite.height * s };
    }

    return { draw, spriteSize, Palettes, SCALE, W, H };
})();
