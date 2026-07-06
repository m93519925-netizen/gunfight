/* Remote players: interpolation buffers, models, nametags, projectiles. */
const Entities = {
  players: new Map(),   // id -> { mesh, buf:[{t,x,y,z,yw,pt,cr}], name, team, alive, weapon, lastPos }
  projectiles: new Map(),

  addPlayer(id, name, team) {
    if (this.players.has(id) || id === Net.myId) return;
    const color = team === 'red' ? 0xcc3333 : team === 'blue' ? 0x3366cc : 0x33aa66;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.35), bodyMat); body.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), new THREE.MeshLambertMaterial({ color:0xd9b38c })); head.position.y = 1.62;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), new THREE.MeshLambertMaterial({ color:0x333333 })); legs.position.y = 0.38;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), new THREE.MeshLambertMaterial({ color:0x222222 }));
    gun.position.set(0.25, 1.25, -0.3);
    body.castShadow = head.castShadow = true;
    g.add(body, head, legs, gun);
    // nametag sprite
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center';
    ctx.fillStyle = team === 'red' ? '#ff8888' : team === 'blue' ? '#88aaff' : '#88ffbb';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
    ctx.strokeText(name, 128, 32); ctx.fillText(name, 128, 32);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest:false }));
    tag.scale.set(1.6, 0.3, 1); tag.position.y = 2.1;
    g.add(tag);
    g.visible = false;
    Renderer.scene.add(g);
    this.players.set(id, { mesh:g, head, buf:[], name, team, alive:true, weapon:'ak47', tag, lastStepAt:0, lastPos:new THREE.Vector3() });
  },

  removePlayer(id) {
    const p = this.players.get(id);
    if (p) { Renderer.scene.remove(p.mesh); this.players.delete(id); }
  },

  onSnapshot(snap) {
    const now = performance.now();
    for (const s of snap.p) {
      if (s.id === Net.myId) continue;
      let e = this.players.get(s.id);
      if (!e) { this.addPlayer(s.id, Net.roster[s.id] ? Net.roster[s.id].name : 'Player', Net.roster[s.id] ? Net.roster[s.id].team : 'ffa'); e = this.players.get(s.id); }
      if (!e) continue;
      e.buf.push({ t: now, x:s.x, y:s.y, z:s.z, yw:s.yw, pt:s.pt, cr:s.cr, a:s.a });
      if (e.buf.length > 30) e.buf.shift();
      e.alive = !!s.a; e.weapon = s.w;
    }
  },

  addProjectile(id, kind, o, v) {
    const color = kind === 'rocket' ? 0x888888 : kind === 'molotov' ? 0xcc4400 : 0x445544;
    const m = new THREE.Mesh(new THREE.SphereGeometry(kind==='rocket'?0.15:0.1, 6, 5),
      new THREE.MeshLambertMaterial({ color }));
    m.position.set(o[0], o[1], o[2]);
    Renderer.scene.add(m);
    const grav = kind === 'rocket' ? 1 : (SHARED.THROWABLES[kind] ? SHARED.THROWABLES[kind].grav : 14);
    this.projectiles.set(id, { mesh:m, v:new THREE.Vector3(v[0],v[1],v[2]), grav, kind });
  },
  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (p) { Renderer.scene.remove(p.mesh); this.projectiles.delete(id); }
  },

  update(dt) {
    const renderT = performance.now() - SHARED.INTERP_DELAY;
    for (const [id, e] of this.players) {
      // entity interpolation between two buffered snapshots
      const buf = e.buf;
      let a = null, b = null;
      for (let i = buf.length-1; i >= 0; i--) {
        if (buf[i].t <= renderT) { a = buf[i]; b = buf[i+1] || buf[i]; break; }
      }
      if (!a) { if (buf.length) { a = b = buf[0]; } else continue; }
      const span = Math.max(1, b.t - a.t);
      const f = Math.min(1, (renderT - a.t) / span);
      const x = a.x + (b.x-a.x)*f, y = a.y + (b.y-a.y)*f, z = a.z + (b.z-a.z)*f;
      e.mesh.position.set(x, y, z);
      e.mesh.rotation.y = a.yw + (b.yw-a.yw)*f;
      e.mesh.visible = e.alive;
      e.head.position.y = a.cr ? 1.0 : 1.62;
      e.mesh.scale.y = a.cr ? 0.72 : 1;
      // footsteps
      const moved = e.mesh.position.distanceTo(e.lastPos);
      if (moved > 0.05 && e.alive && performance.now() - e.lastStepAt > 380) {
        e.lastStepAt = performance.now();
        AudioSys.footstep(e.mesh.position, 'stone');
      }
      e.lastPos.copy(e.mesh.position);
      // nametag: only teammates or close range
      const isTeam = Net.roster[Net.myId] && e.team === Net.roster[Net.myId].team && e.team !== 'ffa';
      const dist = e.mesh.position.distanceTo(Renderer.camera.position);
      e.tag.visible = isTeam ? dist < 60 : dist < 15;
    }
    for (const [id, p] of this.projectiles) {
      p.v.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      if (p.kind === 'rocket') Effects.spawnParticles(p.mesh.position, 0xaaaaaa, 1, 0.5, 0.4, 0.8);
    }
  },

  clear() {
    for (const [id] of this.players) this.removePlayer(id);
    for (const [id] of this.projectiles) this.removeProjectile(id);
  }
};
