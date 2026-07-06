/* Weapon systems: viewmodels, firing, recoil, ADS, reload, throwables. */
const Weapons = {
  current:'ak47', mags:{}, reserves:{}, nades:{ frag:2, flash:2, smoke:1, molotov:1 },
  lastFire:0, reloading:false, reloadEnd:0, ads:false, adsT:0,
  recoilPitch:0, recoilYaw:0, viewmodel:null, vmParts:{}, spinup:0,
  cooking:null, loadout:['ak47','deagle','knife'],

  init() {
    for (const w in SHARED.WEAPONS) { this.mags[w] = SHARED.WEAPONS[w].mag; this.reserves[w] = SHARED.WEAPONS[w].reserve; }
    this.buildViewmodel(this.current);
  },
  def() { return SHARED.WEAPONS[this.current]; },

  /* ---- low-poly procedural viewmodels ---- */
  buildViewmodel(name) {
    if (this.viewmodel) Renderer.weaponScene.remove(this.viewmodel);
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color:0x2a2a2e });
    const wood = new THREE.MeshLambertMaterial({ color:0x6b4a2b });
    const metal = new THREE.MeshLambertMaterial({ color:0x55555f });
    const box = (w,h,d,m,x,y,z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), m); b.position.set(x,y,z); g.add(b); return b; };
    const W = SHARED.WEAPONS[name];
    if (W.melee) {
      box(0.02,0.04,0.28,metal, 0,0,-0.2);            // blade
      box(0.03,0.05,0.1,dark, 0,0,0);                 // handle
    } else if (name === 'rocket' || name === 'gl') {
      box(0.09,0.09,0.7,dark, 0,0,-0.25);
      box(0.11,0.11,0.15,metal, 0,0,-0.55);
    } else if (name === 'minigun') {
      for (let i = 0; i < 6; i++) { const a=i/6*Math.PI*2; box(0.02,0.02,0.5,metal, Math.cos(a)*0.04, Math.sin(a)*0.04, -0.35); }
      box(0.12,0.14,0.3,dark, 0,-0.02,0);
    } else {
      const long = ['bolt','semisnp','scarh','ak47','m4a1'].includes(name);
      box(0.05,0.07,long?0.55:0.4, name==='ak47'?wood:dark, 0,0,-0.2);   // body
      box(0.022,0.022,long?0.35:0.22, metal, 0,0.01,-(long?0.62:0.45));  // barrel
      box(0.04,0.1,0.06, dark, 0,-0.07,0.02);                             // grip
      this.vmParts.mag = box(0.035,0.11,0.05, metal, 0,-0.08,-0.12);      // magazine
      if (W.zoom > 2) box(0.03,0.04,0.12, dark, 0,0.06,-0.15);            // scope
    }
    g.position.set(0.25, -0.22, -0.5);
    this.viewmodel = g;
    Renderer.weaponScene.add(g);
    UI.updateAmmo();
  },

  switchTo(name) {
    if (name === this.current || this.reloading) return;
    this.current = name; this.ads = false; this.spinup = 0;
    this.buildViewmodel(name);
    Net.send(PROTO.SWITCH, { w:name });
  },

  canFire() {
    const w = this.def(), now = performance.now();
    if (this.reloading || !Player.alive || UI.menuOpen) return false;
    if (now - this.lastFire < 60000 / w.rpm) return false;
    if (w.spinup && this.spinup < w.spinup) return false;
    if (!w.melee && this.mags[this.current] <= 0) { AudioSys.emptyClick(); this.reload(); return false; }
    return true;
  },

  tryFire() {
    if (!this.canFire()) return;
    const w = this.def();
    this.lastFire = performance.now();
    if (!w.melee) this.mags[this.current]--;
    // direction with spread (from camera)
    const spread = w.spread * (this.ads ? w.ads : 1) * (Player.moving ? 1.6 : 1) * (Player.crouch ? 0.7 : 1);
    const dir = new THREE.Vector3(0,0,-1).applyQuaternion(Renderer.camera.quaternion);
    dir.x += (Math.random()-0.5)*spread*2; dir.y += (Math.random()-0.5)*spread*2; dir.z += (Math.random()-0.5)*spread*2;
    dir.normalize();
    const origin = Renderer.camera.position.clone();
    // recoil
    this.recoilPitch += w.recoil[0]; this.recoilYaw += (Math.random()-0.5)*w.recoil[1]*2;
    // viewmodel kick
    if (this.viewmodel) this.viewmodel.position.z += 0.06;
    // vfx / sfx
    const muzzle = origin.clone().addScaledVector(dir, 0.8);
    Effects.muzzleFlash(muzzle);
    AudioSys.gunshot(this.current, null, w.suppressor && this.suppressed);
    Effects.shellEject(muzzle, dir);
    if (w.melee) { AudioSys._tone(AudioSys.sfx,{freq:300,dur:0.08,gain:0.2,type:'sawtooth'}); }
    else {
      // client-side tracer to first wall hit (visual only; server decides damage)
      const pellets = w.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        let pd = dir.clone();
        if (pellets > 1) { pd.x+=(Math.random()-0.5)*w.spread*2; pd.y+=(Math.random()-0.5)*w.spread*2; pd.normalize(); }
        const hit = Physics.raycast(origin, pd, 200);
        const end = origin.clone().addScaledVector(pd, hit ? hit.t : 150);
        if (!w.proj) Effects.tracer(muzzle, end);
        if (hit) Effects.impact(end, hit.mat);
      }
    }
    Renderer.addShake(w.recoil[0] * 0.6);
    Net.send(w.melee ? PROTO.FIRE : PROTO.FIRE, {
      w:this.current, o:[origin.x, origin.y, origin.z], d:[dir.x, dir.y, dir.z], sup: !!(w.suppressor && this.suppressed)
    });
    UI.updateAmmo();
  },

  reload() {
    const w = this.def();
    if (this.reloading || w.melee || this.mags[this.current] >= w.mag || this.reserves[this.current] <= 0) return;
    this.reloading = true; this.reloadEnd = performance.now() + w.reload*1000;
    AudioSys.reloadSound(); AudioSys.voice('Reloading!');
    Net.send(PROTO.RELOAD, {});
    setTimeout(() => {
      const need = w.mag - this.mags[this.current];
      const take = Math.min(need, this.reserves[this.current]);
      this.mags[this.current] += take; this.reserves[this.current] -= take;
      this.reloading = false; UI.updateAmmo();
    }, w.reload*1000);
  },

  startCook(kind) {
    if (this.nades[kind] <= 0 || this.cooking) return;
    this.cooking = { kind, start: performance.now() };
    AudioSys.pinPull();
  },
  throwNade() {
    if (!this.cooking) return;
    const { kind, start } = this.cooking; this.cooking = null;
    if (this.nades[kind] <= 0) return;
    this.nades[kind]--;
    const dir = new THREE.Vector3(0,0,-1).applyQuaternion(Renderer.camera.quaternion);
    dir.y += 0.15; dir.normalize();
    const o = Renderer.camera.position;
    Net.send(PROTO.THROW, { k:kind, o:[o.x,o.y,o.z], d:[dir.x,dir.y,dir.z], power:1,
      cooked: SHARED.THROWABLES[kind].cookable ? performance.now() - start : 0 });
    UI.updateAmmo();
  },

  update(dt) {
    const w = this.def();
    // recoil recovery
    Player.pitch += this.recoilPitch; Player.yaw += this.recoilYaw;
    this.recoilPitch *= Math.pow(0.0001, dt); this.recoilYaw *= Math.pow(0.0001, dt);
    Player.pitch -= this.recoilPitch; Player.yaw -= this.recoilYaw;
    // ADS interpolation
    this.adsT += ((this.ads ? 1 : 0) - this.adsT) * Math.min(1, dt*12);
    const targetFov = UI.settings.fov / (1 + (w.zoom - 1) * this.adsT);
    Renderer.camera.fov += (targetFov - Renderer.camera.fov) * Math.min(1, dt*12);
    Renderer.camera.updateProjectionMatrix();
    UI.setScope(w.zoom > 2 && this.adsT > 0.8);
    // minigun spinup
    if (w.spinup) {
      if (Player.firing) this.spinup = Math.min(w.spinup, this.spinup + dt);
      else this.spinup = Math.max(0, this.spinup - dt*2);
    }
    // auto fire
    if (Player.firing && (w.auto || performance.now() - this.lastFire > 200)) {
      if (w.auto) this.tryFire();
    }
    // cooked grenade auto-throw
    if (this.cooking) {
      const spec = SHARED.THROWABLES[this.cooking.kind];
      if (spec.cookable && performance.now() - this.cooking.start > spec.fuse*1000 - 150) this.throwNade();
    }
    // viewmodel animation: bob, sway, ADS position, reload dip
    if (this.viewmodel) {
      const vm = this.viewmodel;
      const bob = Player.bobPhase;
      const adsX = 0.25 * (1-this.adsT), adsY = -0.22 * (1-this.adsT) - 0.14*this.adsT;
      vm.position.x += (adsX + Math.sin(bob)*0.008*(1-this.adsT) - vm.position.x) * Math.min(1, dt*10);
      vm.position.y += (adsY + Math.abs(Math.cos(bob))*0.008*(1-this.adsT) - vm.position.y) * Math.min(1, dt*10);
      vm.position.z += (-0.5 - vm.position.z) * Math.min(1, dt*8);
      // sway with mouse
      vm.rotation.y += (Player.swayX*0.03 - vm.rotation.y) * Math.min(1, dt*6);
      vm.rotation.x += (Player.swayY*0.03 - vm.rotation.x) * Math.min(1, dt*6);
      // scope breathing sway
      if (w.zoom > 2 && this.adsT > 0.5) {
        const t = performance.now()/1000;
        Player.pitch += Math.sin(t*1.2)*0.00015; Player.yaw += Math.cos(t*0.9)*0.00015;
      }
      // reload animation: dip + mag drop
      if (this.reloading) {
        const p = 1 - (this.reloadEnd - performance.now()) / (w.reload*1000);
        vm.rotation.z = Math.sin(p*Math.PI) * 0.5;
        if (this.vmParts.mag) this.vmParts.mag.position.y = -0.08 - Math.sin(p*Math.PI)*0.15;
      } else vm.rotation.z *= 0.85;
    }
  },

  resetForSpawn() {
    for (const w in SHARED.WEAPONS) { this.mags[w] = SHARED.WEAPONS[w].mag; this.reserves[w] = SHARED.WEAPONS[w].reserve; }
    this.nades = { frag:2, flash:2, smoke:1, molotov:1 };
    this.reloading = false; this.cooking = null;
    UI.updateAmmo();
  }
};
