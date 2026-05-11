'use strict';

// ── Canvas ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const WW = 800, WH = 560;
let   SC = 1;
const S  = v => v * SC;

function resizeCanvas() {
  const c = document.getElementById('gameContainer');
  SC = Math.min(c.clientWidth / WW, c.clientHeight / WH);
  canvas.width  = Math.floor(WW * SC);
  canvas.height = Math.floor(WH * SC);
}
window.addEventListener('resize', resizeCanvas);

// ── Math helpers ───────────────────────────────────────────────────────────
const dist = (ax,ay,bx,by) => Math.sqrt((bx-ax)**2+(by-ay)**2);

function seg2seg(ax,ay,bx,by, cx,cy,dx,dy) {
  const abx=bx-ax, aby=by-ay, cdx=dx-cx, cdy=dy-cy;
  const den = abx*cdy - aby*cdx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx-ax)*cdy - (cy-ay)*cdx) / den;
  const u = ((cx-ax)*aby - (cy-ay)*abx) / den;
  return t>=0 && t<=1 && u>=0 && u<=1;
}

function rectEdges(r) {
  return [
    [r.x,r.y, r.x+r.w,r.y],
    [r.x+r.w,r.y, r.x+r.w,r.y+r.h],
    [r.x,r.y+r.h, r.x+r.w,r.y+r.h],
    [r.x,r.y, r.x,r.y+r.h],
  ];
}

// ── Map definition ─────────────────────────────────────────────────────────
//
//  y=0   ┌──────────────────────────────────────────────┐
//        │   ROOM A  (x:10-392)  │  ROOM B  (x:408-790)│ y:10-222
//  y=222 ├──────────[DOOR B]─────┼──────[DOOR C]────────┤ (wall h:10)
//        │           HALLWAY                            │ y:232-332
//  y=332 ├─────────────────[DOOR A]─────────────────────┤ (wall h:8)
//        │                ENTRY                         │ y:340-550
//  y=550 └──────────────────────────────────────────────┘

const STATIC_WALLS = [
  {x:0,   y:0,   w:800, h:10},   // outer top
  {x:0,   y:550, w:800, h:10},   // outer bottom
  {x:0,   y:0,   w:10,  h:560},  // outer left
  {x:790, y:0,   w:10,  h:560},  // outer right
  // Room A/B south wall — gaps for Door B (x:110-250) and Door C (x:540-680)
  {x:10,  y:222, w:100, h:10},
  {x:250, y:222, w:290, h:10},
  {x:680, y:222, w:110, h:10},
  // Entry north wall — gap for Door A (x:325-475)
  {x:10,  y:332, w:315, h:8},
  {x:475, y:332, w:315, h:8},
  // Divider between Room A and Room B
  {x:394, y:10,  w:12,  h:212},
];

// Mutable doors
let DOORS;
function makeDoors() {
  return [
    {id:'A', x:325, y:332, w:150, h:8,  open:false, progress:0, color:'#8B5A2B'},
    {id:'B', x:110, y:222, w:140, h:10, open:false, progress:0, color:'#8B5A2B'},
    {id:'C', x:540, y:222, w:140, h:10, open:false, progress:0, color:'#8B5A2B'},
  ];
}

const FLOORS = [
  {x:10, y:10,  w:382, h:212, label:'ROOM A',  col:'#1b2028'},
  {x:408,y:10,  w:382, h:212, label:'ROOM B',  col:'#1b2028'},
  {x:10, y:232, w:780, h:100, label:'HALLWAY', col:'#161a1e'},
  {x:10, y:340, w:780, h:210, label:'ENTRY',   col:'#1e2228'},
];

// ── Collision ──────────────────────────────────────────────────────────────
function blockers() {
  return [...STATIC_WALLS, ...DOORS.filter(d => !d.open)];
}

function lineHitsRect(x1,y1,x2,y2, r) {
  for (const [ax,ay,bx,by] of rectEdges(r))
    if (seg2seg(x1,y1,x2,y2, ax,ay,bx,by)) return true;
  return false;
}

function lineBlocked(x1,y1,x2,y2) {
  for (const r of blockers()) if (lineHitsRect(x1,y1,x2,y2,r)) return true;
  return false;
}

function circleBlocked(cx,cy,r) {
  for (const rect of blockers()) {
    const px = Math.max(rect.x, Math.min(cx, rect.x+rect.w));
    const py = Math.max(rect.y, Math.min(cy, rect.y+rect.h));
    if ((cx-px)**2+(cy-py)**2 < r*r) return true;
  }
  return false;
}

function pointBlocked(x,y) {
  for (const r of blockers())
    if (x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h) return true;
  return false;
}

// ── Fog of war ─────────────────────────────────────────────────────────────
// 0 = never seen  1 = previously seen  2 = currently visible
const FC = 40;
const FCOLS = Math.ceil(WW/FC), FROWS = Math.ceil(WH/FC);
let fog; // Uint8Array

function initFog() {
  fog = new Uint8Array(FCOLS * FROWS);
}

// Mark cells inside a unit's FOV cone as currently visible (2)
function markVisible(x, y, angle, fovA, range) {
  const rc = Math.ceil(range/FC);
  const cx = Math.floor(x/FC), cy = Math.floor(y/FC);
  for (let gy=Math.max(0,cy-rc); gy<=Math.min(FROWS-1,cy+rc); gy++) {
    for (let gx=Math.max(0,cx-rc); gx<=Math.min(FCOLS-1,cx+rc); gx++) {
      const wx=(gx+0.5)*FC, wy=(gy+0.5)*FC;
      const dx=wx-x, dy=wy-y;
      if (dx*dx+dy*dy > range*range) continue;
      let diff=Math.atan2(dy,dx)-angle;
      while(diff> Math.PI) diff-=2*Math.PI;
      while(diff<-Math.PI) diff+=2*Math.PI;
      if (Math.abs(diff) > fovA/2+0.05) continue;
      if (!lineBlocked(x,y,wx,wy)) fog[gy*FCOLS+gx]=2;
    }
  }
}

// Called every frame: downgrade 2→1, then re-mark all living units' FOV
function updateFog() {
  for (let i=0; i<fog.length; i++) if (fog[i]===2) fog[i]=1;
  for (const u of units) {
    if (u.hp<=0) continue;
    markVisible(u.x, u.y, u.angle, u.fovA, u.fovR);
  }
}

function isVisible(x, y) {
  const gx=Math.floor(x/FC), gy=Math.floor(y/FC);
  if (gx<0||gy<0||gx>=FCOLS||gy>=FROWS) return false;
  return fog[gy*FCOLS+gx]===2;
}

function wasSeen(x, y) {
  const gx=Math.floor(x/FC), gy=Math.floor(y/FC);
  if (gx<0||gy<0||gx>=FCOLS||gy>=FROWS) return false;
  return fog[gy*FCOLS+gx]>=1;
}

// ── LOS ────────────────────────────────────────────────────────────────────
function canSee(fx,fy,fa,fovA,fovR, tx,ty) {
  const dx=tx-fx, dy=ty-fy;
  if (dx*dx+dy*dy > fovR*fovR) return false;
  let d = Math.atan2(dy,dx) - fa;
  while(d> Math.PI) d-=2*Math.PI;
  while(d<-Math.PI) d+=2*Math.PI;
  if (Math.abs(d) > fovA/2) return false;
  return !lineBlocked(fx,fy,tx,ty);
}

// ── Unit ───────────────────────────────────────────────────────────────────
let _uid = 0;
class Unit {
  constructor(x,y,color) {
    this.id    = ++_uid;
    this.x=x; this.y=y;
    this.angle = -Math.PI/2;
    this.speed = 130;
    this.r     = 13;
    this.fovA  = Math.PI/2.2;
    this.fovR  = 270;
    this.color = color;
    this.wp    = [];       // waypoints
    this.state = 'IDLE';  // IDLE MOVING BREACHING ENGAGING
    this.hp    = 100;
    this.kills = 0;
    this.shotCd= 0;
    this.SHOT  = 0.35;
    this.selected = false;
    this.breachDoor  = null;
    this.stackedDoor = null;   // door this unit is assigned to stack at
  }
}

// ── Enemy ──────────────────────────────────────────────────────────────────
class Enemy {
  constructor(x,y,px1,px2) {
    this.x=x; this.y=y;
    this.angle=0;
    this.speed=55;
    this.r    = 12;
    this.fovA = Math.PI/1.9;
    this.fovR = 165;
    this.patrol={x1:px1, x2:px2, dir:1};
    this.state='PATROL'; // PATROL ALERT SEARCH DEAD
    this.hp   = 100;
    this.shotCd=0;
    this.SHOT =1.7;
    this.alertT=0;
    this.lastSeen={x,y};
  }
  update(dt, units) {
    if (this.state==='DEAD') return;
    this.shotCd=Math.max(0,this.shotCd-dt);
    let seen=null;
    for (const u of units) {
      if (u.hp<=0) continue;
      if (canSee(this.x,this.y,this.angle,this.fovA,this.fovR, u.x,u.y)) { seen=u; break; }
    }
    if (seen) {
      this.state='ALERT'; this.alertT=3.5;
      this.lastSeen={x:seen.x,y:seen.y};
      this.angle=Math.atan2(seen.y-this.y, seen.x-this.x);
      if (this.shotCd<=0) {
        const a=Math.atan2(seen.y-this.y,seen.x-this.x);
        bullets.push({x:this.x,y:this.y,vx:Math.cos(a)*265,vy:Math.sin(a)*265,friendly:false,life:3});
        this.shotCd=this.SHOT;
      }
    } else if (this.state==='ALERT') {
      this.alertT-=dt;
      this.angle=Math.atan2(this.lastSeen.y-this.y,this.lastSeen.x-this.x);
      if (this.alertT<=0) { this.state='SEARCH'; this.alertT=4.0; }
    } else if (this.state==='SEARCH') {
      this.alertT-=dt;
      this.angle+=0.9*dt;
      if (this.alertT<=0) this.state='PATROL';
    } else {
      this.x+=this.speed*this.patrol.dir*dt;
      this.angle=this.patrol.dir>0?0:Math.PI;
      if (this.x>=this.patrol.x2){this.x=this.patrol.x2;this.patrol.dir=-1;}
      if (this.x<=this.patrol.x1){this.x=this.patrol.x1;this.patrol.dir= 1;}
    }
  }
}

// ── State ──────────────────────────────────────────────────────────────────
let units=[], enemies=[], bullets=[], flashes=[];
let selectedUnit=null;
let selectedDoor=null;   // door whose stack menu is open

// ── Door stack positions ───────────────────────────────────────────────────
// Returns {left, right} world positions beside a horizontal door,
// on the south (lower) side — the typical approach side.
function getStackPositions(d) {
  const margin = 20;           // distance from door edge to stack centre
  const wallMid = d.y + d.h/2;
  const below   = wallMid + margin;
  const left    = { x: d.x        - margin, y: below,
                    faceAngle: Math.atan2(wallMid - below, (d.x + d.w/2) - (d.x - margin)) };
  const right   = { x: d.x + d.w + margin, y: below,
                    faceAngle: Math.atan2(wallMid - below, (d.x + d.w/2) - (d.x + d.w + margin)) };
  return { left, right };
}

function nearestDoor(x, y) {
  for (const d of DOORS) {
    const cx=d.x+d.w/2, cy=d.y+d.h/2;
    if (Math.abs(x-cx) < d.w/2+18 && Math.abs(y-cy) < d.h/2+18) return d;
  }
  return null;
}

function selectUnit(u) {
  units.forEach(v=>v.selected=false);
  u.selected=true; selectedUnit=u;
  syncUnitBtns();
}

function syncUnitBtns() {
  units.forEach(u=>{
    const btn=document.getElementById(`btnUnit${u.id}`);
    if (!btn) return;
    btn.classList.toggle('active', u.selected);
    btn.style.color       = u.selected ? u.color : '';
    btn.style.borderColor = u.selected ? u.color : '';
  });
}
let gameState='PLANNING';
let showDebug=false;
let fps=0,_ff=0,_ft=0,lastTime=0;
const BREACH_DIST=32, BREACH_TIME=0.55;
const TURN_DURATION=1.0;
let turnTimer=0;   // counts up to TURN_DURATION during EXECUTING
let turnCount=0;   // total turns executed

function initGame() {
  _uid=0;
  DOORS=makeDoors();
  initFog();
  const u1=new Unit(260,450,'#00cc66');
  const u2=new Unit(540,450,'#3399ff');
  u1.selected=true;
  units=[u1,u2]; selectedUnit=u1;
  enemies=[
    new Enemy(130, 100,  30, 370),
    new Enemy(290, 155,  30, 370),
    new Enemy(510,  80, 420, 775),
    new Enemy(680, 140, 420, 775),
    new Enemy(400, 275, 120, 680),
  ];
  bullets=[]; flashes=[];
  turnTimer=0; turnCount=0;
  gameState='PLANNING';
  updateStatusUI();
  syncUnitBtns();
}

// ── Input ──────────────────────────────────────────────────────────────────
let drawing=false, lastDraw=null;
const MIN_DRAW=16;

function toWorld(cx,cy) {
  const r=canvas.getBoundingClientRect();
  return {x:(cx-r.left)/SC, y:(cy-r.top)/SC};
}

function nearestUnit(x,y) {
  for (const u of units) if (dist(u.x,u.y,x,y)<u.r*2.8) return u;
  return null;
}

function ptrDown(x,y) {
  if (gameState!=='PLANNING') return;

  // 1) unit tap → select
  const hitUnit=nearestUnit(x,y);
  if (hitUnit) { selectUnit(hitUnit); selectedDoor=null; drawing=false; lastDraw=null; return; }

  // 2) stack position tap → add waypoint
  if (selectedDoor && selectedUnit) {
    const {left,right}=getStackPositions(selectedDoor);
    for (const pos of [left,right]) {
      if (dist(x,y,pos.x,pos.y)<28) {
        if (!pointBlocked(pos.x,pos.y)) {
          selectedUnit.wp.push({x:pos.x, y:pos.y, faceAngle:pos.faceAngle, stackDoor:selectedDoor});
          selectedUnit.stackedDoor = selectedDoor;  // pre-reserve for coordination
        }
        selectedDoor=null;
        return;
      }
    }
  }

  // 3) door tap → open stack menu
  const hitDoor=nearestDoor(x,y);
  if (hitDoor) { selectedDoor=hitDoor; return; }

  // 4) empty space → draw path
  selectedDoor=null;
  if (selectedUnit) {
    drawing=true;
    selectedUnit.wp=[];
    lastDraw={x,y};
    if (!pointBlocked(x,y)) selectedUnit.wp.push({x,y});
  }
}
function ptrMove(x,y) {
  if (!drawing||!selectedUnit) return;
  if (lastDraw && dist(lastDraw.x,lastDraw.y,x,y)>=MIN_DRAW) {
    if (!pointBlocked(x,y)) selectedUnit.wp.push({x,y});
    lastDraw={x,y};
  }
}
function ptrUp() { drawing=false; lastDraw=null; }

canvas.addEventListener('mousedown', e=>{const p=toWorld(e.clientX,e.clientY);ptrDown(p.x,p.y);});
canvas.addEventListener('mousemove', e=>{const p=toWorld(e.clientX,e.clientY);ptrMove(p.x,p.y);});
canvas.addEventListener('mouseup',   ()=>ptrUp());
canvas.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0],p=toWorld(t.clientX,t.clientY);ptrDown(p.x,p.y);},{passive:false});
canvas.addEventListener('touchmove', e=>{e.preventDefault();const t=e.touches[0],p=toWorld(t.clientX,t.clientY);ptrMove(p.x,p.y);},{passive:false});
canvas.addEventListener('touchend',  e=>{e.preventDefault();ptrUp();},{passive:false});

// ── Update ─────────────────────────────────────────────────────────────────
function nearDoor(u) {
  for (const d of DOORS) {
    if (d.open) continue;
    const cx=d.x+d.w/2, cy=d.y+d.h/2;
    if (Math.abs(u.x-cx)<d.w/2+24 && Math.abs(u.y-cy)<28) return d;
  }
  return null;
}

function update(dt) {
  _ff++; _ft+=dt;
  if (_ft>=1) { fps=_ff; _ff=0; _ft=0; }
  if (gameState!=='EXECUTING') return;

  // ── Turn timer: cap dt so we never overshoot the turn boundary ──
  const remaining = TURN_DURATION - turnTimer;
  dt = Math.min(dt, remaining);
  turnTimer += dt;

  for (const u of units) {
    if (u.hp<=0) continue;

    // ── Breach in progress ──
    if (u.breachDoor) {
      u.state='BREACHING';
      u.breachDoor.progress+=dt/BREACH_TIME;
      if (u.breachDoor.progress>=1) {
        const opened=u.breachDoor;
        opened.open=true;
        flashes.push({x:opened.x+opened.w/2, y:opened.y+opened.h/2, t:0.45});
        // release any unit still reserved for this door
        units.forEach(v=>{ if(v.stackedDoor===opened) v.stackedDoor=null; });
        u.breachDoor=null;
      }
      continue;
    }

    // ── Stacked at door: wait until all assigned teammates are also stacked ──
    if (u.state==='STACKED' && u.stackedDoor) {
      if (u.stackedDoor.open) {
        u.stackedDoor=null; u.state='IDLE';
      } else {
        const assigned=units.filter(v=>v.stackedDoor===u.stackedDoor && v.hp>0);
        const allReady=assigned.every(v=>v.state==='STACKED');
        if (allReady) {
          // All teammates in position → synchronized breach
          assigned.forEach(v=>{
            v.breachDoor=u.stackedDoor;
            v.stackedDoor=null;
          });
          u.stackedDoor.progress=0;
        }
        // else: keep waiting
      }
      continue;
    }

    // ── Proximity breach (non-stacked units only) ──
    if (u.wp.length>0 && !u.breachDoor && u.state!=='STACKED') {
      const d=nearDoor(u);
      if (d) { u.breachDoor=d; d.progress=0; continue; }
    }

    // ── Engage visible enemies ──
    u.shotCd=Math.max(0,u.shotCd-dt);
    let tgt=null, td=Infinity;
    for (const e of enemies) {
      if (e.state==='DEAD') continue;
      if (canSee(u.x,u.y,u.angle,u.fovA,u.fovR,e.x,e.y)) {
        const d2=(e.x-u.x)**2+(e.y-u.y)**2;
        if (d2<td) { td=d2; tgt=e; }
      }
    }
    if (tgt) {
      u.angle=Math.atan2(tgt.y-u.y,tgt.x-u.x);
      u.state='ENGAGING';
      if (u.shotCd<=0) {
        const a=Math.atan2(tgt.y-u.y,tgt.x-u.x);
        bullets.push({x:u.x,y:u.y,vx:Math.cos(a)*440,vy:Math.sin(a)*440,friendly:true,life:2});
        u.shotCd=u.SHOT;
      }
    } else if (u.wp.length>0) {
      const wp=u.wp[0];
      const dx=wp.x-u.x, dy=wp.y-u.y;
      const d=Math.sqrt(dx*dx+dy*dy);
      if (d<5) {
        if(wp.faceAngle!==undefined) u.angle=wp.faceAngle;
        if(wp.stackDoor && !wp.stackDoor.open) u.state='STACKED';
        u.wp.shift();
      } else {
        u.angle=Math.atan2(dy,dx);
        u.state='MOVING';
        const step=Math.min(u.speed*dt,d);
        const nx=u.x+(dx/d)*step, ny=u.y+(dy/d)*step;
        if      (!circleBlocked(nx,ny,u.r))  { u.x=nx; u.y=ny; }
        else if (!circleBlocked(nx,u.y,u.r)) { u.x=nx; }
        else if (!circleBlocked(u.x,ny,u.r)) { u.y=ny; }
      }
    } else { u.state='IDLE'; }
  }

  for (const e of enemies) e.update(dt,units);

  // Bullets
  const nxt=[];
  for (const b of bullets) {
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    if (b.life<=0||pointBlocked(b.x,b.y)) continue;
    let hit=false;
    if (b.friendly) {
      for (const e of enemies) {
        if (e.state==='DEAD') continue;
        if ((b.x-e.x)**2+(b.y-e.y)**2<e.r**2) {
          e.hp-=100; if(e.hp<=0){e.state='DEAD'; units.forEach(u=>u.kills++);}
          hit=true; break;
        }
      }
    } else {
      for (const u of units) {
        if (u.hp<=0) continue;
        if ((b.x-u.x)**2+(b.y-u.y)**2<u.r**2) {
          u.hp=Math.max(0,u.hp-22); hit=true;
          if(u.hp<=0&&gameState==='EXECUTING'){gameState='LOSE';updateStatusUI();}
          break;
        }
      }
    }
    if (!hit) nxt.push(b);
  }
  bullets=nxt;
  flashes=flashes.filter(f=>{f.t-=dt;return f.t>0;});

  if (gameState==='EXECUTING' && enemies.every(e=>e.state==='DEAD')) {
    gameState='WIN'; updateStatusUI(); return;
  }

  // ── End of turn: return to PLANNING after 1 second ──
  if (turnTimer >= TURN_DURATION) {
    // Consume 1 waypoint-segment's worth already moved; keep remainder
    units.forEach(u=>{ u.state='IDLE'; });
    gameState='PLANNING';
    updateStatusUI();
  }
}

// ── Render helpers ─────────────────────────────────────────────────────────
function fov(x,y,a,fovA,r,col,alpha=0.12) {
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(S(x),S(y));
  ctx.arc(S(x),S(y),S(r),a-fovA/2,a+fovA/2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Background
  ctx.fillStyle='#0c0e11';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // Floors
  for (const f of FLOORS) {
    ctx.fillStyle=f.col;
    ctx.fillRect(S(f.x),S(f.y),S(f.w),S(f.h));
    // Tile grid
    ctx.strokeStyle='rgba(255,255,255,0.028)';
    ctx.lineWidth=0.5;
    for(let x=f.x;x<f.x+f.w;x+=40){ctx.beginPath();ctx.moveTo(S(x),S(f.y));ctx.lineTo(S(x),S(f.y+f.h));ctx.stroke();}
    for(let y=f.y;y<f.y+f.h;y+=40){ctx.beginPath();ctx.moveTo(S(f.x),S(y));ctx.lineTo(S(f.x+f.w),S(y));ctx.stroke();}
    // Room label
    ctx.fillStyle='rgba(255,255,255,0.055)';
    ctx.font=`bold ${S(12)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(f.label,S(f.x+f.w/2),S(f.y+f.h/2));
  }

  // Walls
  for (const w of STATIC_WALLS) {
    ctx.fillStyle='#494e55';
    ctx.fillRect(S(w.x),S(w.y),S(w.w),S(w.h));
    ctx.fillStyle='rgba(255,255,255,0.07)';
    ctx.fillRect(S(w.x),S(w.y),S(w.w),S(2));
  }

  // Doors
  for (const d of DOORS) {
    if (d.open) {
      ctx.strokeStyle='rgba(100,65,30,0.35)';
      ctx.lineWidth=S(2);
      ctx.beginPath();
      ctx.moveTo(S(d.x),S(d.y+d.h/2));
      ctx.lineTo(S(d.x+d.w),S(d.y+d.h/2));
      ctx.stroke();
    } else {
      const a=1-d.progress*0.75;
      ctx.fillStyle=`rgba(101,67,33,${a})`;
      ctx.fillRect(S(d.x),S(d.y),S(d.w),S(d.h));
      ctx.strokeStyle=`rgba(180,110,50,${a})`;
      ctx.lineWidth=S(1.5);
      ctx.strokeRect(S(d.x),S(d.y),S(d.w),S(d.h));
      // Breach bar
      if (d.progress>0) {
        ctx.fillStyle='#1a1a1a';
        ctx.fillRect(S(d.x),S(d.y-7),S(d.w),S(5));
        ctx.fillStyle='#ff8800';
        ctx.fillRect(S(d.x),S(d.y-7),S(d.w)*d.progress,S(5));
      }
      // Door label
      ctx.fillStyle=`rgba(255,200,120,${a*0.85})`;
      ctx.font=`${S(9)}px monospace`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(d.id,S(d.x+d.w/2),S(d.y+d.h/2));
    }
  }

  // Stack-up command menu
  if (selectedDoor && gameState==='PLANNING' && selectedUnit) {
    // Highlight selected door
    ctx.strokeStyle='#ffcc00';
    ctx.lineWidth=S(2);
    ctx.strokeRect(S(selectedDoor.x)-S(2),S(selectedDoor.y)-S(3),S(selectedDoor.w)+S(4),S(selectedDoor.h)+S(6));

    const {left,right}=getStackPositions(selectedDoor);
    const uc=selectedUnit.color;
    for (const [pos,label] of [[left,'◀'],[right,'▶']]) {
      // Stack circle
      ctx.fillStyle=uc+'55';
      ctx.beginPath(); ctx.arc(S(pos.x),S(pos.y),S(20),0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=uc;
      ctx.lineWidth=S(2);
      ctx.setLineDash([S(4),S(3)]);
      ctx.beginPath(); ctx.arc(S(pos.x),S(pos.y),S(20),0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);

      // Arrow toward door
      ctx.strokeStyle='#fff';
      ctx.lineWidth=S(2); ctx.lineCap='round';
      const ax=Math.cos(pos.faceAngle)*S(10), ay=Math.sin(pos.faceAngle)*S(10);
      ctx.beginPath();
      ctx.moveTo(S(pos.x),S(pos.y));
      ctx.lineTo(S(pos.x)+ax,S(pos.y)+ay);
      ctx.stroke();

      // Label
      ctx.fillStyle='#fff';
      ctx.font=`bold ${S(11)}px monospace`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(label,S(pos.x),S(pos.y));

      // "STACK" tag above
      ctx.fillStyle='rgba(0,0,0,0.7)';
      ctx.fillRect(S(pos.x)-S(18),S(pos.y)-S(33),S(36),S(14));
      ctx.fillStyle=uc;
      ctx.font=`${S(9)}px monospace`;
      ctx.fillText('STACK',S(pos.x),S(pos.y)-S(26));
    }
  }

  // Debug patrol paths
  if (showDebug) {
    ctx.setLineDash([S(4),S(4)]);
    ctx.strokeStyle='rgba(255,60,60,0.18)';
    ctx.lineWidth=S(1);
    for (const e of enemies) {
      if(e.state==='DEAD') continue;
      ctx.beginPath();
      ctx.moveTo(S(e.patrol.x1),S(e.y));
      ctx.lineTo(S(e.patrol.x2),S(e.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Enemy FOV
  for (const e of enemies) {
    if(e.state==='DEAD') continue;
    fov(e.x,e.y,e.angle,e.fovA,e.fovR,'#ff3333',e.state==='ALERT'?0.2:0.11);
  }

  // Waypoint paths with 1-second interval markers
  for (const u of units) {
    if (u.wp.length===0) continue;
    const allPts=[{x:u.x,y:u.y},...u.wp];

    // Dashed path line
    ctx.strokeStyle=u.selected?u.color+'bb':'rgba(255,255,255,0.28)';
    ctx.lineWidth=S(2.5);
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.setLineDash([S(6),S(5)]);
    ctx.beginPath();
    allPts.forEach((p,i)=>i===0?ctx.moveTo(S(p.x),S(p.y)):ctx.lineTo(S(p.x),S(p.y)));
    ctx.stroke();
    ctx.setLineDash([]);

    // 1-second markers: walk the path accumulating distance,
    // place a ghost + label every u.speed px (= 1 second of travel)
    const interval = u.speed; // px per second
    let cumDist = 0;
    let nextMark = interval;
    let markSec  = 1;

    for (let i=0; i<allPts.length-1; i++) {
      const a=allPts[i], b=allPts[i+1];
      const seg=dist(a.x,a.y,b.x,b.y);
      const ang=Math.atan2(b.y-a.y,b.x-a.x);

      while (cumDist+seg >= nextMark) {
        const t=(nextMark-cumDist)/seg;
        const mx=a.x+(b.x-a.x)*t, my=a.y+(b.y-a.y)*t;

        // Ghost silhouette of the unit
        ctx.save();
        ctx.globalAlpha=0.28;
        ctx.fillStyle=u.color;
        ctx.beginPath(); ctx.arc(S(mx),S(my),S(u.r),0,Math.PI*2); ctx.fill();
        ctx.fillStyle='rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(S(mx),S(my),S(u.r*0.62),0,Math.PI*2); ctx.fill();
        // ghost direction arrow
        ctx.strokeStyle='rgba(255,255,255,0.7)';
        ctx.lineWidth=S(2); ctx.lineCap='round';
        ctx.beginPath();
        ctx.moveTo(S(mx),S(my));
        ctx.lineTo(S(mx+Math.cos(ang)*u.r*1.6),S(my+Math.sin(ang)*u.r*1.6));
        ctx.stroke();
        ctx.restore();

        // Time label badge
        ctx.save();
        const lbl=`${markSec}s`;
        ctx.font=`bold ${S(9)}px monospace`;
        const tw=ctx.measureText(lbl).width+S(6);
        const th=S(13);
        const bx=S(mx)+S(u.r*1.1), by=S(my)-th/2;
        ctx.fillStyle='rgba(0,0,0,0.75)';
        ctx.fillRect(bx,by,tw,th);
        ctx.fillStyle=u.color;
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(lbl,bx+S(3),S(my));
        ctx.restore();

        nextMark+=interval;
        markSec++;
      }
      cumDist+=seg;
    }

    // End marker (X)
    const last=u.wp[u.wp.length-1];
    ctx.strokeStyle=u.color;
    ctx.lineWidth=S(2);
    const rx=S(5);
    ctx.beginPath();
    ctx.moveTo(S(last.x)-rx,S(last.y)-rx); ctx.lineTo(S(last.x)+rx,S(last.y)+rx);
    ctx.moveTo(S(last.x)+rx,S(last.y)-rx); ctx.lineTo(S(last.x)-rx,S(last.y)+rx);
    ctx.stroke();
  }

  // Enemies — only draw if currently visible (or dead + was seen)
  for (const e of enemies) {
    if (e.state==='DEAD') {
      if (!wasSeen(e.x,e.y)) continue;
      ctx.save(); ctx.globalAlpha=0.22;
      ctx.fillStyle='#333';
      ctx.beginPath(); ctx.arc(S(e.x),S(e.y),S(e.r),0,Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }
    if (!isVisible(e.x,e.y)) continue;
    const col=e.state==='ALERT'?'#ff6600':e.state==='SEARCH'?'#ffaa00':'#cc2020';
    ctx.fillStyle=col;
    ctx.beginPath(); ctx.arc(S(e.x),S(e.y),S(e.r),0,Math.PI*2); ctx.fill();
    // Inner ring
    ctx.strokeStyle='rgba(0,0,0,0.4)';
    ctx.lineWidth=S(3);
    ctx.beginPath(); ctx.arc(S(e.x),S(e.y),S(e.r*0.5),0,Math.PI*2); ctx.stroke();
    // Direction
    ctx.strokeStyle='rgba(255,255,255,0.85)';
    ctx.lineWidth=S(2);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(S(e.x),S(e.y));
    ctx.lineTo(S(e.x+Math.cos(e.angle)*e.r*1.9),S(e.y+Math.sin(e.angle)*e.r*1.9));
    ctx.stroke();
    // Alert badge
    if (e.state!=='PATROL') {
      ctx.fillStyle=e.state==='ALERT'?'#ffcc00':'#ff9900';
      ctx.font=`bold ${S(13)}px monospace`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(e.state==='ALERT'?'!':'?',S(e.x),S(e.y-e.r-11));
    }
    // HP
    const bw=S(26),bh=S(3);
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(S(e.x)-bw/2,S(e.y-e.r-7),bw,bh);
    ctx.fillStyle='#cc2020'; ctx.fillRect(S(e.x)-bw/2,S(e.y-e.r-7),bw*e.hp/100,bh);
  }

  // Unit FOV
  for (const u of units) if(u.hp>0) fov(u.x,u.y,u.angle,u.fovA,u.fovR,u.color,0.13);

  // Units
  for (const u of units) {
    if (u.hp<=0) {
      ctx.save(); ctx.globalAlpha=0.25;
      ctx.fillStyle='#555';
      ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r),0,Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }
    // Selection ring
    if (u.selected) {
      ctx.strokeStyle='rgba(255,255,255,0.55)';
      ctx.lineWidth=S(1.5);
      ctx.setLineDash([S(4),S(3)]);
      ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r*1.6),0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Body
    const bc=u.state==='ENGAGING'?'#ffaa00':u.state==='BREACHING'?'#ff6600':u.color;
    ctx.fillStyle=bc;
    ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r),0,Math.PI*2); ctx.fill();
    // Vest
    ctx.fillStyle='rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r*0.62),0,Math.PI*2); ctx.fill();
    ctx.fillStyle=bc;
    ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r*0.28),0,Math.PI*2); ctx.fill();
    // Direction
    ctx.strokeStyle='#fff';
    ctx.lineWidth=S(2.5);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(S(u.x),S(u.y));
    ctx.lineTo(S(u.x+Math.cos(u.angle)*u.r*1.75),S(u.y+Math.sin(u.angle)*u.r*1.75));
    ctx.stroke();
    // ID
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.font=`bold ${S(8)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(u.id,S(u.x),S(u.y));
    // HP bar
    const bw=S(28),bh=S(4);
    ctx.fillStyle='#111'; ctx.fillRect(S(u.x)-bw/2,S(u.y+u.r+4),bw,bh);
    ctx.fillStyle=u.hp>50?'#00cc66':u.hp>25?'#ffaa00':'#ff4444';
    ctx.fillRect(S(u.x)-bw/2,S(u.y+u.r+4),bw*u.hp/100,bh);

    // STACKED: pulsing ring + WAIT badge
    if (u.state==='STACKED') {
      const pulse=0.55+0.45*Math.sin(Date.now()*0.005);
      ctx.save(); ctx.globalAlpha=pulse;
      ctx.strokeStyle='#ffcc00'; ctx.lineWidth=S(2);
      ctx.setLineDash([S(4),S(3)]);
      ctx.beginPath(); ctx.arc(S(u.x),S(u.y),S(u.r*1.9),0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle='rgba(0,0,0,0.75)';
      ctx.fillRect(S(u.x)-S(17),S(u.y-u.r-17),S(34),S(13));
      ctx.fillStyle='#ffcc00';
      ctx.font=`bold ${S(9)}px monospace`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('WAIT',S(u.x),S(u.y-u.r-11));
    }
  }

  // Bullets
  for (const b of bullets) {
    ctx.fillStyle=b.friendly?'#ffe844':'#ff6666';
    ctx.beginPath(); ctx.arc(S(b.x),S(b.y),S(b.friendly?2.5:2),0,Math.PI*2); ctx.fill();
    // Tracer
    ctx.strokeStyle=b.friendly?'rgba(255,230,0,0.35)':'rgba(255,80,80,0.35)';
    ctx.lineWidth=S(1);
    ctx.beginPath();
    ctx.moveTo(S(b.x),S(b.y));
    ctx.lineTo(S(b.x-b.vx*0.025),S(b.y-b.vy*0.025));
    ctx.stroke();
  }

  // Breach flash
  for (const f of flashes) {
    const a=f.t/0.45;
    const g=ctx.createRadialGradient(S(f.x),S(f.y),0,S(f.x),S(f.y),S(90));
    g.addColorStop(0,`rgba(255,200,80,${a*0.85})`);
    g.addColorStop(1,'rgba(255,80,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(S(f.x),S(f.y),S(90),0,Math.PI*2); ctx.fill();
  }

  // Fog of war overlay
  // 0=never seen: heavy dark (map shape barely visible)
  // 1=previously seen: light dim (map fully visible, no enemies)
  // 2=currently visible: no overlay
  for (let gy=0;gy<FROWS;gy++) {
    for (let gx=0;gx<FCOLS;gx++) {
      const s=fog[gy*FCOLS+gx];
      if (s===0) {
        ctx.fillStyle='rgba(0,0,0,0.62)';
        ctx.fillRect(gx*FC*SC,gy*FC*SC,FC*SC+1,FC*SC+1);
      } else if (s===1) {
        ctx.fillStyle='rgba(0,0,0,0.18)';
        ctx.fillRect(gx*FC*SC,gy*FC*SC,FC*SC+1,FC*SC+1);
      }
    }
  }

  // Debug panel
  if (showDebug) {
    const lines=[
      `FPS   ${fps}`,
      `State ${gameState}`,
      `Scale ${SC.toFixed(2)}`,
      `Kills ${enemies.filter(e=>e.state==='DEAD').length}/${enemies.length}`,
      `Shots ${bullets.length}`,
      `── U1 ──`,
      `  ${units[0].state}  HP:${units[0].hp}  WP:${units[0].wp.length}`,
      `── U2 ──`,
      `  ${units[1].state}  HP:${units[1].hp}  WP:${units[1].wp.length}`,
    ];
    ctx.fillStyle='rgba(0,0,0,0.85)';
    ctx.fillRect(S(4),S(4),S(195),lines.length*S(16)+S(10));
    ctx.fillStyle='#00ff88';
    ctx.font=`${S(10)}px monospace`;
    ctx.textAlign='left'; ctx.textBaseline='top';
    lines.forEach((l,i)=>ctx.fillText(l,S(9),S(7+i*16)));
  }

  // End overlay
  if (gameState==='WIN'||gameState==='LOSE') {
    ctx.fillStyle='rgba(0,0,0,0.72)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`bold ${S(30)}px monospace`;
    ctx.fillStyle=gameState==='WIN'?'#00ff88':'#ff5555';
    ctx.fillText(gameState==='WIN'?'MISSION COMPLETE':'MISSION FAILED',canvas.width/2,canvas.height/2);
    ctx.font=`${S(13)}px monospace`; ctx.fillStyle='#777';
    ctx.fillText('Tap RESET to play again',canvas.width/2,canvas.height/2+S(42));
  }

  // Turn progress bar (shown while EXECUTING)
  if (gameState==='EXECUTING') {
    const barH=S(6), barY=canvas.height-barH;
    const prog=turnTimer/TURN_DURATION;
    ctx.fillStyle='rgba(0,0,0,0.6)';
    ctx.fillRect(0,barY,canvas.width,barH);
    // Filled portion (shrinks as time passes)
    ctx.fillStyle='#ffaa00';
    ctx.fillRect(0,barY,canvas.width*(1-prog),barH);
    // Remaining time label
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.font=`${S(9)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText(`${(TURN_DURATION-turnTimer).toFixed(2)}s`, canvas.width/2, barY-S(1));
  }

  // Planning hint bar
  if (gameState==='PLANNING') {
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillRect(0,canvas.height-S(24),canvas.width,S(24));
    ctx.fillStyle='rgba(255,255,255,0.45)';
    ctx.font=`${S(9.5)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(
      `Unit ${selectedUnit?.id||1} selected — drag to draw path  |  tap unit to switch`,
      canvas.width/2, canvas.height-S(12)
    );
  }
}

// ── Buttons ────────────────────────────────────────────────────────────────
function updateStatusUI() {
  const el=document.getElementById('statusText');
  const m={
    PLANNING:  {t:`TURN ${turnCount+1}  PLAN`,  c:'#888'},
    EXECUTING: {t:`TURN ${turnCount}  GO`,       c:'#ffaa00'},
    WIN:       {t:'CLEAR ✓',                     c:'#00ff88'},
    LOSE:      {t:'KIA',                          c:'#ff5555'},
  };
  const s=m[gameState]||{t:gameState,c:'#888'};
  el.textContent=s.t; el.style.color=s.c;

  // Toggle EXECUTE button availability
  const btn=document.getElementById('btnExecute');
  btn.disabled = (gameState==='EXECUTING'||gameState==='WIN'||gameState==='LOSE');
  btn.style.opacity = btn.disabled ? '0.35' : '1';
}

document.getElementById('btnExecute').addEventListener('click',()=>{
  if(gameState==='PLANNING') {
    selectedDoor=null;
    turnTimer=0;
    turnCount++;
    gameState='EXECUTING';
    updateStatusUI();
  }
});
document.getElementById('btnClear').addEventListener('click',()=>{
  if(selectedUnit) {
    selectedUnit.wp=[];
    selectedUnit.stackedDoor=null;
    if(selectedUnit.state==='STACKED') selectedUnit.state='IDLE';
  }
});
document.getElementById('btnReset').addEventListener('click', initGame);
document.getElementById('btnDebug').addEventListener('click',()=>showDebug=!showDebug);

// ── Unit selector buttons ──────────────────────────────────────────────────
document.getElementById('btnUnit1').addEventListener('click',()=>selectUnit(units[0]));
document.getElementById('btnUnit2').addEventListener('click',()=>selectUnit(units[1]));

// ── Loop ───────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt=Math.min((ts-lastTime)/1000,0.05);
  lastTime=ts;
  update(dt);
  updateFog();
  render();
  requestAnimationFrame(loop);
}

resizeCanvas();
initGame();
requestAnimationFrame(ts=>{lastTime=ts;loop(ts);});
