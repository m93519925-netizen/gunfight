/* Client-side game-mode presentation: objectives, flags, bomb, minimap data. */
const GameModes = {
  state: null,

  onSnapshot(g) {
    if (!g) return;
    this.state = g;
    // CTF flag meshes
    if (g.flags && Maps.flagMeshes.red) {
      for (const team of ['red','blue']) {
        const fm = Maps.flagMeshes[team], f = g.flags[team];
        fm.visible = true;
        fm.position.set(f.pos[0], f.pos[1], f.pos[2]);
      }
    }
    // SND site markers
    Maps.siteMarkers.forEach(m => m.visible = g.mode === 'snd');
    this.updateObjectiveHUD(g);
  },

  onEvent(m) {
    switch (m.e) {
      case 'flag_taken': UI.centerMsg(`${m.name} took the ${m.team.toUpperCase()} flag!`, 2500); AudioSys.voice('Enemy has our flag!'); break;
      case 'flag_drop': UI.centerMsg(`${m.team.toUpperCase()} flag dropped`, 2000); break;
      case 'flag_return': UI.centerMsg(`${m.team.toUpperCase()} flag returned`, 2000); break;
      case 'flag_cap': UI.centerMsg(`⚑ ${m.name} CAPTURED the flag!`, 3000); AudioSys.killSound(); break;
      case 'bomb_planted': UI.centerMsg(`💣 BOMB PLANTED at site ${m.site}!`, 3000); AudioSys.voice('Bomb planted!'); break;
      case 'planting': UI.centerMsg(`${m.by} is planting…`, 2000); break;
      case 'defusing': UI.centerMsg(`${m.by} is defusing…`, 2000); break;
      case 'round_start': UI.centerMsg(`ROUND ${m.round}`, 2500); break;
      case 'round_end': UI.centerMsg(`${m.winner.toUpperCase()} wins the round (${m.reason})`, 3500); break;
    }
  },

  updateObjectiveHUD(g) {
    const now = Date.now();
    let timer = '', text = '';
    if (g.mode === 'snd' && g.snd) {
      const s = g.snd;
      if (s.bomb && s.bomb.planted) { timer = this.fmt((s.bomb.detonateAt - now)/1000); text = '💣 BOMB ARMED'; }
      else { timer = this.fmt((s.roundEnd - now)/1000); text = `Round ${s.round} — RED ${s.roundScores?.red||0} : ${s.roundScores?.blue||0} BLUE`; }
      // interact hints
      const hint = document.getElementById('interact-hint');
      const map = Maps.current;
      let show = null;
      if (Player.alive && map) {
        if (Player.team === 'red' && !s.bomb) {
          for (const [site, pos] of Object.entries(map.sites))
            if (Math.hypot(Player.pos.x-pos[0], Player.pos.z-pos[2]) < 6) show = `Hold [E] to plant at ${site}`;
        } else if (Player.team === 'blue' && s.bomb && s.bomb.planted) {
          if (Math.hypot(Player.pos.x-s.bomb.pos[0], Player.pos.z-s.bomb.pos[2]) < 2.5) show = 'Hold [E] to defuse';
        }
      }
      hint.classList.toggle('hidden', !show);
      if (show) hint.textContent = show;
    } else {
      timer = this.fmt((g.endTime - now)/1000);
      if (g.mode === 'ffa') text = 'FREE-FOR-ALL';
      else text = `RED ${g.scores.red} : ${g.scores.blue} BLUE`;
    }
    document.getElementById('obj-timer').textContent = timer;
    document.getElementById('obj-text').textContent = text;
  },

  fmt(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
};
