/* WebSocket client: connection, input stream, snapshot handling, ping. */
const Net = {
  ws:null, myId:0, connected:false, roster:{}, ping:0, _pingSeq:0, _pingSent:{},
  lastInputAt:0,

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host || 'localhost:3000';
    this.ws = new WebSocket(`${proto}://${host}`);
    this.ws.onopen = () => {
      this.connected = true;
      UI.setConnStatus('Connected');
      this.send(PROTO.HELLO, { name: UI.playerName() });
      setInterval(() => {
        const c = ++this._pingSeq;
        this._pingSent[c] = performance.now();
        this.send(PROTO.PING, { c, ping: this.ping });
      }, 2000);
    };
    this.ws.onclose = () => { this.connected = false; UI.setConnStatus('Disconnected — retrying…'); setTimeout(() => this.connect(), 2000); };
    this.ws.onerror = () => {};
    this.ws.onmessage = (ev) => {
      const m = PROTO.unpack(ev.data); if (!m) return;
      this.handle(m);
    };
  },

  send(t, d) { if (this.ws && this.ws.readyState === 1) this.ws.send(PROTO.pack(t, d)); },

  sendInput() {
    const now = performance.now();
    if (now - this.lastInputAt < 1000 / SHARED.INPUT_RATE) return;
    const dt = (now - this.lastInputAt) / 1000;
    this.lastInputAt = now;
    if (!Game.playing || !Player.alive) return;
    this.send(PROTO.INPUT, {
      x:+Player.pos.x.toFixed(3), y:+Player.pos.y.toFixed(3), z:+Player.pos.z.toFixed(3),
      yw:+Player.yaw.toFixed(3), pt:+Player.pitch.toFixed(3), cr:Player.crouch?1:0,
      w:Weapons.current, dt:+dt.toFixed(3)
    });
  },

  handle(m) {
    switch (m.t) {
      case PROTO.WELCOME: this.myId = m.id; break;
      case PROTO.PONG: {
        const sent = this._pingSent[m.c];
        if (sent) { this.ping = Math.round(performance.now() - sent); delete this._pingSent[m.c]; UI.setPing(this.ping); }
        break;
      }
      case PROTO.ROOMS: UI.showRooms(m.rooms); break;
      case PROTO.LOBBY: UI.showLobby(m); break;
      case PROTO.ERROR: UI.toast(m.msg); break;
      case PROTO.GAME_START: Game.start(m); break;
      case PROTO.SNAPSHOT:
        Entities.onSnapshot(m);
        GameModes.onSnapshot(m.g);
        break;
      case PROTO.RESPAWN: Player.spawn(m.pos, m.team); break;
      case PROTO.HIT_CONFIRM:
        UI.hitmarker(m.headshot);
        AudioSys.hitSound(m.headshot);
        if (m.killed) AudioSys.killSound();
        if (UI.settings.dmgNumbers) {
          const e = Entities.players.get(m.id);
          if (e) UI.damageNumber(e.mesh.position, m.dmg, m.headshot);
        }
        break;
      case PROTO.DAMAGED:
        if (m.hp < Player.hp) { AudioSys.damageSound(); UI.damageFlash(m.from); AudioSys.combatLevel = 1; }
        Player.hp = m.hp; Player.armor = m.armor;
        UI.updateHealth(m.hp, m.armor);
        break;
      case PROTO.KILL: {
        UI.killfeed(m);
        if (m.victim === this.myId) {
          Player.die(m.killerPos);
          if (SHARED.MODES[Game.mode].respawn) UI.showRespawn(SHARED.PLAYER.RESPAWN);
          else UI.centerMsg('Eliminated — spectating until next round', 3000);
        }
        const e = Entities.players.get(m.victim);
        if (e) { Effects.blood(e.mesh.position.clone().add(new THREE.Vector3(0,1,0))); e.alive = false; e.mesh.visible = false; }
        break;
      }
      case PROTO.EVENT: this.handleEvent(m); break;
      case PROTO.CHAT_MSG: UI.chatMsg(m); break;
      case PROTO.GAME_OVER: Game.end(m); break;
      case PROTO.PROJECTILE: Entities.addProjectile(m.id, m.kind, m.o, m.v); break;
      case PROTO.EXPLOSION: {
        Entities.removeProjectile(m.id);
        const pos = new THREE.Vector3(...m.pos);
        if (m.kind === 'flash') Effects.flashbang(pos);
        else if (m.kind === 'smoke') Effects.smoke(pos, SHARED.THROWABLES.smoke.duration);
        else if (m.kind === 'molotov') { Effects.molotovFire(pos, SHARED.THROWABLES.molotov.duration); Effects.explosion(pos); }
        else Effects.explosion(pos);
        break;
      }
      case PROTO.DESTROY: Maps.destroyBox(m.i); break;
    }
  },

  handleEvent(m) {
    switch (m.e) {
      case 'shot': {
        const e = Entities.players.get(m.id);
        const pos = e ? e.mesh.position.clone().add(new THREE.Vector3(0,1.4,0)) : new THREE.Vector3(...m.o);
        AudioSys.gunshot(m.w, pos, m.sup);
        Effects.muzzleFlash(pos);
        const d = new THREE.Vector3(...m.d);
        Effects.tracer(pos, pos.clone().addScaledVector(d, 40));
        AudioSys.combatLevel = Math.max(AudioSys.combatLevel, 0.6);
        break;
      }
      case 'reload': { const e = Entities.players.get(m.id); if (e) AudioSys.reloadSound(e.mesh.position); break; }
      case 'correct': Player.correct(m.pos); break;
      case 'leave': Entities.removePlayer(m.id); UI.toast(`${m.name} left`); break;
      default: GameModes.onEvent(m);
    }
  }
};
