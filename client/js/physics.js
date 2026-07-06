/* Custom AABB physics: move-and-slide against map boxes. */
const Physics = {
  boxes: [],       // {min:[x,y,z], max:[x,y,z], destroyed, idx}

  setMap(mapDef) {
    this.boxes = mapDef.boxes.map((b, i) => ({
      min:[b.x-b.w/2, b.y-b.h/2, b.z-b.d/2], max:[b.x+b.w/2, b.y+b.h/2, b.z+b.d/2],
      destroyed:false, idx:i, mat:b.m
    }));
  },
  destroyBox(i) { const b = this.boxes.find(x => x.idx === i); if (b) b.destroyed = true; },

  /* Move a player AABB (feet position). Returns { grounded, surface }. */
  move(pos, vel, dt, height, radius) {
    let grounded = false, surface = 'stone';
    const half = [radius, height/2, radius];
    const axes = [0, 2, 1]; // x, z, then y (better step behavior)
    for (const a of axes) {
      pos[a === 0 ? 'x' : a === 1 ? 'y' : 'z'] += (a===0?vel.x:a===1?vel.y:vel.z) * dt;
      const c = [pos.x, pos.y + height/2, pos.z];
      for (const b of this.boxes) {
        if (b.destroyed) continue;
        const ox = Math.min(c[0]+half[0], b.max[0]) - Math.max(c[0]-half[0], b.min[0]);
        const oy = Math.min(c[1]+half[1], b.max[1]) - Math.max(c[1]-half[1], b.min[1]);
        const oz = Math.min(c[2]+half[2], b.max[2]) - Math.max(c[2]-half[2], b.min[2]);
        if (ox <= 0 || oy <= 0 || oz <= 0) continue;
        if (a === 0) { pos.x += c[0] < (b.min[0]+b.max[0])/2 ? -ox : ox; vel.x = 0; }
        else if (a === 2) { pos.z += c[2] < (b.min[2]+b.max[2])/2 ? -oz : oz; vel.z = 0; }
        else {
          if (c[1] < (b.min[1]+b.max[1])/2) { pos.y -= oy; if (vel.y > 0) vel.y = 0; }
          else { pos.y += oy; if (vel.y < 0) { vel.y = 0; grounded = true; surface = b.mat; } }
        }
        c[0]=pos.x; c[1]=pos.y+height/2; c[2]=pos.z;
      }
    }
    if (pos.y <= 0) { pos.y = 0; vel.y = Math.max(0, vel.y); grounded = true; }
    return { grounded, surface };
  },

  /* Raycast against world boxes; returns {t, mat} or null. */
  raycast(o, d, maxT) {
    let best = null;
    for (const b of this.boxes) {
      if (b.destroyed) continue;
      let tmin = 0, tmax = maxT || 1e9, ok = true;
      for (let i = 0; i < 3; i++) {
        const oi = i===0?o.x:i===1?o.y:o.z, di = i===0?d.x:i===1?d.y:d.z;
        if (Math.abs(di) < 1e-9) { if (oi < b.min[i] || oi > b.max[i]) { ok = false; break; } }
        else {
          let t1=(b.min[i]-oi)/di, t2=(b.max[i]-oi)/di;
          if (t1>t2) [t1,t2]=[t2,t1];
          tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
          if (tmin>tmax) { ok=false; break; }
        }
      }
      if (ok && tmin > 0.01 && (!best || tmin < best.t)) best = { t:tmin, mat:b.mat };
    }
    return best;
  }
};
