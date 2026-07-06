/* Shared between Node server and browser client (UMD-lite). */
(function (g) {
  const C = {};

  // ---- Networking / simulation ----
  C.TICK_RATE = 64;          // server sim Hz
  C.SNAPSHOT_EVERY = 2;      // send snapshot every N ticks (32Hz)
  C.INPUT_RATE = 32;         // client input send Hz
  C.INTERP_DELAY = 100;      // ms remote-entity render delay
  C.HISTORY_MS = 1000;       // lag-comp rewind window

  // ---- Player ----
  C.PLAYER = {
    SPEED: 5.2, SPRINT: 7.6, CROUCH_SPEED: 2.6, JUMP: 8.6, GRAVITY: 24,
    HEIGHT: 1.8, CROUCH_HEIGHT: 1.2, RADIUS: 0.38, EYE: 1.62, CROUCH_EYE: 1.05,
    HP: 100, MAX_ARMOR: 100, ARMOR_ABSORB: 0.5,
    REGEN_DELAY: 5, REGEN_TO: 30, REGEN_RATE: 12, RESPAWN: 5
  };

  C.DMG_MULT = { head: 2.5, chest: 1.0, limbs: 0.75 };

  // ---- Weapons ----
  // dmg per bullet, rpm, mag, reserve, range (full dmg m), falloff (m to min),
  // spread (rad hip), ads (spread mult), recoil [vert,horiz], reload (s),
  // auto, pellets, zoom (fov divide), proj {speed,grav,splash,splashDmg}
  C.WEAPONS = {
    ak47:   { name:'AK-47',  slot:'primary', dmg:34, rpm:600, mag:30, reserve:120, range:35, falloff:40, spread:0.022, ads:0.25, recoil:[0.030,0.014], reload:2.4, auto:true,  zoom:1.25 },
    m4a1:   { name:'M4A1',   slot:'primary', dmg:28, rpm:750, mag:30, reserve:150, range:32, falloff:38, spread:0.017, ads:0.22, recoil:[0.018,0.008], reload:2.1, auto:true,  zoom:1.25, suppressor:true },
    scarh:  { name:'SCAR-H', slot:'primary', dmg:44, rpm:420, mag:20, reserve:80,  range:42, falloff:45, spread:0.019, ads:0.22, recoil:[0.034,0.012], reload:2.6, auto:true,  zoom:1.3 },
    mp5:    { name:'MP5',    slot:'primary', dmg:22, rpm:850, mag:30, reserve:150, range:18, falloff:22, spread:0.026, ads:0.35, recoil:[0.013,0.010], reload:1.9, auto:true,  zoom:1.15 },
    ump45:  { name:'UMP45',  slot:'primary', dmg:30, rpm:600, mag:25, reserve:100, range:20, falloff:24, spread:0.024, ads:0.32, recoil:[0.017,0.010], reload:2.0, auto:true,  zoom:1.15 },
    pump:   { name:'Pump Shotgun', slot:'primary', dmg:14, rpm:70,  mag:8,  reserve:32, range:9,  falloff:12, spread:0.055, ads:0.7, recoil:[0.07,0.02], reload:3.2, auto:false, pellets:8, zoom:1.1 },
    autosg: { name:'Auto Shotgun', slot:'primary', dmg:10, rpm:180, mag:6,  reserve:30, range:8,  falloff:11, spread:0.06,  ads:0.75,recoil:[0.05,0.02], reload:2.8, auto:false, pellets:8, zoom:1.1 },
    bolt:   { name:'Bolt-Action', slot:'primary', dmg:95, rpm:45, mag:5, reserve:25, range:120, falloff:200, spread:0.05, ads:0.005, recoil:[0.09,0.01], reload:3.0, auto:false, zoom:8, drop:true },
    semisnp:{ name:'Semi Sniper', slot:'primary', dmg:62, rpm:170, mag:10, reserve:40, range:100, falloff:180, spread:0.04, ads:0.01, recoil:[0.05,0.012], reload:2.6, auto:false, zoom:6, drop:true },
    deagle: { name:'Desert Eagle', slot:'secondary', dmg:48, rpm:220, mag:7,  reserve:35, range:22, falloff:28, spread:0.028, ads:0.3, recoil:[0.05,0.02], reload:1.9, auto:false, zoom:1.1 },
    glock:  { name:'Glock 17',     slot:'secondary', dmg:20, rpm:500, mag:17, reserve:85, range:18, falloff:24, spread:0.024, ads:0.35, recoil:[0.012,0.008], reload:1.6, auto:false, zoom:1.1 },
    rocket: { name:'Rocket Launcher', slot:'special', dmg:0, rpm:40, mag:1, reserve:3, range:100, falloff:0, spread:0.01, ads:0.5, recoil:[0.08,0], reload:3.5, auto:false, zoom:1.3, proj:{speed:32, grav:1, splash:5, splashDmg:130} },
    gl:     { name:'Grenade Launcher', slot:'special', dmg:0, rpm:80, mag:6, reserve:12, range:60, falloff:0, spread:0.02, ads:0.6, recoil:[0.05,0], reload:3.0, auto:false, zoom:1.15, proj:{speed:22, grav:14, splash:4, splashDmg:100, bounce:true, fuse:2.5} },
    minigun:{ name:'Minigun', slot:'special', dmg:16, rpm:1400, mag:200, reserve:200, range:25, falloff:35, spread:0.05, ads:0.8, recoil:[0.007,0.010], reload:5.0, auto:true, zoom:1.05, spinup:1.2 },
    knife:  { name:'Knife', slot:'melee', dmg:55, rpm:110, mag:Infinity, reserve:0, range:2.2, falloff:0, spread:0, ads:1, recoil:[0,0], reload:0, auto:false, melee:true, backstab:200, zoom:1 }
  };

  C.THROWABLES = {
    frag:    { name:'Frag',     fuse:3.5, speed:18, grav:16, splash:5.5, splashDmg:120, cookable:true },
    flash:   { name:'Flashbang',fuse:1.6, speed:20, grav:16, splash:8,   splashDmg:0, flash:true },
    smoke:   { name:'Smoke',    fuse:1.2, speed:16, grav:16, splash:5,   splashDmg:0, smoke:true, duration:14 },
    molotov: { name:'Molotov',  fuse:0,   speed:15, grav:18, splash:3.5, splashDmg:0, fire:true, duration:6, dps:20 }
  };

  C.MODES = {
    ffa: { name:'Free-For-All', teams:false, killLimit:30, timeLimit:600, respawn:true },
    tdm: { name:'Team Deathmatch', teams:true, killLimit:50, timeLimit:600, respawn:true },
    ctf: { name:'Capture The Flag', teams:true, capLimit:3, timeLimit:900, respawn:true },
    snd: { name:'Search & Destroy', teams:true, rounds:12, roundTime:120, plantAction:4, bombTimer:45, defuse:7, respawn:false }
  };

  // ---- Maps (procedural, deterministic; boxes are axis-aligned) ----
  // box: [x, y, z, w, h, d, color, material('wood'|'metal'|'stone'|'glass'), destructible?, hp?]
  function B(x,y,z,w,h,d,c,m,dest,hp){ return {x,y,z,w,h,d,c:c||0x888888,m:m||'stone',dest:!!dest,hp:hp||60}; }

  function dustfall() {
    const b = [];
    b.push(B(0,-0.5,0, 120,1,120, 0xC9A66B,'stone'));               // ground
    // perimeter walls
    b.push(B(0,2,-60,120,5,2,0xB08D57),B(0,2,60,120,5,2,0xB08D57),B(-60,2,0,2,5,120,0xB08D57),B(60,2,0,2,5,120,0xB08D57));
    // central building
    b.push(B(0,2,-6,16,4,2,0x9E7E4E),B(0,2,6,16,4,2,0x9E7E4E),B(-8,2,0,2,4,10,0x9E7E4E),B(8,2,0,2,4,10,0x9E7E4E));
    b.push(B(0,4.5,0,18,1,14,0x8A6E44));                             // roof
    // dunes (cover mounds)
    for (let i=0;i<8;i++){ const a=i/8*Math.PI*2; b.push(B(Math.cos(a)*28, 0.8, Math.sin(a)*28, 6,1.6,6, 0xD8B87B)); }
    // crates (destructible)
    [[-18,0,-18],[18,0,18],[-24,0,10],[24,0,-10],[0,0,-24],[0,0,24],[-10,0,14],[10,0,-14]].forEach(p=>
      b.push(B(p[0],1,p[2],2,2,2,0x8B5A2B,'wood',true,50)));
    // sniper alleys blockers
    b.push(B(-40,1.5,0,3,3,12,0xA0824F),B(40,1.5,0,3,3,12,0xA0824F));
    return { name:'dustfall', label:'Dustfall', size:120, boxes:b,
      spawns:{ red:[[-52,0,-40],[-52,0,0],[-52,0,40],[-45,0,-20],[-45,0,20]], blue:[[52,0,-40],[52,0,0],[52,0,40],[45,0,-20],[45,0,20]],
        ffa:[[-30,0,-30],[30,0,30],[-30,0,30],[30,0,-30],[0,0,-40],[0,0,40],[-45,0,0],[45,0,0],[0,5.2,0]] },
      flags:{ red:[-52,0,0], blue:[52,0,0] }, sites:{ A:[0,0,0], B:[0,0,-40] },
      theme:{ sky:0xE8C88F, fog:[0xE0C080,0.006], ambient:0.55, sun:[0.6,1,0.3], weather:null } };
  }

  function ironworks() {
    const b = [];
    b.push(B(0,-0.5,0,80,1,80,0x5A5A5F,'metal'));
    b.push(B(0,4,-40,80,9,2,0x4A4A50),B(0,4,40,80,9,2,0x4A4A50),B(-40,4,0,2,9,80,0x4A4A50),B(40,4,0,2,9,80,0x4A4A50));
    b.push(B(0,9,0,80,1,80,0x3A3A40));                               // ceiling
    // machinery blocks + corridors
    const mach=[[-20,-20,8,4,10],[20,20,8,4,10],[-20,20,6,3,6],[20,-20,6,3,6],[0,-15,10,3,4],[0,15,10,3,4],[-10,0,4,2.5,12],[10,0,4,2.5,12]];
    mach.forEach(m=>b.push(B(m[0],m[3]/2,m[1],m[2],m[3],m[4],0x6E6E78,'metal')));
    // catwalks (verticality)
    b.push(B(0,4,-30,50,0.4,3,0x7A7A85,'metal'),B(0,4,30,50,0.4,3,0x7A7A85,'metal'));
    b.push(B(-30,2,-30,3,4,3,0x7A7A85,'metal'),B(30,2,30,3,4,3,0x7A7A85,'metal')); // ramp pillars/stairs blocks
    b.push(B(-27,1,-30,4,0.4,3,0x7A7A85,'metal'),B(-24,2,-30,4,0.4,3,0x7A7A85,'metal'),B(-21,3,-30,4,0.4,3,0x7A7A85,'metal'));
    b.push(B(27,1,30,4,0.4,3,0x7A7A85,'metal'),B(24,2,30,4,0.4,3,0x7A7A85,'metal'),B(21,3,30,4,0.4,3,0x7A7A85,'metal'));
    [[-8,-8],[8,8],[-8,8],[8,-8],[0,-25],[0,25]].forEach(p=>b.push(B(p[0],1,p[1],2,2,2,0x8B5A2B,'wood',true,50)));
    return { name:'ironworks', label:'Ironworks', size:80, boxes:b,
      spawns:{ red:[[-35,0,-35],[-35,0,0],[-35,0,35]], blue:[[35,0,-35],[35,0,0],[35,0,35]],
        ffa:[[-25,0,-25],[25,0,25],[-25,0,25],[25,0,-25],[0,0,0],[0,4.5,-30],[0,4.5,30]] },
      flags:{ red:[-35,0,0], blue:[35,0,0] }, sites:{ A:[-20,0,-20], B:[20,0,20] },
      theme:{ sky:0x1A1A22, fog:[0x111116,0.02], ambient:0.28, sun:[0.2,1,0.1], weather:null, indoor:true } };
  }

  function coldfront() {
    const b = [];
    b.push(B(0,-0.5,0,140,1,140,0xE8EEF2,'stone'));
    b.push(B(0,2,-70,140,5,2,0xB9C4CC),B(0,2,70,140,5,2,0xB9C4CC),B(-70,2,0,2,5,140,0xB9C4CC),B(70,2,0,2,5,140,0xB9C4CC));
    // sniper towers
    b.push(B(-58,3,0,6,6,6,0x9AA7B0),B(-58,6.2,0,8,0.4,8,0x8895A0)); // tower platform
    b.push(B(58,3,0,6,6,6,0x9AA7B0),B(58,6.2,0,8,0.4,8,0x8895A0));
    // research huts
    [[-20,-20],[20,20],[-20,20],[20,-20],[0,0]].forEach(p=>{
      b.push(B(p[0],1.8,p[1]-5,10,3.6,1,0xC8D4DA),B(p[0],1.8,p[1]+5,10,3.6,1,0xC8D4DA),
             B(p[0]-5,1.8,p[1],1,3.6,8,0xC8D4DA),B(p[0]+5,1.8,p[1],1,3.6,8,0xC8D4DA),B(p[0],3.8,p[1],11,0.5,11,0xAAB8C0));
    });
    [[-35,10],[35,-10],[-10,35],[10,-35],[-40,-40],[40,40]].forEach(p=>b.push(B(p[0],1,p[1],2,2,2,0x8B5A2B,'wood',true,50)));
    return { name:'coldfront', label:'Coldfront', size:140, boxes:b,
      spawns:{ red:[[-62,0,-50],[-62,0,50],[-62,7,0]], blue:[[62,0,-50],[62,0,50],[62,7,0]],
        ffa:[[-40,0,-40],[40,0,40],[-40,0,40],[40,0,-40],[0,0,-55],[0,0,55],[0,0,10]] },
      flags:{ red:[-62,0,0], blue:[62,0,0] }, sites:{ A:[0,0,0], B:[20,0,20] },
      theme:{ sky:0xC7D6E0, fog:[0xC7D6E0,0.018], ambient:0.65, sun:[0.3,1,0.5], weather:'snow' } };
  }

  C.buildMap = function (name) {
    return { dustfall, ironworks, coldfront }[name]();
  };
  C.MAP_NAMES = ['dustfall','ironworks','coldfront'];

  // XP
  C.XP = { kill:100, headshot:25, assist:50, capture:300, plant:200, defuse:200, win:500 };

  if (typeof module !== 'undefined') module.exports = C;
  g.SHARED = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
