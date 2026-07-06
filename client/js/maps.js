/* Map loading: builds render meshes + collision from shared map defs. */
const Maps = {
  current:null, meshes:[], flagMeshes:{}, weatherPoints:null, siteMarkers:[],

  _canvasTexture(base, noise) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0,0,128,128);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random()*noise})`;
      ctx.fillRect(Math.random()*128, Math.random()*128, 2, 2);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  },

  load(name) {
    this.unload();
    const def = SHARED.buildMap(name);
    this.current = def;
    Physics.setMap(def);
    Renderer.setupLights(def.theme);
    def.boxes.forEach((b, i) => {
      const tex = this._canvasTexture('#' + b.c.toString(16).padStart(6,'0'), b.m === 'metal' ? 0.25 : 0.15);
      tex.repeat.set(Math.max(1, b.w/4), Math.max(1, b.h/4));
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d),
        new THREE.MeshLambertMaterial({ map: tex }));
      mesh.position.set(b.x, b.y, b.z);
      mesh.castShadow = mesh.receiveShadow = UI.settings.shadows;
      mesh.userData.boxIdx = i;
      Renderer.scene.add(mesh); this.meshes.push(mesh);
    });
    // CTF flags
    for (const team of ['red','blue']) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,2.6), new THREE.MeshBasicMaterial({color:0x888888}));
      pole.position.y = 1.3;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.55),
        new THREE.MeshBasicMaterial({ color: team==='red'?0xff3333:0x3388ff, side:THREE.DoubleSide }));
      cloth.position.set(0.45, 2.25, 0);
      g.add(pole, cloth);
      g.visible = false;
      Renderer.scene.add(g); this.flagMeshes[team] = g;
    }
    // bomb site markers
    for (const [site, pos] of Object.entries(def.sites)) {
      const m = new THREE.Mesh(new THREE.RingGeometry(4.5, 5, 32),
        new THREE.MeshBasicMaterial({ color:0xffd257, side:THREE.DoubleSide, transparent:true, opacity:0.35 }));
      m.rotation.x = -Math.PI/2; m.position.set(pos[0], 0.05, pos[2]);
      m.visible = false;
      Renderer.scene.add(m); this.siteMarkers.push(m);
    }
    // weather
    if (def.theme.weather === 'snow') {
      const n = 1500, pos = new Float32Array(n*3);
      for (let i = 0; i < n; i++) { pos[i*3]=(Math.random()-0.5)*def.size; pos[i*3+1]=Math.random()*20; pos[i*3+2]=(Math.random()-0.5)*def.size; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.weatherPoints = new THREE.Points(geo, new THREE.PointsMaterial({ color:0xffffff, size:0.12, transparent:true, opacity:0.8 }));
      Renderer.scene.add(this.weatherPoints);
    }
    return def;
  },

  destroyBox(i) {
    Physics.destroyBox(i);
    const mesh = this.meshes.find(m => m.userData.boxIdx === i);
    if (mesh) { Effects.spawnParticles(mesh.position, 0x8b5a2b, 15, 5, 0.8, 1.5); Renderer.scene.remove(mesh); }
  },

  update(dt) {
    if (this.weatherPoints) {
      const p = this.weatherPoints.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.array[i*3+1] -= dt * 2.2;
        p.array[i*3] += Math.sin(performance.now()/1000 + i) * dt * 0.4;
        if (p.array[i*3+1] < 0) p.array[i*3+1] = 20;
      }
      p.needsUpdate = true;
    }
  },

  unload() {
    this.meshes.forEach(m => Renderer.scene.remove(m)); this.meshes = [];
    Object.values(this.flagMeshes).forEach(m => Renderer.scene.remove(m)); this.flagMeshes = {};
    this.siteMarkers.forEach(m => Renderer.scene.remove(m)); this.siteMarkers = [];
    if (this.weatherPoints) { Renderer.scene.remove(this.weatherPoints); this.weatherPoints = null; }
  }
};
