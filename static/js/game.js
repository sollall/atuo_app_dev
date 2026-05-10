'use strict';

const TILE  = 44;
const MAP_W = 20;
const MAP_H = 15;
const T     = { WALL: 0, FLOOR: 1, DOOR: 2 };
const PHASE = { PLANNING: 'planning', RUNNING: 'running', WIN: 'win', LOSE: 'lose' };

// 6 rooms (TL,TC,TR,BL,BC,BR) + central corridor
const MAP = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,1,1,1,1,2,1,1,1,1,1,1,2,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,0,0,2,0,0,0,0,2,0,0,0,0,0,2,0,0,0,0,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
    [0,0,0,2,0,0,0,0,2,0,0,0,0,0,2,0,0,0,0,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,1,1,1,1,2,1,1,1,1,1,1,2,1,1,1,1,1,1,0],
    [0,1,1,1,1,0,1,1,1,1,1,1,0,1,1,1,1,1,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const ROOM_LABELS = [
    [1,  1,  'TL'], [6,  1,  'TC'],       [13, 1,  'TR'],
    [5,  6,  '─── CORRIDOR ───'],
    [1, 10,  'BL (ENTRY)'],  [6, 10, 'BC'], [13, 10, 'BR'],
];

// ── helpers ──────────────────────────────────────────────────────────────────
function isPassable(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    return MAP[ty][tx] !== T.WALL;
}

function hasLOS(x1, y1, x2, y2) {
    const dx = x2-x1, dy = y2-y1;
    const steps = Math.ceil(Math.sqrt(dx*dx+dy*dy) / (TILE*0.4));
    for (let i = 1; i < steps; i++) {
        const t = i/steps;
        if (MAP[Math.floor((y1+dy*t)/TILE)]?.[Math.floor((x1+dx*t)/TILE)] === T.WALL) return false;
    }
    return true;
}

function castRay(ox, oy, angle, maxDist) {
    const step = 4, dx = Math.cos(angle)*step, dy = Math.sin(angle)*step;
    let cx = ox, cy = oy;
    for (let d = 0; d < maxDist; d += step) {
        cx += dx; cy += dy;
        if (MAP[Math.floor(cy/TILE)]?.[Math.floor(cx/TILE)] === T.WALL)
            return { x: cx-dx, y: cy-dy };
    }
    return { x: cx, y: cy };
}

function wrap(a) {
    while (a >  Math.PI) a -= 2*Math.PI;
    while (a < -Math.PI) a += 2*Math.PI;
    return a;
}

// ── particles ─────────────────────────────────────────────────────────────────
const particles = [];

function addFlash(x, y, angle) {
    const gx = x+Math.cos(angle)*22, gy = y+Math.sin(angle)*22;
    particles.push({ k:'flash', x:gx, y:gy, life:6, max:6 });
    particles.push({ k:'tracer',
        x1:gx, y1:gy,
        x2:x+Math.cos(angle)*130, y2:y+Math.sin(angle)*130,
        life:4, max:4 });
}

function addBlood(x, y) {
    for (let i = 0; i < 14; i++) {
        const a = Math.random()*Math.PI*2, s = Math.random()*5+1;
        particles.push({ k:'blood', x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s,
            r:Math.random()*5+2, life:70, max:70 });
    }
}

function tickParticles() {
    for (let i = particles.length-1; i >= 0; i--) {
        const p = particles[i];
        p.life--;
        if (p.k === 'blood') { p.x+=p.vx; p.y+=p.vy; p.vx*=0.78; p.vy*=0.78; }
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles(ctx) {
    for (const p of particles) {
        const a = p.life/p.max;
        if (p.k === 'flash') {
            ctx.beginPath(); ctx.arc(p.x,p.y,11*a,0,Math.PI*2);
            ctx.fillStyle = `rgba(255,230,80,${a})`; ctx.fill();
            ctx.beginPath(); ctx.arc(p.x,p.y,5*a,0,Math.PI*2);
            ctx.fillStyle = `rgba(255,255,220,${a})`; ctx.fill();
        } else if (p.k === 'tracer') {
            ctx.beginPath(); ctx.moveTo(p.x1,p.y1); ctx.lineTo(p.x2,p.y2);
            ctx.strokeStyle = `rgba(255,240,100,${a*0.55})`; ctx.lineWidth=1.5; ctx.stroke();
        } else {
            ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
            ctx.fillStyle = `rgba(140,0,0,${a*0.9})`; ctx.fill();
        }
    }
}

// ── entities ──────────────────────────────────────────────────────────────────
const openedDoors = new Set();

class SwatUnit {
    constructor(tx, ty) {
        this.x = tx*TILE+TILE/2; this.y = ty*TILE+TILE/2;
        this.hp = 3; this.maxHp = 3;
        this.facing = -Math.PI/2;
        this.path = []; this.pathIdx = 0;
        this.speed = 2.8;
        this.state = 'idle';
        this.engTimer = 0; this.flash = 0; this.dead = false;
    }
    update(enemies) {
        if (this.dead) return;
        if (this.flash > 0) this.flash--;
        for (const e of enemies) {
            if (e.dead) continue;
            const dx=e.x-this.x, dy=e.y-this.y, d2=dx*dx+dy*dy;
            if (d2 < (6.5*TILE)**2 && hasLOS(this.x,this.y,e.x,e.y)) {
                this.facing = Math.atan2(dy,dx);
                this.state = 'engaging';
                if (++this.engTimer >= 28) {
                    e.hp--; addFlash(this.x,this.y,this.facing);
                    if (e.hp<=0) { e.dead=true; addBlood(e.x,e.y); }
                    this.engTimer=0;
                }
                return;
            }
        }
        this.engTimer=0; this.state='moving';
        if (this.pathIdx < this.path.length) {
            const wp=this.path[this.pathIdx];
            const dx=wp.x-this.x, dy=wp.y-this.y, d=Math.sqrt(dx*dx+dy*dy);
            if (d < this.speed+0.5) {
                this.x=wp.x; this.y=wp.y; this.pathIdx++;
                const tx=Math.floor(this.x/TILE), ty=Math.floor(this.y/TILE);
                if (MAP[ty]?.[tx]===T.DOOR) openedDoors.add(`${tx},${ty}`);
            } else {
                this.facing=Math.atan2(dy,dx);
                this.x+=(dx/d)*this.speed; this.y+=(dy/d)*this.speed;
            }
        } else { this.state='idle'; }
    }
}

class Enemy {
    constructor(tx, ty, patrol, initFacing) {
        this.x=tx*TILE+TILE/2; this.y=ty*TILE+TILE/2;
        this.hp=1; this.speed=1.0;
        this.facing = initFacing ?? (Math.random()*Math.PI*2);
        this.fovAngle=Math.PI*0.65; this.fovRange=5.5*TILE;
        this.patrol=patrol.map(p=>({x:p[0]*TILE+TILE/2, y:p[1]*TILE+TILE/2}));
        this.patIdx=0; this.state='patrol';
        this.alertTimer=0; this.shootTimer=0; this.dead=false;
    }
    update(units) {
        if (this.dead) return;
        if (this.alertTimer>0 && --this.alertTimer===0) this.state='patrol';

        let saw=false;
        for (const u of units) {
            if (u.dead) continue;
            const dx=u.x-this.x, dy=u.y-this.y, d2=dx*dx+dy*dy;
            if (d2>this.fovRange**2) continue;
            const diff=Math.abs(wrap(Math.atan2(dy,dx)-this.facing));
            if (diff<this.fovAngle/2 && hasLOS(this.x,this.y,u.x,u.y)) {
                saw=true;
                this.state='hostile'; this.alertTimer=150;
                this.facing=Math.atan2(dy,dx);
                if (++this.shootTimer>=50) {
                    u.hp--; u.flash=14; addFlash(this.x,this.y,this.facing);
                    if (u.hp<=0) { u.dead=true; addBlood(u.x,u.y); }
                    this.shootTimer=0;
                }
            }
        }
        if (!saw) this.shootTimer=0;
        if (this.state==='hostile') return;

        if (!this.patrol.length) { this.facing+=0.006; return; }
        const t=this.patrol[this.patIdx];
        const dx=t.x-this.x, dy=t.y-this.y, d=Math.sqrt(dx*dx+dy*dy);
        if (d<this.speed+1) { this.patIdx=(this.patIdx+1)%this.patrol.length; }
        else { this.facing=Math.atan2(dy,dx); this.x+=(dx/d)*this.speed; this.y+=(dy/d)*this.speed; }
    }
}

// ── game state ────────────────────────────────────────────────────────────────
const game = { phase:PHASE.PLANNING, units:[], enemies:[], selectedUnit:null };

function initGame() {
    game.phase=PHASE.PLANNING; game.selectedUnit=null;
    openedDoors.clear(); particles.length=0;
    game.units = [ new SwatUnit(2,12), new SwatUnit(3,12) ];
    game.enemies = [
        new Enemy(2,  2,  [[1,1],[4,1],[4,4],[1,4]]),
        new Enemy(9,  2,  [[6,1],[11,1],[11,4],[6,4]]),
        new Enemy(16, 2,  [], Math.PI),
        new Enemy(10, 7,  [[1,7],[18,7]]),
        new Enemy(9,  12, [], Math.PI/2),
        new Enemy(16, 12, [[13,10],[18,10],[18,13],[13,13]]),
    ];
}

function executeGame() { if (game.phase===PHASE.PLANNING) game.phase=PHASE.RUNNING; }

function resetPaths() {
    for (const u of game.units) { u.path=[]; u.pathIdx=0; u.state='idle'; }
    game.selectedUnit=null;
    if (game.phase===PHASE.RUNNING) game.phase=PHASE.PLANNING;
}

function tickGame() {
    if (game.phase!==PHASE.RUNNING) return;
    tickParticles();
    for (const u of game.units)  u.update(game.enemies);
    for (const e of game.enemies) e.update(game.units);
    if (game.enemies.every(e=>e.dead)) { game.phase=PHASE.WIN; return; }
    if (game.units.every(u=>u.dead))   { game.phase=PHASE.LOSE; return; }
    const active=game.units.filter(u=>!u.dead&&(u.state==='engaging'||u.state==='moving'||u.pathIdx<u.path.length));
    if (!active.length) game.phase=PHASE.PLANNING;
}

// ── canvas ────────────────────────────────────────────────────────────────────
const canvas=document.getElementById('gameCanvas');
const ctx=canvas.getContext('2d');
canvas.width=MAP_W*TILE; canvas.height=MAP_H*TILE;

function resize() {
    const c=document.getElementById('canvas-container');
    const s=Math.min(c.clientWidth/canvas.width, c.clientHeight/canvas.height);
    canvas.style.width=(canvas.width*s)+'px'; canvas.style.height=(canvas.height*s)+'px';
}
window.addEventListener('resize', resize);

// ── render ────────────────────────────────────────────────────────────────────
function drawMap() {
    ctx.fillStyle='#080c12'; ctx.fillRect(0,0,canvas.width,canvas.height);
    for (let ty=0;ty<MAP_H;ty++) for (let tx=0;tx<MAP_W;tx++) {
        const tile=MAP[ty][tx], px=tx*TILE, py=ty*TILE;
        if (tile===T.FLOOR) {
            ctx.fillStyle='#121b2e'; ctx.fillRect(px,py,TILE,TILE);
            ctx.strokeStyle='#172238'; ctx.lineWidth=0.5; ctx.strokeRect(px,py,TILE,TILE);
        } else if (tile===T.DOOR) {
            ctx.fillStyle='#121b2e'; ctx.fillRect(px,py,TILE,TILE);
            if (!openedDoors.has(`${tx},${ty}`)) {
                ctx.fillStyle='#3d2500'; ctx.fillRect(px+3,py+3,TILE-6,TILE-6);
                ctx.fillStyle='#7a5010'; ctx.fillRect(px+7,py+7,TILE-14,TILE-14);
                ctx.beginPath(); ctx.arc(px+TILE/2,py+TILE/2,3,0,Math.PI*2);
                ctx.fillStyle='#c8a030'; ctx.fill();
            } else {
                ctx.strokeStyle='#7a5010'; ctx.lineWidth=3;
                ctx.strokeRect(px+2,py+2,TILE-4,TILE-4);
            }
        }
    }
    // wall top-edge highlight
    for (let ty=1;ty<MAP_H;ty++) for (let tx=0;tx<MAP_W;tx++) {
        if (MAP[ty][tx]===T.WALL && MAP[ty-1]?.[tx]!==T.WALL) {
            ctx.fillStyle='rgba(50,80,140,0.25)'; ctx.fillRect(tx*TILE,ty*TILE,TILE,3);
        }
    }
    // room labels
    ctx.font='bold 11px monospace'; ctx.fillStyle='rgba(50,80,140,0.55)';
    for (const [tx,ty,text] of ROOM_LABELS) ctx.fillText(text,tx*TILE+5,ty*TILE+15);
}

function drawFOV(e) {
    const {x,y,facing,fovAngle,fovRange,state}=e;
    const rays=28, alert=state!=='patrol';
    ctx.beginPath(); ctx.moveTo(x,y);
    for (let i=0;i<=rays;i++) {
        const a=facing-fovAngle/2+fovAngle*(i/rays);
        const p=castRay(x,y,a,fovRange);
        i===0?ctx.moveTo(x,y):null; ctx.lineTo(p.x,p.y);
    }
    ctx.lineTo(x,y); ctx.closePath();
    const g=ctx.createRadialGradient(x,y,0,x,y,fovRange);
    if (alert) { g.addColorStop(0,'rgba(255,70,0,0.38)'); g.addColorStop(1,'rgba(255,70,0,0)'); }
    else        { g.addColorStop(0,'rgba(255,220,0,0.28)'); g.addColorStop(0.6,'rgba(255,220,0,0.10)'); g.addColorStop(1,'rgba(255,220,0,0)'); }
    ctx.fillStyle=g; ctx.fill();
}

function drawPath(u) {
    if (!u.path.length) return;
    const sel=game.selectedUnit===u;
    ctx.save(); ctx.setLineDash([7,6]);
    ctx.strokeStyle=sel?'#00ffaa':'#2277ff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(u.x,u.y);
    for (let i=u.pathIdx;i<u.path.length;i++) ctx.lineTo(u.path[i].x,u.path[i].y);
    ctx.stroke(); ctx.setLineDash([]);
    for (let i=u.pathIdx;i<u.path.length;i++) {
        const w=u.path[i];
        ctx.beginPath(); ctx.arc(w.x,w.y,5,0,Math.PI*2);
        ctx.fillStyle='#00ffaa'; ctx.fill();
        ctx.fillStyle='#000'; ctx.font='8px monospace'; ctx.fillText(i+1,w.x-3,w.y+3);
    }
    ctx.restore();
}

function drawOperator(u) {
    const {x,y,facing,hp,maxHp,flash}=u;
    const sel=game.selectedUnit===u;
    ctx.save(); ctx.translate(x,y); ctx.rotate(facing);
    // shadow
    ctx.beginPath(); ctx.ellipse(3,5,12,9,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fill();
    // body
    ctx.beginPath(); ctx.arc(0,0,11,0,Math.PI*2);
    ctx.fillStyle=flash>0?'#fff':'#1866e0'; ctx.fill();
    ctx.strokeStyle=flash>0?'#fff':'#55aaff'; ctx.lineWidth=2; ctx.stroke();
    // vest cross
    ctx.fillStyle='rgba(0,0,100,0.45)'; ctx.fillRect(-8,-3,16,6);
    // helmet
    ctx.beginPath(); ctx.arc(0,-2,7.5,Math.PI,0);
    ctx.fillStyle=flash>0?'#fff':'#0a2a50'; ctx.fill();
    // gun + suppressor
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(9,-2,14,3);
    ctx.fillStyle='#444';    ctx.fillRect(23,-3,4,5);
    ctx.fillStyle='#2a2a2a'; ctx.fillRect(27,-2,7,3);
    ctx.restore();
    // HP bar
    const bw=24;
    ctx.fillStyle='#111'; ctx.fillRect(x-bw/2,y+14,bw,4);
    ctx.fillStyle=hp>1?'#00ee77':'#ff3300';
    ctx.fillRect(x-bw/2,y+14,bw*(hp/maxHp),4);
    if (sel) {
        ctx.save(); ctx.beginPath(); ctx.arc(x,y,19,0,Math.PI*2);
        ctx.strokeStyle='#00ffaa'; ctx.lineWidth=1.5;
        ctx.setLineDash([4,4]); ctx.stroke(); ctx.restore();
    }
}

function drawDeadOp(x,y) {
    ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2);
    ctx.fillStyle='rgba(15,35,90,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+2,y+3,9,6,-0.3,0,Math.PI*2);
    ctx.fillStyle='rgba(120,0,0,0.55)'; ctx.fill();
}

function drawEnemy(e) {
    const {x,y,facing,state,dead}=e;
    if (dead) {
        ctx.beginPath(); ctx.arc(x,y,9,0,Math.PI*2);
        ctx.fillStyle='rgba(70,0,0,0.6)'; ctx.fill();
        ctx.beginPath(); ctx.ellipse(x+2,y+3,9,6,-0.4,0,Math.PI*2);
        ctx.fillStyle='rgba(120,0,0,0.5)'; ctx.fill();
        return;
    }
    const hostile=state==='hostile';
    ctx.save(); ctx.translate(x,y); ctx.rotate(facing);
    ctx.beginPath(); ctx.ellipse(3,5,11,8,0,0,Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2);
    ctx.fillStyle=hostile?'#ff2200':'#991111'; ctx.fill();
    ctx.strokeStyle=hostile?'#ff7700':'#cc3333'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='rgba(80,0,0,0.5)'; ctx.fillRect(-7,-3,14,6);
    ctx.beginPath(); ctx.arc(0,-2,6.5,Math.PI,0);
    ctx.fillStyle=hostile?'#660000':'#330000'; ctx.fill();
    ctx.fillStyle='#3a0000'; ctx.fillRect(8,-2,13,3);
    ctx.restore();
    if (hostile) {
        ctx.font='bold 16px monospace'; ctx.fillStyle='#ff4400';
        ctx.fillText('!!',x-9,y-16);
    } else if (state==='alert') {
        ctx.font='bold 14px monospace'; ctx.fillStyle='#ffaa00';
        ctx.fillText('?',x-4,y-14);
    }
}

function drawEngageLine(u) {
    for (const e of game.enemies) {
        if (e.dead||!hasLOS(u.x,u.y,e.x,e.y)) continue;
        ctx.beginPath(); ctx.moveTo(u.x,u.y); ctx.lineTo(e.x,e.y);
        ctx.strokeStyle='rgba(255,180,0,0.22)'; ctx.lineWidth=1; ctx.stroke();
    }
}

function drawOverlay(title,sub,bg) {
    ctx.fillStyle=bg; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.textAlign='center'; ctx.shadowColor='#000'; ctx.shadowBlur=12;
    ctx.font=`bold ${Math.floor(TILE*1.1)}px monospace`;
    ctx.fillStyle='#fff'; ctx.fillText(title,canvas.width/2,canvas.height/2-8);
    ctx.font=`${Math.floor(TILE*0.5)}px monospace`;
    ctx.fillStyle='#ddd'; ctx.fillText(sub,canvas.width/2,canvas.height/2+40);
    ctx.shadowBlur=0; ctx.textAlign='left';
}

function render() {
    drawMap();
    for (const e of game.enemies) if (!e.dead) drawFOV(e);
    for (const u of game.units)   if (!u.dead) drawPath(u);
    // engage lines
    if (game.phase===PHASE.RUNNING)
        for (const u of game.units) if (!u.dead&&u.state==='engaging') drawEngageLine(u);
    // dead first (under living)
    for (const e of game.enemies) if (e.dead) drawEnemy(e);
    for (const u of game.units)   if (u.dead) drawDeadOp(u.x,u.y);
    drawParticles(ctx);
    for (const e of game.enemies) if (!e.dead) drawEnemy(e);
    for (const u of game.units)   if (!u.dead) drawOperator(u);
    if (game.phase===PHASE.WIN)  drawOverlay('MISSION COMPLETE','全敵兵を排除しました','rgba(0,120,60,0.82)');
    if (game.phase===PHASE.LOSE) drawOverlay('MISSION FAILED','隊員が全滅しました','rgba(140,0,0,0.82)');
    updateUI();
}

function updateUI() {
    const ae=game.enemies.filter(e=>!e.dead).length;
    const au=game.units.filter(u=>!u.dead).length;
    document.getElementById('status-phase').textContent=game.phase.toUpperCase();
    document.getElementById('status-enemies').textContent=ae;
    document.getElementById('status-units').textContent=au;
    const h=document.getElementById('hint');
    if (game.selectedUnit)              h.textContent='隊員選択中 — ドラッグで経路描画 | 右クリック/Clear で消去';
    else if (game.phase===PHASE.PLANNING) h.textContent='青い隊員をクリック/タップして選択 → ドラッグで経路を引く → ▶ Execute';
    else if (game.phase===PHASE.RUNNING)  h.textContent='実行中... 黄色FOVに入ると発見されます。橙/赤FOVは警戒/交戦中';
    else                                  h.textContent='New Game で再挑戦';
}

// ── input ─────────────────────────────────────────────────────────────────────
function getPos(e) {
    const r=canvas.getBoundingClientRect();
    const sx=canvas.width/r.width, sy=canvas.height/r.height;
    const s=e.changedTouches?e.changedTouches[0]:(e.touches?e.touches[0]:e);
    return {x:(s.clientX-r.left)*sx, y:(s.clientY-r.top)*sy};
}

let drawing=false, lastWP=null;
const MIN_D2=(TILE*0.65)**2;

function pointerDown(pos) {
    if (game.phase===PHASE.WIN||game.phase===PHASE.LOSE) return;
    for (const u of game.units) {
        if (u.dead) continue;
        const dx=pos.x-u.x, dy=pos.y-u.y;
        if (dx*dx+dy*dy<22**2) { game.selectedUnit=(game.selectedUnit===u)?null:u; drawing=false; return; }
    }
    if (game.selectedUnit) { drawing=true; lastWP=pos; addWP(pos); }
}

function addWP(pos) {
    const tx=Math.floor(pos.x/TILE), ty=Math.floor(pos.y/TILE);
    if (isPassable(tx,ty)) game.selectedUnit.path.push({x:tx*TILE+TILE/2,y:ty*TILE+TILE/2});
}

function pointerMove(pos) {
    if (!drawing||!game.selectedUnit) return;
    const dx=pos.x-lastWP.x, dy=pos.y-lastWP.y;
    if (dx*dx+dy*dy>=MIN_D2) { addWP(pos); lastWP=pos; }
}

function clearSelectedPath() {
    if (game.selectedUnit) { game.selectedUnit.path=[]; game.selectedUnit.pathIdx=0; }
}

canvas.addEventListener('mousedown',   e=>{e.preventDefault();pointerDown(getPos(e));});
canvas.addEventListener('mousemove',   e=>{if(e.buttons)pointerMove(getPos(e));});
canvas.addEventListener('mouseup',     ()=>{drawing=false;});
canvas.addEventListener('contextmenu', e=>{e.preventDefault();clearSelectedPath();});
canvas.addEventListener('touchstart',  e=>{e.preventDefault();pointerDown(getPos(e));},{passive:false});
canvas.addEventListener('touchmove',   e=>{e.preventDefault();pointerMove(getPos(e));},{passive:false});
canvas.addEventListener('touchend',    e=>{e.preventDefault();drawing=false;},{passive:false});

document.getElementById('btn-execute').addEventListener('click', executeGame);
document.getElementById('btn-reset').addEventListener('click', resetPaths);
document.getElementById('btn-clear').addEventListener('click', clearSelectedPath);
document.getElementById('btn-new').addEventListener('click', initGame);

// ── loop ──────────────────────────────────────────────────────────────────────
function loop() { tickGame(); render(); requestAnimationFrame(loop); }
initGame(); resize(); loop();
