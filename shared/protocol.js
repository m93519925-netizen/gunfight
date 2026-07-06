/* Message type constants + tiny helpers. JSON protocol. */
(function (g) {
  const P = {
    // client -> server
    HELLO:'hello', CREATE_ROOM:'create', JOIN_ROOM:'join', LEAVE_ROOM:'leave',
    LIST_ROOMS:'list', SET_READY:'ready', SET_TEAM:'team', SET_SETTINGS:'settings',
    KICK:'kick', FORCE_START:'start', INPUT:'input', FIRE:'fire', RELOAD:'reload',
    SWITCH:'switch', THROW:'throw', MELEE:'melee', USE:'use', CHAT:'chat', PING:'ping',
    // server -> client
    WELCOME:'welcome', ROOMS:'rooms', LOBBY:'lobby', GAME_START:'gstart',
    SNAPSHOT:'snap', HIT_CONFIRM:'hitc', DAMAGED:'dmg', KILL:'kill', RESPAWN:'resp',
    EVENT:'event', SCORE:'score', GAME_OVER:'gover', CHAT_MSG:'chatm', PONG:'pong',
    ERROR:'err', EXPLOSION:'boom', PROJECTILE:'proj', DESTROY:'destroy'
  };
  P.pack = (t, d) => JSON.stringify(Object.assign({ t }, d));
  P.unpack = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  if (typeof module !== 'undefined') module.exports = P;
  g.PROTO = P;
})(typeof globalThis !== 'undefined' ? globalThis : this);
