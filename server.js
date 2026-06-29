// ============================================================
//  FPS MULTIPLAYER SERVER — Authoritative WebSocket Server
// ============================================================
//  Protocol Messages (JSON with `type` field):
//
//  Client -> Server:
//    { type: "join",            payload: { name } }
//    { type: "create_room",     payload: { roomName, mapId } }
//    { type: "join_room",       payload: { roomId } }
//    { type: "leave_room",      payload: {} }
//    { type: "player_input",    payload: { f,b,l,r,jump,run,shoot, yaw, pitch } }
//    { type: "shoot",           payload: { yaw, pitch } }
//    { type: "ping",            payload: { t } }
//
//  Server -> Client:
//    { type: "lobby_state",     payload: { rooms: [...] } }
//    { type: "room_joined",     payload: { roomId, roomName, mapId, yourId, players, mapData } }
//    { type: "player_joined",   payload: { id, name, position } }
//    { type: "player_left",     payload: { id } }
//    { type: "game_state",      payload: { players: [...], t } }
//    { type: "hit",             payload: { shooterId, targetId, damage, targetHealth } }
//    { type: "kill",            payload: { killerId, killerName, victimId, victimName } }
//    { type: "spawn",           payload: { playerId, position } }
//    { type: "pong",            payload: { t } }
//    { type: "error",           payload: { message } }
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 30; // Hz
const TICK_DT = 1 / TICK_RATE;
const TICK_INTERVAL = 1000 / TICK_RATE;
const RESPAWN_TIME = 3000; // ms
const FIRE_RATE = 100; // ms between shots
const WEAPON_DAMAGE = 25;
const PLAYER_RADIUS = 0.5;
const MAX_HEALTH = 100;

// ============================================================
//  MAP DEFINITIONS  (shared format — sent to client on join)
// ============================================================
const MAPS = {
  warehouse: {
    name: 'Warehouse',
    size: { width: 50, depth: 50, height: 10 },
    obstacles: [
      // Outer walls
      { pos: [0, 5, -25], size: [50, 10, 1] },
      { pos: [0, 5, 25],  size: [50, 10, 1] },
      { pos: [-25, 5, 0], size: [1, 10, 50] },
      { pos: [25, 5, 0],  size: [1, 10, 50] },
      // Containers
      { pos: [-10, 1.5, -10], size: [6, 3, 6], color: 0x8B4513 },
      { pos: [10, 1.5, 10],   size: [6, 3, 6], color: 0x8B4513 },
      { pos: [-10, 1.5, 10],  size: [6, 3, 6], color: 0x556B2F },
      { pos: [10, 1.5, -10],  size: [6, 3, 6], color: 0x556B2F },
      { pos: [0, 1.5, 0],     size: [8, 3, 3], color: 0x696969 },
      { pos: [-18, 1.5, 0],   size: [3, 3, 8], color: 0x696969 },
      { pos: [18, 1.5, 0],    size: [3, 3, 8], color: 0x696969 },
      // Ramps / cover
      { pos: [0, 0.75, -15], size: [4, 1.5, 2], color: 0x4A4A4A },
      { pos: [0, 0.75, 15],  size: [4, 1.5, 2], color: 0x4A4A4A },
    ],
    spawnPoints: [
      { x: -20, y: 1.7, z: -20 }, { x: 20, y: 1.7, z: -20 },
      { x: -20, y: 1.7, z: 20 },  { x: 20, y: 1.7, z: 20 },
      { x: 0, y: 1.7, z: -22 },   { x: 0, y: 1.7, z: 22 },
      { x: -22, y: 1.7, z: 0 },   { x: 22, y: 1.7, z: 0 },
    ],
    floorColor: 0x2a2a2a, wallColor: 0x3a3a3a, skyColor: 0x1a1a2e,
  },
  desert: {
    name: 'Desert Outpost',
    size: { width: 70, depth: 70, height: 12 },
    obstacles: [
      // Outer walls (low)
      { pos: [0, 3, -35], size: [70, 6, 1] },
      { pos: [0, 3, 35],  size: [70, 6, 1] },
      { pos: [-35, 3, 0], size: [1, 6, 70] },
      { pos: [35, 3, 0],  size: [1, 6, 70] },
      // Bunkers
      { pos: [-15, 1.5, -15], size: [8, 3, 8], color: 0xC2B280 },
      { pos: [15, 1.5, 15],   size: [8, 3, 8], color: 0xC2B280 },
      { pos: [-15, 1.5, 15],  size: [8, 3, 8], color: 0xC2B280 },
      { pos: [15, 1.5, -15],  size: [8, 3, 8], color: 0xC2B280 },
      // Central structure
      { pos: [0, 2, 0], size: [10, 4, 10], color: 0xA0522D },
      // Sandbag walls
      { pos: [-25, 0.75, 0], size: [2, 1.5, 12], color: 0xD2B48C },
      { pos: [25, 0.75, 0],  size: [2, 1.5, 12], color: 0xD2B48C },
      { pos: [0, 0.75, -25], size: [12, 1.5, 2], color: 0xD2B48C },
      { pos: [0, 0.75, 25],  size: [12, 1.5, 2], color: 0xD2B48C },
    ],
    spawnPoints: [
      { x: -30, y: 1.7, z: -30 }, { x: 30, y: 1.7, z: -30 },
      { x: -30, y: 1.7, z: 30 },  { x: 30, y: 1.7, z: 30 },
      { x: 0, y: 1.7, z: -30 },   { x: 0, y: 1.7, z: 30 },
      { x: -30, y: 1.7, z: 0 },   { x: 30, y: 1.7, z: 0 },
    ],
    floorColor: 0xC2B280, wallColor: 0x8B7355, skyColor: 0x87CEEB,
  },
  sniper: {
    name: 'Sniper Tower',
    size: { width: 40, depth: 40, height: 20 },
    obstacles: [
      // Outer walls
      { pos: [0, 10, -20], size: [40, 20, 1] },
      { pos: [0, 10, 20],  size: [40, 20, 1] },
      { pos: [-20, 10, 0], size: [1, 20, 40] },
      { pos: [20, 10, 0],  size: [1, 20, 40] },
      // Central tower
      { pos: [0, 5, 0],   size: [6, 10, 6], color: 0x4A4A4A },
      { pos: [0, 10.5, 0], size: [8, 1, 8], color: 0x666666 },
      // Corner towers
      { pos: [-14, 4, -14], size: [4, 8, 4], color: 0x555555 },
      { pos: [14, 4, -14],  size: [4, 8, 4], color: 0x555555 },
      { pos: [-14, 4, 14],  size: [4, 8, 4], color: 0x555555 },
      { pos: [14, 4, 14],   size: [4, 8, 4], color: 0x555555 },
      // Platforms on top of corner towers
      { pos: [-14, 8.5, -14], size: [5, 1, 5], color: 0x777777 },
      { pos: [14, 8.5, -14],  size: [5, 1, 5], color: 0x777777 },
      { pos: [-14, 8.5, 14],  size: [5, 1, 5], color: 0x777777 },
      { pos: [14, 8.5, 14],   size: [5, 1, 5], color: 0x777777 },
      // Ramps to corner towers
      { pos: [-10, 2, -10], size: [2, 4, 6], color: 0x444444 },
      { pos: [10, 2, -10],  size: [2, 4, 6], color: 0x444444 },
      { pos: [-10, 2, 10],  size: [2, 4, 6], color: 0x444444 },
      { pos: [10, 2, 10],   size: [2, 4, 6], color: 0x444444 },
      // Cover blocks
      { pos: [-6, 0.75, 0],  size: [2, 1.5, 4], color: 0x333333 },
      { pos: [6, 0.75, 0],   size: [2, 1.5, 4], color: 0x333333 },
      { pos: [0, 0.75, -6],  size: [4, 1.5, 2], color: 0x333333 },
      { pos: [0, 0.75, 6],   size: [4, 1.5, 2], color: 0x333333 },
    ],
    spawnPoints: [
      { x: -16, y: 1.7, z: -16 }, { x: 16, y: 1.7, z: -16 },
      { x: -16, y: 1.7, z: 16 },  { x: 16, y: 1.7, z: 16 },
      { x: 0, y: 1.7, z: -16 },   { x: 0, y: 1.7, z: 16 },
      { x: -16, y: 1.7, z: 0 },   { x: 16, y: 1.7, z: 0 },
      // Tower spawns
      { x: -14, y: 9.5, z: -14 }, { x: 14, y: 9.5, z: 14 },
    ],
    floorColor: 0x3a3a3a, wallColor: 0x2a2a2a, skyColor: 0x0a0a1a,
  },
};

// ============================================================
//  PLAYER
// ============================================================
class Player {
  constructor(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.room = null;
    this.position = { x: 0, y: 1.7, z: 0 };
    this.rotation = { yaw: 0, pitch: 0 };
    this.velocityY = 0;
    this.health = MAX_HEALTH;
    this.kills = 0;
    this.deaths = 0;
    this.alive = true;
    this.input = { f: false, b: false, l: false, r: false, jump: false, run: false, shoot: false };
    this.lastShootTime = 0;
    this.ping = 0;
    this.color = PLAYER_COLORS[id % PLAYER_COLORS.length];
  }

  reset(map) {
    const spawn = map.spawnPoints[Math.floor(Math.random() * map.spawnPoints.length)];
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.velocityY = 0;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.rotation = { yaw: 0, pitch: 0 };
  }
}

const PLAYER_COLORS = [
  0xff4444, 0x44ff44, 0x4488ff, 0xffff44,
  0xff44ff, 0x44ffff, 0xff8844, 0x88ff44,
  0x4488ff, 0xff44ff, 0x44ff88, 0xff88ff,
  0x8844ff, 0x44ff44, 0xffffff, 0xaaaaaa,
];

// ============================================================
//  ROOM
// ============================================================
class Room {
  constructor(id, name, mapId) {
    this.id = id;
    this.name = name;
    this.mapId = mapId;
    this.players = new Map();
    this.maxPlayers = 16;
  }

  addPlayer(player) {
    if (this.players.size >= this.maxPlayers) return false;
    this.players.set(player.id, player);
    player.room = this;
    player.reset(MAPS[this.mapId]);
    player.kills = 0;
    player.deaths = 0;
    return true;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) player.room = null;
    this.players.delete(playerId);
  }

  getSpawn() {
    const map = MAPS[this.mapId];
    return map.spawnPoints[Math.floor(Math.random() * map.spawnPoints.length)];
  }

  isEmpty() { return this.players.size === 0; }
}

// ============================================================
//  GLOBAL STATE
// ============================================================
const rooms = new Map();
const players = new Map();
let nextPlayerId = 1;
let nextRoomId = 1;

// ============================================================
//  HTTP SERVER (serves client.html)
// ============================================================
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/client.html') {
    const filePath = path.join(__dirname, 'client.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading client.html — make sure it is in the same folder as server.js');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

// ============================================================
//  WEBSOCKET HANDLING
// ============================================================
wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  let player = null;

  console.log(`[CONNECT] New connection → pending join (id=${playerId})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // -------- JOIN --------
      case 'join': {
        if (player) return;
        const name = (msg.payload.name || 'Player').slice(0, 16);
        player = new Player(playerId, name, ws);
        players.set(playerId, player);
        console.log(`[JOIN] ${name} (id=${playerId})`);
        send(ws, { type: 'lobby_state', payload: { rooms: getLobbyRooms() } });
        break;
      }

      // -------- CREATE ROOM --------
      case 'create_room': {
        if (!player) return;
        if (player.room) leaveRoom(player);
        const mapId = msg.payload.mapId || 'warehouse';
        const roomName = (msg.payload.roomName || `Room ${nextRoomId}`).slice(0, 24);
        if (!MAPS[mapId]) { send(ws, { type: 'error', payload: { message: 'Invalid map' } }); return; }

        const room = new Room(nextRoomId++, roomName, mapId);
        room.addPlayer(player);
        rooms.set(room.id, room);
        console.log(`[ROOM] Created "${roomName}" (id=${room.id}, map=${mapId}) by ${player.name}`);

        send(ws, {
          type: 'room_joined',
          payload: {
            roomId: room.id, roomName: room.name, mapId: room.mapId,
            yourId: player.id, players: getRoomPlayers(room), mapData: MAPS[room.mapId],
          }
        });
        broadcastLobbyState();
        break;
      }

      // -------- JOIN ROOM --------
      case 'join_room': {
        if (!player) return;
        const room = rooms.get(msg.payload.roomId);
        if (!room) { send(ws, { type: 'error', payload: { message: 'Room not found' } }); return; }
        if (player.room) leaveRoom(player);
        if (!room.addPlayer(player)) {
          send(ws, { type: 'error', payload: { message: 'Room is full' } });
          return;
        }
        console.log(`[ROOM] ${player.name} joined room ${room.id}`);

        broadcastToRoom(room, {
          type: 'player_joined',
          payload: { id: player.id, name: player.name, color: player.color, position: player.position }
        }, player.id);

        send(ws, {
          type: 'room_joined',
          payload: {
            roomId: room.id, roomName: room.name, mapId: room.mapId,
            yourId: player.id, players: getRoomPlayers(room), mapData: MAPS[room.mapId],
          }
        });
        broadcastLobbyState();
        break;
      }

      // -------- LEAVE ROOM --------
      case 'leave_room': {
        if (!player || !player.room) return;
        leaveRoom(player);
        send(ws, { type: 'lobby_state', payload: { rooms: getLobbyRooms() } });
        break;
      }

      // -------- PLAYER INPUT --------
      case 'player_input': {
        if (!player || !player.room) return;
        const p = msg.payload;
        player.input.f = !!p.f;
        player.input.b = !!p.b;
        player.input.l = !!p.l;
        player.input.r = !!p.r;
        player.input.jump = !!p.jump;
        player.input.run = !!p.run;
        player.input.shoot = !!p.shoot;
        if (typeof p.yaw === 'number') player.rotation.yaw = p.yaw;
        if (typeof p.pitch === 'number') player.rotation.pitch = p.pitch;
        break;
      }

      // -------- SHOOT --------
      case 'shoot': {
        if (!player || !player.room || !player.alive) return;
        handleShoot(player, msg.payload);
        break;
      }

      // -------- PING --------
      case 'ping': {
        send(ws, { type: 'pong', payload: { t: msg.payload.t } });
        break;
      }

    }
  });

  ws.on('close', () => {
    if (player) {
      console.log(`[DISCONNECT] ${player.name} (id=${player.id})`);
      if (player.room) leaveRoom(player);
      players.delete(player.id);
    }
    broadcastLobbyState();
  });

  ws.on('error', () => {});
});

// ============================================================
//  SHOOTING — Server-side raycasting (authoritative)
// ============================================================
function handleShoot(player, payload) {
  const now = Date.now();
  if (now - player.lastShootTime < FIRE_RATE) return;
  player.lastShootTime = now;

  // Use yaw/pitch from payload (client's view at click moment)
  const yaw = payload.yaw ?? player.rotation.yaw;
  const pitch = payload.pitch ?? player.rotation.pitch;

  // Compute ray origin (slightly forward from camera) and direction
  const origin = {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
  };
  const dir = {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };

  // Ray-sphere intersection against each other player
  let closestHit = null;
  let closestT = Infinity;

  for (const other of player.room.players.values()) {
    if (other.id === player.id || !other.alive) continue;

    const cx = other.position.x, cy = other.position.y, cz = other.position.z;
    const r = PLAYER_RADIUS + 0.3; // slightly forgiving hitbox

    // Sphere at chest height
    const sphereCenter = { x: cx, y: cy, z: cz };

    const oc = { x: origin.x - sphereCenter.x, y: origin.y - sphereCenter.y, z: origin.z - sphereCenter.z };
    const a = dir.x*dir.x + dir.y*dir.y + dir.z*dir.z;
    const b = 2 * (oc.x*dir.x + oc.y*dir.y + oc.z*dir.z);
    const c = oc.x*oc.x + oc.y*oc.y + oc.z*oc.z - r*r;
    const disc = b*b - 4*a*c;

    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2*a);
    if (t < 0) continue;

    // Check if any obstacle blocks the shot
    if (isBlockedByObstacle(origin, dir, t, player.room.mapId)) continue;

    if (t < closestT) {
      closestT = t;
      closestHit = other;
    }
  }

  if (closestHit) {
    closestHit.health -= WEAPON_DAMAGE;
    broadcastToRoom(player.room, {
      type: 'hit',
      payload: {
        shooterId: player.id, targetId: closestHit.id,
        damage: WEAPON_DAMAGE, targetHealth: closestHit.health,
      }
    });

    if (closestHit.health <= 0) {
      closestHit.alive = false;
      closestHit.health = 0;
      closestHit.deaths++;
      player.kills++;

      broadcastToRoom(player.room, {
        type: 'kill',
        payload: {
          killerId: player.id, killerName: player.name,
          victimId: closestHit.id, victimName: closestHit.name,
        }
      });

      // Schedule respawn
      const victimId = closestHit.id;
      const room = player.room;
      setTimeout(() => {
        const v = room.players.get(victimId);
        if (!v || !v.room) return;
        v.reset(MAPS[room.mapId]);
        broadcastToRoom(room, {
          type: 'spawn',
          payload: { playerId: v.id, position: v.position }
        });
      }, RESPAWN_TIME);
    }
  }
}

// Simple ray-AABB intersection check against obstacles
function isBlockedByObstacle(origin, dir, maxT, mapId) {
  const map = MAPS[mapId];
  for (const obs of map.obstacles) {
    const [ox, oy, oz] = obs.pos;
    const [ow, oh, od] = obs.size;
    const minX = ox - ow/2, maxX = ox + ow/2;
    const minY = oy - oh/2, maxY = oy + oh/2;
    const minZ = oz - od/2, maxZ = oz + od/2;

    // Ray-AABB (slab method)
    let tmin = -Infinity, tmax = Infinity;

    for (const [o, d, lo, hi] of [
      [origin.x, dir.x, minX, maxX],
      [origin.y, dir.y, minY, maxY],
      [origin.z, dir.z, minZ, maxZ],
    ]) {
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) { tmin = Infinity; break; }
      } else {
        let t1 = (lo - o) / d, t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { tmin = Infinity; break; }
      }
    }

    if (tmin !== Infinity && tmin > 0 && tmin < maxT) return true;
  }
  return false;
}

// ============================================================
//  TICK LOOP — Update positions & broadcast state
// ============================================================
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.isEmpty()) continue;
    for (const player of room.players.values()) {
      if (player.alive) updatePlayerMovement(player);
    }
    broadcastGameState(room);
  }
}, TICK_INTERVAL);

function updatePlayerMovement(player) {
  const map = MAPS[player.room.mapId];
  const dt = TICK_DT;
  const speed = player.input.run ? 8 : 5;

  // Direction vectors based on yaw
  const cosY = Math.cos(player.rotation.yaw);
  const sinY = Math.sin(player.rotation.yaw);
  // Forward = (-sin, 0, -cos), Right = (cos, 0, -sin)
  let mx = 0, mz = 0;
  if (player.input.f) { mx -= sinY; mz -= cosY; }
  if (player.input.b) { mx += sinY; mz += cosY; }
  if (player.input.r) { mx += cosY; mz -= sinY; }
  if (player.input.l) { mx -= cosY; mz += sinY; }

  const len = Math.hypot(mx, mz);
  if (len > 0) {
    mx = (mx / len) * speed * dt;
    mz = (mz / len) * speed * dt;
  }

  // Move X with collision
  const newX = player.position.x + mx;
  if (!collidesWithObstacle(newX, player.position.z, PLAYER_RADIUS, map)) {
    player.position.x = newX;
  }
  // Move Z with collision
  const newZ = player.position.z + mz;
  if (!collidesWithObstacle(player.position.x, newZ, PLAYER_RADIUS, map)) {
    player.position.z = newZ;
  }

  // Clamp to map bounds
  const hw = map.size.width / 2 - 0.5;
  const hd = map.size.depth / 2 - 0.5;
  player.position.x = Math.max(-hw, Math.min(hw, player.position.x));
  player.position.z = Math.max(-hd, Math.min(hd, player.position.z));

  // Jump / gravity
  if (player.input.jump && player.position.y <= 1.71) {
    player.velocityY = 7;
  }
  player.velocityY -= 20 * dt;
  player.position.y += player.velocityY * dt;
  if (player.position.y < 1.7) {
    player.position.y = 1.7;
    player.velocityY = 0;
  }
}

function collidesWithObstacle(x, z, radius, map) {
  for (const obs of map.obstacles) {
    // Skip very tall walls (handled by bounds clamping) — only block solid structures
    const [ox, , oz] = obs.pos;
    const [ow, oh, od] = obs.size;
    if (oh > 8) continue; // skip outer walls (they're at bounds)

    const minX = ox - ow/2 - radius;
    const maxX = ox + ow/2 + radius;
    const minZ = oz - od/2 - radius;
    const maxZ = oz + od/2 + radius;
    if (x > minX && x < maxX && z > minZ && z < maxZ) return true;
  }
  return false;
}

// ============================================================
//  BROADCAST / SERIALIZE HELPERS
// ============================================================
function broadcastGameState(room) {
  const playersArr = [];
  for (const p of room.players.values()) {
    playersArr.push({
      id: p.id, name: p.name, color: p.color,
      x: round(p.position.x), y: round(p.position.y), z: round(p.position.z),
      yaw: round(p.rotation.yaw, 3), pitch: round(p.rotation.pitch, 3),
      health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths,
    });
  }
  const msg = { type: 'game_state', payload: { players: playersArr, t: Date.now() } };
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function broadcastToRoom(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function getRoomPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color,
    x: round(p.position.x), y: round(p.position.y), z: round(p.position.z),
    yaw: round(p.rotation.yaw, 3), health: p.health, alive: p.alive,
    kills: p.kills, deaths: p.deaths,
  }));
}

function getLobbyRooms() {
  return [...rooms.values()].map(r => ({
    id: r.id, name: r.name, mapId: r.mapId, mapName: MAPS[r.mapId].name,
    playerCount: r.players.size, maxPlayers: r.maxPlayers,
  }));
}

function broadcastLobbyState() {
  const msg = { type: 'lobby_state', payload: { rooms: getLobbyRooms() } };
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (!p.room && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function leaveRoom(player) {
  if (!player.room) return;
  const room = player.room;
  room.removePlayer(player.id);
  broadcastToRoom(room, { type: 'player_left', payload: { id: player.id } });
  if (room.isEmpty()) {
    rooms.delete(room.id);
    console.log(`[ROOM] Deleted empty room ${room.id}`);
  }
  broadcastLobbyState();
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function round(n, d = 2) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ============================================================
//  START
// ============================================================
server.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  FPS MULTIPLAYER SERVER                  ║`);
  console.log(`║  HTTP:  http://localhost:${PORT}          ║`);
  console.log(`║  WS:    ws://localhost:${PORT}            ║`);
  console.log(`║  Tick:  ${TICK_RATE} Hz                     ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`\nMở trình duyệt: http://localhost:${PORT}`);
  console.log(`Mở nhiều tab để test multiplayer.\n`);
});
