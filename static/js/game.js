'use strict';

const TILE = 40;
const MAP_W = 20;
const MAP_H = 15;
const T = { WALL: 0, FLOOR: 1, DOOR: 2 };
const PHASE = { PLANNING: 'planning', RUNNING: 'running', WIN: 'win', LOSE: 'lose' };
const STATE = { IDLE: 'idle', MOVING: 'moving', ENGAGING: 'engaging', DEAD: 'dead' };

// ===== MAP =====
const MAP = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,2,1,1,1,1,0,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,0,1,1,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,2,0,0,0,0,2,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,0],
    [0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

function isPassable(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    return MAP[ty][tx] !== T.WALL;
}

function hasLOS(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / (TILE * 0.4));
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const tx = Math.floor((x1 + dx * t) / TILE);
        const ty = Math.floor((y1 + dy * t) / TILE);
        if (MAP[ty]?.[tx] === T.WALL) return false;
    }
    return true;
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// ===== ENTITIES =====
class SwatUnit {
    constructor(tx, ty) {
        this.x = tx * TILE + TILE / 2;
        this.y = ty * TILE + TILE / 2;
        this.hp = 3;
        this.maxHp = 3;
        this.speed = 2.5;
        this.facing = -Math.PI / 2;
        this.state = STATE.IDLE;
        this.path = [];
        this.pathIndex = 0;
        this.engageTimer = 0;
        this.flash = 0;
    }

    get dead() { return this.hp <= 0; }

    update(enemies) {
        if (this.dead) return;
        if (this.flash > 0) this.flash--;

        const living = enemies.filter(e => !e.dead);

        // Check LOS to enemies
        for (const enemy of living) {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 6 * TILE && hasLOS(this.x, this.y, enemy.x, enemy.y)) {
                this.facing = Math.atan2(dy, dx);
                this.state = STATE.ENGAGING;
                this.engageTimer++;
                if (this.engageTimer >= 30) {
                    enemy.hp--;
                    this.engageTimer = 0;
                    this.flash = 6;
                }
                return;
            }
        }

        this.engageTimer = 0;

        if (this.pathIndex < this.path.length) {
            this.state = STATE.MOVING;
            const wp = this.path[this.pathIndex];
            const dx = wp.x - this.x;
            const dy = wp.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < this.speed + 0.5) {
                this.x = wp.x;
                this.y = wp.y;
                this.pathIndex++;
            } else {
                this.facing = Math.atan2(dy, dx);
                this.x += (dx / dist) * this.speed;
                this.y += (dy / dist) * this.speed;
            }
        } else {
            this.state = STATE.IDLE;
        }
    }
}

class Enemy {
    constructor(tx, ty, patrol) {
        this.x = tx * TILE + TILE / 2;
        this.y = ty * TILE + TILE / 2;
        this.hp = 1;
        this.speed = 1.0;
        this.facing = Math.random() * Math.PI * 2;
        this.fovAngle = Math.PI / 2;
        this.fovRange = 5 * TILE;
        this.patrol = (patrol || []).map(p => ({ x: p[0], y: p[1] }));
        this.patrolIdx = 0;
        this.alert = false;
        this.alertTimer = 0;
        this.shootTimer = 0;
    }

    get dead() { return this.hp <= 0; }

    update(units) {
        if (this.dead) return;
        if (this.alertTimer > 0) this.alertTimer--;
        if (this.alertTimer === 0) this.alert = false;

        for (const unit of units) {
            if (unit.dead) continue;
            const dx = unit.x - this.x;
            const dy = unit.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < this.fovRange) {
                const angle = Math.atan2(dy, dx);
                const diff = Math.abs(normalizeAngle(angle - this.facing));
                if (diff < this.fovAngle / 2 && hasLOS(this.x, this.y, unit.x, unit.y)) {
                    this.alert = true;
                    this.alertTimer = 90;
                    this.shootTimer++;
                    if (this.shootTimer >= 45) {
                        unit.hp--;
                        unit.flash = 10;
                        this.shootTimer = 0;
                    }
                }
            }
        }

        if (this.patrol.length === 0) return;
        const target = this.patrol[this.patrolIdx];
        const tx = target.x * TILE + TILE / 2;
        const ty = target.y * TILE + TILE / 2;
        const dx = tx - this.x;
        const dy = ty - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.speed + 1) {
            this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
        } else {
            this.facing = Math.atan2(dy, dx);
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
    }
}

// ===== GAME STATE =====
const game = { phase: PHASE.PLANNING, units: [], enemies: [], selectedUnit: null };

function initGame() {
    game.phase = PHASE.PLANNING;
    game.selectedUnit = null;
    game.units = [
        new SwatUnit(3, 12),
        new SwatUnit(4, 12),
    ];
    game.enemies = [
        new Enemy(3, 2,  [[1,2],[4,2],[4,3],[1,3]]),
        new Enemy(8, 2,  [[6,1],[9,1],[9,4],[6,4]]),
        new Enemy(15, 2, [[12,1],[18,1],[18,4],[12,4]]),
        new Enemy(8, 7,  [[1,6],[14,6],[14,9],[1,9]]),
        new Enemy(17, 7, []),
    ];
    game.enemies[4].facing = Math.PI;
}

function executeGame() {
    if (game.phase === PHASE.PLANNING) game.phase = PHASE.RUNNING;
}

function resetPaths() {
    for (const u of game.units) { u.path = []; u.pathIndex = 0; u.state = STATE.IDLE; }
    game.selectedUnit = null;
    if (game.phase === PHASE.RUNNING) game.phase = PHASE.PLANNING;
}

function updateGame() {
    if (game.phase !== PHASE.RUNNING) return;
    for (const u of game.units) u.update(game.enemies);
    for (const e of game.enemies) e.update(game.units);

    if (game.enemies.every(e => e.dead)) { game.phase = PHASE.WIN; return; }
    if (game.units.every(u => u.dead))   { game.phase = PHASE.LOSE; return; }

    const active = game.units.filter(u => !u.dead &&
        (u.state === STATE.MOVING || u.state === STATE.ENGAGING || u.pathIndex < u.path.length));
    if (active.length === 0) game.phase = PHASE.PLANNING;
}

// ===== RENDERER =====
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width  = MAP_W * TILE;
canvas.height = MAP_H * TILE;

function resizeCanvas() {
    const cont = document.getElementById('canvas-container');
    const scaleX = cont.clientWidth  / canvas.width;
    const scaleY = cont.clientHeight / canvas.height;
    const scale  = Math.min(scaleX, scaleY);
    canvas.style.width  = (canvas.width  * scale) + 'px';
    canvas.style.height = (canvas.height * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);

function drawMap() {
    for (let ty = 0; ty < MAP_H; ty++) {
        for (let tx = 0; tx < MAP_W; tx++) {
            const tile = MAP[ty][tx];
            const px = tx * TILE, py = ty * TILE;
            if (tile === T.FLOOR) {
                ctx.fillStyle = '#1e2d50';
                ctx.fillRect(px, py, TILE, TILE);
                ctx.strokeStyle = '#283a63';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(px, py, TILE, TILE);
            } else if (tile === T.DOOR) {
                ctx.fillStyle = '#1e2d50';
                ctx.fillRect(px, py, TILE, TILE);
                ctx.fillStyle = '#7a5c10';
                ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
                ctx.fillStyle = '#c49a1e';
                ctx.fillRect(px + 9, py + 9, TILE - 18, TILE - 18);
            }
        }
    }
}

function drawFOV(e) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.arc(e.x, e.y, e.fovRange, e.facing - e.fovAngle / 2, e.facing + e.fovAngle / 2);
    ctx.closePath();
    ctx.fillStyle = e.alert ? 'rgba(255,80,0,0.22)' : 'rgba(255,210,0,0.13)';
    ctx.fill();
    ctx.strokeStyle = e.alert ? 'rgba(255,80,0,0.5)' : 'rgba(255,210,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawPath(unit) {
    if (unit.path.length === 0) return;
    const isSelected = game.selectedUnit === unit;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = isSelected ? '#00ff88' : '#3399ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(unit.x, unit.y);
    for (let i = unit.pathIndex; i < unit.path.length; i++) {
        ctx.lineTo(unit.path[i].x, unit.path[i].y);
    }
    ctx.stroke();
    for (let i = unit.pathIndex; i < unit.path.length; i++) {
        ctx.beginPath();
        ctx.arc(unit.path[i].x, unit.path[i].y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#00ff88';
        ctx.fill();
    }
    ctx.restore();
}

function drawUnit(unit) {
    const { x, y, facing, flash, hp, maxHp } = unit;
    const isSel = game.selectedUnit === unit;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0 ? '#ffffff' : (isSel ? '#00ff88' : '#1a88ff');
    ctx.fill();
    ctx.strokeStyle = isSel ? '#00ff88' : '#aaccff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(15, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < hp; i++) {
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(x - 10 + i * 8, y + 15, 6, 4);
    }
    for (let i = hp; i < maxHp; i++) {
        ctx.fillStyle = '#444';
        ctx.fillRect(x - 10 + i * 8, y + 15, 6, 4);
    }

    if (isSel) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 19, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
    }
}

function drawEnemy(enemy) {
    const { x, y, facing, alert } = enemy;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(facing);
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = alert ? '#ff6600' : '#cc2222';
    ctx.fill();
    ctx.strokeStyle = alert ? '#ffaa44' : '#ff6666';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(13, 0);
    ctx.strokeStyle = '#ffcccc';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    if (alert) {
        ctx.font = 'bold 15px monospace';
        ctx.fillStyle = '#ffaa00';
        ctx.fillText('!', x - 4, y - 16);
    }
}

function drawOverlay(text, sub, color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '20px monospace';
    ctx.fillStyle = '#dddddd';
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 35);
    ctx.textAlign = 'left';
}

function render() {
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawMap();
    for (const e of game.enemies) if (!e.dead) drawFOV(e);
    for (const u of game.units) if (!u.dead) drawPath(u);
    for (const e of game.enemies) if (!e.dead) drawEnemy(e);
    for (const u of game.units) if (!u.dead) drawUnit(u);

    if (game.phase === PHASE.WIN)  drawOverlay('MISSION COMPLETE', '全敵兵を排除しました', 'rgba(0,160,80,0.75)');
    if (game.phase === PHASE.LOSE) drawOverlay('MISSION FAILED',   '隊員が全滅しました',   'rgba(180,0,0,0.75)');

    updateUI();
}

function updateUI() {
    const alive = game.enemies.filter(e => !e.dead).length;
    document.getElementById('status-phase').textContent = game.phase.toUpperCase();
    document.getElementById('status-enemies').textContent = alive;
    const hint = document.getElementById('hint');
    if (game.selectedUnit) {
        hint.textContent = '隊員選択中 — フロアをタップしてウェイポイントを追加';
    } else if (game.phase === PHASE.PLANNING) {
        hint.textContent = '青い隊員をタップして選択 → ウェイポイント設置 → Execute';
    } else if (game.phase === PHASE.RUNNING) {
        hint.textContent = '実行中... 全員が経路を完了するか排除されるまで続きます';
    } else {
        hint.textContent = 'New Game で再挑戦';
    }
}

// ===== INPUT =====
function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    const src = e.changedTouches ? e.changedTouches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
}

function handleTap(x, y) {
    if (game.phase === PHASE.WIN || game.phase === PHASE.LOSE) return;
    for (const u of game.units) {
        if (u.dead) continue;
        const dx = x - u.x, dy = y - u.y;
        if (Math.sqrt(dx * dx + dy * dy) < 22) {
            game.selectedUnit = (game.selectedUnit === u) ? null : u;
            return;
        }
    }
    if (game.selectedUnit) {
        const tx = Math.floor(x / TILE);
        const ty = Math.floor(y / TILE);
        if (isPassable(tx, ty)) {
            game.selectedUnit.path.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
        }
    }
}

canvas.addEventListener('click',      e => { e.preventDefault(); const p = getPos(e); handleTap(p.x, p.y); });
canvas.addEventListener('touchend',   e => { e.preventDefault(); const p = getPos(e); handleTap(p.x, p.y); }, { passive: false });
canvas.addEventListener('touchstart', e => { e.preventDefault(); }, { passive: false });

document.getElementById('btn-execute').addEventListener('click', executeGame);
document.getElementById('btn-reset').addEventListener('click', resetPaths);
document.getElementById('btn-new').addEventListener('click', initGame);

// ===== LOOP =====
function loop() {
    updateGame();
    render();
    requestAnimationFrame(loop);
}

initGame();
resizeCanvas();
loop();
