/* Three.js scene, camera, lighting, resize, post effects hooks. */
const Renderer = {
  scene:null, camera:null, renderer:null, weaponCamera:null, weaponScene:null,
  shake:0, baseFov:90,

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov, innerWidth/innerHeight, 0.05, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    document.getElementById('game-container').appendChild(this.renderer.domElement);
    // separate scene for first-person viewmodel (rendered on top)
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.01, 10);
    this.weaponScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const wl = new THREE.DirectionalLight(0xffffff, 0.8); wl.position.set(1,2,1); this.weaponScene.add(wl);
    addEventListener('resize', () => {
      this.camera.aspect = this.weaponCamera.aspect = innerWidth/innerHeight;
      this.camera.updateProjectionMatrix(); this.weaponCamera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  },

  setupLights(theme) {
    // clear old lights
    [...this.scene.children].forEach(o => { if (o.isLight) this.scene.remove(o); });
    this.scene.add(new THREE.AmbientLight(0xffffff, theme.ambient));
    const sun = new THREE.DirectionalLight(0xfff4e0, theme.indoor ? 0.4 : 1.1);
    sun.position.set(theme.sun[0]*80, theme.sun[1]*100, theme.sun[2]*80);
    sun.castShadow = UI.settings.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 80; sun.shadow.camera.left=-s; sun.shadow.camera.right=s; sun.shadow.camera.top=s; sun.shadow.camera.bottom=-s;
    sun.shadow.camera.far = 300;
    this.scene.add(sun);
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.FogExp2(theme.fog[0], theme.fog[1]);
  },

  addShake(amt) { this.shake = Math.min(0.6, this.shake + amt); },

  render(dt) {
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random()-0.5) * this.shake * 0.3;
      this.camera.position.y += (Math.random()-0.5) * this.shake * 0.3;
      this.shake *= Math.pow(0.001, dt); // exponential decay
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.weaponScene, this.weaponCamera);
  }
};
