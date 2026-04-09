const Renderer = (() => {
    let canvas, ctx;
    const CW = 800;
    const CH = 500;
    const PLATFORM_Y = 470;
    const PLATFORM_H = 18;
    const PIVOT_Y = 10;
    const ARM_LEN = PLATFORM_Y - PIVOT_Y;
    const MAX_ANGLE = Math.PI / 3.2;

    // ---- Parallax background layers ----
    let bgFar = null;   // sky + stars
    let bgMid = null;   // wall
    let bgNear = null;  // torches + details

    // ---- Blade blood accumulation ----
    let bladeBloodSplatters = [];

    function addBladeBlood() {
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const t = Math.random();
            const edgeX = -30 + 60 * t;
            const edgeY = 36 * Math.sin(Math.PI * t);
            bladeBloodSplatters.push({
                x: edgeX + (Math.random() - 0.5) * 6,
                y: edgeY - Math.random() * 6,
                size: 1.5 + Math.random() * 2.5,
                color: Math.random() > 0.4 ? '#991111' : '#771111',
            });
        }
    }

    function resetBladeBlood() { bladeBloodSplatters = []; }

    function drawBladeBlood() {
        if (bladeBloodSplatters.length === 0) return;
        for (const s of bladeBloodSplatters) {
            ctx.fillStyle = s.color;
            ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
        }
    }

    // ---- Blade trail ----
    let bladeTrail = [];
    const TRAIL_MAX = 12;

    // ---- Smooth camera state ----
    let cameraOffsetY = 0;
    let cameraZoom = 1;

    // ---- Screen effects state ----
    let vignetteGrad = null;

    function resetEffects() {
        bladeTrail = [];
        cameraOffsetY = 0;
        cameraZoom = 1;
    }

    // ---- Rope (chain) simulation ----
    const BLADE_OFFSET = 20;
    const ROPE_SEGS = 8;
    const BLADE_CENTER_OFFSET = 21;
    const ROPE_SEG_LEN = (ARM_LEN - BLADE_OFFSET + BLADE_CENTER_OFFSET) / ROPE_SEGS;
    const ROPE_GRAVITY = 400;
    const ROPE_ITERATIONS = 12;
    const ROPE_DAMPING = 0.92;
    const ROPE_STIFFNESS = 0.4;
    let ropePoints = null;
    let ropeLastTime = 0;

    function initRope(anchorX, anchorY, endX, endY) {
        ropePoints = [];
        for (let i = 0; i <= ROPE_SEGS; i++) {
            const t = i / ROPE_SEGS;
            const x = anchorX + (endX - anchorX) * t;
            const y = anchorY + (endY - anchorY) * t;
            ropePoints.push({ x, y, ox: x, oy: y });
        }
        ropeLastTime = performance.now();
    }

    function updateRope(anchorX, anchorY, endX, endY) {
        if (!ropePoints) { initRope(anchorX, anchorY, endX, endY); return; }

        const now = performance.now();
        const dt = Math.min(0.033, (now - ropeLastTime) / 1000);
        ropeLastTime = now;
        if (dt <= 0) return;

        const restPoints = [];
        for (let i = 0; i <= ROPE_SEGS; i++) {
            const t = i / ROPE_SEGS;
            restPoints.push({
                x: anchorX + (endX - anchorX) * t,
                y: anchorY + (endY - anchorY) * t,
            });
        }

        for (let i = 1; i < ROPE_SEGS; i++) {
            const p = ropePoints[i];
            const vx = (p.x - p.ox) * ROPE_DAMPING;
            const vy = (p.y - p.oy) * ROPE_DAMPING;
            p.ox = p.x; p.oy = p.y;
            p.x += vx; p.y += vy + ROPE_GRAVITY * dt * dt;
            p.x += (restPoints[i].x - p.x) * ROPE_STIFFNESS;
            p.y += (restPoints[i].y - p.y) * ROPE_STIFFNESS;
        }

        ropePoints[0].x = ropePoints[0].ox = anchorX;
        ropePoints[0].y = ropePoints[0].oy = anchorY;
        ropePoints[ROPE_SEGS].x = ropePoints[ROPE_SEGS].ox = endX;
        ropePoints[ROPE_SEGS].y = ropePoints[ROPE_SEGS].oy = endY;

        for (let iter = 0; iter < ROPE_ITERATIONS; iter++) {
            for (let i = 0; i < ROPE_SEGS; i++) {
                const a = ropePoints[i];
                const b = ropePoints[i + 1];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const diff = (dist - ROPE_SEG_LEN) / dist * 0.5;
                const ox = dx * diff;
                const oy = dy * diff;
                if (i > 0) { a.x += ox; a.y += oy; }
                if (i < ROPE_SEGS - 1) { b.x -= ox; b.y -= oy; }
            }
            ropePoints[0].x = anchorX; ropePoints[0].y = anchorY;
            ropePoints[ROPE_SEGS].x = endX; ropePoints[ROPE_SEGS].y = endY;
        }

        const BLEND_COUNT = 3;
        for (let i = 1; i <= BLEND_COUNT; i++) {
            const idx = ROPE_SEGS - i;
            if (idx <= 0) break;
            const blend = i / (BLEND_COUNT + 1);
            const target = ropePoints[idx + 1] || { x: endX, y: endY };
            const prev = ropePoints[idx - 1];
            const straightX = prev.x + (target.x - prev.x) * 0.5;
            const straightY = prev.y + (target.y - prev.y) * 0.5;
            ropePoints[idx].x += (straightX - ropePoints[idx].x) * blend;
            ropePoints[idx].y += (straightY - ropePoints[idx].y) * blend;
        }
    }

    function drawRope() {
        if (!ropePoints) return;
        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(ropePoints[0].x, ropePoints[0].y);
        for (let i = 1; i <= ROPE_SEGS; i++) {
            ctx.lineTo(ropePoints[i].x, ropePoints[i].y);
        }
        ctx.stroke();
    }

    function init(c) {
        canvas = c;
        ctx = canvas.getContext('2d');
        canvas.width = CW;
        canvas.height = CH;
        buildParallaxLayers();
        buildVignette();
    }

    // ---- Parallax background layers ----
    function buildParallaxLayers() {
        const rng = mulberry32(42);

        // Far layer: sky gradient + stars
        bgFar = document.createElement('canvas');
        bgFar.width = CW + 40; bgFar.height = CH;
        const far = bgFar.getContext('2d');
        const grad = far.createLinearGradient(0, 0, 0, CH);
        grad.addColorStop(0, '#08081a');
        grad.addColorStop(0.5, '#0e0e28');
        grad.addColorStop(1, '#141432');
        far.fillStyle = grad;
        far.fillRect(0, 0, bgFar.width, CH);
        for (let i = 0; i < 60; i++) {
            const sx = rng() * bgFar.width;
            const sy = rng() * CH * 0.6;
            const brightness = 80 + Math.floor(rng() * 120);
            const size = rng() > 0.85 ? 2 : 1;
            far.fillStyle = `rgb(${brightness},${brightness},${brightness + 40})`;
            far.fillRect(Math.floor(sx), Math.floor(sy), size, size);
        }

        // Mid layer: wall silhouettes
        bgMid = document.createElement('canvas');
        bgMid.width = CW + 60; bgMid.height = CH;
        const mid = bgMid.getContext('2d');
        mid.fillStyle = '#0c0c22';
        drawWall(mid, 0, CH * 0.35, bgMid.width, CH * 0.65);

        // Near layer: torches + decorative
        bgNear = document.createElement('canvas');
        bgNear.width = CW + 80; bgNear.height = CH;
        const near = bgNear.getContext('2d');
        [[100, 170], [300, 160], [500, 165], [700, 155]].forEach(([tx, ty]) => {
            near.fillStyle = '#332211';
            near.fillRect(tx - 1, ty, 3, 20);
            near.fillStyle = '#ff8833';
            near.fillRect(tx - 2, ty - 4, 5, 5);
            near.fillStyle = '#ffcc44';
            near.fillRect(tx - 1, ty - 3, 3, 3);
            const glow = near.createRadialGradient(tx, ty, 2, tx, ty, 40);
            glow.addColorStop(0, 'rgba(255,140,40,0.12)');
            glow.addColorStop(1, 'rgba(255,100,20,0)');
            near.fillStyle = glow;
            near.fillRect(tx - 40, ty - 40, 80, 80);
        });
        // Hanging chains decorative
        for (let i = 0; i < 5; i++) {
            const cx = 50 + i * 180;
            near.strokeStyle = '#333344';
            near.lineWidth = 1;
            near.beginPath();
            near.moveTo(cx, 0);
            near.lineTo(cx + 3, 30 + rng() * 20);
            near.stroke();
        }
    }

    function buildVignette() {
        const vc = document.createElement('canvas');
        vc.width = CW; vc.height = CH;
        const vctx = vc.getContext('2d');
        const grad = vctx.createRadialGradient(CW / 2, CH / 2, CW * 0.25, CW / 2, CH / 2, CW * 0.6);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.7)');
        vctx.fillStyle = grad;
        vctx.fillRect(0, 0, CW, CH);
        vignetteGrad = vc;
    }

    function drawWall(bg, x, y, w, h) {
        bg.fillRect(x, y, w, h);
        bg.fillStyle = '#0a0a1e';
        for (let row = 0; row < h; row += 16) {
            const offset = (Math.floor(row / 16) % 2) * 16;
            for (let col = offset; col < w; col += 32) {
                bg.fillRect(x + col, y + row, 1, 16);
            }
            bg.fillRect(x, y + row, w, 1);
        }
    }

    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function renderPlatform(x, w) {
        const tileW = 32;
        const tileH = PLATFORM_H;
        for (let tx = x; tx < x + w; tx += tileW) {
            const tw = Math.min(tileW, x + w - tx);
            ctx.fillStyle = '#776655';
            ctx.fillRect(tx, PLATFORM_Y, tw, 2);
            ctx.fillStyle = '#665544';
            ctx.fillRect(tx, PLATFORM_Y + 2, tw, tileH - 4);
            ctx.fillStyle = '#554433';
            ctx.fillRect(tx, PLATFORM_Y + tileH - 2, tw, 2);
            ctx.fillStyle = '#554433';
            ctx.fillRect(tx, PLATFORM_Y, 1, tileH);
        }
        ctx.fillStyle = '#2a2420';
        ctx.fillRect(x, PLATFORM_Y + PLATFORM_H, w, CH - PLATFORM_Y - PLATFORM_H);
    }

    function renderPendulum(centerX, angle, invisible) {
        if (invisible) return;

        const tipX = centerX + ARM_LEN * Math.sin(angle);
        const tipY = PIVOT_Y + ARM_LEN * Math.cos(angle);
        const nearCenter = 1 - Math.min(1, Math.abs(angle) / (MAX_ANGLE * 0.15));

        const bladeX = tipX - BLADE_OFFSET * Math.sin(angle);
        const bladeY = tipY - BLADE_OFFSET * Math.cos(angle);

        const BLADE_CENTER = 21;
        const ropeTipX = bladeX + BLADE_CENTER * Math.sin(angle);
        const ropeTipY = bladeY + BLADE_CENTER * Math.cos(angle);
        updateRope(centerX, PIVOT_Y, ropeTipX, ropeTipY);
        drawRope();

        // Blade trail
        bladeTrail.push({ x: tipX, y: tipY });
        if (bladeTrail.length > TRAIL_MAX) bladeTrail.shift();

        // Draw trail
        if (bladeTrail.length > 1) {
            for (let i = 1; i < bladeTrail.length; i++) {
                const a = i / bladeTrail.length;
                ctx.strokeStyle = `rgba(200,210,230,${a * 0.15})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(bladeTrail[i - 1].x, bladeTrail[i - 1].y);
                ctx.lineTo(bladeTrail[i].x, bladeTrail[i].y);
                ctx.stroke();
            }
        }

        // Blade
        ctx.save();
        ctx.translate(bladeX, bladeY);
        ctx.rotate(-angle * 0.6);

        ctx.fillStyle = '#778899';
        ctx.beginPath();
        ctx.moveTo(-32, 0);
        ctx.quadraticCurveTo(0, 42, 32, 0);
        ctx.quadraticCurveTo(0, 12, -32, 0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#99aabb';
        ctx.beginPath();
        ctx.moveTo(-26, 1);
        ctx.quadraticCurveTo(0, 34, 26, 1);
        ctx.quadraticCurveTo(0, 14, -26, 1);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = nearCenter > 0.3
            ? `rgba(240,248,255,${0.4 + 0.6 * nearCenter})`
            : 'rgba(200,215,230,0.4)';
        ctx.lineWidth = nearCenter > 0.3 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(-30, 1);
        ctx.quadraticCurveTo(0, 40, 30, 1);
        ctx.stroke();

        ctx.strokeStyle = '#556677';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-24, 2);
        ctx.quadraticCurveTo(0, 13, 24, 2);
        ctx.stroke();

        drawBladeBlood();
        ctx.restore();

        // Pivot gear
        ctx.fillStyle = '#333344';
        ctx.beginPath();
        ctx.arc(centerX, PIVOT_Y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#555566';
        ctx.beginPath();
        ctx.arc(centerX, PIVOT_Y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function renderCharacter(player, arenaX, arenaW) {
        const palette = player.index === 0 ? 'blue' : 'red';
        const state = player.hitTimer > 0 ? 'hit' : (player.isJumping ? 'jump' : 'idle');
        const size = Sprites.spriteSize(state);
        const cx = arenaX + arenaW / 2;
        const charX = cx - size.w / 2;
        const baseY = PLATFORM_Y - size.h;
        const charY = baseY - player.jumpY;

        // Shield glow
        if (player.shield) {
            ctx.save();
            ctx.globalAlpha = 0.25 + 0.1 * Math.sin(performance.now() / 200);
            ctx.fillStyle = '#FFD633';
            ctx.beginPath();
            ctx.arc(cx, charY + size.h / 2, size.w * 0.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Shadow
        const shadowScale = 1 - player.jumpY / 50;
        if (shadowScale > 0) {
            ctx.fillStyle = `rgba(0,0,0,${0.3 * shadowScale})`;
            const sw = size.w * 0.7 * shadowScale;
            ctx.fillRect(cx - sw / 2, PLATFORM_Y - 3, sw, 4);
        }

        // Hit flash
        if (player.hitTimer > 0 && Math.floor(player.hitTimer * 10) % 2 === 0) {
            ctx.globalAlpha = 0.6;
        }

        const HIT_ANIM_DUR = 0.7;
        const hitProgress = (state === 'hit') ? 1 - (player.hitTimer / HIT_ANIM_DUR) : undefined;
        Sprites.draw(ctx, charX, charY, palette, state, undefined, player.jumpProgress, hitProgress);
        ctx.globalAlpha = 1;

        // Mini blood spurt
        if (player.bloodSpurt && player.bloodSpurt.length > 0) {
            player.bloodSpurt.forEach(b => {
                ctx.globalAlpha = Math.max(0, b.life * 2);
                ctx.fillStyle = b.life > 0.3 ? '#cc1111' : '#881111';
                ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
            });
            ctx.globalAlpha = 1;
        }

        // Judgment popup
        if (player.judgmentText && player.judgmentTimer > 0) {
            const alpha = Math.min(1, player.judgmentTimer * 2);
            const yOff = (1 - player.judgmentTimer) * 40;
            ctx.globalAlpha = alpha;
            ctx.font = '16px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            if (player.judgmentText === 'PERFECT') ctx.fillStyle = '#FFD633';
            else if (player.judgmentText === 'GOOD') ctx.fillStyle = '#44DD66';
            else if (player.judgmentText === 'BLOCKED') ctx.fillStyle = '#4488FF';
            else ctx.fillStyle = '#EE4444';

            let label = player.judgmentText;
            if (player.judgmentText === 'PERFECT' && player.combo > 1) {
                label += ' ' + player.combo + 'x';
            }
            ctx.fillText(label, cx, baseY - 30 - yOff);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'start';
        }

        // Emote bubble
        if (player.emote && player.emoteTimer > 0) {
            const ea = Math.min(1, player.emoteTimer * 1.5);
            ctx.globalAlpha = ea;
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            const bubbleY = baseY - size.h - 20;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            const tw = ctx.measureText(player.emote).width + 12;
            ctx.fillRect(cx - tw / 2, bubbleY - 10, tw, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(player.emote, cx, bubbleY + 2);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'start';
        }

        // Double points indicator
        if (player.doublePoints > 0) {
            ctx.globalAlpha = 0.7;
            ctx.font = '7px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFD633';
            ctx.fillText('2x PTS', cx, baseY - 8);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'start';
        }
    }

    function renderPowerUps(pups, arenaX, arenaW, playerArena) {
        if (!pups || pups.length === 0) return;
        pups.forEach(pu => {
            if (pu.playerArena !== playerArena) return;
            const blink = pu.life < 2 && Math.floor(pu.life * 5) % 2 === 0;
            if (blink) return;

            ctx.save();
            const s = 10;
            const px = pu.x;
            const py = pu.y;

            switch (pu.type) {
                case 'shield':
                    ctx.fillStyle = '#FFD633';
                    ctx.beginPath();
                    ctx.moveTo(px, py - s);
                    ctx.lineTo(px + s * 0.7, py - s * 0.3);
                    ctx.lineTo(px + s * 0.5, py + s * 0.5);
                    ctx.lineTo(px, py + s * 0.8);
                    ctx.lineTo(px - s * 0.5, py + s * 0.5);
                    ctx.lineTo(px - s * 0.7, py - s * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    break;
                case 'slow':
                    ctx.fillStyle = '#4488FF';
                    ctx.beginPath();
                    ctx.arc(px, py, s * 0.6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(px, py - s * 0.3);
                    ctx.lineTo(px, py);
                    ctx.lineTo(px + s * 0.25, py + s * 0.15);
                    ctx.stroke();
                    break;
                case 'doublePoints':
                    ctx.fillStyle = '#44DD66';
                    ctx.font = '8px "Press Start 2P", monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('2x', px, py + 3);
                    ctx.textAlign = 'start';
                    break;
                case 'spike':
                    ctx.fillStyle = '#EE4444';
                    ctx.beginPath();
                    for (let j = 0; j < 5; j++) {
                        const a = (j / 5) * Math.PI * 2 - Math.PI / 2;
                        const r = j % 2 === 0 ? s * 0.7 : s * 0.3;
                        if (j === 0) ctx.moveTo(px + r * Math.cos(a), py + r * Math.sin(a));
                        else ctx.lineTo(px + r * Math.cos(a), py + r * Math.sin(a));
                    }
                    ctx.closePath();
                    ctx.fill();
                    break;
            }
            ctx.restore();
        });
    }

    function renderDivider() {
        const x = CW / 2;
        ctx.fillStyle = '#222233';
        ctx.fillRect(x - 2, 0, 4, CH);
        ctx.fillStyle = '#333355';
        ctx.fillRect(x - 1, 0, 2, CH);
        for (let y = 10; y < CH; y += 30) {
            ctx.fillStyle = '#444466';
            ctx.fillRect(x - 2, y, 4, 4);
        }
    }

    function renderCountdown(count) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, CW, CH);
        ctx.font = '64px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = count === 'GO' ? '#44DD66' : '#FFD633';
        ctx.shadowBlur = 20;
        ctx.shadowColor = count === 'GO' ? '#22AA44' : '#AA8800';
        ctx.fillText(count, CW / 2, CH / 2);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    function renderRagdoll(r) {
        if (!r) return;

        if (r.trail && r.trail.length > 0) {
            const len = r.trail.length;
            for (let i = 0; i < len; i++) {
                const t = r.trail[i];
                const fade = 0.35 + 0.35 * (i / len);
                ctx.globalAlpha = fade;
                ctx.fillStyle = (i % 3 === 0) ? '#881111' : '#aa1818';
                const s = t.size;
                ctx.fillRect(t.x - s / 2, t.y - s / 2, s, s);
            }
            ctx.globalAlpha = 1;
        }

        ctx.save();
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(r.rotation);

        const flipX = r.slideDir && r.slideDir < 0 ? -1 : 1;
        if (flipX < 0) ctx.scale(-1, 1);

        Sprites.draw(ctx, -r.w / 2, -r.h / 2, r.palette, 'hit', undefined, undefined, r.hitProgress != null ? r.hitProgress : 1.0);
        ctx.restore();
    }

    function renderBloodParticles(particles) {
        if (!particles) return;
        particles.forEach(p => {
            if (p.landed) return;
            const a = Math.max(0, Math.min(1, p.life));
            ctx.globalAlpha = a;
            ctx.fillStyle = a > 0.5 ? '#cc1111' : '#881111';
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        });
        ctx.globalAlpha = 1;
    }

    function renderSplatters(splatters) {
        if (!splatters) return;
        ctx.globalAlpha = 0.7;
        splatters.forEach(s => {
            ctx.fillStyle = '#771111';
            ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
            ctx.fillStyle = '#991111';
            ctx.fillRect(s.x - s.size * 0.3, s.y - s.size * 0.3, s.size * 0.6, s.size * 0.6);
        });
        ctx.globalAlpha = 1;
    }

    function renderArena(player, arenaX, arenaW, pendAngle, icam, state) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(arenaX, 0, arenaW, CH);
        ctx.clip();

        const centerX = arenaX + arenaW / 2;

        // Smooth camera
        if (state && state.cameraEnabled && !icam) {
            const targetY = player.jumpY > 5 ? -player.jumpY * 0.15 : 0;
            cameraOffsetY += (targetY - cameraOffsetY) * 0.05;

            const bpmRatio = (state.bpm || 60) / (state.maxBpm || 180);
            const targetZoom = bpmRatio > 0.66 ? 1 - (bpmRatio - 0.66) * 0.1 : 1;
            cameraZoom += (targetZoom - cameraZoom) * 0.03;

            const focusX = centerX;
            const focusY = PLATFORM_Y * 0.8;
            ctx.translate(focusX, focusY);
            ctx.scale(cameraZoom, cameraZoom);
            ctx.translate(-focusX, -focusY + cameraOffsetY);
        }

        if (icam) {
            const focusX = centerX;
            const focusY = PLATFORM_Y - 30;
            ctx.translate(focusX, focusY);
            ctx.scale(icam.zoom, icam.zoom);
            ctx.translate(-focusX, -focusY);
        }

        renderPlatform(arenaX, arenaW);

        if (icam) renderSplatters(icam.splatters);

        // Power-ups
        renderPowerUps(state ? state.powerUps : null, arenaX, arenaW, player.index);

        renderPendulum(centerX, pendAngle, state && state.invisibleBlade);

        if (icam && icam.ragdoll) {
            renderRagdoll(icam.ragdoll);
        } else {
            renderCharacter(player, arenaX, arenaW);
        }

        if (icam) renderBloodParticles(icam.particles);

        ctx.restore();
    }

    function renderParallaxBg(angle) {
        const a = angle || 0;
        ctx.drawImage(bgFar, -20 + a * 3, 0);
        ctx.drawImage(bgMid, -30 + a * 8, 0);
        ctx.drawImage(bgNear, -40 + a * 15, 0);
    }

    function renderVignette(bpmRatio) {
        if (!vignetteGrad) return;
        const intensity = Math.max(0, Math.min(1, (bpmRatio - 0.3) * 1.2));
        if (intensity <= 0) return;
        ctx.globalAlpha = intensity * 0.5;
        ctx.drawImage(vignetteGrad, 0, 0);
        ctx.globalAlpha = 1;
    }

    function renderRedFlash(timer) {
        if (timer <= 0) return;
        ctx.globalAlpha = Math.min(0.25, timer * 0.8);
        ctx.fillStyle = '#cc0000';
        ctx.fillRect(0, 0, CW, CH);
        ctx.globalAlpha = 1;
    }

    function render(state) {
        ctx.clearRect(0, 0, CW, CH);

        // Parallax background
        renderParallaxBg(state.pendulumAngle);

        const ic = state.impactCam;

        if (!state.players || state.players.length === 0) {
            renderPlatform(0, CW);
            renderPendulum(CW / 2, state.pendulumAngle || 0);
        } else if (state.mode === 'practice' || state.mode === 'debug' || state.mode === 'survival') {
            const icam = (ic && ic.playerIdx === 0) ? ic : null;
            renderArena(state.players[0], 0, CW, state.pendulumAngle, icam, state);
        } else if (state.players.length > 1) {
            const ic0 = (ic && ic.playerIdx === 0) ? ic : null;
            const ic1 = (ic && ic.playerIdx === 1) ? ic : null;
            renderArena(state.players[0], 0, CW / 2, state.pendulumAngle, ic0, state);
            renderArena(state.players[1], CW / 2, CW / 2, state.pendulumAngle, ic1, state);
            renderDivider();
        }

        if (state.phase === 'countdown') {
            renderCountdown(state.countdownDisplay);
        }

        // Screen effects
        const bpmRatio = (state.bpm || 60) / Math.max(1, state.maxBpm || 180);
        renderVignette(bpmRatio);
        renderRedFlash(state.redFlashTimer || 0);

        // Screen shake
        const shaking = state.shakeTimer > 0 || (ic && (ic.phase === 'impact'));
        if (shaking) {
            const intensity = (ic && ic.phase === 'impact') ? 10 : state.shakeTimer * 6;
            canvas.style.transform = `translate(${(Math.random() - 0.5) * intensity}px, ${(Math.random() - 0.5) * intensity}px)`;
        } else {
            canvas.style.transform = '';
        }
    }

    function resetRope() { ropePoints = null; }

    return {
        init, render, resetRope, addBladeBlood, resetBladeBlood, resetEffects,
        MAX_ANGLE, PLATFORM_Y, PIVOT_Y, ARM_LEN, CW, CH,
    };
})();
