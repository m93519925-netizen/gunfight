/* FPS Multiplayer — authoritative server. Node.js + ws.
 * - Serves the client statically over HTTP (same port, 3000)
 * - 64Hz simulation, 32Hz snapshots, lag-compensated hitscan
 * - Rooms/lobbies, 4 game modes, anti-cheat validation
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const C = require('./shared/constants.js');
const P = require('./shared/protocol.js');

const PORT = process.env.PORT || 3000;
const TICK_MS = 1000 / C.TICK_RATE;

// ---------- static file server ----------
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json' };
const httpServer = http.createServer((req, res) => {
  let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
  const file = path.join(__dirname, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wss = new WebSocket.Server({ server: httpServer });
httpServer.listen(PORT, () => console.log(`[server] http+ws on :${PORT}`));

// ---------- state ----------
const rooms = new Map();   // code -> Room
const clients = new Map(); // ws -> Client
let nextId = 1;

function roomCode() { let s=''; for (let i=0;i<5;i++) s+='ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.random()*31|0]; return s; }
function send(ws, t, d) { if (ws.readyState === WebSocket.OPEN) ws.send(P.pack(t, d || {})); }
function bcast(room, t, d, except) { for (const c of room.players.values()) if (c !== except) send(c.ws, t, d); }

// ---------- geometry helpers ----------
function rayAABB(o, d, box) { // returns t or null
  const min = [box.x - box.w/2, box.y - box.h/2, box.z - box.d/2];
  const max = [box.x + box.w/2, box.y + box.h/2, box.z + box.d/2];
  let tmin = 0, tmax = 1e9;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return null; }
    else {
      let t1 = (min[i]-o[i])/d[i], t2 = (max[i]-o[i])/d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
function raySphere(o, d, c, r) {
  const oc = [o[0]-c[0], o[1]-c[1], o[2]-c[2]];
  const b = oc[0]*d[0]+oc[1]*d[1]+oc[2]*d[2];
  const cc = oc[0]*oc[0]+oc[1]*oc[1]+oc[2]*oc[2] - r*r;
  const disc = b*b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
const PENETRABLE = { wood: 0.55, glass: 0.85 }; // damage retained after pass-through

// ---------- Room ----------
class Room {
  constructor(host, opts) {
    this.code = roomCode();
    this.name = opts.name || `${host.name}'s room`;
    this.settings = {
      mode: opts.mode || 'tdm', map: opts.map || 'dustfall',
      killLimit: opts.killLimit || C.MODES[opts.mode || 'tdm'].killLimit || 30,
      timeLimit: opts.timeLimit || 600, friendlyFire: !!opts.friendlyFire,
      maxPlayers: Math.min(opts.maxPlayers || 16, 16)
    };
    this.hostId = host.id;
    this.players = new Map(); // id -> Client
    this.state = 'lobby';
    this.map = null; this.game = null; this.tick = 0;
    this.history = []; // lag comp: [{t, pos:{id:[x,y,z,crouch]}}]
    this.projectiles = []; this.nextProjId = 1;
    this.fires = []; // molotov areas
  }

  lobbyState() {
    return {
      code: this.code, name: this.name, settings: this.settings, hostId: this.hostId, state: this.state,
      players: [...this.players.values()].map(c => ({ id:c.id, name:c.name, team:c.team, ready:c.ready }))
    };
  }

  addPlayer(c) {
    this.players.set(c.id, c); c.room = this; c.ready = false;
    if (C.MODES[this.settings.mode].teams) {
      const red = [...this.players.values()].filter(p => p.team === 'red').length;
      const blue = [...this.players.values()].filter(p => p.team === 'blue').length;
      c.team = red <= blue ? 'red' : 'blue';
    } else c.team = 'ffa';
    if (this.state === 'playing') { this.spawnPlayer(c, true); send(c.ws, P.GAME_START, this.gameStartPayload()); }
    bcast(this, P.LOBBY, this.lobbyState());
  }

  removePlayer(c) {
    this.players.delete(c.id); c.room = null;
    if (this.game && this.game.flags) for (const t of ['red','blue'])
      if (this.game.flags[t].carrier === c.id) this.dropFlag(t, c.st ? [c.st.x, c.st.y, c.st.z] : null);
    if (this.players.size === 0) { rooms.delete(this.code); return; }
    if (this.hostId === c.id) this.hostId = this.players.keys().next().value;
    bcast(this, P.LOBBY, this.lobbyState());
    bcast(this, P.EVENT, { e:'leave', id:c.id, name:c.name });
  }

  // ---- match lifecycle ----
  start() {
    this.state = 'playing';
    this.map = C.buildMap(this.settings.map);
    this.boxState = this.map.boxes.map(b => ({ hp: b.hp, destroyed: false }));
    const mode = this.settings.mode;
    this.game = {
      mode, startTime: Date.now(), endTime: Date.now() + this.settings.timeLimit * 1000,
      scores: { red:0, blue:0 }, over: false
    };
    if (mode === 'ctf') this.game.flags = {
      red:  { atBase:true, carrier:null, pos:this.map.flags.red.slice() },
      blue: { atBase:true, carrier:null, pos:this.map.flags.blue.slice() }
    };
    if (mode === 'snd') { this.game.round = 0; this.startRound(); }
    for (const c of this.players.values()) { c.stats = { kills:0, deaths:0, assists:0, xp:0, headshots:0, dmg:0, caps:0, shots:0, hits:0 }; this.spawnPlayer(c); }
    bcast(this, P.GAME_START, this.gameStartPayload());
  }

  gameStartPayload() {
    return { settings: this.settings, map: this.settings.map, game: this.publicGame(),
      players: [...this.players.values()].map(c => ({ id:c.id, name:c.name, team:c.team })) };
  }

  publicGame() {
    const g = this.game; if (!g) return null;
    const out = { mode:g.mode, scores:g.scores, endTime:g.endTime, over:g.over };
    if (g.flags) out.flags = g.flags;
    if (g.mode === 'snd') out.snd = { round:g.round, roundEnd:g.roundEnd, bomb:g.bomb, planting:g.planting, defusing:g.defusing, roundScores:g.roundScores };
    return out;
  }

  startRound() {
    const g = this.game;
    g.round++; g.roundScores = g.roundScores || { red:0, blue:0 };
    g.bomb = null; g.planting = null; g.defusing = null;
    g.roundEnd = Date.now() + C.MODES.snd.roundTime * 1000;
    for (const c of this.players.values()) this.spawnPlayer(c);
    bcast(this, P.EVENT, { e:'round_start', round: g.round });
  }

  endRound(winner, reason) {
    const g = this.game;
    g.roundScores[winner]++;
    bcast(this, P.EVENT, { e:'round_end', winner, reason, roundScores: g.roundScores });
    if (g.roundScores[winner] > C.MODES.snd.rounds / 2 || g.round >= C.MODES.snd.rounds) this.endGame(winner);
    else setTimeout(() => { if (this.state === 'playing') this.startRound(); }, 5000);
  }

  spawnPlayer(c, spectateJoin) {
    const spawns = C.MODES[this.settings.mode].teams ? this.map.spawns[c.team] : this.map.spawns.ffa;
    const s = spawns[Math.random() * spawns.length | 0];
    c.st = {
      x: s[0] + (Math.random()-0.5), y: s[1] + 0.1, z: s[2] + (Math.random()-0.5),
      vy: 0, yaw: 0, pitch: 0, crouch: false,
      hp: C.PLAYER.HP, armor: 25, alive: true, lastDamageAt: 0, lastHitBy: null, assists: {},
      weapon: 'ak47', mags: {}, lastFireAt: 0, reloadUntil: 0
    };
    for (const w in C.WEAPONS) c.st.mags[w] = C.WEAPONS[w].mag;
    c.st.reserves = {}; for (const w in C.WEAPONS) c.st.reserves[w] = C.WEAPONS[w].reserve;
    c.st.nades = { frag: 2, flash: 2, smoke: 1, molotov: 1 };
    send(c.ws, P.RESPAWN, { pos: [c.st.x, c.st.y, c.st.z], team: c.team });
  }

  // ---- damage / kills ----
  applyDamage(victim, dmg, attacker, weapon, headshot) {
    if (!victim.st || !victim.st.alive || this.state !== 'playing') return;
    if (attacker && attacker !== victim && C.MODES[this.settings.mode].teams &&
        attacker.team === victim.team && !this.settings.friendlyFire) return;
    const st = victim.st;
    if (st.armor > 0) {
      const absorbed = Math.min(st.armor, dmg * C.PLAYER.ARMOR_ABSORB);
      st.armor -= absorbed; dmg -= absorbed;
    }
    st.hp -= dmg; st.lastDamageAt = Date.now();
    if (attacker && attacker !== victim) {
      st.lastHitBy = attacker.id; st.assists[attacker.id] = Date.now();
      attacker.stats.dmg += dmg;
      send(attacker.ws, P.HIT_CONFIRM, { id: victim.id, dmg: Math.round(dmg), headshot: !!headshot, killed: st.hp <= 0 });
    }
    send(victim.ws, P.DAMAGED, { hp: Math.max(0, Math.round(st.hp)), armor: Math.round(st.armor),
      from: attacker ? [attacker.st.x, attacker.st.y, attacker.st.z] : null });
    if (st.hp <= 0) this.kill(victim, attacker, weapon, headshot);
  }

  kill(victim, attacker, weapon, headshot) {
    const st = victim.st; st.alive = false; st.hp = 0;
    victim.stats.deaths++;
    let assistId = null;
    if (attacker && attacker !== victim) {
      attacker.stats.kills++; attacker.stats.xp += C.XP.kill + (headshot ? C.XP.headshot : 0);
      if (headshot) attacker.stats.headshots++;
      // assist: recent damager other than killer
      for (const [id, t] of Object.entries(st.assists))
        if (+id !== attacker.id && Date.now() - t < 8000) {
          const a = this.players.get(+id);
          if (a) { a.stats.assists++; a.stats.xp += C.XP.assist; assistId = a.id; }
        }
    }
    // drop flag
    if (this.game.flags) for (const t of ['red','blue'])
      if (this.game.flags[t].carrier === victim.id) this.dropFlag(t, [st.x, st.y, st.z]);
    bcast(this, P.KILL, { victim: victim.id, attacker: attacker ? attacker.id : null,
      weapon, headshot: !!headshot, assist: assistId, killerPos: attacker ? [attacker.st.x, attacker.st.y + C.PLAYER.EYE, attacker.st.z] : null });
    // scoring
    const g = this.game;
    if (g.mode === 'tdm' && attacker && attacker.team !== victim.team) {
      g.scores[attacker.team]++;
      if (g.scores[attacker.team] >= this.settings.killLimit) this.endGame(attacker.team);
    } else if (g.mode === 'ffa' && attacker && attacker !== victim) {
      if (attacker.stats.kills >= this.settings.killLimit) this.endGame(null, attacker);
    }
    if (g.mode === 'snd') this.checkRoundElim();
    else {
      victim.respawnAt = Date.now() + C.PLAYER.RESPAWN * 1000;
    }
  }

  checkRoundElim() {
    const alive = { red:0, blue:0 };
    for (const c of this.players.values()) if (c.st && c.st.alive) alive[c.team]++;
    const g = this.game;
    if (g.bomb && g.bomb.planted) { if (alive.blue === 0) this.endRound('red', 'elim'); } // red=attackers
    else if (alive.red === 0) this.endRound('blue', 'elim');
    else if (alive.blue === 0) this.endRound('red', 'elim');
  }

  dropFlag(team, pos) {
    const f = this.game.flags[team];
    f.carrier = null;
    if (pos) { f.pos = [pos[0], 0, pos[2]]; f.atBase = false; }
    else { f.pos = this.map.flags[team].slice(); f.atBase = true; }
    bcast(this, P.EVENT, { e:'flag_drop', team, pos: f.pos });
  }

  endGame(winnerTeam, winnerPlayer) {
    const g = this.game; g.over = true; this.state = 'lobby';
    for (const c of this.players.values()) {
      c.ready = false;
      if ((winnerTeam && c.team === winnerTeam) || (winnerPlayer && c === winnerPlayer)) c.stats.xp += C.XP.win;
    }
    const board = [...this.players.values()].map(c => ({
      id:c.id, name:c.name, team:c.team, ...c.stats,
      acc: c.stats.shots ? Math.round(100 * c.stats.hits / c.stats.shots) : 0,
      level: 1 + Math.floor(c.stats.xp / 1000)
    })).sort((a,b) => b.kills - a.kills);
    bcast(this, P.GAME_OVER, { winnerTeam, winnerPlayer: winnerPlayer ? winnerPlayer.id : null, board, mvp: board[0] ? board[0].id : null });
    setTimeout(() => bcast(this, P.LOBBY, this.lobbyState()), 100);
  }

  // ---- lag compensation ----
  recordHistory() {
    const pos = {};
    for (const c of this.players.values()) if (c.st && c.st.alive)
      pos[c.id] = [c.st.x, c.st.y, c.st.z, c.st.crouch ? 1 : 0];
    this.history.push({ t: Date.now(), pos });
    const cutoff = Date.now() - C.HISTORY_MS;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
  }
  rewind(t) {
    if (!this.history.length) return null;
    let best = this.history[0];
    for (const h of this.history) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
    return best.pos;
  }

  // ---- shooting (server-authoritative) ----
  handleFire(shooter, msg) {
    const st = shooter.st;
    if (!st || !st.alive || this.state !== 'playing') return;
    const w = C.WEAPONS[msg.w]; if (!w || msg.w !== st.weapon) return;
    const now = Date.now();
    // anti-cheat: fire rate (10% tolerance)
    if (now - st.lastFireAt < (60000 / w.rpm) * 0.9) return;
    if (now < st.reloadUntil) return;
    if (!w.melee) {
      if (st.mags[msg.w] <= 0) return;
      st.mags[msg.w]--;
    }
    st.lastFireAt = now;
    shooter.stats.shots += w.pellets || 1;
    // anti-cheat: origin must be near server position
    const o = msg.o, dir = msg.d;
    const dx = o[0]-st.x, dy = o[1]-(st.y+C.PLAYER.EYE), dz = o[2]-st.z;
    if (dx*dx + dy*dy + dz*dz > 9) return;
    const len = Math.hypot(dir[0],dir[1],dir[2]) || 1;
    const d = [dir[0]/len, dir[1]/len, dir[2]/len];

    bcast(this, P.EVENT, { e:'shot', id: shooter.id, w: msg.w, o, d, sup: !!msg.sup }, shooter);

    if (w.proj) { this.spawnProjectile(shooter, msg.w, o, d, w.proj); return; }
    if (w.melee) { this.doMelee(shooter, o, d, w); return; }

    // lag-compensated hitscan (per pellet)
    const rewindT = now - (shooter.ping / 2 || 0) - C.INTERP_DELAY;
    const past = this.rewind(rewindT);
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      let pd = d;
      if (pellets > 1) {
        const s = w.spread;
        pd = norm([d[0]+(Math.random()-0.5)*s*2, d[1]+(Math.random()-0.5)*s*2, d[2]+(Math.random()-0.5)*s*2]);
      }
      this.traceBullet(shooter, o, pd, w, past);
    }
  }

  traceBullet(shooter, o, d, w, past) {
    // gather wall hits (allow penetration through thin destructible/wood/glass)
    let dmgScale = 1, blockT = 1e9;
    const walls = [];
    this.map.boxes.forEach((box, i) => {
      if (this.boxState[i].destroyed) return;
      const t = rayAABB(o, d, box);
      if (t !== null && t > 0.01) walls.push({ t, box, i });
    });
    walls.sort((a,b) => a.t - b.t);
    for (const wl of walls) {
      const pen = PENETRABLE[wl.box.m];
      const thin = Math.min(wl.box.w, wl.box.h, wl.box.d) <= 2.2;
      if (pen && thin) {
        dmgScaleAt.push({ t: wl.t, scale: pen });
        if (wl.box.dest) this.damageBox(wl.i, w.dmg * 2, shooter);
      } else { blockT = wl.t; break; }
    }
    // player hits (from rewound history)
    let best = null;
    for (const c of this.players.values()) {
      if (c === shooter || !c.st || !c.st.alive) continue;
      let px = c.st.x, py = c.st.y, pz = c.st.z, cr = c.st.crouch;
      if (past && past[c.id]) { [px, py, pz] = past[c.id]; cr = !!past[c.id][3]; }
      const eye = cr ? C.PLAYER.CROUCH_EYE : C.PLAYER.EYE;
      const zones = [
        { name:'head',  c:[px, py + eye + 0.08, pz], r:0.19 },
        { name:'chest', c:[px, py + eye * 0.62, pz], r:0.42 },
        { name:'limbs', c:[px, py + 0.45, pz],       r:0.38 }
      ];
      for (const z of zones) {
        const t = raySphere(o, d, z.c, z.r);
        if (t !== null && t < blockT && (!best || t < best.t)) { best = { t, c, zone: z.name }; break; }
      }
    }
    if (best) {
      shooter.stats.hits++;
      const dist = best.t;
      let dmg = w.dmg * C.DMG_MULT[best.zone];
      // penetration damage reduction
      for (const wl of walls) if (wl.t < best.t && PENETRABLE[wl.box.m] && Math.min(wl.box.w,wl.box.h,wl.box.d) <= 2.2) dmg *= PENETRABLE[wl.box.m];
      // range dropoff
      if (dist > w.range && w.falloff > 0) dmg *= Math.max(0.3, 1 - (dist - w.range) / w.falloff);
      this.applyDamage(best.c, dmg, shooter, shooter.st.weapon, best.zone === 'head');
    } else if (blockT < 1e9) {
      // damage destructible on direct block hit
      const wl = walls.find(x => x.t === blockT);
      if (wl && wl.box.dest) this.damageBox(wl.i, w.dmg * 2, shooter);
    }
  }

  damageBox(i, dmg, attacker) {
    const bs = this.boxState[i];
    if (bs.destroyed) return;
    bs.hp -= dmg;
    if (bs.hp <= 0) { bs.destroyed = true; bcast(this, P.DESTROY, { i }); }
  }

  doMelee(shooter, o, d, w) {
    for (const c of this.players.values()) {
      if (c === shooter || !c.st || !c.st.alive) continue;
      const dx = c.st.x - shooter.st.x, dz = c.st.z - shooter.st.z;
      const dist = Math.hypot(dx, dz);
      if (dist > w.range) continue;
      const facing = (dx * d[0] + dz * d[2]) / (dist || 1);
      if (facing < 0.5) continue;
      // backstab: victim facing away from shooter
      const vfx = -Math.sin(c.st.yaw), vfz = -Math.cos(c.st.yaw);
      const back = (dx * vfx + dz * vfz) / (dist || 1) > 0.4;
      this.applyDamage(c, back ? w.backstab : w.dmg, shooter, 'knife', false);
      return;
    }
  }

  // ---- projectiles & throwables ----
  spawnProjectile(owner, kind, o, d, spec, extra) {
    const p = {
      id: this.nextProjId++, owner: owner.id, kind,
      x:o[0], y:o[1], z:o[2],
      vx:d[0]*spec.speed, vy:d[1]*spec.speed, vz:d[2]*spec.speed,
      grav: spec.grav, splash: spec.splash, splashDmg: spec.splashDmg,
      fuse: spec.fuse !== undefined ? Date.now() + spec.fuse*1000 : null,
      bounce: !!spec.bounce, flash: !!spec.flash, smoke: !!spec.smoke, fire: !!spec.fire,
      duration: spec.duration, contact: spec.fuse === undefined || kind === 'rocket' || (kind === 'gl' && !spec.bounce)
    };
    if (kind === 'rocket') { p.contact = true; p.fuse = null; }
    if (kind === 'molotov') { p.contact = true; }
    if (extra) Object.assign(p, extra);
    this.projectiles.push(p);
    bcast(this, P.PROJECTILE, { id:p.id, kind, o, v:[p.vx,p.vy,p.vz], owner: owner.id });
  }

  handleThrow(c, msg) {
    const st = c.st; if (!st || !st.alive) return;
    const spec = C.THROWABLES[msg.k]; if (!spec) return;
    if (!st.nades[msg.k] || st.nades[msg.k] <= 0) return;
    st.nades[msg.k]--;
    const len = Math.hypot(...msg.d) || 1;
    const d = msg.d.map(v => v / len);
    const spd = spec.speed * Math.min(1, Math.max(0.3, msg.power || 1));
    this.spawnProjectile(c, msg.k, msg.o, d, Object.assign({}, spec, { speed: spd }),
      spec.cookable && msg.cooked ? { fuse: Date.now() + Math.max(200, spec.fuse*1000 - msg.cooked) } : null);
  }

  tickProjectiles(dt) {
    const now = Date.now();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vy -= p.grav * dt;
      const nx = p.x + p.vx*dt, ny = p.y + p.vy*dt, nz = p.z + p.vz*dt;
      // collide with world boxes
      let hit = false;
      for (let bi = 0; bi < this.map.boxes.length; bi++) {
        if (this.boxState[bi].destroyed) continue;
        const b = this.map.boxes[bi];
        if (Math.abs(nx-b.x) < b.w/2+0.1 && Math.abs(ny-b.y) < b.h/2+0.1 && Math.abs(nz-b.z) < b.d/2+0.1) { hit = true; break; }
      }
      // player direct hits for rockets/GL
      if (!hit && p.contact) for (const c of this.players.values()) {
        if (c.id === p.owner || !c.st || !c.st.alive) continue;
        if (Math.hypot(nx-c.st.x, ny-(c.st.y+1), nz-c.st.z) < 0.7) { hit = true; break; }
      }
      if (hit && p.bounce && !p.contact) {
        p.vx *= -0.4; p.vz *= -0.4; p.vy = Math.abs(p.vy) * 0.4; // simple bounce
      } else if (hit && p.contact) { this.detonate(p); this.projectiles.splice(i,1); continue; }
      else { p.x = nx; p.y = ny; p.z = nz; }
      if (hit && !p.contact && !p.bounce) { p.vx = p.vz = 0; p.vy = 0; }
      if (p.fuse && now >= p.fuse) { this.detonate(p); this.projectiles.splice(i,1); continue; }
      if (p.y < -20) this.projectiles.splice(i,1);
    }
    // molotov fire areas
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (now > f.until) { this.fires.splice(i,1); continue; }
      for (const c of this.players.values())
        if (c.st && c.st.alive && Math.hypot(c.st.x-f.x, c.st.z-f.z) < f.r && Math.abs(c.st.y-f.y) < 2.5)
          this.applyDamage(c, f.dps * dt, this.players.get(f.owner) || null, 'molotov');
    }
  }

  detonate(p) {
    bcast(this, P.EXPLOSION, { id:p.id, kind:p.kind, pos:[p.x,p.y,p.z], r:p.splash });
    const owner = this.players.get(p.owner);
    if (p.flash) return; // client handles blinding based on LOS/distance
    if (p.smoke) return;
    if (p.fire) { this.fires.push({ x:p.x, y:p.y, z:p.z, r:p.splash, dps:C.THROWABLES.molotov.dps, until:Date.now()+p.duration*1000, owner:p.owner }); return; }
    // splash damage (with dropoff)
    for (const c of this.players.values()) {
      if (!c.st || !c.st.alive) continue;
      const dist = Math.hypot(c.st.x-p.x, c.st.y+1-p.y, c.st.z-p.z);
      if (dist < p.splash) this.applyDamage(c, p.splashDmg * (1 - dist/p.splash), owner, p.kind);
    }
    // destroy nearby destructible cover
    this.map.boxes.forEach((b, i) => {
      if (!b.dest || this.boxState[i].destroyed) return;
      if (Math.hypot(b.x-p.x, b.y-p.y, b.z-p.z) < p.splash + 1) this.damageBox(i, 999, owner);
    });
  }

  // ---- objectives ----
  tickObjectives() {
    const g = this.game; if (!g || g.over) return;
    const now = Date.now();
    if (g.mode !== 'snd' && now > g.endTime) {
      if (g.mode === 'ffa') { let top = null; for (const c of this.players.values()) if (!top || c.stats.kills > top.stats.kills) top = c; this.endGame(null, top); }
      else this.endGame(g.scores.red === g.scores.blue ? null : (g.scores.red > g.scores.blue ? 'red' : 'blue'));
      return;
    }
    if (g.mode === 'ctf') this.tickCTF();
    if (g.mode === 'snd') this.tickSND(now);
  }

  tickCTF() {
    const g = this.game;
    for (const c of this.players.values()) {
      if (!c.st || !c.st.alive) continue;
      for (const team of ['red','blue']) {
        const f = g.flags[team];
        // pick up enemy flag
        if (c.team !== team && !f.carrier && Math.hypot(c.st.x-f.pos[0], c.st.z-f.pos[2]) < 2) {
          f.carrier = c.id; f.atBase = false;
          bcast(this, P.EVENT, { e:'flag_taken', team, by:c.id, name:c.name });
        }
        // return own flag
        if (c.team === team && !f.atBase && !f.carrier && Math.hypot(c.st.x-f.pos[0], c.st.z-f.pos[2]) < 2) {
          f.atBase = true; f.pos = this.map.flags[team].slice();
          bcast(this, P.EVENT, { e:'flag_return', team });
        }
      }
      // capture: carrying enemy flag at own base while own flag is home
      const enemy = c.team === 'red' ? 'blue' : 'red';
      const ef = g.flags[enemy], of_ = g.flags[c.team];
      if (ef.carrier === c.id && of_.atBase) {
        const base = this.map.flags[c.team];
        if (Math.hypot(c.st.x-base[0], c.st.z-base[2]) < 3) {
          ef.carrier = null; ef.atBase = true; ef.pos = this.map.flags[enemy].slice();
          g.scores[c.team]++; c.stats.caps++; c.stats.xp += C.XP.capture;
          bcast(this, P.EVENT, { e:'flag_cap', team:c.team, by:c.id, name:c.name, scores:g.scores });
          if (g.scores[c.team] >= (this.settings.capLimit || C.MODES.ctf.capLimit)) this.endGame(c.team);
        }
      }
      // update carried flag position
      for (const team of ['red','blue']) if (g.flags[team].carrier === c.id) g.flags[team].pos = [c.st.x, c.st.y, c.st.z];
    }
  }

  tickSND(now) {
    const g = this.game;
    if (g.bomb && g.bomb.planted) {
      if (now > g.bomb.detonateAt) { this.detonate({ x:g.bomb.pos[0], y:g.bomb.pos[1], z:g.bomb.pos[2], splash:12, splashDmg:200, kind:'bomb', owner:0 }); this.endRound('red','bomb'); return; }
      if (g.defusing) {
        const d = this.players.get(g.defusing.id);
        if (!d || !d.st.alive || Math.hypot(d.st.x-g.bomb.pos[0], d.st.z-g.bomb.pos[2]) > 2.5) g.defusing = null;
        else if (now > g.defusing.doneAt) { d.stats.xp += C.XP.defuse; this.endRound('blue','defuse'); return; }
      }
    } else if (g.planting) {
      const p = this.players.get(g.planting.id);
      if (!p || !p.st.alive) g.planting = null;
      else if (now > g.planting.doneAt) {
        g.bomb = { planted:true, pos:[p.st.x, p.st.y, p.st.z], detonateAt: now + C.MODES.snd.bombTimer*1000, site:g.planting.site };
        g.planting = null; p.stats.xp += C.XP.plant;
        bcast(this, P.EVENT, { e:'bomb_planted', site:g.bomb.site, by:p.name });
      }
    }
    if (!g.bomb && now > g.roundEnd) this.endRound('blue', 'time');
  }

  handleUse(c) { // E key: plant / defuse
    const g = this.game;
    if (!g || g.mode !== 'snd' || !c.st || !c.st.alive) return;
    const now = Date.now();
    if (g.bomb && g.bomb.planted && c.team === 'blue') {
      if (Math.hypot(c.st.x-g.bomb.pos[0], c.st.z-g.bomb.pos[2]) < 2.5 && !g.defusing) {
        g.defusing = { id:c.id, doneAt: now + C.MODES.snd.defuse*1000 };
        bcast(this, P.EVENT, { e:'defusing', by:c.name });
      }
    } else if (!g.bomb && c.team === 'red' && !g.planting) {
      for (const [site, pos] of Object.entries(this.map.sites))
        if (Math.hypot(c.st.x-pos[0], c.st.z-pos[2]) < 6) {
          g.planting = { id:c.id, site, doneAt: now + C.MODES.snd.plantAction*1000 };
          bcast(this, P.EVENT, { e:'planting', by:c.name, site });
          break;
        }
    }
  }

  // ---- main tick ----
  update(dt) {
    this.tick++;
    if (this.state !== 'playing') return;
    const now = Date.now();
    for (const c of this.players.values()) {
      const st = c.st; if (!st) continue;
      // respawn
      if (!st.alive && c.respawnAt && now >= c.respawnAt && C.MODES[this.settings.mode].respawn) { c.respawnAt = 0; this.spawnPlayer(c); }
      // regen
      if (st.alive && st.hp < C.PLAYER.REGEN_TO && now - st.lastDamageAt > C.PLAYER.REGEN_DELAY*1000) {
        st.hp = Math.min(C.PLAYER.REGEN_TO, st.hp + C.PLAYER.REGEN_RATE*dt);
        if ((this.tick & 15) === 0) send(c.ws, P.DAMAGED, { hp: Math.round(st.hp), armor: Math.round(st.armor) });
      }
    }
    this.tickProjectiles(dt);
    this.tickObjectives();
    this.recordHistory();
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  broadcastSnapshot() {
    const players = [];
    for (const c of this.players.values()) {
      if (!c.st) continue;
      players.push({ id:c.id, x:+c.st.x.toFixed(2), y:+c.st.y.toFixed(2), z:+c.st.z.toFixed(2),
        yw:+c.st.yaw.toFixed(2), pt:+c.st.pitch.toFixed(2), cr:c.st.crouch?1:0, a:c.st.alive?1:0,
        w:c.st.weapon, hp:Math.round(c.st.hp) });
    }
    const snap = { ts: Date.now(), p: players, g: this.publicGame() };
    // interest management: send full nearby detail; others get coarse (still small w/ JSON)
    for (const c of this.players.values()) send(c.ws, P.SNAPSHOT, snap);
  }

  handleInput(c, m) {
    const st = c.st; if (!st || !st.alive) return;
    // anti-cheat: clamp displacement per input frame
    const maxD = C.PLAYER.SPRINT * (m.dt || 0.033) * 1.6 + 0.5;
    const dx = m.x - st.x, dz = m.z - st.z;
    const d = Math.hypot(dx, dz);
    if (d > maxD) { // snap back, notify
      send(c.ws, P.EVENT, { e:'correct', pos:[st.x, st.y, st.z] });
      return;
    }
    st.x = m.x; st.y = m.y; st.z = m.z;
    st.yaw = m.yw; st.pitch = m.pt; st.crouch = !!m.cr;
    if (m.w && C.WEAPONS[m.w]) st.weapon = m.w;
  }
}

function norm(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
var dmgScaleAt = []; // scratch (per-trace)

// ---------- connection handling ----------
wss.on('connection', (ws) => {
  const client = { id: nextId++, ws, name: 'Player', room: null, ready: false, team: 'ffa', ping: 0, st: null, stats: null, respawnAt: 0 };
  clients.set(ws, client);
  send(ws, P.WELCOME, { id: client.id });

  ws.on('message', (raw) => {
    const m = P.unpack(raw.toString()); if (!m) return;
    const r = client.room;
    try {
      switch (m.t) {
        case P.HELLO: client.name = String(m.name || 'Player').slice(0, 16); break;
        case P.PING: client.ping = m.ping || 0; send(ws, P.PONG, { c: m.c }); break;
        case P.LIST_ROOMS:
          send(ws, P.ROOMS, { rooms: [...rooms.values()].map(r => ({ code:r.code, name:r.name, mode:r.settings.mode, map:r.settings.map, players:r.players.size, max:r.settings.maxPlayers, state:r.state })) });
          break;
        case P.CREATE_ROOM: {
          if (r) r.removePlayer(client);
          const room = new Room(client, m);
          rooms.set(room.code, room);
          room.addPlayer(client);
          break;
        }
        case P.JOIN_ROOM: {
          const room = rooms.get((m.code || '').toUpperCase());
          if (!room) { send(ws, P.ERROR, { msg: 'Room not found' }); break; }
          if (room.players.size >= room.settings.maxPlayers) { send(ws, P.ERROR, { msg: 'Room full' }); break; }
          if (r) r.removePlayer(client);
          room.addPlayer(client);
          break;
        }
        case P.LEAVE_ROOM: if (r) r.removePlayer(client); break;
        case P.SET_READY: if (r) { client.ready = !!m.ready; bcast(r, P.LOBBY, r.lobbyState());
          if (r.state === 'lobby' && [...r.players.values()].every(p => p.ready) && r.players.size >= 1) r.start(); } break;
        case P.SET_TEAM: if (r && ['red','blue'].includes(m.team)) { client.team = m.team; bcast(r, P.LOBBY, r.lobbyState()); } break;
        case P.SET_SETTINGS: if (r && client.id === r.hostId && r.state === 'lobby') { Object.assign(r.settings, {
            mode: C.MODES[m.mode] ? m.mode : r.settings.mode, map: C.MAP_NAMES.includes(m.map) ? m.map : r.settings.map,
            killLimit: m.killLimit|0 || r.settings.killLimit, timeLimit: m.timeLimit|0 || r.settings.timeLimit,
            friendlyFire: m.friendlyFire !== undefined ? !!m.friendlyFire : r.settings.friendlyFire
          }); bcast(r, P.LOBBY, r.lobbyState()); } break;
        case P.KICK: if (r && client.id === r.hostId) { const k = r.players.get(m.id); if (k) { send(k.ws, P.ERROR, { msg:'Kicked by host' }); r.removePlayer(k); } } break;
        case P.FORCE_START: if (r && client.id === r.hostId && r.state === 'lobby') r.start(); break;
        case P.INPUT: if (r && r.state === 'playing') r.handleInput(client, m); break;
        case P.FIRE: if (r && r.state === 'playing') r.handleFire(client, m); break;
        case P.RELOAD: if (r && client.st) {
          const w = C.WEAPONS[client.st.weapon];
          if (w && client.st.reserves[client.st.weapon] > 0 && client.st.mags[client.st.weapon] < w.mag) {
            client.st.reloadUntil = Date.now() + w.reload * 1000;
            setTimeout(() => { if (!client.st) return;
              const need = w.mag - client.st.mags[client.st.weapon];
              const take = Math.min(need, client.st.reserves[client.st.weapon]);
              client.st.mags[client.st.weapon] += take; client.st.reserves[client.st.weapon] -= take;
            }, w.reload * 1000);
          }
          bcast(r, P.EVENT, { e:'reload', id: client.id }, client);
        } break;
        case P.THROW: if (r && r.state === 'playing') r.handleThrow(client, m); break;
        case P.USE: if (r && r.state === 'playing') r.handleUse(client); break;
        case P.CHAT: if (r) {
          const payload = { from: client.name, id: client.id, team: client.team, msg: String(m.msg||'').slice(0,120), teamOnly: !!m.teamOnly };
          for (const c of r.players.values())
            if (!m.teamOnly || c.team === client.team) send(c.ws, P.CHAT_MSG, payload);
        } break;
      }
    } catch (e) { console.error('[msg error]', e); }
  });

  ws.on('close', () => { if (client.room) client.room.removePlayer(client); clients.delete(ws); });
});

// ---------- main loop ----------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) room.update(dt);
}, TICK_MS);
