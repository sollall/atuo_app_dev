'use strict';

// ── Canvas & scaling ────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const WORLD_W = 800;
const WORLD_H = 560;
let   SCALE   = 1;

function resizeCanvas() {
  const cont = document.getElementById('gameContainer');
  const mw   = Math.min(cont.clientWidth,  WORLD_W);
  const mh   = Math.min(cont.clientHeight, WORLD_H);
  SCALE = Math.min(mw / WORLD_W, mh / WORLD_H);
  canvas.width  = Math.floor(WORLD_W * SCALE);
  canvas.height = Math.floor(WORLD_H * SCALE);
}
window.addEventListener('resize', resizeCanvas);

// ── Map geometry ─────────────────────────────────────────────────────────────
//  Layout (world units):
//  +─────────────────── 800 ──────────────────────+
//  |  UPPER ROOM (enemies)         y: 10 – 245   |
//  +────────────+          +────────────────────  |
//               | door gap | x: 310–490, y:245-265
//  +────────────+          +────────────────────  |
//  |  LOWER ROOM (entry)           y: 265 – 550  |
//  +──────────────────────────────────────────────+

const WALLS = [
  // outer boundary
  { x: 0,   y: 0,   w: 800, h: 10  },
  { x: 0,   y: 550, w: 800, h: 10  },
  { x: 0,   y: 0,   w: 10,  h: 560 },
  { x: 790, y: 0,   w: 10,  h: 560 },
  // dividing wall with a 180-px door gap centred at x=400
  { x: 10,  y: 245, w: 300, h: 20  },   // left  of door
  { x: 490, y: 245, w: 300, h: 20  },   // right of door
];

// Rooms used for floor colouring only
const FLOORS = [
  { x: 10, y: 10,  w: 780, h: 235 },   // upper
  { x: 10, y: 265, w: 780, h: 285 },   // lower
  { x: 310, y: 245, w: 180, h: 20 },   // door gap
];

// Room labels
const LABELS = [
  { x: 400, y: 130, text: '— THREAT ZONE —' },
  { x: 400, y: 420, text: '— ENTRY POINT —' },
];

function isPointInWall(x, y) {
  for (const w of WALLS)
    if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true;
  return false;
}

function isCircleInWall(x, y, r) {
  for (const w of WALLS) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

// ── Line-of-sight ─────────────────────────────────────────────────────────
function seg2seg(ax, ay, bx, by, cx, cy, dx, dy) {
  const abx = bx - ax, aby = by - ay;
  const cdx = dx - cx, cdy = dy - cy;
  const denom = abx * cdy - aby * cdx;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((cx - ax) * cdy - (cy - ay) * cdx) / denom;
  const u = ((cx - ax) * aby - (cy - ay) * abx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function wallBlocks(x1, y1, x2, y2) {
  for (const w of WALLS) {
    const rx = w.x, ry = w.y, rr = w.x + w.w, rb = w.y + w.h;
    if (seg2seg(x1,y1,x2,y2, rx,ry,rr,ry) ||
        seg2seg(x1,y1,x2,y2, rr,ry,rr,rb) ||
        seg2seg(x1,y1,x2,y2, rx,rb,rr,rb) ||
        seg2seg(x1,y1,x2,y2, rx,ry,rx,rb)) return true;
  }
  return false;
}

// Returns true if (tx,ty) is visible from (fx,fy) looking at fAngle with fovA half-angle, range fovR
function canSee(fx, fy, fAngle, fovA, fovR, tx, ty) {
  const dx = tx - fx, dy = ty - fy;
  const dist2 = dx * dx + dy * dy;
  if (dist2 > fovR * fovR) return false;
  let diff = Math.atan2(dy, dx) - fAngle;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > fovA / 2) return false;
  return !wallBlocks(fx, fy, tx, ty);
}

// ── Entity classes ────────────────────────────────────────────────────────
function makePlayer() {
  return {
    x: 400, y: 430,
    angle: -Math.PI / 2,
    speed: 130,
    radius: 12,
    fovAngle: Math.PI / 2.8,   // ~64°
    fovRange: 260,
    waypoints: [],
    state: 'IDLE',             // IDLE | MOVING | ENGAGING
    hp: 100,
    kills: 0,
    shootCooldown: 0,
    SHOOT_CD: 0.38,
  };
}

class Enemy {
  constructor(x, y, px1, px2) {
    this.x = x; this.y = y;
    this.angle = 0;
    this.speed = 55;
    this.radius = 12;
    this.fovAngle = Math.PI / 1.8;   // ~100°
    this.fovRange = 170;
    this.patrol = { x1: px1, x2: px2, dir: 1 };
    this.state = 'PATROL';           // PATROL | ALERT | DEAD
    this.hp = 100;
    this.shootCooldown = 0;
    this.SHOOT_CD = 1.8;
  }

  update(dt) {
    if (this.state === 'DEAD') return;
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    const seesPlayer = canSee(
      this.x, this.y, this.angle, this.fovAngle, this.fovRange,
      player.x, player.y
    );

    if (seesPlayer) {
      this.state = 'ALERT';
      this.angle = Math.atan2(player.y - this.y, player.x - this.x);
      if (this.shootCooldown <= 0) {
        const a = Math.atan2(player.y - this.y, player.x - this.x);
        bullets.push({ x: this.x, y: this.y, vx: Math.cos(a)*280, vy: Math.sin(a)*280, friendly: false, life: 3 });
        this.shootCooldown = this.SHOOT_CD;
      }
    } else {
      this.state = 'PATROL';
      this.x += this.speed * this.patrol.dir * dt;
      this.angle = this.patrol.dir > 0 ? 0 : Math.PI;
      if (this.x >= this.patrol.x2) { this.x = this.patrol.x2; this.patrol.dir = -1; }
      if (this.x <= this.patrol.x1) { this.x = this.patrol.x1; this.patrol.dir =  1; }
    }
  }
}

// ── Game state ────────────────────────────────────────────────────────────
let player, enemies, bullets;
let gameState = 'PLANNING';         // PLANNING | EXECUTING | WIN | LOSE
let showDebug = false;
let fps = 0, _frames = 0, _fpsTimer = 0;
let lastTime = 0;

function initGame() {
  player  = makePlayer();
  bullets = [];
  enemies = [
    new Enemy( 110, 120,  20, 290),
    new Enemy( 400,  80, 310, 490),
    new Enemy( 660, 140, 500, 775),
  ];
  gameState = 'PLANNING';
  updateStatusUI();
}

// ── Input ─────────────────────────────────────────────────────────────────
function canvasToWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / SCALE, y: (clientY - r.top) / SCALE };
}

function handleTap(clientX, clientY) {
  if (gameState !== 'PLANNING') return;
  const { x, y } = canvasToWorld(clientX, clientY);
  if (!isPointInWall(x, y)) player.waypoints.push({ x, y });
}

canvas.addEventListener('click', e => handleTap(e.clientX, e.clientY));
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  handleTap(t.clientX, t.clientY);
}, { passive: false });

document.getElementById('btnExecute').addEventListener('click', () => {
  if (gameState === 'PLANNING' && player.waypoints.length > 0) {
    gameState = 'EXECUTING';
    player.state = 'MOVING';
    updateStatusUI();
  }
});
document.getElementById('btnClear').addEventListener('click', () => {
  player.waypoints = [];
  if (gameState === 'EXECUTING') { gameState = 'PLANNING'; player.state = 'IDLE'; }
  updateStatusUI();
});
document.getElementById('btnReset').addEventListener('click', initGame);
document.getElementById('btnDebug').addEventListener('click', () => { showDebug = !showDebug; });

function updateStatusUI() {
  const el = document.getElementById('statusText');
  const map = {
    PLANNING:  { text: 'PLANNING',   color: '#888'    },
    EXECUTING: { text: 'EXECUTING',  color: '#ffaa00' },
    WIN:       { text: 'CLEAR',      color: '#00ff88' },
    LOSE:      { text: 'KIA',        color: '#ff5555' },
  };
  const s = map[gameState] || { text: gameState, color: '#888' };
  el.textContent = s.text;
  el.style.color  = s.color;
}

// ── Update ────────────────────────────────────────────────────────────────
function update(dt) {
  _frames++;
  _fpsTimer += dt;
  if (_fpsTimer >= 1) { fps = _frames; _frames = 0; _fpsTimer = 0; }

  if (gameState !== 'EXECUTING') return;

  // ── Check visible enemies before moving ──
  let target = null, tDist = Infinity;
  for (const e of enemies) {
    if (e.state === 'DEAD') continue;
    if (canSee(player.x, player.y, player.angle, player.fovAngle, player.fovRange, e.x, e.y)) {
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < tDist) { tDist = d; target = e; }
    }
  }

  const engaging = target !== null;

  // ── Move along waypoints (halt when engaging) ──
  if (!engaging && player.waypoints.length > 0) {
    const wp = player.waypoints[0];
    const dx = wp.x - player.x, dy = wp.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) {
      player.waypoints.shift();
    } else {
      player.angle = Math.atan2(dy, dx);
      const step = Math.min(player.speed * dt, dist);
      const nx = player.x + (dx / dist) * step;
      const ny = player.y + (dy / dist) * step;
      if      (!isCircleInWall(nx, ny,          player.radius)) { player.x = nx; player.y = ny; }
      else if (!isCircleInWall(nx, player.y,    player.radius)) { player.x = nx; }
      else if (!isCircleInWall(player.x, ny,    player.radius)) { player.y = ny; }
    }
  }

  // ── Auto-aim and shoot ──
  if (engaging) {
    player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    player.shootCooldown = Math.max(0, player.shootCooldown - dt);
    if (player.shootCooldown <= 0) {
      const a = Math.atan2(target.y - player.y, target.x - player.x);
      bullets.push({ x: player.x, y: player.y, vx: Math.cos(a)*420, vy: Math.sin(a)*420, friendly: true, life: 2 });
      player.shootCooldown = player.SHOOT_CD;
    }
    player.state = 'ENGAGING';
  } else {
    player.state = player.waypoints.length > 0 ? 'MOVING' : 'IDLE';
  }

  // ── Update enemies ──
  for (const e of enemies) e.update(dt);

  // ── Update bullets ──
  const next = [];
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || isPointInWall(b.x, b.y)) continue;

    let hit = false;
    if (b.friendly) {
      for (const e of enemies) {
        if (e.state === 'DEAD') continue;
        if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < e.radius ** 2) {
          e.hp -= 100;
          if (e.hp <= 0) { e.state = 'DEAD'; player.kills++; }
          hit = true; break;
        }
      }
    } else {
      if ((b.x - player.x) ** 2 + (b.y - player.y) ** 2 < player.radius ** 2) {
        player.hp = Math.max(0, player.hp - 25);
        hit = true;
        if (player.hp <= 0) { gameState = 'LOSE'; updateStatusUI(); }
      }
    }
    if (!hit) next.push(b);
  }
  bullets = next;

  // ── Win check ──
  if (enemies.every(e => e.state === 'DEAD')) { gameState = 'WIN'; updateStatusUI(); }
}

// ── Rendering helpers ──────────────────────────────────────────────────────
function s(v) { return v * SCALE; }   // world → canvas px

function drawFOV(x, y, angle, fovA, range, color) {
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s(x), s(y));
  ctx.arc(s(x), s(y), s(range), angle - fovA / 2, angle + fovA / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCircle(x, y, r, fill, stroke, lw) {
  ctx.beginPath();
  ctx.arc(s(x), s(y), s(r), 0, Math.PI * 2);
  if (fill)  { ctx.fillStyle   = fill;         ctx.fill();   }
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw || s(2); ctx.stroke(); }
}

function drawArrow(x, y, angle, len, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = s(2.5);
  ctx.beginPath();
  ctx.moveTo(s(x), s(y));
  ctx.lineTo(s(x + Math.cos(angle) * len), s(y + Math.sin(angle) * len));
  ctx.stroke();
}

function drawHPBar(x, y, yOff, hp, color) {
  const bw = s(30), bh = s(4);
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(s(x) - bw/2, s(y + yOff), bw, bh);
  ctx.fillStyle = color;
  ctx.fillRect(s(x) - bw/2, s(y + yOff), bw * hp / 100, bh);
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Floor tiles
  for (const f of FLOORS) {
    ctx.fillStyle = '#252525';
    ctx.fillRect(s(f.x), s(f.y), s(f.w), s(f.h));
  }

  // Room labels
  ctx.fillStyle = '#333';
  ctx.font = `${s(11)}px 'Courier New'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of LABELS) ctx.fillText(l.text, s(l.x), s(l.y));

  // Subtle grid (debug)
  if (showDebug) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x < WORLD_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(s(x), 0); ctx.lineTo(s(x), canvas.height); ctx.stroke();
    }
    for (let y = 0; y < WORLD_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, s(y)); ctx.lineTo(canvas.width, s(y)); ctx.stroke();
    }
  }

  // Walls
  ctx.fillStyle = '#4a4a4a';
  for (const w of WALLS) ctx.fillRect(s(w.x), s(w.y), s(w.w), s(w.h));

  // Patrol paths (debug)
  if (showDebug) {
    ctx.setLineDash([s(4), s(4)]);
    ctx.strokeStyle = 'rgba(255,60,60,0.25)';
    ctx.lineWidth   = s(1);
    for (const e of enemies) {
      if (e.state === 'DEAD') continue;
      ctx.beginPath();
      ctx.moveTo(s(e.patrol.x1), s(e.y));
      ctx.lineTo(s(e.patrol.x2), s(e.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Waypoint path
  if (player.waypoints.length > 0) {
    ctx.strokeStyle = 'rgba(0,255,136,0.55)';
    ctx.setLineDash([s(5), s(4)]);
    ctx.lineWidth = s(2);
    ctx.beginPath();
    ctx.moveTo(s(player.x), s(player.y));
    for (const wp of player.waypoints) ctx.lineTo(s(wp.x), s(wp.y));
    ctx.stroke();
    ctx.setLineDash([]);

    player.waypoints.forEach((wp, i) => {
      drawCircle(wp.x, wp.y, 6, i === 0 ? '#00ff88' : '#007744');
      ctx.fillStyle    = '#fff';
      ctx.font         = `${s(9)}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i + 1, s(wp.x), s(wp.y));
    });
  }

  // Enemy FOV cones (behind enemies)
  for (const e of enemies) {
    if (e.state === 'DEAD') continue;
    drawFOV(e.x, e.y, e.angle, e.fovAngle, e.fovRange, '#ff4444');
  }

  // Enemies
  for (const e of enemies) {
    if (e.state === 'DEAD') {
      ctx.save(); ctx.globalAlpha = 0.3;
      drawCircle(e.x, e.y, e.radius, '#333');
      ctx.restore();
      // X
      ctx.strokeStyle = '#555'; ctx.lineWidth = s(2);
      const rr = s(e.radius * 0.55);
      ctx.beginPath();
      ctx.moveTo(s(e.x) - rr, s(e.y) - rr); ctx.lineTo(s(e.x) + rr, s(e.y) + rr);
      ctx.moveTo(s(e.x) + rr, s(e.y) - rr); ctx.lineTo(s(e.x) - rr, s(e.y) + rr);
      ctx.stroke();
      continue;
    }
    const eColor = e.state === 'ALERT' ? '#ff6600' : '#cc2020';
    drawCircle(e.x, e.y, e.radius, eColor, '#ff9090', s(1.5));
    drawArrow(e.x, e.y, e.angle, e.radius * 1.8, '#fff');
    drawHPBar(e.x, e.y, -(e.radius + 9), e.hp, '#ff4444');
    if (e.state === 'ALERT') {
      ctx.fillStyle    = '#ffcc00';
      ctx.font         = `bold ${s(12)}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', s(e.x), s(e.y - e.radius - 16));
    }
  }

  // Player FOV
  drawFOV(player.x, player.y, player.angle, player.fovAngle, player.fovRange, '#00ff88');

  // Player
  const pColor = player.state === 'ENGAGING' ? '#ffaa00' : '#00cc66';
  drawCircle(player.x, player.y, player.radius, pColor, '#88ffcc', s(1.5));
  drawArrow(player.x, player.y, player.angle, player.radius * 1.8, '#fff');
  drawHPBar(player.x, player.y, player.radius + 4, player.hp, '#00cc66');

  // Bullets
  for (const b of bullets) {
    ctx.fillStyle = b.friendly ? '#ffe844' : '#ff6666';
    ctx.beginPath();
    ctx.arc(s(b.x), s(b.y), s(3), 0, Math.PI * 2);
    ctx.fill();
  }

  // Debug panel
  if (showDebug) {
    const lines = [
      `FPS   : ${fps}`,
      `State : ${gameState}`,
      `Unit  : ${player.state}`,
      `Pos   : (${Math.round(player.x)}, ${Math.round(player.y)})`,
      `Angle : ${(player.angle * 180 / Math.PI).toFixed(0)}°`,
      `WP    : ${player.waypoints.length}`,
      `HP    : ${player.hp}`,
      `Kills : ${player.kills}/${enemies.length}`,
      `Shots : ${bullets.length}`,
      `Scale : ${SCALE.toFixed(2)}`,
    ];
    const pw = s(185), ph = lines.length * s(17) + s(10);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(s(4), s(4), pw, ph);
    ctx.fillStyle    = '#00ff88';
    ctx.font         = `${s(11)}px monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, s(9), s(7 + i * 17)));
  }

  // End-game overlay
  if (gameState === 'WIN' || gameState === 'LOSE') {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `bold ${s(34)}px monospace`;
    ctx.fillStyle    = gameState === 'WIN' ? '#00ff88' : '#ff5555';
    ctx.fillText(
      gameState === 'WIN' ? 'MISSION COMPLETE' : 'MISSION FAILED',
      canvas.width / 2, canvas.height / 2
    );
    ctx.font      = `${s(15)}px monospace`;
    ctx.fillStyle = '#888';
    ctx.fillText('Tap RESET to play again', canvas.width / 2, canvas.height / 2 + s(44));
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

resizeCanvas();
initGame();
requestAnimationFrame(ts => { lastTime = ts; loop(ts); });
