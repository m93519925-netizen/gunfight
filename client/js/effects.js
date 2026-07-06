/* Particles, tracers, muzzle flash, explosions, smoke, VFX. */
const Effects = {
  particles: [], tracers: [], smokes: [], lights: [],

  init() {
    this.particleGeo = new THREE.SphereGeometry(0.04, 4, 3);
    this.matCache = {};
  },
  _mat(color) {
    if (!this.matCache[color]) this.matCache[color] = new THREE.MeshBasicMaterial({ color });
    return this.matCache[color];
  },

  spawnParticles(pos, color, count, speed, life, size) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, this._mat(color));
      m.scale.setScalar(size || 1);
      m.position.copy(pos);
      m.userData = {
        v: new THREE.Vector3((Math.random()-0.5)*speed,(Math.random()-0.2)*speed,(Math.random()-0.5)*speed),
        life: life || 0.6, maxLife: life || 0.6
      };
      Renderer.scene.add(m); this.particles.push(m);
    }
  },
  blood(pos) { this.spawnParticles(pos, 0xaa0000, 10, 4, 0.5, 1.4); },
  impact(pos, mat) { this.spawnParticles(pos, mat === 'wood' ? 0x8b5a2b : 0xbbbbbb, 6, 3, 0.4, 0.8); },
  shellEject(pos, dir) { this.spawnParticles(pos, 0xd4af37, 1, 2.5, 0.7, 0.7); },

  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color:0xffcc66, transparent:true, opacity:0.8 }));
    l.userData = { life: 0.07 };
    Renderer.scene.add(l); this.tracers.push(l);
  },

  muzzleFlash(pos) {
    const light = new THREE.PointLight(0xffaa33, 8, 12);
    light.position.copy(pos); light.userData = { life: 0.06 };
    Renderer.scene.add(light); this.lights.push(light);
  },

  explosion(pos) {
    this.spawnParticles(pos, 0xff6622, 30, 12, 1.0, 2.5);
    this.spawnParticles(pos, 0x333333, 20, 8, 1.5, 3);
    const light = new THREE.PointLight(0xff8833, 30, 25);
    light.position.copy(pos); light.userData = { life: 0.25 };
    Renderer.scene.add(light); this.lights.push(light);
    // shockwave ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 24),
      new THREE.MeshBasicMaterial({ color:0xffddaa, side:THREE.DoubleSide, transparent:true, opacity:0.8 }));
    ring.position.copy(pos); ring.rotation.x = -Math.PI/2;
    ring.userData = { life:0.5, ring:true };
    Renderer.scene.add(ring); this.tracers.push(ring);
    const dist = Renderer.camera.position.distanceTo(pos);
    Renderer.addShake(Math.max(0, 0.5 - dist * 0.02));
    AudioSys.explosion(pos);
  },

  smoke(pos, duration) {
    const group = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random(), 8, 6),
        new THREE.MeshLambertMaterial({ color:0xbbbbbb, transparent:true, opacity:0 }));
      m.position.set(pos.x+(Math.random()-0.5)*3, pos.y+Math.random()*2.5, pos.z+(Math.random()-0.5)*3);
      Renderer.scene.add(m); group.push(m);
    }
    this.smokes.push({ group, born: performance.now(), duration: (duration||14)*1000 });
    AudioSys.smokeHiss(pos);
  },

  molotovFire(pos, duration) {
    const iv = setInterval(() => {
      this.spawnParticles(new THREE.Vector3(pos.x+(Math.random()-0.5)*4, pos.y+0.2, pos.z+(Math.random()-0.5)*4), 0xff5500, 2, 2, 0.6, 1.6);
    }, 120);
    setTimeout(() => clearInterval(iv), duration*1000);
  },

  flashbang(pos) {
    const cam = Renderer.camera.position;
    const dist = cam.distanceTo(pos);
    // check LOS
    const dir = pos.clone().sub(cam).normalize();
    const hit = Physics.raycast(cam, dir, dist);
    const blocked = hit && hit.t < dist - 0.5;
    if (dist < 20 && !blocked) {
      const strength = Math.max(0.2, 1 - dist/20);
      const el = document.getElementById('flash-overlay');
      el.style.transition = 'none'; el.style.opacity = strength;
      requestAnimationFrame(() => { el.style.transition = `opacity ${2.5*strength}s`; el.style.opacity = 0; });
      AudioSys.flashRing();
    }
  },

  update(dt) {
    for (let i = this.particles.length-1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.v.y -= 9 * dt;
      p.position.addScaledVector(p.userData.v, dt);
      p.userData.life -= dt;
      if (p.userData.life <= 0) { Renderer.scene.remove(p); this.particles.splice(i,1); }
    }
    for (let i = this.tracers.length-1; i >= 0; i--) {
      const t = this.tracers[i];
      t.userData.life -= dt;
      if (t.userData.ring) { t.scale.multiplyScalar(1 + dt*14); t.material.opacity *= 0.9; }
      if (t.userData.life <= 0) { Renderer.scene.remove(t); this.tracers.splice(i,1); }
    }
    for (let i = this.lights.length-1; i >= 0; i--) {
      const l = this.lights[i];
      l.userData.life -= dt;
      if (l.userData.life <= 0) { Renderer.scene.remove(l); this.lights.splice(i,1); }
    }
    const now = performance.now();
    for (let i = this.smokes.length-1; i >= 0; i--) {
      const s = this.smokes[i];
      const age = (now - s.born) / s.duration;
      const op = age < 0.1 ? age*8 : age > 0.85 ? (1-age)*6 : 0.85;
      s.group.forEach(m => { m.material.opacity = Math.min(0.9, op); m.scale.setScalar(1 + age*1.5); });
      if (age >= 1) { s.group.forEach(m => Renderer.scene.remove(m)); this.smokes.splice(i,1); }
    }
  }
};
