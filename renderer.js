const Renderer = (() => {
    let canvas, ctx;
    let bgCache = null;
    const CW = 800;
    const CH = 500;
    const PLATFORM_Y = 430;
    const PLATFORM_H = 18;
    const PIVOT_Y = 45;
    const ARM_LEN = PLATFORM_Y - PIVOT_Y;
    const MAX_ANGLE = Math.PI / 3.2;

    function init(c) {
        canvas = c;
        ctx = canvas.getContext('2d');
        canvas.width = CW;
        canvas.height = CH;
        buildBackground();
    }

    function buildBackground() {
        bgCache = document.createElement('canvas');
        bgCache.width = CW;
        bgCache.height = CH;
        const bg = bgCache.getContext('2d');

        // Sky gradient
        const grad = bg.createLinearGradient(0, 0, 0, CH);
        grad.addColorStop(0, '#08081a');
        grad.addColorStop(0.5, '#0e0e28');
        grad.addColorStop(1, '#141432');
        bg.fillStyle = grad;
        bg.fillRect(0, 0, CW, CH);

        // Stars
        const rng = mulberry32(42);
        for (let i = 0; i < 60; i++) {
            const sx = rng() * CW;
            const sy = rng() * CH * 0.6;
            const brightness = 80 + Math.floor(rng() * 120);
            const size = rng() > 0.85 ? 2 : 1;
            bg.fillStyle = `rgb(${brightness},${brightness},${brightness + 40})`;
            bg.fillRect(Math.floor(sx), Math.floor(sy), size, size);
        }

        // Distant wall silhouettes
        bg.fillStyle = '#0c0c22';
        drawWall(bg, 0, CH * 0.35, CW, CH * 0.65);

        // Torches
        [[100, 170], [300, 160], [500, 165], [700, 155]].forEach(([tx, ty]) => {
            bg.fillStyle = '#332211';
            bg.fillRect(tx - 1, ty, 3, 20);
            bg.fillStyle = '#ff8833';
            bg.fillRect(tx - 2, ty - 4, 5, 5);
            bg.fillStyle = '#ffcc44';
            bg.fillRect(tx - 1, ty - 3, 3, 3);
            // Glow
            const glow = bg.createRadialGradient(tx, ty, 2, tx, ty, 40);
            glow.addColorStop(0, 'rgba(255,140,40,0.12)');
            glow.addColorStop(1, 'rgba(255,100,20,0)');
            bg.fillStyle = glow;
            bg.fillRect(tx - 40, ty - 40, 80, 80);
        });
    }

    function drawWall(bg, x, y, w, h) {
        bg.fillRect(x, y, w, h);
        // Brick pattern
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
            // Mortar lines
            ctx.fillStyle = '#554433';
            ctx.fillRect(tx, PLATFORM_Y, 1, tileH);
        }
        // Bottom fill
        ctx.fillStyle = '#2a2420';
        ctx.fillRect(x, PLATFORM_Y + PLATFORM_H, w, CH - PLATFORM_Y - PLATFORM_H);
    }

    function renderPendulum(centerX, angle) {
        const tipX = centerX + ARM_LEN * Math.sin(angle);
        const tipY = PIVOT_Y + ARM_LEN * Math.cos(angle);
        const nearCenter = 1 - Math.min(1, Math.abs(angle) / (MAX_ANGLE * 0.15));

        // Arm
        ctx.save();
        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerX, PIVOT_Y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.translate(tipX, tipY);
        ctx.rotate(angle);

        // Crescent blade body -- always steel colored
        ctx.fillStyle = '#778899';
        ctx.beginPath();
        ctx.moveTo(-36, 4);
        ctx.quadraticCurveTo(0, -52, 36, 4);
        ctx.quadraticCurveTo(0, -16, -36, 4);
        ctx.closePath();
        ctx.fill();

        // Inner steel highlight
        ctx.fillStyle = '#99aabb';
        ctx.beginPath();
        ctx.moveTo(-30, 2);
        ctx.quadraticCurveTo(0, -42, 30, 2);
        ctx.quadraticCurveTo(0, -18, -30, 2);
        ctx.closePath();
        ctx.fill();

        // Cutting edge -- subtle gleam that brightens near center
        ctx.strokeStyle = nearCenter > 0.3
            ? `rgba(240,248,255,${0.4 + 0.6 * nearCenter})`
            : 'rgba(200,215,230,0.4)';
        ctx.lineWidth = nearCenter > 0.3 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(-34, 3);
        ctx.quadraticCurveTo(0, -49, 34, 3);
        ctx.stroke();

        // Spine detail
        ctx.strokeStyle = '#556677';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-28, 1);
        ctx.quadraticCurveTo(0, -15, 28, 1);
        ctx.stroke();

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

    function lerpColor(a, b, t) {
        const ah = parseInt(a.slice(1), 16);
        const bh = parseInt(b.slice(1), 16);
        const ar = ah >> 16, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
        const br = bh >> 16, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
        const rr = Math.round(ar + (br - ar) * t);
        const rg = Math.round(ag + (bg - ag) * t);
        const rb = Math.round(ab + (bb - ab) * t);
        return `rgb(${rr},${rg},${rb})`;
    }

    function renderCharacter(player, arenaX, arenaW) {
        const palette = player.index === 0 ? 'blue' : 'red';
        const state = player.hitTimer > 0 ? 'hit' : (player.isJumping ? 'jump' : 'idle');
        const size = Sprites.spriteSize(state);
        const cx = arenaX + arenaW / 2;
        const charX = cx - size.w / 2;
        const baseY = PLATFORM_Y - size.h;
        const charY = baseY - player.jumpY;

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

        Sprites.draw(ctx, charX, charY, palette, state);
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
            if (player.judgmentText === 'PERFECT') {
                ctx.fillStyle = '#FFD633';
            } else if (player.judgmentText === 'GOOD') {
                ctx.fillStyle = '#44DD66';
            } else {
                ctx.fillStyle = '#EE4444';
            }
            ctx.fillText(player.judgmentText, cx, baseY - 30 - yOff);
            ctx.globalAlpha = 1;
            ctx.textAlign = 'start';
        }
    }

    function renderDivider() {
        const x = CW / 2;
        ctx.fillStyle = '#222233';
        ctx.fillRect(x - 2, 0, 4, CH);
        ctx.fillStyle = '#333355';
        ctx.fillRect(x - 1, 0, 2, CH);
        // Decorative dots
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
        ctx.save();
        ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
        ctx.rotate(r.rotation);
        Sprites.draw(ctx, -r.w / 2, -r.h / 2, r.palette, 'hit');
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

    function renderArena(player, arenaX, arenaW, pendulumAngle, icam) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(arenaX, 0, arenaW, CH);
        ctx.clip();

        const centerX = arenaX + arenaW / 2;

        if (icam) {
            const focusX = centerX;
            const focusY = PLATFORM_Y - 30;
            ctx.translate(focusX, focusY);
            ctx.scale(icam.zoom, icam.zoom);
            ctx.translate(-focusX, -focusY);
        }

        renderPlatform(arenaX, arenaW);

        if (icam) {
            renderSplatters(icam.splatters);
        }

        renderPendulum(centerX, pendulumAngle);

        if (icam && icam.ragdoll) {
            renderRagdoll(icam.ragdoll);
        } else {
            renderCharacter(player, arenaX, arenaW);
        }

        if (icam) {
            renderBloodParticles(icam.particles);
        }

        ctx.restore();
    }

    function render(state) {
        ctx.clearRect(0, 0, CW, CH);
        ctx.drawImage(bgCache, 0, 0);

        const ic = state.impactCam;

        if (!state.players || state.players.length === 0) {
            renderPlatform(0, CW);
            renderPendulum(CW / 2, state.pendulumAngle || 0);
        } else if (state.mode === 'practice' || state.mode === 'debug') {
            const icam = (ic && ic.playerIdx === 0) ? ic : null;
            renderArena(state.players[0], 0, CW, state.pendulumAngle, icam);
        } else if (state.players.length > 1) {
            const ic0 = (ic && ic.playerIdx === 0) ? ic : null;
            const ic1 = (ic && ic.playerIdx === 1) ? ic : null;
            renderArena(state.players[0], 0, CW / 2, state.pendulumAngle, ic0);
            renderArena(state.players[1], CW / 2, CW / 2, state.pendulumAngle, ic1);
            renderDivider();
        }

        if (state.phase === 'countdown') {
            renderCountdown(state.countdownDisplay);
        }

        // Screen shake
        const shaking = state.shakeTimer > 0 || (ic && (ic.phase === 'impact'));
        if (shaking) {
            const intensity = (ic && ic.phase === 'impact') ? 10 : state.shakeTimer * 6;
            canvas.style.transform = `translate(${(Math.random() - 0.5) * intensity}px, ${(Math.random() - 0.5) * intensity}px)`;
        } else {
            canvas.style.transform = '';
        }
    }

    return { init, render, MAX_ANGLE, PLATFORM_Y, PIVOT_Y, ARM_LEN, CW, CH };
})();
