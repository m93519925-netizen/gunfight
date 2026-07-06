/* Game bootstrap + main loop. */
const Game = {
  playing:false, mode:'tdm', lastT:0,

  init() {
    Renderer.init();
    Effects.init();
    Physics.setMap({ boxes: [] });
    AudioSys.init();
    UI.init();
    Player.init();
    Weapons.init();
    Net.connect();
    UI.applySettings();
    requestAnimationFrame((t) => this.loop(t));
  },

  start(m) {
    // build world
    this.mode = m.settings.mode;
    Entities.clear();
    Maps.load(m.map);
    Net.roster = {};
    m.players.forEach(p => {
      Net.roster[p.id] = p;
      if (p.id !== Net.myId) Entities.addPlayer(p.id, p.name, p.team);
      else Player.team = p.team;
    });
    UI.killTally = {};
    this.playing = true;
    UI.show(null);
    UI.showHUD(true);
    UI.centerMsg(`${SHARED.MODES[this.mode].name} — ${Maps.current.label}`, 3000);
    Renderer.renderer.domElement.requestPointerLock();
  },

  end(m) {
    this.playing = false;
    document.exitPointerLock();
    UI.showHUD(false);
    UI.showGameOver(m);
  },

  loop(t) {
    requestAnimationFrame((t2) => this.loop(t2));
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    if (this.playing) {
      Player.update(dt);
      Weapons.update(dt);
      Entities.update(dt);
      Effects.update(dt);
      Maps.update(dt);
      Net.sendInput();
      AudioSys.updateListener(Renderer.camera.position, Player.yaw);
      UI.drawMinimap();
      if (GameModes.state) GameModes.updateObjectiveHUD(GameModes.state);
    }
    Renderer.render(dt);
  }
};

window.addEventListener('DOMContentLoaded', () => Game.init());
