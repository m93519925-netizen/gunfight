// ============================================================
//  FPS MULTIPLAYER SERVER — Authoritative WebSocket Server
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const TICK_RATE = 30;
const TICK_DT = 1 / TICK_RATE;
const TICK_INTERVAL = 1000 / TICK_RATE;
const RESPAWN_TIME = 3000;
const FIRE_RATE = 100;
const WEAPON_DAMAGE = 25;
const PLAYER_RADIUS = 0.5;
const MAX_HEALTH = 100;

// Map definitions đổi màu trời sáng sủa hơn & map rộng ra
const MAPS = {
  warehouse: {
    name: 'Warehouse',
    size: { width: 90, depth: 90, height: 12 },
    obstacles: [
      // Vách bao ngoài (rộng 90)
      { pos: [0, 6, -45], size: [90, 12, 1] }, { pos: [0, 6, 45],  size: [90, 12, 1] },
      { pos: [-45, 6, 0], size: [1, 12, 90] }, { pos: [45, 6, 0],  size: [1, 12, 90] },
      // Container và vật cản rải rác
      { pos: [-20, 1.5, -20], size: [6, 3, 6], color: 0x8B4513 },
      { pos: [20, 1.5, 20],   size: [6, 3, 6], color: 0x8B4513 },
      { pos: [-20, 1.5, 20],  size: [6, 3, 6], color: 0x556B2F },
      { pos: [20, 1.5, -20],  size: [6, 3, 6], color: 0x556B2F },
      { pos: [0, 1.5, 0],     size: [10, 3, 4], color: 0x696969 },
      { pos: [-30, 1.5, 0],   size: [4, 3, 12], color: 0x696969 },
      { pos: [30, 1.5, 0],    size: [4, 3, 12], color: 0x696969 },
      { pos: [0, 1.5, -30],   size: [12, 3, 4], color: 0x696969 },
      { pos: [0, 1.5, 30],    size: [12, 3, 4], color: 0x696969 },
      { pos: [0, 0.75, -15], size: [6, 1.5, 2], color: 0x4A4A4A },
      { pos: [0, 0.75, 15],  size: [6, 1.5, 2], color: 0x4A4A4A },
      // Thêm vật cản ở vùng ngoại vi mới
      { pos: [-38, 1.5, -38], size: [8, 3, 8], color: 0x8B4513 },
      { pos: [38, 1.5, 38],   size: [8, 3, 8], color: 0x8B4513 },
      { pos: [-38, 1.5, 38],  size: [8, 3, 8], color: 0x556B2F },
      { pos: [38, 1.5, -38],  size: [8, 3, 8], color: 0x556B2F },
      { pos: [-15, 1.5, 35],  size: [4, 3, 10], color: 0x696969 },
      { pos: [15, 1.5, -35],  size: [4, 3, 10], color: 0x696969 },
    ],
    spawnPoints: [
      { x: -40, y: 1.7, z: -40 }, { x: 40, y: 1.7, z: -40 },
      { x: -40, y: 1.7, z: 40 },  { x: 40, y: 1.7, z: 40 },
      { x: 0, y: 1.7, z: -42 },   { x: 0, y: 1.7, z: 42 },
      { x: -42, y: 1.7, z: 0 },   { x: 42, y: 1.7, z: 0 },
      { x: -25, y: 1.7, z: 25 },  { x: 25, y: 1.7, z: -25 },
      { x: -35, y: 1.7, z: 10 },  { x: 35, y: 1.7, z: -10 },
    ],
    floorColor: 0x888888, wallColor: 0xAAAAAA, skyColor: 0x87CEEB,
  },
  desert: {
    name: 'Desert Outpost',
    size: { width: 120, depth: 120, height: 14 },
    obstacles: [
      // Vách bao ngoài (rộng 120)
      { pos: [0, 3, -60], size: [120, 6, 1] }, { pos: [0, 3, 60],  size: [120, 6, 1] },
      { pos: [-60, 3, 0], size: [1, 6, 120] }, { pos: [60, 3, 0],  size: [1, 6, 120] },
      // Lô cốt và bao cát
      { pos: [-25, 1.5, -25], size: [8, 3, 8], color: 0xC2B280 },
      { pos: [25, 1.5, 25],   size: [8, 3, 8], color: 0xC2B280 },
      { pos: [-25, 1.5, 25],  size: [8, 3, 8], color: 0xC2B280 },
      { pos: [25, 1.5, -25],  size: [8, 3, 8], color: 0xC2B280 },
      { pos: [0, 2, 0], size: [12, 4, 12], color: 0xA0522D },
      { pos: [-40, 0.75, 0], size: [3, 1.5, 15], color: 0xD2B48C },
      { pos: [40, 0.75, 0],  size: [3, 1.5, 15], color: 0xD2B48C },
      { pos: [0, 0.75, -40], size: [15, 1.5, 3], color: 0xD2B48C },
      { pos: [0, 0.75, 40],  size: [15, 1.5, 3], color: 0xD2B48C },
      // Vật cản vùng ngoại vi
      { pos: [-50, 1.5, -50], size: [10, 3, 10], color: 0xA0522D },
      { pos: [50, 1.5, 50],   size: [10, 3, 10], color: 0xA0522D },
      { pos: [-50, 1.5, 50],  size: [10, 3, 10], color: 0xA0522D },
      { pos: [50, 1.5, -50],  size: [10, 3, 10], color: 0xA0522D },
      { pos: [0, 0.75, -55],  size: [20, 1.5, 3], color: 0xD2B48C },
      { pos: [0, 0.75, 55],   size: [20, 1.5, 3], color: 0xD2B48C },
      { pos: [-55, 0.75, 0],  size: [3, 1.5, 20], color: 0xD2B48C },
      { pos: [55, 0.75, 0],   size: [3, 1.5, 20], color: 0xD2B48C },
    ],
    spawnPoints: [
      { x: -50, y: 1.7, z: -50 }, { x: 50, y: 1.7, z: -50 },
      { x: -50, y: 1.7, z: 50 },  { x: 50, y: 1.7, z: 50 },
      { x: 0, y: 1.7, z: -50 },   { x: 0, y: 1.7, z: 50 },
      { x: -50, y: 1.7, z: 0 },   { x: 50, y: 1.7, z: 0 },
      { x: -30, y: 1.7, z: 30 },  { x: 30, y: 1.7, z: -30 },
      { x: -45, y: 1.7, z: 20 },  { x: 45, y: 1.7, z: -20 },
    ],
    floorColor: 0xD2B48C, wallColor: 0x8B7355, skyColor: 0x87CEEB,
  },
  sniper: {
    name: 'Sniper Tower',
    size: { width: 80, depth: 80, height: 22 },
    obstacles: [
      // Vách bao ngoài (rộng 80)
      { pos: [0, 11, -40], size: [80, 22, 1] }, { pos: [0, 11, 40],  size: [80, 22, 1] },
      { pos: [-40, 11, 0], size: [1, 22, 80] }, { pos: [40, 11, 0],  size: [1, 22, 80] },
      // Tháp giữa
      { pos: [0, 5, 0],   size: [8, 10, 8], color: 0x4A4A4A },
      { pos: [0, 10.5, 0], size: [12, 1, 12], color: 0x666666 },
      // Tháp 4 góc
      { pos: [-30, 4, -30], size: [6, 8, 6], color: 0x555555 },
      { pos: [30, 4, -30],  size: [6, 8, 6], color: 0x555555 },
      { pos: [-30, 4, 30],  size: [6, 8, 6], color: 0x555555 },
      { pos: [30, 4, 30],   size: [6, 8, 6], color: 0x555555 },
      { pos: [-30, 8.5, -30], size: [8, 1, 8], color: 0x777777 },
      { pos: [30, 8.5, -30],  size: [8, 1, 8], color: 0x777777 },
      { pos: [-30, 8.5, 30],  size: [8, 1, 8], color: 0x777777 },
      { pos: [30, 8.5, 30],   size: [8, 1, 8], color: 0x777777 },
      // Dốc lên tháp
      { pos: [-20, 2, -20], size: [2, 4, 8], color: 0x444444 },
      { pos: [20, 2, -20],  size: [2, 4, 8], color: 0x444444 },
      { pos: [-20, 2, 20],  size: [2, 4, 8], color: 0x444444 },
      { pos: [20, 2, 20],   size: [2, 4, 8], color: 0x444444 },
      // Vật cản ngoài
      { pos: [-10, 0.75, 0],  size: [3, 1.5, 6], color: 0x333333 },
      { pos: [10, 0.75, 0],   size: [3, 1.5, 6], color: 0x333333 },
      { pos: [0, 0.75, -10],  size: [6, 1.5, 3], color: 0x333333 },
      { pos: [0, 0.75, 10],   size: [6, 1.5, 3], color: 0x333333 },
      { pos: [-35, 1.5, -15], size: [4, 3, 4], color: 0x555555 },
      { pos: [35, 1.5, 15],   size: [4, 3, 4], color: 0x555555 },
    ],
    spawnPoints: [
      { x: -35, y: 1.7, z: -35 }, { x: 35, y: 1.7, z: -35 },
      { x: -35, y: 1.7, z: 35 },  { x: 35, y: 1.7, z: 35 },
      { x: 0, y: 1.7, z: -35 },   { x: 0, y: 1.7, z: 35 },
      { x: -35, y: 1.7, z: 0 },   { x: 35, y: 1.7, z: 0 },
      { x: -30, y: 9.5, z: -30 }, { x: 30, y: 9.5, z: 30 },
      { x: 0, y: 9.5, z: 0 },     { x: -15, y: 1.7, z: 30 },
    ],
    floorColor: 0xAAAAAA, wallColor: 0x999999, skyColor: 0x87CEEB,
  },
};

class Player {
  constructor(id, name, ws) {
    this.id = id; this.name = name; this.ws = ws; this.room = null;
    this.position = { x: 0, y: 1.7, z: 0 }; this.rotation = { yaw: 0, pitch: 0 };
    this.velocityY = 0; this.health = MAX_HEALTH; this.kills = 0; this.deaths = 0;
    this.alive = true; this.input = { f: false, b: false, l: false, r: false, jump: false, run: false, shoot: false };
    this.lastShootTime = 0; this.ping = 0;
    this.color = PLAYER_COLORS[id % PLAYER_COLORS.length];
  }
  reset(map) {
    const spawn = map.spawnPoints[Math.floor(Math.random() * map.spawnPoints.length)];
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.velocityY = 0; this.health = MAX_HEALTH; this.alive = true; this.rotation = { yaw: 0, pitch: 0 };
  }
}

const PLAYER_COLORS = [0xff4444, 0x44ff44, 0x4488ff, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x88ff44, 0x4488ff, 0xff44ff, 0x44ff88, 0xff88ff, 0x8844ff, 0x44ff44, 0xffffff, 0xaaaaaa];
class Room {
  constructor(id, name, mapId) { this.id = id; this.name = name; this.mapId = mapId; this.players = new Map(); this.maxPlayers = 16; }
  addPlayer(player) { if (this.players.size >= this.maxPlayers) return false; this.players.set(player.id, player); player.room = this; player.reset(MAPS[this.mapId]); player.kills = 0; player.deaths = 0; return true; }
  removePlayer(playerId) { const p = this.players.get(playerId); if (p) p.room = null; this.players.delete(playerId); }
  isEmpty() { return this.players.size === 0; }
}

const rooms = new Map(); const players = new Map();
let nextPlayerId = 1; let nextRoomId = 1;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/client.html') {
    fs.readFile(path.join(__dirname, 'client.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading client.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data);
    });
  } else { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++; let player = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.type) {
      case 'join': {
        if (player) return; const name = (msg.payload.name || 'Player').slice(0, 16);
        player = new Player(playerId, name, ws); players.set(playerId, player);
        send(ws, { type: 'lobby_state', payload: { rooms: getLobbyRooms() } }); break;
      }
      case 'create_room': {
        if (!player) return; if (player.room) leaveRoom(player);
        const mapId = msg.payload.mapId || 'warehouse';
        const roomName = (msg.payload.roomName || `Room ${nextRoomId}`).slice(0, 24);
        if (!MAPS[mapId]) { send(ws, { type: 'error', payload: { message: 'Invalid map' } }); return; }
        const room = new Room(nextRoomId++, roomName, mapId); room.addPlayer(player); rooms.set(room.id, room);
        send(ws, { type: 'room_joined', payload: { roomId: room.id, roomName: room.name, mapId: room.mapId, yourId: player.id, players: getRoomPlayers(room), mapData: MAPS[room.mapId] } });
        broadcastLobbyState(); break;
      }
      case 'join_room': {
        if (!player) return; const room = rooms.get(msg.payload.roomId);
        if (!room) { send(ws, { type: 'error', payload: { message: 'Room not found' } }); return; }
        if (player.room) leaveRoom(player);
        if (!room.addPlayer(player)) { send(ws, { type: 'error', payload: { message: 'Room is full' } }); return; }
        broadcastToRoom(room, { type: 'player_joined', payload: { id: player.id, name: player.name, color: player.color, position: player.position } }, player.id);
        send(ws, { type: 'room_joined', payload: { roomId: room.id, roomName: room.name, mapId: room.mapId, yourId: player.id, players: getRoomPlayers(room), mapData: MAPS[room.mapId] } });
        broadcastLobbyState(); break;
      }
      case 'leave_room': { if (!player || !player.room) return; leaveRoom(player); send(ws, { type: 'lobby_state', payload: { rooms: getLobbyRooms() } }); break; }
      case 'player_input': {
        if (!player || !player.room) return; const p = msg.payload;
        player.input.f = !!p.f; player.input.b = !!p.b; player.input.l = !!p.l; player.input.r = !!p.r;
        player.input.jump = !!p.jump; player.input.run = !!p.run; player.input.shoot = !!p.shoot;
        if (typeof p.yaw === 'number') player.rotation.yaw = p.yaw;
        if (typeof p.pitch === 'number') player.rotation.pitch = p.pitch;
        break;
      }
      case 'shoot': { if (!player || !player.room || !player.alive) return; handleShoot(player, msg.payload); break; }
      case 'ping': { send(ws, { type: 'pong', payload: { t: msg.payload.t } }); break; }
    }
  });
  ws.on('close', () => { if (player) { if (player.room) leaveRoom(player); players.delete(player.id); } broadcastLobbyState(); });
  ws.on('error', () => {});
});

function handleShoot(player, payload) {
  const now = Date.now(); if (now - player.lastShootTime < FIRE_RATE) return;
  player.lastShootTime = now; const yaw = payload.yaw ?? player.rotation.yaw; const pitch = payload.pitch ?? player.rotation.pitch;
  const origin = { x: player.position.x, y: player.position.y, z: player.position.z };
  const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  let closestHit = null; let closestT = Infinity;
  for (const other of player.room.players.values()) {
    if (other.id === player.id || !other.alive) continue;
    const r = PLAYER_RADIUS + 0.3; const cx = other.position.x, cy = other.position.y, cz = other.position.z;
    const oc = { x: origin.x - cx, y: origin.y - cy, z: origin.z - cz };
    const a = dir.x*dir.x + dir.y*dir.y + dir.z*dir.z;
    const b = 2 * (oc.x*dir.x + oc.y*dir.y + oc.z*dir.z);
    const c = oc.x*oc.x + oc.y*oc.y + oc.z*oc.z - r*r; const disc = b*b - 4*a*c;
    if (disc < 0) continue; const t = (-b - Math.sqrt(disc)) / (2*a); if (t < 0) continue;
    if (isBlockedByObstacle(origin, dir, t, player.room.mapId)) continue;
    if (t < closestT) { closestT = t; closestHit = other; }
  }
  if (closestHit) {
    closestHit.health -= WEAPON_DAMAGE;
    broadcastToRoom(player.room, { type: 'hit', payload: { shooterId: player.id, targetId: closestHit.id, damage: WEAPON_DAMAGE, targetHealth: closestHit.health } });
    if (closestHit.health <= 0) {
      closestHit.alive = false; closestHit.health = 0; closestHit.deaths++; player.kills++;
      broadcastToRoom(player.room, { type: 'kill', payload: { killerId: player.id, killerName: player.name, victimId: closestHit.id, victimName: closestHit.name } });
      const victimId = closestHit.id; const room = player.room;
      setTimeout(() => { const v = room.players.get(victimId); if (!v || !v.room) return; v.reset(MAPS[room.mapId]); broadcastToRoom(room, { type: 'spawn', payload: { playerId: v.id, position: v.position } }); }, RESPAWN_TIME);
    }
  }
}

function isBlockedByObstacle(origin, dir, maxT, mapId) {
  const map = MAPS[mapId];
  for (const obs of map.obstacles) {
    const [ox, oy, oz] = obs.pos; const [ow, oh, od] = obs.size;
    const minX = ox - ow/2, maxX = ox + ow/2, minY = oy - oh/2, maxY = oy + oh/2, minZ = oz - od/2, maxZ = oz + od/2;
    let tmin = -Infinity, tmax = Infinity;
    for (const [o, d, lo, hi] of [[origin.x, dir.x, minX, maxX], [origin.y, dir.y, minY, maxY], [origin.z, dir.z, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) { tmin = Infinity; break; } }
      else { let t1 = (lo - o) / d, t2 = (hi - o) / d; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { tmin = Infinity; break; } }
    }
    if (tmin !== Infinity && tmin > 0 && tmin < maxT) return true;
  }
  return false;
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.isEmpty()) continue;
    for (const player of room.players.values()) { if (player.alive) updatePlayerMovement(player); }
    broadcastGameState(room);
  }
}, TICK_INTERVAL);

function updatePlayerMovement(player) {
  const map = MAPS[player.room.mapId]; const dt = TICK_DT; const speed = player.input.run ? 9 : 5; 
  const cosY = Math.cos(player.rotation.yaw); const sinY = Math.sin(player.rotation.yaw);
  let mx = 0, mz = 0;
  if (player.input.f) { mx -= sinY; mz -= cosY; } if (player.input.b) { mx += sinY; mz += cosY; }
  if (player.input.r) { mx += cosY; mz -= sinY; } if (player.input.l) { mx -= cosY; mz += sinY; }
  const len = Math.hypot(mx, mz); if (len > 0) { mx = (mx / len) * speed * dt; mz = (mz / len) * speed * dt; }
  const newX = player.position.x + mx; if (!collidesWithObstacle(newX, player.position.z, PLAYER_RADIUS, map)) player.position.x = newX;
  const newZ = player.position.z + mz; if (!collidesWithObstacle(player.position.x, newZ, PLAYER_RADIUS, map)) player.position.z = newZ;
  const hw = map.size.width / 2 - 0.5; const hd = map.size.depth / 2 - 0.5;
  player.position.x = Math.max(-hw, Math.min(hw, player.position.x)); player.position.z = Math.max(-hd, Math.min(hd, player.position.z));
  if (player.input.jump && player.position.y <= 1.71) player.velocityY = 7;
  player.velocityY -= 20 * dt; player.position.y += player.velocityY * dt;
  if (player.position.y < 1.7) { player.position.y = 1.7; player.velocityY = 0; }
}

function collidesWithObstacle(x, z, radius, map) {
  for (const obs of map.obstacles) {
    const [ox, , oz] = obs.pos; const [ow, oh, od] = obs.size; if (oh > 8) continue;
    const minX = ox - ow/2 - radius, maxX = ox + ow/2 + radius, minZ = oz - od/2 - radius, maxZ = oz + od/2 + radius;
    if (x > minX && x < maxX && z > minZ && z < maxZ) return true;
  }
  return false;
}

function broadcastGameState(room) {
  const playersArr = [];
  for (const p of room.players.values()) playersArr.push({ id: p.id, name: p.name, color: p.color, x: round(p.position.x), y: round(p.position.y), z: round(p.position.z), yaw: round(p.rotation.yaw, 3), pitch: round(p.rotation.pitch, 3), health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths });
  const msg = { type: 'game_state', payload: { players: playersArr, t: Date.now() } }; const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
}
function broadcastToRoom(room, msg, exceptId = null) { const data = JSON.stringify(msg); for (const p of room.players.values()) { if (p.id === exceptId) continue; if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data); } }
function getRoomPlayers(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, x: round(p.position.x), y: round(p.position.y), z: round(p.position.z), yaw: round(p.rotation.yaw, 3), health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths })); }
function getLobbyRooms() { return [...rooms.values()].map(r => ({ id: r.id, name: r.name, mapId: r.mapId, mapName: MAPS[r.mapId].name, playerCount: r.players.size, maxPlayers: r.maxPlayers })); }
function broadcastLobbyState() { const msg = { type: 'lobby_state', payload: { rooms: getLobbyRooms() } }; const data = JSON.stringify(msg); for (const p of players.values()) if (!p.room && p.ws.readyState === WebSocket.OPEN) p.ws.send(data); }
function leaveRoom(player) { if (!player.room) return; const room = player.room; room.removePlayer(player.id); broadcastToRoom(room, { type: 'player_left', payload: { id: player.id } }); if (room.isEmpty()) rooms.delete(room.id); broadcastLobbyState(); }
function send(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function round(n, d = 2) { const f = Math.pow(10, d); return Math.round(n * f) / f; }

server.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  FPS MULTIPLAYER SERVER                  ║`);
  console.log(`║  HTTP:  http://localhost:${PORT}          ║`);
  console.log(`║  WS:    ws://localhost:${PORT}            ║`);
  console.log(`╚══════════════════════════════════════════╝`);
});
