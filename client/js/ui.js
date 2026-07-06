/* All DOM UI: menus, lobby, HUD, minimap, chat, scoreboard, settings. */
const UI = {
  settings: { fov:90, sens:8, vol:0.7, dist:200, xhair:'#00ff88', dmgNumbers:true, shadows:true },
  menuOpen:true, chatOpen:false, lobbyData:null, killTally:{},

  $(id) { return document.getElementById(id); },
  playerName() { return this.$('player-name').value.trim() || 'Player' + (Math.random()*999|0); },
  show(id) {
    ['menu','browser','create','lobby','settings','gameover'].forEach(s => this.$(s).classList.add('hidden'));
    if (id) { this.$(id).classList.remove('hidden'); this.menuOpen = true; }
    else this.menuOpen = false;
  },
  setConnStatus(s) { this.$('conn-status').textContent = s; },
  setPing(p) { this.$('ping-display').textContent = `${p} ms`; },
  toast(msg) { this.centerMsg(msg, 2500); },
  centerMsg(msg, ms) {
    const el = this.$('center-msg');
    el.textContent = msg;
    clearTimeout(this._cm);
    this._cm = setTimeout(() => el.textContent = '', ms || 2000);
  },

  init() {
    this.$('player-name').value = 'Player' + (Math.random()*999|0);
    this.$('btn-create').onclick = () => this.show('create');
    this.$('btn-browse').onclick = () => { this.show('browser'); Net.send(PROTO.LIST_ROOMS, {}); };
    this.$('btn-refresh').onclick = () => Net.send(PROTO.LIST_ROOMS, {});
    this.$('btn-join-code').onclick = () => {
      const code = prompt('Room code:'); if (code) { Net.send(PROTO.HELLO, { name:this.playerName() }); Net.send(PROTO.JOIN_ROOM, { code }); }
    };
    this.$('btn-settings').onclick = () => this.show('settings');
    ['btn-back-browse','btn-back-create','btn-back-settings'].forEach(b => this.$(b).onclick = () => this.show('menu'));
    this.$('btn-do-create').onclick = () => {
      Net.send(PROTO.HELLO, { name:this.playerName() });
      Net.send(PROTO.CREATE_ROOM, {
        name:this.$('c-name').value, mode:this.$('c-mode').value, map:this.$('c-map').value,
        killLimit:+this.$('c-kills').value, timeLimit:+this.$('c-time').value,
        friendlyFire:this.$('c-ff').checked, maxPlayers:+this.$('c-max').value
      });
    };
    this.$('btn-ready').onclick = () => { this._ready = !this._ready; Net.send(PROTO.SET_READY, { ready:this._ready }); this.$('btn-ready').textContent = this._ready ? 'UNREADY' : 'READY'; };
    this.$('btn-team-red').onclick = () => Net.send(PROTO.SET_TEAM, { team:'red' });
    this.$('btn-team-blue').onclick = () => Net.send(PROTO.SET_TEAM, { team:'blue' });
    this.$('btn-force-start').onclick = () => Net.send(PROTO.FORCE_START, {});
    this.$('btn-leave').onclick = () => { Net.send(PROTO.LEAVE_ROOM, {}); this.show('menu'); };
    this.$('btn-return-lobby').onclick = () => { this.show('lobby'); };
    // settings bindings
    const bind = (id, key, fn) => { this.$(id).oninput = (e) => { this.settings[key] = fn ? fn(e.target) : +e.target.value; this.applySettings(); }; };
    bind('s-fov','fov'); bind('s-sens','sens'); bind('s-dist','dist');
    bind('s-vol','vol', t => t.value/100);
    bind('s-xhair','xhair', t => t.value);
    bind('s-dmgnum','dmgNumbers', t => t.checked);
    bind('s-shadows','shadows', t => t.checked);
    this.minimapCtx = this.$('minimap-canvas').getContext('2d');
  },
  applySettings() {
    this.$('s-fov-v').textContent = this.settings.fov;
    Renderer.baseFov = this.settings.fov;
    if (!Weapons.ads) { Renderer.camera.fov = this.settings.fov; Renderer.camera.updateProjectionMatrix(); }
    Renderer.camera.far = this.settings.dist; Renderer.camera.updateProjectionMatrix();
    AudioSys.setVolume(this.settings.vol);
    document.documentElement.style.setProperty('--xhair', this.settings.xhair);
    Renderer.renderer.shadowMap.enabled = this.settings.shadows;
  },

  showRooms(rooms) {
    const el = this.$('room-list');
    el.innerHTML = rooms.length ? '' : '<div style="color:#666">No rooms — create one!</div>';
    rooms.forEach(r => {
      const d = document.createElement('div');
      d.className = 'room-row';
      d.innerHTML = `<span>${r.name}</span><span>${SHARED.MODES[r.mode].name} · ${r.map} · ${r.players}/${r.max} · ${r.state}</span>`;
      d.onclick = () => { Net.send(PROTO.HELLO, { name:this.playerName() }); Net.send(PROTO.JOIN_ROOM, { code:r.code }); };
      el.appendChild(d);
    });
  },

  showLobby(l) {
    this.lobbyData = l;
    Net.roster = {};
    l.players.forEach(p => Net.roster[p.id] = p);
    if (Game.playing && l.state === 'playing') return; // mid-game lobby update, ignore UI
    this.show('lobby');
    this.$('lobby-title').textContent = l.name;
    this.$('lobby-code').textContent = `CODE: ${l.code}`;
    const s = l.settings;
    this.$('lobby-settings').textContent =
      `${SHARED.MODES[s.mode].name} · ${s.map} · kill limit ${s.killLimit} · ${s.timeLimit}s · FF ${s.friendlyFire?'on':'off'}`;
    const teams = SHARED.MODES[s.mode].teams;
    const wrap = this.$('lobby-players'); wrap.innerHTML = '';
    const cols = teams ? { red:'RED', blue:'BLUE' } : { ffa:'PLAYERS' };
    for (const [team, label] of Object.entries(cols)) {
      const col = document.createElement('div');
      col.className = `team-col ${team}`;
      col.innerHTML = `<h3>${label}</h3>`;
      l.players.filter(p => teams ? p.team === team : true).forEach(p => {
        const row = document.createElement('div');
        row.className = 'lobby-player';
        row.innerHTML = `<span>${p.name}${p.id === l.hostId ? ' 👑' : ''}</span><span class="${p.ready?'rdy':''}">${p.ready?'READY':'…'}</span>`;
        if (Net.myId === l.hostId && p.id !== Net.myId) {
          const k = document.createElement('button'); k.textContent = '✕'; k.style.pointerEvents = 'auto';
          k.onclick = () => Net.send(PROTO.KICK, { id:p.id });
          row.appendChild(k);
        }
        col.appendChild(row);
      });
      wrap.appendChild(col);
    }
    this.$('btn-team-red').classList.toggle('hidden', !teams);
    this.$('btn-team-blue').classList.toggle('hidden', !teams);
    this.$('btn-force-start').classList.toggle('hidden', Net.myId !== l.hostId);
  },

  // ---- HUD ----
  showHUD(v) { this.$('hud').classList.toggle('hidden', !v); },
  updateHealth(hp, armor) {
    this.$('hp-fill').style.width = hp + '%';
    this.$('hp-fill').style.background = hp > 60 ? '#2ecc71' : hp > 30 ? '#f39c12' : '#e74c3c';
    this.$('armor-fill').style.width = armor + '%';
    this.$('hp-text').textContent = hp;
    this.$('vignette').style.opacity = hp < 35 ? (1 - hp/35) : 0;
  },
  updateAmmo() {
    const w = Weapons.def();
    this.$('weapon-name').textContent = w.name;
    this.$('ammo-text').textContent = w.melee ? '—' : `${Weapons.mags[Weapons.current]} / ${Weapons.reserves[Weapons.current]}`;
    const n = Weapons.nades;
    this.$('nade-row').textContent = `G:${n.frag} F:${n.flash} C:${n.smoke} V:${n.molotov}`;
  },
  hitmarker(head) {
    const el = this.$('hitmarker');
    el.classList.toggle('head', !!head);
    el.style.opacity = 1;
    clearTimeout(this._hm);
    this._hm = setTimeout(() => el.style.opacity = 0, 120);
  },
  damageFlash(from) {
    const v = this.$('vignette');
    v.style.opacity = 0.9;
    setTimeout(() => this.updateHealth(Player.hp, Player.armor), 250);
  },
  damageNumber(worldPos, dmg, head) {
    const v = worldPos.clone().add(new THREE.Vector3(0, 1.8, 0)).project(Renderer.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'dmg-num' + (head ? ' hs' : '');
    el.textContent = dmg;
    el.style.left = ((v.x*0.5+0.5) * innerWidth) + 'px';
    el.style.top = ((-v.y*0.5+0.5) * innerHeight) + 'px';
    this.$('damage-numbers').appendChild(el);
    setTimeout(() => el.remove(), 800);
  },
  killfeed(m) {
    const kn = m.attacker ? (Net.roster[m.attacker]?.name || '?') : '☠';
    const vn = Net.roster[m.victim]?.name || '?';
    const kt = Net.roster[m.attacker]?.team || 'ffa';
    const vt = Net.roster[m.victim]?.team || 'ffa';
    const div = document.createElement('div');
    div.innerHTML = `<span class="${kt}">${kn}</span> ${m.headshot ? '<span class="hs">☠HS</span>' : '🔫'} [${SHARED.WEAPONS[m.weapon]?.name || m.weapon}] <span class="${vt}">${vn}</span>`;
    const kf = this.$('killfeed');
    kf.prepend(div);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
    // tally for scoreboard
    if (m.attacker) { this.killTally[m.attacker] = this.killTally[m.attacker] || {k:0,d:0}; this.killTally[m.attacker].k++; }
    this.killTally[m.victim] = this.killTally[m.victim] || {k:0,d:0}; this.killTally[m.victim].d++;
  },
  showRespawn(sec) {
    const el = this.$('respawn-overlay');
    el.classList.remove('hidden');
    let left = sec;
    const tick = () => {
      this.$('respawn-text').textContent = `RESPAWNING IN ${left}…`;
      if (--left >= 0 && !Player.alive) this._rt = setTimeout(tick, 1000);
    };
    tick();
  },
  hideRespawn() { this.$('respawn-overlay').classList.add('hidden'); clearTimeout(this._rt); },
  setScope(on) {
    this.$('scope-overlay').classList.toggle('hidden', !on);
    this.$('crosshair').style.opacity = on ? 0 : 1;
    if (Weapons.viewmodel) Weapons.viewmodel.visible = !on;
  },

  // ---- chat ----
  openChat(teamOnly) {
    if (this.chatOpen || !Game.playing) return;
    this.chatOpen = true; this._chatTeam = teamOnly;
    document.exitPointerLock();
    const inp = this.$('chat-input');
    inp.classList.remove('hidden');
    inp.placeholder = teamOnly ? 'Team chat…' : 'All chat…';
    setTimeout(() => inp.focus(), 10);
  },
  sendChat() {
    const inp = this.$('chat-input');
    if (inp.value.trim()) Net.send(PROTO.CHAT, { msg:inp.value.trim(), teamOnly:this._chatTeam });
    this.closeChat();
  },
  closeChat() {
    this.chatOpen = false;
    const inp = this.$('chat-input');
    inp.value = ''; inp.classList.add('hidden'); inp.blur();
    Renderer.renderer.domElement.requestPointerLock();
  },
  chatMsg(m) {
    const div = document.createElement('div');
    const tc = m.team === 'red' ? '#ff8888' : m.team === 'blue' ? '#88aaff' : '#88ffbb';
    div.innerHTML = `<span style="color:${tc}">${m.from}${m.teamOnly?' [TEAM]':''}:</span> ${m.msg.replace(/</g,'&lt;')}`;
    const log = this.$('chat-log');
    log.appendChild(div);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => div.remove(), 12000);
  },

  // ---- scoreboard ----
  showScoreboard(v) {
    const el = this.$('scoreboard');
    el.classList.toggle('hidden', !v);
    if (!v) return;
    let rows = Object.entries(Net.roster).map(([id, p]) => {
      const t = this.killTally[id] || { k:0, d:0 };
      return { ...p, k:t.k, d:t.d };
    }).sort((a,b) => b.k - a.k);
    el.innerHTML = `<table><tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>K/D</th></tr>` +
      rows.map(r => `<tr class="${r.team}"><td>${r.name}${+r.id===Net.myId?' (you)':''}</td><td>${r.team}</td><td>${r.k}</td><td>${r.d}</td><td>${r.d?(r.k/r.d).toFixed(2):r.k}</td></tr>`).join('') + '</table>';
  },

  showGameOver(m) {
    this.show('gameover');
    this.$('go-title').textContent = m.winnerTeam ? `${m.winnerTeam.toUpperCase()} TEAM WINS!` :
      m.winnerPlayer ? `${Net.roster[m.winnerPlayer]?.name || 'Player'} WINS!` : 'DRAW';
    this.$('go-board').innerHTML =
      `<table><tr><th>Player</th><th>K</th><th>D</th><th>A</th><th>HS</th><th>Acc%</th><th>Dmg</th><th>XP</th><th>Lvl</th></tr>` +
      m.board.map(p => `<tr class="${p.id===m.mvp?'mvp':''}"><td>${p.id===m.mvp?'★ ':''}${p.name}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td><td>${p.headshots}</td><td>${p.acc}</td><td>${Math.round(p.dmg)}</td><td>${p.xp}</td><td>${p.level}</td></tr>`).join('') + '</table>';
  },

  // ---- minimap ----
  drawMinimap() {
    if (!Maps.current) return;
    const ctx = this.minimapCtx, S = 180, ms = Maps.current.size;
    const toMap = (x, z) => [ (x/ms + 0.5) * S, (z/ms + 0.5) * S ];
    ctx.clearRect(0,0,S,S);
    ctx.fillStyle = '#0d0d14cc'; ctx.fillRect(0,0,S,S);
    ctx.fillStyle = '#333';
    for (const b of Maps.current.boxes) {
      if (b.h < 1.5 || b.y > 4) continue;
      const [mx, mz] = toMap(b.x - b.w/2, b.z - b.d/2);
      ctx.fillRect(mx, mz, b.w/ms*S, b.d/ms*S);
    }
    // flags
    const g = GameModes.state;
    if (g && g.flags) for (const team of ['red','blue']) {
      const [fx, fz] = toMap(g.flags[team].pos[0], g.flags[team].pos[2]);
      ctx.fillStyle = team === 'red' ? '#ff4444' : '#4488ff';
      ctx.fillRect(fx-3, fz-3, 6, 6);
    }
    // bomb
    if (g && g.snd && g.snd.bomb && g.snd.bomb.planted) {
      const [bx, bz] = toMap(g.snd.bomb.pos[0], g.snd.bomb.pos[2]);
      ctx.fillStyle = '#ffd257'; ctx.beginPath(); ctx.arc(bx, bz, 4, 0, 7); ctx.fill();
    }
    // players
    for (const [id, e] of Entities.players) {
      if (!e.alive) continue;
      const isTeam = e.team === Player.team && e.team !== 'ffa';
      const dist = e.mesh.position.distanceTo(Player.pos);
      if (!isTeam && dist > 30) continue; // enemies only when close ("spotted")
      const [px, pz] = toMap(e.mesh.position.x, e.mesh.position.z);
      ctx.fillStyle = isTeam ? '#44ff88' : '#ff4444';
      ctx.beginPath(); ctx.arc(px, pz, 3, 0, 7); ctx.fill();
    }
    // self (with facing)
    const [sx, sz] = toMap(Player.pos.x, Player.pos.z);
    ctx.save(); ctx.translate(sx, sz); ctx.rotate(-Player.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(4,4); ctx.lineTo(-4,4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
};
