/* Local player: input, pointer lock, movement, prediction, camera. */
const Player = {
  pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, crouch: false, sprint: false, grounded: true,
  hp: 100, armor: 25, alive: true, moving: false, firing: false,
  bobPhase: 0, swayX: 0, swayY: 0, keys: {}, lastStepAt: 0,
  team: 'ffa', pendingInputs: [], seq: 0,

  init() {
    const canvas = Renderer.renderer.domElement;
    canvas.addEventListener('click', () => { if (Game.playing && !UI.menuOpen) canvas.requestPointerLock(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const sens = UI.settings.sens * 0.00028 * (Weapons.adsT > 0.5 ? 0.5 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      this.swayX = THREE.MathUtils.clamp(e.movementX * 0.02, -1, 1);
      this.swayY = THREE.MathUtils.clamp(e.movementY * 0.02, -1, 1);
    });
    document.addEventListener('keydown', (e) => {
      if (UI.chatOpen) { if (e.code === 'Enter') UI.sendChat(); else if (e.code === 'Escape') UI.closeChat(); return; }
      this.keys[e.code] = true;
      switch (e.code) {
        case 'KeyR': Weapons.reload(); break;
        case 'Digit1': Weapons.switchTo(Weapons.loadout[0]); break;
        case 'Digit2': Weapons.switchTo(Weapons.loadout[1]); break;
        case 'Digit3': Weapons.switchTo('knife'); break;
        case 'Digit4': Weapons.switchTo('rocket'); break;
        case 'Digit5': Weapons.switchTo('minigun'); break;
        case 'KeyG': Weapons.startCook('frag'); break;
        case 'KeyF': Weapons.startCook('flash'); break;
        case 'KeyC': Weapons.startCook('smoke'); break;
        case 'KeyV': Weapons.startCook('molotov'); break;
        case 'KeyE': Net.send(PROTO.USE, {}); break;
        case 'KeyT': e.preventDefault(); UI.openChat(false); break;
        case 'KeyY': e.preventDefault(); UI.openChat(true); break;
        case 'Tab': e.preventDefault(); UI.showScoreboard(true); break;
        case 'Escape': break;
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Tab') UI.showScoreboard(false);
      if (['KeyG','KeyF','KeyC','KeyV'].includes(e.code)) Weapons.throwNade();
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) { this.firing = true; Weapons.tryFire(); }
      if (e.button === 2) Weapons.ads = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) Weapons.ads = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());
  },

  spawn(pos, team) {
    this.pos.set(pos[0], pos[1], pos[2]); this.vel.set(0,0,0);
    this.hp = 100; this.armor = 25; this.alive = true; this.team = team || this.team;
    Weapons.resetForSpawn();
    UI.updateHealth(this.hp, this.armor);
    UI.hideRespawn();
  },

  die(killerPos) {
    this.alive = false; this.firing = false;
    if (killerPos) this.deathCamTarget = new THREE.Vector3(...killerPos);
    this.deathTilt = 0;
  },

  update(dt) {
    if (!this.alive) {
      // death cam: tilt toward ground + look at killer
      this.deathTilt = Math.min(1, (this.deathTilt || 0) + dt * 0.7);
      Renderer.camera.position.set(this.pos.x, this.pos.y + 1.6 - this.deathTilt*1.1, this.pos.z);
      if (this.deathCamTarget) Renderer.camera.lookAt(this.deathCamTarget);
      Renderer.camera.rotation.z = this.deathTilt * 0.6;
      return;
    }
    const P = SHARED.PLAYER;
    this.crouch = !!this.keys['ControlLeft'];
    this.sprint = !!this.keys['ShiftLeft'] && !this.crouch && !Weapons.ads;
    const speed = this.crouch ? P.CROUCH_SPEED : this.sprint ? P.SPRINT : P.SPEED;
    // input direction (camera-relative)
    let ix = 0, iz = 0;
    if (this.keys['KeyW']) iz -= 1; if (this.keys['KeyS']) iz += 1;
    if (this.keys['KeyA']) ix -= 1; if (this.keys['KeyD']) ix += 1;
    const len = Math.hypot(ix, iz) || 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (ix*cos + iz*sin) / len * speed;
    const wz = (-ix*sin + iz*cos) / len * speed;
    // smooth accel
    const accel = this.grounded ? 12 : 3;
    this.vel.x += (wx - this.vel.x) * Math.min(1, accel*dt);
    this.vel.z += (wz - this.vel.z) * Math.min(1, accel*dt);
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    // jump / gravity
    if (this.keys['Space'] && this.grounded) { this.vel.y = P.JUMP; this.grounded = false; }
    this.vel.y -= P.GRAVITY * dt;
    const height = this.crouch ? P.CROUCH_HEIGHT : P.HEIGHT;
    const res = Physics.move(this.pos, this.vel, dt, height, P.RADIUS);
    this.grounded = res.grounded;
    // head bob + footsteps
    if (this.moving && this.grounded) {
      this.bobPhase += dt * (this.sprint ? 13 : 9);
      if (performance.now() - this.lastStepAt > (this.sprint ? 300 : 420)) {
        this.lastStepAt = performance.now();
        AudioSys.footstep(null, res.surface);
        Net.lastSurface = res.surface;
      }
    }
    this.swayX *= 0.85; this.swayY *= 0.85;
    // camera
    const eye = this.crouch ? P.CROUCH_EYE : P.EYE;
    const bobY = this.moving && this.grounded ? Math.abs(Math.sin(this.bobPhase)) * 0.05 * (1 - Weapons.adsT) : 0;
    Renderer.camera.position.set(this.pos.x, this.pos.y + eye + bobY, this.pos.z);
    Renderer.camera.rotation.set(0,0,0);
    Renderer.camera.rotation.order = 'YXZ';
    Renderer.camera.rotation.y = this.yaw;
    Renderer.camera.rotation.x = this.pitch;
    // sprint FOV boost (subtle motion feel)
    if (this.sprint && this.moving) Renderer.camera.fov = Math.min(Renderer.camera.fov + 20*dt, UI.settings.fov + 6);
  },

  /* server correction (anti-cheat snapback) */
  correct(pos) { this.pos.set(pos[0], pos[1], pos[2]); this.vel.set(0,0,0); }
};
