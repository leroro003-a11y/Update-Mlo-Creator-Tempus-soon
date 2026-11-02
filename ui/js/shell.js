// Interior shell for a vanilla house. The interior is a set of rectangles (add / cut), so the automatic fit and hand edits share one model.
// Walls are thin: the room's surface is the detected inner boundary and the wall box reaches outward by `wallDepth` towards the game's own wall.
// Output has the same shape as Mesher.build(): batches, collision boxes, portals, lights.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const TEX = M.TEX;
    const MAXV = 60000;
    const OPEN = {
        door: { w: 0.9, z0: 0, z1: 2.1, portal: 8192 },
        window: { w: 0.9, z0: 0.9, z1: 2.1, portal: 0, glass: true },
        arch: { w: 1.0, z0: 0, z1: 2.3, portal: 8192 }
    };

    // The surfaces a collision box can have: the game's own surface types (the numbers are the lines of data\materials\materials.dat), with the colour of the
    // box's outline in the editor. The type decides how it sounds, how bullets go through it and what it does to a ragdoll.
    const COLMATS = [
        { id: 'concrete', name: 'Concrete', type: 1, col: [0.72, 0.74, 0.80] }, { id: 'plaster', name: 'Plaster, drywall', type: 101, col: [0.95, 0.90, 0.72] },
        { id: 'brick', name: 'Brick', type: 13, col: [0.90, 0.52, 0.40] }, { id: 'stone', name: 'Stone', type: 11, col: [0.62, 0.66, 0.62] }, { id: 'marble', name: 'Marble', type: 14, col: [0.86, 0.88, 0.95] },
        { id: 'wood', name: 'Wood (polished)', type: 72, col: [0.82, 0.62, 0.36] }, { id: 'metal', name: 'Metal (solid)', type: 56, col: [0.55, 0.72, 0.95] }, { id: 'railing', name: 'Metal railing', type: 65, col: [0.40, 0.62, 0.90] },
        { id: 'tile', name: 'Tile (ceramic)', type: 81, col: [0.55, 0.92, 0.92] }, { id: 'carpet', name: 'Carpet', type: 97, col: [0.78, 0.58, 0.85] }, { id: 'linoleum', name: 'Linoleum', type: 95, col: [0.70, 0.85, 0.55] },
        { id: 'plastic', name: 'Plastic', type: 86, col: [0.95, 0.60, 0.80] }, { id: 'glass', name: 'Glass (shoot through)', type: 112, col: [0.50, 0.90, 1.0] }
    ];
    const COLMAT = {}; COLMATS.forEach(m => { COLMAT[m.id] = m; });
    M.COLMATS = { list: COLMATS, byId: COLMAT, get: (id) => COLMAT[id] || COLMAT.concrete };

    function uniq(a) { a.sort((p, q) => p - q); const o = []; for (const v of a) if (!o.length || Math.abs(v - o[o.length - 1]) > 1e-6) o.push(v); return o; }

    // compressed grid of the region (union of 'add' rects minus 'cut' rects, in order)
    function regionGrid(shell, extraX, extraY) {
        const xs = [], ys = [];
        shell.ops.forEach(o => { xs.push(o.r[0], o.r[2]); ys.push(o.r[1], o.r[3]); });
        (extraX || []).forEach(v => xs.push(v)); (extraY || []).forEach(v => ys.push(v));
        const X = uniq(xs), Y = uniq(ys), nx = Math.max(X.length - 1, 0), ny = Math.max(Y.length - 1, 0), mask = [];
        for (let i = 0; i < nx; i++) mask.push(new Array(ny).fill(false));
        shell.ops.forEach(o => {
            const r = o.r;
            for (let i = 0; i < nx; i++) {
                const cx = (X[i] + X[i + 1]) / 2; if (cx <= r[0] || cx >= r[2]) continue;
                for (let j = 0; j < ny; j++) { const cy = (Y[j] + Y[j + 1]) / 2; if (cy > r[1] && cy < r[3]) mask[i][j] = o.op === 'add'; }
            }
        });
        return { X, Y, nx, ny, mask };
    }

    // wall segments along the boundary of the region; inward = which side of the wall line the room is on (+1 = towards +x / +y)
    function boundary(g) {
        const segs = [];
        for (let j = 0; j <= g.ny; j++) {
            let cur = null;
            for (let i = 0; i < g.nx; i++) {
                const below = j > 0 ? g.mask[i][j - 1] : false, above = j < g.ny ? g.mask[i][j] : false;
                if (below !== above) {
                    const inward = above ? 1 : -1;
                    if (cur && cur.inward === inward && Math.abs(cur.u1 - g.X[i]) < 1e-6) cur.u1 = g.X[i + 1];
                    else { cur = { o: 'H', c: g.Y[j], u0: g.X[i], u1: g.X[i + 1], inward, ops: [] }; segs.push(cur); }
                } else cur = null;
            }
        }
        for (let i = 0; i <= g.nx; i++) {
            let cur = null;
            for (let j = 0; j < g.ny; j++) {
                const left = i > 0 ? g.mask[i - 1][j] : false, right = i < g.nx ? g.mask[i][j] : false;
                if (left !== right) {
                    const inward = right ? 1 : -1;
                    if (cur && cur.inward === inward && Math.abs(cur.u1 - g.Y[j]) < 1e-6) cur.u1 = g.Y[j + 1];
                    else { cur = { o: 'V', c: g.X[i], u0: g.Y[j], u1: g.Y[j + 1], inward, ops: [] }; segs.push(cur); }
                } else cur = null;
            }
        }
        return segs;
    }

    function build(project, opts) {
        opts = opts || {};
        const S = project.shell, cfg = project.settings, D = project.defaults;
        const H = cfg.ceilH, depth = cfg.wallDepth, PT = cfg.partT, floorSurfaceZ = 0.003;
        const exportMode = opts.mode === 'export';
        // several floors (levels): `shared` = this floor makes what belongs to the whole building (the openings cut from the model, the collision boxes, the solid
        // doors); `rise` = how far up the floor above is (its stairs go that high); `holesBelow` = the stairs of the floor below, which come up through this floor
        const shared = opts.shared !== false, rise = opts.rise || null, holesBelow = opts.holesBelow || [], stairs = S.stairs || [];
        // walls and ceiling that follow the building's roof (a floor under sloping roofs, shell.roofFit): the room is as high as its ceiling, or as the roof's
        // underside less 5 cm where that is lower
        const roofFn = opts.roof !== undefined ? opts.roof : (S.roofFit && project.kind === 'import' && M.ImportModel && M.ImportModel.roofAt ? M.ImportModel.roofAt() : null);
        const topAt = (x, y) => roofFn ? Math.max(0, Math.min(H, roofFn(x, y) - 0.05)) : H;
        // the same, but no higher than the roof 10 cm round the point: a wall under a step in the roof stays under the lower side too, and the ceiling meets
        // the top of the walls (both are taken this way)
        const topAtS = (x, y) => roofFn ? Math.min(topAt(x, y), topAt(x + 0.1, y), topAt(x - 0.1, y), topAt(x, y + 0.1), topAt(x, y - 0.1)) : H;
        const wantBoxes = exportMode || !!opts.boxes;         // the collision boxes are made for the export, and for the editor's "my collision" outline
        // walls = 'skin' (imported models only): the walls are the building's own wall faces turned to look into the rooms, so they cannot be off by a millimetre;
        // no wall pieces or wall collision are made from the room edges (the game's own collision of the building stays). Openings, trim and portals still are.
        const skin = project.kind === 'import' && cfg.walls === 'skin';
        const acc = new Map(), batches = [], boxes = [], matList = [], matIdx = new Map(), portals = [], lights = [];
        const bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
        const stats = { tris: 0, boxes: 0, portals: 0, lights: 0, warnings: [] };

        function emitQuad(kind, group, tex, glass, a, b, c, d) {
            const key = kind + '|' + group + '|' + tex + '|' + (glass ? 1 : 0);
            let m = acc.get(key);
            if (!m || m.pos.length / 3 + 4 > MAXV) { m = { level: 0, kind, group, tex, glass: !!glass, pos: [], nrm: [], uv: [], idx: [] }; acc.set(key, m); batches.push(m); }
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
            const tile = glass ? 1 : TEX.tile(tex), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), base = m.pos.length / 3;
            [a, b, c, d].forEach(p => {
                m.pos.push(p[0], p[1], p[2]); m.nrm.push(nx, ny, nz);
                if (ax >= ay && ax >= az) m.uv.push(p[1] / tile, -p[2] / tile); else if (ay >= ax && ay >= az) m.uv.push(p[0] / tile, -p[2] / tile); else m.uv.push(p[0] / tile, p[1] / tile);
                for (let q = 0; q < 3; q++) { if (p[q] < bmn[q]) bmn[q] = p[q]; if (p[q] > bmx[q]) bmx[q] = p[q]; }
            });
            m.idx.push(base, base + 1, base + 2, base + 2, base + 3, base); stats.tris += 2;
        }
        // one triangle (a, b, c); the normal follows the winding
        function emitTri(kind, group, tex, a, b, c) {
            const key = kind + '|' + group + '|' + tex + '|0'; let m = acc.get(key);
            if (!m || m.pos.length / 3 + 3 > MAXV) { m = { level: 0, kind, group, tex, glass: false, pos: [], nrm: [], uv: [], idx: [] }; acc.set(key, m); batches.push(m); }
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
            const tile = TEX.tile(tex), ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), base = m.pos.length / 3;
            [a, b, c].forEach(p => {
                m.pos.push(p[0], p[1], p[2]); m.nrm.push(nx, ny, nz);
                if (ax >= ay && ax >= az) m.uv.push(p[1] / tile, -p[2] / tile); else if (ay >= ax && ay >= az) m.uv.push(p[0] / tile, -p[2] / tile); else m.uv.push(p[0] / tile, p[1] / tile);
                for (let q = 0; q < 3; q++) { if (p[q] < bmn[q]) bmn[q] = p[q]; if (p[q] > bmx[q]) bmx[q] = p[q]; }
            });
            m.idx.push(base, base + 1, base + 2); stats.tris += 1;
        }
        // axis-aligned rectangle in the plane ax = f, ranges (p0,p1) x (q0,q1) over the cyclic pair of the other axes; sign = facing direction
        function pq(kind, group, tex, glass, ax, f, p0, p1, q0, q1, sign) {
            if (p1 - p0 < 1e-5 || q1 - q0 < 1e-5) return;
            const P = (p, q) => ax === 'x' ? [f, p, q] : (ax === 'y' ? [q, f, p] : [p, q, f]);
            const a = P(p0, q0), b = P(p1, q0), c = P(p1, q1), d = P(p0, q1);
            if (sign > 0) emitQuad(kind, group, tex, glass, a, b, c, d); else emitQuad(kind, group, tex, glass, a, d, c, b);
        }
        function box(kind, group, tex, x0, y0, z0, x1, y1, z1) {
            pq(kind, group, tex, false, 'x', x1, y0, y1, z0, z1, 1); pq(kind, group, tex, false, 'x', x0, y0, y1, z0, z1, -1);
            pq(kind, group, tex, false, 'y', y1, z0, z1, x0, x1, 1); pq(kind, group, tex, false, 'y', y0, z0, z1, x0, x1, -1);
            pq(kind, group, tex, false, 'z', z1, x0, x1, y0, y1, 1); pq(kind, group, tex, false, 'z', z0, x0, x1, y0, y1, -1);
        }
        function cbox(x0, y0, z0, x1, y1, z1, type, room) {
            if (!wantBoxes) return;
            if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
            const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            boxes.push([x0, y0, z0, x1, y1, z1, mi]);
        }
        // collision faces of their own (a stair's ramp): both sides of a quad, [a, b, c, material] each
        const cpolys = [];
        function cquad(a, b, c, d, type, room) {
            if (!wantBoxes) return; const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            cpolys.push([a, b, c, mi], [c, d, a, mi], [a, c, b, mi], [c, a, d, mi]);
        }
        // a collision box that is turned about Z (the ones the user draws): the first six numbers are the box around it, the eighth says how it really stands
        function cboxO(cx, cy, z0, z1, hu, hn, yaw, type, room, id) {
            if (!wantBoxes) return;
            if (hu < 5e-5 || hn < 5e-5 || z1 - z0 < 1e-4) return;
            const mk = type + '|' + room; let mi = matIdx.get(mk);
            if (mi === undefined) { mi = matList.length; matList.push([type, room]); matIdx.set(mk, mi); }
            const c = Math.cos(yaw), s = Math.sin(yaw), square = Math.abs(s) < 1e-9 || Math.abs(c) < 1e-9;
            const ex = Math.abs(c) * hu + Math.abs(s) * hn, ey = Math.abs(s) * hu + Math.abs(c) * hn;
            boxes.push([cx - ex, cy - ey, z0, cx + ex, cy + ey, z1, mi, square ? { user: id } : { user: id, cx, cy, hu, hn, yaw }]);          // (square to the grid: the box around it is the box)
        }

        // ---------------- region, floors, ceiling ----------------
        const fx = [], fy = [];
        (S.floors || []).forEach(f => { fx.push(f.r[0], f.r[2]); fy.push(f.r[1], f.r[3]); });
        holesBelow.concat(stairs).forEach(h => { fx.push(h.r[0], h.r[2]); fy.push(h.r[1], h.r[3]); });
        const g = regionGrid(S, fx, fy);
        const inRects = (list, x, y) => list.some(h => x > h.r[0] && x < h.r[2] && y > h.r[1] && y < h.r[3]);
        const inRegion = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
        const floorTexAt = (cx, cy) => { let t = D.floor; (S.floors || []).forEach(f => { if (cx > f.r[0] && cx < f.r[2] && cy > f.r[1] && cy < f.r[3]) t = f.tex; }); return t; };
        {
            const cells = [], used = [];
            for (let i = 0; i < g.nx; i++) { used.push(new Array(g.ny).fill(false)); for (let j = 0; j < g.ny; j++) if (g.mask[i][j]) cells.push([i, j, floorTexAt((g.X[i] + g.X[i + 1]) / 2, (g.Y[j] + g.Y[j + 1]) / 2)]); }
            // (a cell under a stair hole of the floor above has no ceiling, one over the stairs of the floor below no floor: they are kept apart when joined)
            const keyAt = (cx, cy) => floorTexAt(cx, cy) + '|' + (inRects(holesBelow, cx, cy) ? 1 : 0) + (inRects(stairs, cx, cy) ? 1 : 0);
            cells.forEach(c => { c[2] = keyAt((g.X[c[0]] + g.X[c[0] + 1]) / 2, (g.Y[c[1]] + g.Y[c[1] + 1]) / 2); });
            const texOf = (i, j) => g.mask[i][j] ? keyAt((g.X[i] + g.X[i + 1]) / 2, (g.Y[j] + g.Y[j + 1]) / 2) : null;
            cells.forEach(c => {
                const i = c[0], j = c[1]; if (used[i][j]) return; const key = c[2], kp = key.split('|'), tex = kp[0], noFloor = kp[1][0] === '1', noCeil = kp[1][1] === '1';
                let i1 = i + 1; while (i1 < g.nx && !used[i1][j] && texOf(i1, j) === key) i1++;
                let j1 = j + 1; for (; j1 < g.ny; j1++) { let ok = true; for (let x = i; x < i1; x++) if (used[x][j1] || texOf(x, j1) !== key) { ok = false; break; } if (!ok) break; }
                for (let x = i; x < i1; x++) for (let y = j; y < j1; y++) used[x][y] = true;
                const x0 = g.X[i], x1 = g.X[i1], y0 = g.Y[j], y1 = g.Y[j1];
                if (!noFloor) { pq('floor', 'int', tex, false, 'z', floorSurfaceZ, x0, x1, y0, y1, 1); cbox(x0, y0, -0.35, x1, y1, 0, TEX.colType(tex), 1); }
                if (!noCeil && !roofFn) { pq('roof', 'int', D.ceiling, false, 'z', H, x0, x1, y0, y1, -1); cbox(x0, y0, H, x1, y1, H + 0.1, 101, 0); }
            });
        }

        // ---------------- the ceiling under the roof (a floor that follows the roof) ----------------
        // One grid for the whole floor (the room's edges and every 40 cm), each corner's height worked out once and shared by the pieces round it, so the
        // pieces meet without a crack. Flat pieces (the roof is over the ceiling there) get collision, a row of them one box; under the slopes the collision
        // is the building's own roof, which is kept there (see ImportModel.allRoomVolumes).
        let CX = null, CY = null;            // (the grid's lines: the walls and partitions under the roof are cut at them too, so their tops meet the ceiling's corners)
        if (roofFn) {
            const step = 0.4, X = [], Y = [], TT = Math.max(0, Math.min(0.5, +cfg.wallThick || 0));
            // the room's edges, the inner faces of its walls (moved in by the wall thickness), the faces of the partitions, and every 40 cm
            g.X.forEach(v => { X.push(v); if (TT > 0.0005) X.push(v - TT, v + TT); }); g.Y.forEach(v => { Y.push(v); if (TT > 0.0005) Y.push(v - TT, v + TT); });
            (S.parts || []).forEach(pt => { const L = pt.o === 'H' ? Y : X, A = pt.o === 'H' ? X : Y; L.push(pt.c - PT / 2, pt.c + PT / 2); A.push(pt.u0, pt.u1); });
            for (let v = Math.ceil(g.X[0] / step) * step; v < g.X[g.nx]; v += step) X.push(v);
            for (let v = Math.ceil(g.Y[0] / step) * step; v < g.Y[g.ny]; v += step) Y.push(v);
            const XS = uniq(X), YS = uniq(Y), T = YS.map(y => XS.map(x => topAtS(x, y))); CX = XS; CY = YS;
            const on = (a, b) => { const cx = (XS[a] + XS[a + 1]) / 2, cy = (YS[b] + YS[b + 1]) / 2; return inRegion(cx, cy) && !inRects(stairs, cx, cy); };
            for (let b = 0; b + 1 < YS.length; b++) {
                let run = -1;
                const flush = (endA) => { if (run >= 0) cbox(XS[run], YS[b], H, XS[endA], YS[b + 1], H + 0.1, 101, 0); run = -1; };
                for (let a = 0; a + 1 < XS.length; a++) {
                    if (!on(a, b)) { flush(a); continue; }
                    const p00 = [XS[a], YS[b], T[b][a]], p01 = [XS[a], YS[b + 1], T[b + 1][a]], p11 = [XS[a + 1], YS[b + 1], T[b + 1][a + 1]], p10 = [XS[a + 1], YS[b], T[b][a + 1]];
                    emitQuad('roof', 'int', D.ceiling, false, p00, p01, p11, p10);
                    if (Math.min(p00[2], p01[2], p11[2], p10[2]) >= H - 1e-4) { if (run < 0) run = a; } else flush(a);
                }
                flush(XS.length - 1);
            }
        }

        // ---------------- stairs up to the floor above, and the railing round the stairs that come up from the floor below ----------------
        // A stair is a rectangle (r) and the way it goes up (dir: '+x', '-x', '+y', '-y'); its steps are solid blocks of about 18 cm, each one a collision box,
        // up to the floor above (without one: up to the ceiling). The ceiling has a hole over it, the floor above has a hole where it comes up (holesBelow).
        const stairTex = D.stair || D.floor, stepRise = 0.18;
        // A stair's shape (st.kind): 'straight', 'l' (two flights round a landing in the far corner), 'u' (up one side, a landing across the far end, back up
        // the other side) or 'spiral' (round a post in the middle). st.turn 'r' turns right instead of left; st.open: treads on stringers instead of solid steps;
        // st.step: the height of a step (15 to 22 cm, 18 when not set); st.w: the width of a flight of an L or U stair; st.rail: handrails on the flights.
        // The collision is solid under every step (a turned box for each step of a spiral), so it can be walked up.
        function buildStair(st, up) {
            const r = st.r, d = st.dir, A = d[1] === 'x' ? r[2] - r[0] : r[3] - r[1], B = d[1] === 'x' ? r[3] - r[1] : r[2] - r[0], ct = TEX.colType(stairTex);
            const n = Math.max(2, Math.round(up / Math.min(0.22, Math.max(0.15, st.step || stepRise)))), sh = up / n, flip = st.turn === 'r', open = !!st.open;
            // the stair's own frame: u along the way up (0..A), v across it (0..B, to the left of the way up; mirrored for a right turn)
            const W = (u, v) => { if (flip) v = B - v; return d === '+x' ? [r[0] + u, r[1] + v] : d === '-x' ? [r[2] - u, r[3] - v] : d === '+y' ? [r[2] - v, r[1] + u] : [r[0] + v, r[3] - u]; };
            const ext = (u0, v0, u1, v1) => { const p = W(u0, v0), q = W(u1, v1); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]; };
            const lbox = (u0, v0, z0, u1, v1, z1, tex) => { const e = ext(u0, v0, u1, v1); box('floor', 'int', tex || stairTex, e[0], e[1], z0, e[2], e[3], z1); };
            const lcol = (u0, v0, u1, v1, z1) => { const e = ext(u0, v0, u1, v1); cbox(e[0], e[1], 0, e[2], e[3], z1, ct, 1); };
            // a step's box: for the walk test of the editor; the game walks on the ramps below (people catch on the edges of boxes, as on no stair of the game)
            const scol = (u0, v0, u1, v1, z1) => { const n0 = boxes.length; lcol(u0, v0, u1, v1, z1); if (boxes.length > n0) boxes[n0][7] = Object.assign(boxes[n0][7] || {}, { stair: true }); };
            const P3 = (u, v, z) => { const w = W(u, v); return [w[0], w[1], z]; };
            // a flight's ramp: from half a step over the floor at its start, through the middle of every tread, flat over the last half tread
            const ramp = (u0, v0, u1, v1, along, back, k0, cnt) => {
                if (cnt <= 0) return; const L = (along === 'u' ? u1 - u0 : v1 - v0), len = L / cnt, z0 = (k0 - 0.5) * sh, zt = (k0 + cnt - 1) * sh;
                const at = (s, w) => { const a = along === 'u' ? (back ? u1 - s : u0 + s) : (back ? v1 - s : v0 + s); return along === 'u' ? P3(a, v0 + (v1 - v0) * w, 0) : P3(u0 + (u1 - u0) * w, a, 0); };
                const Q = (s, w, z) => { const p = at(s, w); p[2] = z; return p; }, s1 = L - len / 2;
                cquad(Q(0, 0, z0), Q(s1, 0, zt), Q(s1, 1, zt), Q(0, 1, z0), ct, 1); cquad(Q(s1, 0, zt), Q(L, 0, zt), Q(L, 1, zt), Q(s1, 1, zt), ct, 1);
            };
            const rail = (u0, v0, u1, v1, top, post) => {                      // a piece of handrail 90 cm over a tread, with a post at its start
                if (post) { const pu = u0 + (u1 - u0) * 0.5, pv = v0 + (v1 - v0) * 0.5; lbox(pu - 0.02, pv - 0.02, top, pu + 0.02, pv + 0.02, top + 0.9, D.trim); }
                lbox(u0, v0, top + 0.86, u1, v1, top + 0.9, D.trim);
            };
            // one step (k: 1 for the lowest) over [u0,u1] x [v0,v1]
            const step = (u0, v0, u1, v1, k) => { const top = k * sh; lbox(u0, v0, open ? top - 0.05 : 0, u1, v1, top); scol(u0, v0, u1, v1, top); };
            // a flight: cnt steps along u (or v), from u0 up to u1 (back: from u1 down to u0), the first being step k0; its stringers and rails on both sides
            const flight = (u0, v0, u1, v1, along, back, k0, cnt) => {
                if (cnt <= 0) return; const len = ((along === 'u' ? u1 - u0 : v1 - v0)) / cnt; ramp(u0, v0, u1, v1, along, back, k0, cnt);
                for (let i = 0; i < cnt; i++) {
                    const a = back ? (along === 'u' ? u1 : v1) - (i + 1) * len : (along === 'u' ? u0 : v0) + i * len, top = (k0 + i) * sh;
                    if (along === 'u') step(a, v0, a + len, v1, k0 + i); else step(u0, a, u1, a + len, k0 + i);
                    [0, 1].forEach(side => {
                        const s0 = along === 'u' ? (side ? v1 - 0.04 : v0) : (side ? u1 - 0.04 : u0), s1 = s0 + 0.04;
                        if (open) { if (along === 'u') lbox(a, s0, Math.max(0, top - 0.32), a + len, s1, top - 0.05, D.trim); else lbox(s0, a, Math.max(0, top - 0.32), s1, a + len, top - 0.05, D.trim); }
                        if (st.rail) { if (along === 'u') rail(a, s0, a + len, s1, top, i % 2 === 0); else rail(s0, a, s1, a + len, top, i % 2 === 0); }
                    });
                }
            };
            const landing = (u0, v0, u1, v1, k) => { const top = k * sh; lbox(u0, v0, open ? top - 0.12 : 0, u1, v1, top); lcol(u0, v0, u1, v1, top); };
            const kind = st.kind || 'straight';
            if (kind === 'l' && A > 1.2 && B > 1.2) {
                const w = Math.max(0.6, Math.min(st.w || 1.0, A - 0.5, B - 0.5)), r1 = A - w, r2 = B - w;
                let n1 = Math.max(1, Math.round((n - 1) * r1 / (r1 + r2))); if (n - 1 - n1 < 1) n1 = n - 2; const n2 = n - 1 - n1;
                flight(0, 0, r1, w, 'u', false, 1, n1); landing(r1, 0, A, w, n1 + 1); flight(r1, w, A, B, 'v', false, n1 + 2, n2);
            } else if (kind === 'u' && A > 1.2 && B > 1.0) {
                const w = Math.max(0.5, Math.min(st.w || B / 2, B / 2)), run = A - w, n1 = Math.max(1, Math.floor((n - 1) / 2)), n2 = n - 1 - n1;
                flight(0, 0, run, w, 'u', false, 1, n1); landing(run, 0, A, B, n1 + 1); flight(0, B - w, run, B, 'u', true, n1 + 2, n2);
            } else if (kind === 'spiral') {
                // wedges round a post, 6 cm thick, each one a step higher, turning left (right when mirrored) from the side the stairs start on
                const R = Math.min(A, B) / 2 - 0.02, cu = A / 2, cv = B / 2, ri = 0.08, da = Math.min(0.6, Math.max(0.3, 0.26 / (0.6 * R))), a0 = Math.PI;
                const P = (a, rr, z) => { const w = W(cu + Math.cos(a) * rr, cv + Math.sin(a) * rr); return [w[0], w[1], z]; };
                const quad = (p, q, s, t) => flip ? emitQuad('floor', 'int', stairTex, false, p, t, s, q) : emitQuad('floor', 'int', stairTex, false, p, q, s, t);
                for (let i = 0; i < n; i++) {
                    const aa = a0 + i * da, ab = aa + da, top = (i + 1) * sh, bot = top - 0.06;
                    quad(P(aa, ri, top), P(aa, R, top), P(ab, R, top), P(ab, ri, top));                                  // tread
                    quad(P(aa, ri, bot), P(ab, ri, bot), P(ab, R, bot), P(aa, R, bot));                                  // under it
                    quad(P(aa, ri, bot), P(aa, R, bot), P(aa, R, top), P(aa, ri, top));                                  // front
                    quad(P(ab, ri, bot), P(ab, ri, top), P(ab, R, top), P(ab, R, bot));                                  // back
                    quad(P(aa, R, bot), P(ab, R, bot), P(ab, R, top), P(aa, R, top));                                    // outer edge
                    const am = (aa + ab) / 2, c = P(am, R * 0.55, 0), t = P(am + 0.01, R * 0.55, 0), n0 = boxes.length;
                    cboxO(c[0], c[1], 0, top, R * 0.55 * da / 2 + 0.02, R * 0.42, Math.atan2(t[1] - c[1], t[0] - c[0]), ct, 1);
                    if (boxes.length > n0) boxes[n0][7] = Object.assign(boxes[n0][7] || {}, { stair: true });          // (the walk test's; the game walks on the ramp)
                    // the ramp: from the middle of this tread to the middle of the next one (from half a step up at the start; flat over the last half tread)
                    const zA = i === 0 ? sh / 2 : top, zB = i === n - 1 ? top : top + sh, a0r = i === 0 ? aa : am, a1r = i === n - 1 ? ab : am + da;
                    cquad(P(a0r, ri, zA), P(a0r, R, zA), P(a1r, R, zB), P(a1r, ri, zB), ct, 1);
                    if (st.rail) { const o = P(am, R - 0.03, 0); box('floor', 'int', D.trim, o[0] - 0.02, o[1] - 0.02, top, o[0] + 0.02, o[1] + 0.02, top + 0.9); }
                }
                const pc = W(cu, cv); box('floor', 'int', D.trim, pc[0] - 0.07, pc[1] - 0.07, 0, pc[0] + 0.07, pc[1] + 0.07, up + (st.rail ? 0.9 : 0)); cbox(pc[0] - 0.07, pc[1] - 0.07, 0, pc[0] + 0.07, pc[1] + 0.07, up, ct, 1);
            } else flight(0, 0, A, B, 'u', false, 1, n);
        }
        stairs.forEach(st => {
            // the well: the sides of the hole from this ceiling up to the floor above, so you do not look into the space between the floors (and through the
            // building's wall, which is only seen from outside)
            if (rise && rise > H + 0.01) {
                const r = st.r; pq('wall', 'int', D.wallInt, false, 'x', r[0], r[1], r[3], H, rise, 1); pq('wall', 'int', D.wallInt, false, 'x', r[2], r[1], r[3], H, rise, -1);
                pq('wall', 'int', D.wallInt, false, 'y', r[1], H, rise, r[0], r[2], 1); pq('wall', 'int', D.wallInt, false, 'y', r[3], H, rise, r[0], r[2], -1);
            }
            buildStair(st, rise || H);
        });
        // ---------------- collision for the furniture whose model carries none (a kitchen, a counter, shelves: their collision was in the files of the game's
        // interior they come from): boxes of the model's shape (PropCollision.cs, in the model's frame) where it stands, turned with it ----------------
        (S.furniture || []).forEach(f => {
            const m = M.Furniture && M.Furniture.model ? M.Furniture.model(f.n) : null; if (!m || m.error || m.col !== false || !m.colBoxes) return;
            const h = (f.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), fz = f.z || 0;
            m.colBoxes.forEach((q, k) => {
                const z0 = Math.max(0.02, fz + q[2] - q[5]), z1 = fz + q[2] + q[5]; if (z1 - z0 < 0.03 || q[3] < 0.01 || q[4] < 0.01) return;
                const before = boxes.length; cboxO(f.x + q[0] * c - q[1] * s, f.y + q[0] * s + q[1] * c, z0, z1, q[3], q[4], h, 70, 1, 'prop:' + f.id + ':' + k);
                if (boxes.length > before && boxes[before][7]) delete boxes[before][7].user;          // (not one of the user's own boxes)
            });
        });
        holesBelow.forEach(h => {
            // a railing 1 m high on the sides of the hole that have floor next to them, not on the side the stairs come out on
            const r = h.r, t = 0.05, rh = 1.0, out = { '+x': 'e', '-x': 'w', '+y': 'n', '-y': 's' }[h.dir];
            const side = (k, x0, y0, x1, y1, px, py) => { if (k === out || !inRegion(px, py)) return; box('wall', 'int', D.trim, x0, y0, 0, x1, y1, rh); cbox(x0, y0, 0, x1, y1, rh, TEX.colType(D.trim), 1); };
            const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
            side('w', r[0] - t, r[1], r[0], r[3], r[0] - 0.1, my); side('e', r[2], r[1], r[2] + t, r[3], r[2] + 0.1, my);
            side('s', r[0], r[1] - t, r[2], r[1], mx, r[1] - 0.1); side('n', r[0], r[3], r[2], r[3] + t, mx, r[3] + 0.1);
        });

        // ---------------- walls around the region ----------------
        const segs = boundary(g);
        const entranceOpen = (S.openings || []).find(o => o.entrance);
        (S.openings || []).forEach(op => {
            let best = null, bo = 0;
            segs.forEach(sg => {
                if (sg.o !== op.o || Math.abs(sg.c - op.c) > 0.3) return;
                const ov = Math.min(sg.u1, op.u1) - Math.max(sg.u0, op.u0); if (ov > bo + 1e-9 && ov > 0.04) { bo = ov; best = sg; }
            });
            if (best) best.ops.push({ u0: Math.max(op.u0, best.u0), u1: Math.min(op.u1, best.u1), z0: op.z0, z1: op.z1, type: op.type, id: op.id, entrance: !!op.entrance });
        });

        // cutters the user placed (imported-model projects) also open the interior walls they pass through
        const spans = [], slanted = [];
        const fitCut = M.FitModels ? M.FitModels.cutters(project) : [];                                    // placed window and door models (Models tool): they open the walls too
        const IMx = M.ImportModel, rooms = IMx && IMx.roomRects && project.import ? IMx.roomRects(project) : [];
        (((project.import && project.import.cutters) || []).concat(fitCut)).forEach(k => {
            const q = (((k.yaw * 180 / Math.PI) % 360) + 360) % 360, r90 = q % 90; if (Math.min(r90, 90 - r90) > (k.face ? 6 : 1.5)) { slanted.push(k); return; }      // faces of the model can be a few degrees off the grid
            const horiz = Math.round(q / 90) % 2 === 0, cu = horiz ? k.cx : k.cy, cn = horiz ? k.cy : k.cx;
            const type = k.face ? k.type : (k.type === 'arch' ? 'arch' : ((k.type === 'window' || (k.type === 'door' && k.zb > 0.3)) ? 'window' : 'door'));
            // (a door with a frame that is bigger than its opening: the walls open to the frame, which is where the model's wall is cut out to as well)
            const fe = IMx && IMx.doorFrameExtent ? IMx.doorFrameExtent(k) : null, ju = fe ? fe.cu : k.w / 2, zTop = fe ? fe.ct : k.zb + k.h;
            // (an opening in a thick wall reaches the room's wall behind it, not only 40 cm about the faces that were clicked)
            const rc = IMx && IMx.reach ? IMx.reach(k, rooms) : null;
            spans.push({ o: horiz ? 'H' : 'V', u0: cu - ju, u1: cu + ju, n0: cn + (rc ? rc.lo : -k.d / 2), n1: cn + (rc ? rc.hi : k.d / 2), z0: Math.max(0, k.zb), z1: Math.min(H, zTop), type, id: 'cut' + k.id, face: !!k.face });
        });
        spans.forEach(sp => segs.forEach(sg => {
            if (sg.o !== sp.o || sg.c < sp.n0 - 0.03 || sg.c > sp.n1 + 0.03) return;
            const u0 = Math.max(sp.u0, sg.u0), u1 = Math.min(sp.u1, sg.u1); if (u1 - u0 < 0.04 || sp.z1 - sp.z0 < 0.1) return;
            sg.ops.push({ u0, u1, z0: sp.z0, z1: sp.z1, type: sp.type, id: sp.id, entrance: false, face: sp.face });
        }));

        // A cutter turned against the grid (a slanted wall of the building, a cut corner): the room's edge there is a staircase of short walls along and across the
        // grid. Every piece of them inside the cutter's box seen from above is opened: along the wall as wide as the opening, across it from the cutter's front to its
        // back and 40 cm further on each side (where the steps of the staircase are). Those pieces get no trim; one portal stands in the cutter's own plane.
        const slantPortals = [];
        slanted.forEach(k => {
            const type = k.face ? k.type : (k.type === 'arch' ? 'arch' : ((k.type === 'window' || (k.type === 'door' && k.zb > 0.3)) ? 'window' : 'door'));
            const fe = M.ImportModel && M.ImportModel.doorFrameExtent ? M.ImportModel.doorFrameExtent(k) : null, ju = fe ? fe.cu : k.w / 2, zTop = fe ? fe.ct : k.zb + k.h;
            const z0 = Math.max(0, k.zb), z1 = Math.min(H, zTop); if (z1 - z0 < 0.1) return;
            const ax = Math.cos(k.yaw), ay = Math.sin(k.yaw), nx = -ay, ny = ax, hn = k.d / 2 + 0.4;
            segs.forEach(sg => {
                const px = sg.o === 'H' ? sg.u0 : sg.c, py = sg.o === 'H' ? sg.c : sg.u0, dx = sg.o === 'H' ? 1 : 0, dy = 1 - dx;
                let t0 = 0, t1 = sg.u1 - sg.u0;
                [[ax, ay, ju], [nx, ny, hn]].forEach(([ex, ey, half]) => {
                    const p0 = (px - k.cx) * ex + (py - k.cy) * ey, dd = dx * ex + dy * ey;
                    if (Math.abs(dd) < 1e-9) { if (Math.abs(p0) > half) t1 = -1; return; }
                    let ta = (-half - p0) / dd, tb = (half - p0) / dd; if (ta > tb) { const t = ta; ta = tb; tb = t; }
                    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
                });
                if (t1 - t0 < 0.04) return;
                sg.ops.push({ u0: sg.u0 + t0, u1: sg.u0 + t1, z0, z1, type, id: 'cut' + k.id, entrance: false, face: true, slant: true });
            });
            // the portal: across the opening at the cutter's middle, its front facing out of the room
            const inside = inRegion(k.cx + nx * (k.d / 2 + 0.05), k.cy + ny * (k.d / 2 + 0.05)), ox = inside ? -nx : nx, oy = inside ? -ny : ny, ex = -oy, ey = ox;
            const a = [k.cx - ex * ju, k.cy - ey * ju], b = [k.cx + ex * ju, k.cy + ey * ju];
            slantPortals.push({ type, corners: [a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z1] });
        });

        // Wall thickness (into the room): things of the building stick through the wall (frames and vents reach 5 to 10 cm past the wall surface into the room), so the
        // inner face of every wall moves `T` into the room, sg.ci. At a corner of the room the two walls meet at their moved faces: both end T shorter; round a
        // corner that sticks into the room they end T longer.
        const T = Math.max(0, Math.min(0.5, +cfg.wallThick || 0)), ciOf = (sg) => sg.ci != null ? sg.ci : sg.c;
        // The thickness only goes into the room: with one set, nothing of a wall (collision, sides of openings, portals) reaches past the room edge to the outside,
        // which is the building's own wall. Without one, the old "wall depth" still reaches out that far.
        const outD = T > 0.0005 ? 0 : depth, ext0 = T > 0.0005 ? T : depth;
        if (T > 0.0005) {
            const vk = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4), endsAt = new Map(), endKey = (sg, e) => { const u = e ? sg.u1 : sg.u0; return sg.o === 'H' ? vk(u, sg.c) : vk(sg.c, u); };
            segs.forEach(sg => [0, 1].forEach(e => { const k = endKey(sg, e); let l = endsAt.get(k); if (!l) endsAt.set(k, l = []); l.push({ sg, end: e }); }));
            const moves = [];
            segs.forEach(sg => {
                sg.ci = sg.c + sg.inward * T;
                [0, 1].forEach(e => {
                    const here = endsAt.get(endKey(sg, e)), perp = here.filter(o => o.sg.o !== sg.o); if (perp.length !== 1 || here.some(o => o.sg !== sg && o.sg.o === sg.o)) return;
                    const B = perp[0].sg, dB = perp[0].end === 0 ? 1 : -1, dA = e ? 1 : -1, sA = sg.inward, sB = B.inward;
                    if (dB === sA && sB === -dA) moves.push([sg, e, -T]); else if (dB === -sA && sB === dA) moves.push([sg, e, T]);
                });
            });
            moves.forEach(m => { if (m[1]) m[0].u1 += m[2]; else m[0].u0 -= m[2]; });
        }
        // a piece of wall: inner face over [u0,u1] x [z0,z1]; collision box reaches `depth` outward and `ext` past the ends
        // a wall face from a to b along the wall line (o 'H': along x at y = f; 'V': along y at x = f), from z0 up to ta at a and tb at b
        function trap(o, f, a, b, z0, ta, tb, sign, tex) {
            const A = o === 'H' ? [a, f, z0] : [f, a, z0], B2 = o === 'H' ? [a, f, ta] : [f, b, z0], C = o === 'H' ? [b, f, tb] : [f, b, tb], D2 = o === 'H' ? [b, f, z0] : [f, a, ta];
            if (sign > 0) emitQuad('wall', 'int', tex, false, A, B2, C, D2); else emitQuad('wall', 'int', tex, false, A, D2, C, B2);
        }
        function wallPiece(sg, u0, u1, z0, z1, extLo, extHi) {
            if (u1 - u0 < 1e-5 || z1 - z0 < 1e-5) return;
            const tex = sg.tex || D.wallInt, ci = ciOf(sg);
            if (roofFn && z1 > H - 1e-6) {
                // under the roof: in pieces of at most 40 cm, each as high as the room is there (its top follows the slope)
                const cuts = [u0].concat(((sg.o === 'H' ? CX : CY) || []).filter(v => v > u0 + 1e-4 && v < u1 - 1e-4), [u1]), n = cuts.length - 1, at = (u) => sg.o === 'H' ? topAtS(u, ci) : topAtS(ci, u);
                const out = sg.c - sg.inward * outD, o0 = Math.min(ci, out), o1 = Math.max(ci, out);
                // (pieces that reach the full height one after another are one piece)
                const piece = (a, b, ta, tb, first, last) => {
                    if (!skin) trap(sg.o, ci, a, b, z0, ta, tb, sg.inward, tex);
                    const ea = first ? extLo : 0, eb = last ? extHi : 0, zt = Math.max(ta, tb);
                    if (sg.o === 'H') cbox(a - ea, o0, z0, b + eb, o1, zt, TEX.colType(tex), 0); else cbox(o0, a - ea, z0, o1, b + eb, zt, TEX.colType(tex), 0);
                };
                let runA = null;
                for (let i = 0; i < n; i++) {
                    const a = cuts[i], b = cuts[i + 1], ta = Math.max(z0, at(a)), tb = Math.max(z0, at(b)), full = ta >= z1 - 1e-4 && tb >= z1 - 1e-4;
                    if (full) { if (runA === null) runA = { a, i }; if (i === n - 1) piece(runA.a, b, z1, z1, runA.i === 0, true); continue; }
                    if (runA !== null) { piece(runA.a, a, z1, z1, runA.i === 0, false); runA = null; }
                    if (Math.max(ta, tb) - z0 < 0.01) continue;
                    piece(a, b, ta, tb, i === 0, i === n - 1);
                }
                return;
            }
            // (walls = 'skin' has no wall faces of its own, but still the collision: the building's collision is cleared out of the rooms, so the walls need it from here)
            if (!skin) { if (sg.o === 'H') pq('wall', 'int', tex, false, 'y', ci, z0, z1, u0, u1, sg.inward); else pq('wall', 'int', tex, false, 'x', ci, u0, u1, z0, z1, sg.inward); }
            const out = sg.c - sg.inward * outD, o0 = Math.min(ci, out), o1 = Math.max(ci, out), a = u0 - extLo, b = u1 + extHi;
            if (sg.o === 'H') cbox(a, o0, z0, b, o1, z1, TEX.colType(tex), 0); else cbox(o0, a, z0, o1, b, z1, TEX.colType(tex), 0);
        }
        function revealQuad(sg, plane, f, a0, a1, z0, z1, sign) {
            // plane: 'u' jamb at u = f (normal along the wall line), 'z' head/sill at z = f
            const ci = ciOf(sg), out = sg.c - sg.inward * outD, o0 = Math.min(ci, out), o1 = Math.max(ci, out);
            if (plane === 'u') { if (sg.o === 'H') pq('wall', 'int', D.trim, false, 'x', f, o0, o1, z0, z1, sign); else pq('wall', 'int', D.trim, false, 'y', f, z0, z1, o0, o1, sign); }
            else { if (sg.o === 'H') pq('wall', 'int', D.trim, false, 'z', f, a0, a1, o0, o1, sign); else pq('wall', 'int', D.trim, false, 'z', f, o0, o1, a0, a1, sign); }
        }
        function casing(sg, u0, u1, z0, z1, thick, group) {
            // thin trim plates on the room side around an opening
            const cw = 0.06, e0 = ciOf(sg), e1 = e0 + sg.inward * thick;
            const plate = (a0, a1, b0, b1) => {
                if (a1 - a0 < 1e-5 || b1 - b0 < 1e-5) return;
                if (sg.o === 'H') box('wall', 'int', D.trim, a0, Math.min(e0, e1), b0, a1, Math.max(e0, e1), b1); else box('wall', 'int', D.trim, Math.min(e0, e1), a0, b0, Math.max(e0, e1), a1, b1);
            };
            plate(u0 - cw, u0, z0, z1 + cw); plate(u1, u1 + cw, z0, z1 + cw); plate(u0, u1, z1, z1 + cw); if (z0 > 0.05) plate(u0, u1, z0 - cw, z0);
        }

        segs.forEach(sg => {
            sg.ops.sort((a, b) => a.u0 - b.u0);
            // Openings that overlap along the wall (a frame placed in an opening that was cut from the faces, a door cut a little wider than its frame) are one
            // hole: as wide and as high as both together. (Before, the second one was dropped, so the wall stayed shut where only it reached.)
            const merged = [];
            sg.ops.forEach(op => {
                const last = merged[merged.length - 1];
                if (last && op.u0 < last.u1 - 1e-6) {
                    last.u1 = Math.max(last.u1, op.u1); last.z0 = Math.min(last.z0, op.z0); last.z1 = Math.max(last.z1, op.z1);
                    if (last.z0 < 0.05 && last.type === 'window') last.type = 'door';
                    last.face = last.face && op.face; last.entrance = last.entrance || op.entrance;
                } else merged.push(Object.assign({}, op));
            });
            sg.ops = merged;
            let cur = sg.u0, first = true;
            sg.ops.forEach(op => {
                op.u0 = Math.max(op.u0, sg.u0); op.u1 = Math.min(op.u1, sg.u1); if (op.u1 - op.u0 < 0.02) return;          // (a wall that was made shorter at a corner keeps the part of an opening that is left)
                if (op.u0 < cur - 1e-6) return;
                wallPiece(sg, cur, op.u0, 0, H, first ? ext0 : 0, 0); first = false;
                wallPiece(sg, op.u0, op.u1, op.z1, H, 0, 0);
                if (op.z0 > 1e-4) wallPiece(sg, op.u0, op.u1, 0, op.z0, 0, 0);
                // an opening made from the model's faces has no generated trim: it is only cut through the wall (glass or the door model fill it)
                // (with a wall thickness the hole has sides, so the reveals are made for those too)
                if (!op.slant && (!op.face || T > 0.0005)) {
                    revealQuad(sg, 'u', op.u0, 0, 0, op.z0, op.z1, 1); revealQuad(sg, 'u', op.u1, 0, 0, op.z0, op.z1, -1);
                    revealQuad(sg, 'z', op.z1, op.u0, op.u1, 0, 0, -1); if (op.z0 > 1e-4) revealQuad(sg, 'z', op.z0, op.u0, op.u1, 0, 0, 1);
                    if (!op.face) casing(sg, op.u0, op.u1, op.z0, op.z1, 0.02, 'int');
                }
                if (op.type === 'window' && !op.face) {
                    // frame, mullions and glass at the middle of the wall depth
                    const wc = sg.c - sg.inward * outD / 2 + sg.inward * T / 2, fb = 0.045, fd = 0.03, zc = (op.z0 + op.z1) / 2, uc = (op.u0 + op.u1) / 2;
                    const fbox = (a0, a1, b0, b1, h) => { if (sg.o === 'H') box('wall', 'int', D.trim, a0, wc - h, b0, a1, wc + h, b1); else box('wall', 'int', D.trim, wc - h, a0, b0, wc + h, a1, b1); };
                    fbox(op.u0, op.u0 + fb, op.z0, op.z1, fd); fbox(op.u1 - fb, op.u1, op.z0, op.z1, fd);
                    fbox(op.u0 + fb, op.u1 - fb, op.z0, op.z0 + fb, fd); fbox(op.u0 + fb, op.u1 - fb, op.z1 - fb, op.z1, fd);
                    if (op.u1 - op.u0 > 0.6) fbox(uc - 0.015, uc + 0.015, op.z0 + fb, op.z1 - fb, 0.025);
                    if (op.z1 - op.z0 > 0.7) fbox(op.u0 + fb, op.u1 - fb, zc - 0.015, zc + 0.015, 0.025);
                    const gu0 = op.u0 + fb, gu1 = op.u1 - fb, gz0 = op.z0 + fb, gz1 = op.z1 - fb;
                    if (sg.o === 'H') { pq('glass', 'glass', 'glass', true, 'y', wc + 0.003, gz0, gz1, gu0, gu1, 1); pq('glass', 'glass', 'glass', true, 'y', wc - 0.003, gz0, gz1, gu0, gu1, -1); cbox(gu0, wc - 0.015, gz0, gu1, wc + 0.015, gz1, 112, 0); }
                    else { pq('glass', 'glass', 'glass', true, 'x', wc + 0.003, gu0, gu1, gz0, gz1, 1); pq('glass', 'glass', 'glass', true, 'x', wc - 0.003, gu0, gu1, gz0, gz1, -1); cbox(wc - 0.015, gu0, gz0, wc + 0.015, gu1, gz1, 112, 0); }
                }
                // portal to the outside
                if (exportMode && !op.slant) {
                    const spec = OPEN[op.type] || OPEN.window, out = -sg.inward, wm = sg.c - sg.inward * outD / 2 + sg.inward * T / 2;
                    let a, b, c, d; const U0 = op.u0, U1 = op.u1, Z0 = op.z0, Z1 = op.z1;
                    if (sg.o === 'H') { if (out < 0) { a = [U0, wm, Z0]; b = [U1, wm, Z0]; c = [U1, wm, Z1]; d = [U0, wm, Z1]; } else { a = [U1, wm, Z0]; b = [U0, wm, Z0]; c = [U0, wm, Z1]; d = [U1, wm, Z1]; } }
                    else { if (out < 0) { a = [wm, U1, Z0]; b = [wm, U0, Z0]; c = [wm, U0, Z1]; d = [wm, U1, Z1]; } else { a = [wm, U0, Z0]; b = [wm, U1, Z0]; c = [wm, U1, Z1]; d = [wm, U0, Z1]; } }
                    const pr = { flags: spec.portal, corners: [].concat(a, b, c, d) };
                    if (op.type === 'window') portals.push(pr); else if (op.entrance) portals.unshift(pr); else portals.push(pr);
                }
                cur = op.u1;
            });
            wallPiece(sg, cur, sg.u1, 0, H, first ? ext0 : 0, ext0);
        });
        if (exportMode) slantPortals.forEach(sp => portals.push({ flags: (OPEN[sp.type] || OPEN.window).portal, corners: sp.corners }));

        // ---------------- the building's own walls, turned inwards (walls = 'skin') ----------------
        if (skin && M.ImportModel && M.ImportModel.wallFaces) {
            const inRoom = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
            let n = 0;
            M.ImportModel.wallFaces().forEach(f => {
                const nh = Math.hypot(f.n[0], f.n[1]); if (nh < 0.5 || f.c[2] < -0.3 || f.c[2] > H + 0.3) return; const nx = f.n[0] / nh, ny = f.n[1] / nh;
                // the room is behind the face (a model's faces look outwards) and nothing of the room is in front of it
                let behind = false; for (const d of [0.05, 0.12, 0.25]) if (inRoom(f.c[0] - nx * d, f.c[1] - ny * d)) { behind = true; break; }
                if (!behind || inRoom(f.c[0] + nx * 0.1, f.c[1] + ny * 0.1)) return;
                const sx = -nx * T, sy = -ny * T;                                                                                    // wall thickness: moved into the room
                emitTri('wall', 'int', D.wallInt, [f.p[0] + sx, f.p[1] + sy, f.p[2]], [f.p[6] + sx, f.p[7] + sy, f.p[8]], [f.p[3] + sx, f.p[4] + sy, f.p[5]]); n++;        // turned round: it looks into the room
            });
            stats.skin = n;
        }

        // ---------------- partition walls ----------------
        (S.parts || []).forEach(pt => {
            const pops = (pt.open || []).slice();
            spans.forEach(sp => { if (sp.o !== pt.o || pt.c < sp.n0 - 0.03 || pt.c > sp.n1 + 0.03) return; const u0 = Math.max(sp.u0, pt.u0), u1 = Math.min(sp.u1, pt.u1); if (u1 - u0 >= 0.04 && sp.z1 - sp.z0 >= 0.1) pops.push({ u0, u1, z0: sp.z0, z1: sp.z1 }); });
            const rawOps = pops.sort((a, b) => a.u0 - b.u0), ops = [], tex = pt.texA || D.wallInt, texB = pt.texB || D.wallInt;
            rawOps.forEach(op => {
                const last = ops[ops.length - 1];
                if (last && op.u0 < last.u1 - 1e-6) {
                    last.u1 = Math.max(last.u1, op.u1);
                    last.z0 = Math.min(last.z0, op.z0);
                    last.z1 = Math.max(last.z1, op.z1);
                } else ops.push(Object.assign({}, op));
            });
            const lo = pt.c - PT / 2, hi = pt.c + PT / 2, ctype = TEX.colType(tex);
            const piece = (u0, u1, z0, z1) => {
                if (u1 - u0 < 1e-5 || z1 - z0 < 1e-5) return;
                if (roofFn && z1 > H - 1e-6) {
                    const cuts = [u0].concat(((pt.o === 'H' ? CX : CY) || []).filter(v => v > u0 + 1e-4 && v < u1 - 1e-4), [u1]), n = cuts.length - 1;
                    for (let i = 0; i < n; i++) {
                        const a = cuts[i], b = cuts[i + 1], tH = (u) => Math.max(z0, pt.o === 'H' ? topAtS(u, hi) : topAtS(hi, u)), tL = (u) => Math.max(z0, pt.o === 'H' ? topAtS(u, lo) : topAtS(lo, u)), ta = Math.max(tH(a), tL(a)), tb = Math.max(tH(b), tL(b)); if (Math.max(ta, tb) - z0 < 0.01) continue;
                        trap(pt.o, hi, a, b, z0, tH(a), tH(b), 1, texB); trap(pt.o, lo, a, b, z0, tL(a), tL(b), -1, tex);
                        if (pt.o === 'H') cbox(a, lo, z0, b, hi, Math.max(ta, tb), ctype, 0); else cbox(lo, a, z0, hi, b, Math.max(ta, tb), ctype, 0);
                    }
                    return;
                }
                if (pt.o === 'H') { pq('wall', 'int', texB, false, 'y', hi, z0, z1, u0, u1, 1); pq('wall', 'int', tex, false, 'y', lo, z0, z1, u0, u1, -1); cbox(u0, lo, z0, u1, hi, z1, ctype, 0); }
                else { pq('wall', 'int', texB, false, 'x', hi, u0, u1, z0, z1, 1); pq('wall', 'int', tex, false, 'x', lo, u0, u1, z0, z1, -1); cbox(lo, u0, z0, hi, u1, z1, ctype, 0); }
            };
            const capTop = (u) => pt.o === 'H' ? topAtS(u, pt.c) : topAtS(pt.c, u);
            const cap = (u, sign) => { const t = capTop(u); if (t < 0.01) return; if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'x', u, lo, hi, 0, t, sign); else pq('wall', 'int', D.trim, false, 'y', u, 0, t, lo, hi, sign); };
            const jamb = (u, sign, z0, z1) => { if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'x', u, lo, hi, z0, z1, sign); else pq('wall', 'int', D.trim, false, 'y', u, z0, z1, lo, hi, sign); };
            const headsill = (z, u0, u1, sign) => { if (pt.o === 'H') pq('wall', 'int', D.trim, false, 'z', z, u0, u1, lo, hi, sign); else pq('wall', 'int', D.trim, false, 'z', z, lo, hi, u0, u1, sign); };
            let cur = pt.u0; cap(pt.u0, -1); cap(pt.u1, 1);
            ops.forEach(op => {
                if (op.u0 < cur - 1e-6) return;
                piece(cur, op.u0, 0, H); piece(op.u0, op.u1, op.z1, H); if (op.z0 > 1e-4) piece(op.u0, op.u1, 0, op.z0);
                jamb(op.u0, 1, op.z0, op.z1); jamb(op.u1, -1, op.z0, op.z1); headsill(op.z1, op.u0, op.u1, -1); if (op.z0 > 1e-4) headsill(op.z0, op.u0, op.u1, 1);
                cur = op.u1;
            });
            piece(cur, pt.u1, 0, H);
        });

        // ---------------- openings cut out of the model's faces: glass in windows, a frame around windows and doors ----------------
        // An oriented box of a frame: u = ua..ub across the opening (from its centre), z = za..zb, bd deep, centred dn along the outward normal.
        const frameBar = (k, dn, bd, ua, ub, za, zb) => {
            const ux = Math.cos(k.yaw), uy = Math.sin(k.yaw), nx = -uy, ny = ux, uc = (ua + ub) / 2, hu = (ub - ua) / 2, hn = bd / 2, cx0 = k.cx + uc * ux + dn * nx, cy0 = k.cy + uc * uy + dn * ny;
            if (hu < 1e-4 || zb - za < 1e-4) return;
            const P = (su, sn2, z) => [cx0 + su * hu * ux + sn2 * hn * nx, cy0 + su * hu * uy + sn2 * hn * ny, z], T = D.trim;
            emitQuad('wall', 'int', T, false, P(1, -1, za), P(1, 1, za), P(1, 1, zb), P(1, -1, zb));      // +u
            emitQuad('wall', 'int', T, false, P(-1, 1, za), P(-1, -1, za), P(-1, -1, zb), P(-1, 1, zb));  // -u
            emitQuad('wall', 'int', T, false, P(1, 1, za), P(-1, 1, za), P(-1, 1, zb), P(1, 1, zb));      // outside
            emitQuad('wall', 'int', T, false, P(-1, -1, za), P(1, -1, za), P(1, -1, zb), P(-1, -1, zb));  // inside
            emitQuad('wall', 'int', T, false, P(-1, -1, zb), P(1, -1, zb), P(1, 1, zb), P(-1, 1, zb));    // top
            emitQuad('wall', 'int', T, false, P(-1, -1, za), P(-1, 1, za), P(1, 1, za), P(1, -1, za));    // bottom
        };
        // collision of a box like that, where the opening is near square to the grid (the collision boxes are axis aligned)
        const frameCol = (k, dn, bd, ua, ub, za, zb, type) => {
            const q = (((k.yaw * 180 / Math.PI) % 360) + 360) % 360, r90 = q % 90; if (Math.min(r90, 90 - r90) > 6) return;
            const horiz = Math.round(q / 90) % 2 === 0, c = Math.cos(k.yaw), s = Math.sin(k.yaw), sg = (horiz ? c : s) < 0 ? -1 : 1, u0 = Math.min(sg * ua, sg * ub), u1 = Math.max(sg * ua, sg * ub);
            if (horiz) { const cn = k.cy + c * dn; cbox(k.cx + u0, cn - bd / 2, za, k.cx + u1, cn + bd / 2, zb, type, 0); } else { const cn = k.cx - s * dn; cbox(cn - bd / 2, k.cy + u0, za, cn + bd / 2, k.cy + u1, zb, type, 0); }
        };
        (shared ? ((project.import && project.import.cutters) || []).concat(fitCut) : []).forEach(k => {
            if (!k.face) return;
            // a placed model brings its own frame, glass and door; the pane of a window still stops you (collision across the opening)
            if (k.fit) { if (k.type === 'window' && !k.noglass) frameCol(k, 0, 0.03, -k.w / 2, k.w / 2, k.zb, k.zb + k.h, 112); return; }
            const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), dd = M.ImportModel.depthOf(k), hw = k.w / 2, zt = k.zb + k.h;
            // Gaps in the model's wall beside the cut-out (see-through slits the cut-out faces used to cover) are closed with trim boxes that reach the wall.
            const IMg = M.ImportModel; let gp = k.fill !== false && (k.type === 'window' || k.type === 'door') && IMg && IMg.gapAround ? IMg.gapAround(k) : null;
            // the model's wall is cut out to a door's frame when that is bigger than the opening, so that much of a gap is gone (the frame covers the rest)
            const fex = IMg && IMg.doorFrameExtent ? IMg.doorFrameExtent(k) : null;
            if (gp && fex) { const ex = Math.max(0, fex.cu - fex.hw), et = Math.max(0, fex.ct - fex.zt); gp = { l: Math.max(0, gp.l - ex), r: Math.max(0, gp.r - ex), b: gp.b, t: Math.max(0, gp.t - et), dw: gp.dw }; if (!gp.l && !gp.r && !gp.b && !gp.t) gp = null; }
            if (gp) {
                const lo = Math.min(dd - 0.035, gp.dw - 0.02), hi = Math.max(dd + 0.035, gp.dw + 0.02), dnc = (lo + hi) / 2, bdf = hi - lo, z0 = k.zb - gp.b, z1 = zt + gp.t;
                if (gp.l) frameBar(k, dnc, bdf, -hw - gp.l, -hw, z0, z1);
                if (gp.r) frameBar(k, dnc, bdf, hw, hw + gp.r, z0, z1);
                if (gp.b) frameBar(k, dnc, bdf, -hw, hw, z0, k.zb);
                if (gp.t) frameBar(k, dnc, bdf, -hw, hw, zt, z1);
            }
            if (k.type === 'window') {
                // The model's window is one painted picture (frame, bars and glass together) on a single face, so cutting it out takes the frame away too.
                // A plain frame is put back inside the opening, at the depth of the frame: bars all round, and a cross when asked for.
                // (k.vframe: the model's own frame is used: nothing is built, the glass goes behind what the model has left around the opening)
                const framed = k.frame !== false && !k.vframe, bw = k.bw || 0.055, bd = 0.07;
                if (framed) {
                    frameBar(k, dd, bd, -hw, hw, zt - bw, zt); frameBar(k, dd, bd, -hw, hw, k.zb, k.zb + bw);                                  // head and sill
                    frameBar(k, dd, bd, -hw, -hw + bw, k.zb + bw, zt - bw); frameBar(k, dd, bd, hw - bw, hw, k.zb + bw, zt - bw);                // the two sides
                    if (k.bars) {
                        if (k.w > 0.9) frameBar(k, dd, bd, -bw / 2, bw / 2, k.zb + bw, zt - bw);
                        if (k.h > 1.3) { const zm = (k.zb + zt) / 2; frameBar(k, dd, bd, -hw + bw, -bw / 2, zm - bw / 2, zm + bw / 2); frameBar(k, dd, bd, bw / 2, hw - bw, zm - bw / 2, zm + bw / 2); }
                    }
                }
                // The pane sits at the depth of the window's own frame (dd, behind the faces that were cut out) and is only as large as the frame's inner
                // opening plus 1 cm that is tucked into the bars; without a frame it is the opening plus 1 cm into the wall.
                const ov = 0.01, gu = framed ? Math.max(0.02, hw - bw + ov) : hw + ov, gz0 = framed ? k.zb + bw - ov : k.zb - ov, gz1 = framed ? zt - bw + ov : zt + ov;
                const Pt = (du, z, dn) => [k.cx + du * cs - (dn + dd) * sn, k.cy + du * sn + (dn + dd) * cs, z];
                emitQuad('glass', 'glass', 'glass', true, Pt(-gu, gz0, 0.003), Pt(-gu, gz1, 0.003), Pt(gu, gz1, 0.003), Pt(gu, gz0, 0.003));
                emitQuad('glass', 'glass', 'glass', true, Pt(-gu, gz0, -0.003), Pt(gu, gz0, -0.003), Pt(gu, gz1, -0.003), Pt(-gu, gz1, -0.003));
                frameCol(k, dd, 0.03, -hw, hw, k.zb, zt, 112);                                                                              // collision for the pane
            } else if (k.type === 'door' && k.leaf && k.frame !== false && !k.vframe) {
                // The door model keeps its own size (the game ignores the scale of an entity), so its frame is built to the door: the jambs and the head
                // run from the edges of the door out to the edges of the opening (at least bw wide, the rest is inside the wall) and close the gap.
                const IMod = M.ImportModel, dg = IMod && IMod.doorGroup ? IMod.doorGroup(k) : null; if (!dg) return;
                const bw = k.bw || 0.05, bd = 0.1, dn = dd + (k.lo || 0), dw = dg.w / 2, ju = Math.max(hw, dw + bw), dt = k.zb + dg.h, top = Math.max(zt, dt + bw), ct = TEX.colType(D.trim);
                [[-ju, -dw, k.zb, top], [dw, ju, k.zb, top], [-dw, dw, dt, top]].forEach(b => { frameBar(k, dn, bd, b[0], b[1], b[2], b[3]); frameCol(k, dn, bd, b[0], b[1], b[2], b[3], ct); });
            }
        });

        // ---------------- collision boxes the user built (Collision box tool): they only make collision, nothing is drawn ----------------
        // (a box whose centre is inside the interior belongs to its room, like the floor)
        (shared ? (project.import && project.import.cboxes) || [] : []).forEach(k => {
            const m = COLMAT[k.mat] || COLMAT.concrete;
            cboxO(k.cx, k.cy, k.zb, k.zb + k.h, k.w / 2, k.d / 2, k.yaw || 0, m.type, inRegion(k.cx, k.cy) ? 1 : 0, k.id);
        });

        // ---------------- doors of the Window / door models tool that are made solid: a box of collision the size of the leaf ----------------
        (M.FitModels && shared ? M.FitModels.solidBoxes(project) : []).forEach(b => cboxO(b.cx, b.cy, b.zb, b.zb + b.h, b.hu, b.hn, b.yaw, COLMAT.wood.type, inRegion(b.cx, b.cy) ? 1 : 0, b.id));          // (a doorway sits in the wall: its room is the walls' room unless its middle is inside)

        // ---------------- lights: one per ~3.5 m of every room (rooms are cut apart by partitions, doors and arches stay open) ----------------
        if (exportMode && opts.autoLights !== false) {
            const px = [], py = [];
            (S.parts || []).forEach(pt => { if (pt.o === 'H') { py.push(pt.c); px.push(pt.u0, pt.u1); } else { px.push(pt.c); py.push(pt.u0, pt.u1); } });
            const g2 = regionGrid(S, px, py), comp = [], blockedH = (i, j) => false;
            for (let i = 0; i < g2.nx; i++) comp.push(new Array(g2.ny).fill(-1));
            const blockedBetween = (i, j, i2, j2) => {
                // moving from cell (i,j) to (i2,j2): crosses a partition line?
                const vertical = i2 !== i, line = vertical ? g2.X[Math.max(i, i2)] : g2.Y[Math.max(j, j2)];
                const mid = vertical ? (g2.Y[j] + g2.Y[j + 1]) / 2 : (g2.X[i] + g2.X[i + 1]) / 2;
                return (S.parts || []).some(pt => {
                    if (vertical ? pt.o !== 'V' : pt.o !== 'H') return false;
                    if (Math.abs(pt.c - line) > PT / 2 + 0.02 || mid < pt.u0 || mid > pt.u1) return false;
                    return !(pt.open || []).some(op => mid > op.u0 && mid < op.u1);
                });
            };
            let nid = 0;
            for (let i = 0; i < g2.nx; i++) for (let j = 0; j < g2.ny; j++) {
                if (!g2.mask[i][j] || comp[i][j] >= 0) continue; const id = nid++, st = [[i, j]]; comp[i][j] = id;
                while (st.length) {
                    const [ci, cj] = st.pop();
                    [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]].forEach(n => {
                        if (n[0] < 0 || n[1] < 0 || n[0] >= g2.nx || n[1] >= g2.ny || !g2.mask[n[0]][n[1]] || comp[n[0]][n[1]] >= 0 || blockedBetween(ci, cj, n[0], n[1])) return;
                        comp[n[0]][n[1]] = id; st.push([n[0], n[1]]);
                    });
                }
            }
            const byId = new Map();
            for (let i = 0; i < g2.nx; i++) for (let j = 0; j < g2.ny; j++) if (comp[i][j] >= 0) { if (!byId.has(comp[i][j])) byId.set(comp[i][j], []); byId.get(comp[i][j]).push([i, j]); }
            byId.forEach(cs => {
                let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, area = 0;
                cs.forEach(c => { x0 = Math.min(x0, g2.X[c[0]]); x1 = Math.max(x1, g2.X[c[0] + 1]); y0 = Math.min(y0, g2.Y[c[1]]); y1 = Math.max(y1, g2.Y[c[1] + 1]); area += (g2.X[c[0] + 1] - g2.X[c[0]]) * (g2.Y[c[1] + 1] - g2.Y[c[1]]); });
                if (area < 1.0) return;
                const nx = Math.max(1, Math.round((x1 - x0) / 3.5)), ny = Math.max(1, Math.round((y1 - y0) / 3.5)), seen = new Set();
                for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
                    const cx = x0 + (a + 0.5) * (x1 - x0) / nx, cy = y0 + (b + 0.5) * (y1 - y0) / ny;
                    let best = null, bd = 1e9;
                    cs.forEach(c => { const mx = (g2.X[c[0]] + g2.X[c[0] + 1]) / 2, my = (g2.Y[c[1]] + g2.Y[c[1] + 1]) / 2, d = Math.hypot(mx - cx, my - cy); if (d < bd) { bd = d; best = [mx, my]; } });
                    const lk = best[0].toFixed(2) + ',' + best[1].toFixed(2); if (seen.has(lk)) continue; seen.add(lk);
                    lights.push({ x: best[0], y: best[1], z: topAt(best[0], best[1]) - 0.15 });
                }
            });
        }
        if (exportMode) (S.lights || []).forEach(l => lights.push({ x: l.x, y: l.y, z: topAt(l.x, l.y) - 0.15 }));

        batches.forEach(b => { b.pos = new Float32Array(b.pos); b.nrm = new Float32Array(b.nrm); b.uv = new Float32Array(b.uv); b.idx = new Uint16Array(b.idx); });
        stats.boxes = boxes.length; stats.portals = portals.length; stats.lights = lights.length;
        const resolved = []; segs.forEach(sg => sg.ops.forEach(op => resolved.push({ o: sg.o, c: sg.c, inward: sg.inward, u0: op.u0, u1: op.u1, z0: op.z0, z1: op.z1, type: op.type, entrance: op.entrance })));
        return { batches, boxes, matList, cpolys, portals, lights, entrance: null, bounds: { mn: bmn, mx: bmx }, stats, shell: { grid: g, segs, resolved } };
    }

    // what a floor needs to know about the others: how far up the floor above is, and the stairs that come up from the floor below. For the active floor of
    // the project, or the floor `lv` of the list `levels` (Model.levelsOf).
    function levelCtx(project, levels, lv) {
        const L = levels || (project.import && M.Model ? M.Model.levelsOf({ import: project.import, shell: project.shell, settings: project.settings }) : null);
        if (!L || L.length < 2) return {};
        const i = lv ? L.findIndex(l => l.id === lv.id) : L.findIndex(l => l.active), above = L[i + 1], below = L[i - 1]; if (i < 0) return {};
        return { rise: above ? above.z - L[i].z : null, holesBelow: below ? (below.shell.stairs || []) : [] };
    }
    // Every floor of the active building put together into one result (the export): each floor is built with its own rooms, stairs and holes, and moved up by
    // its height above the active floor. What belongs to the building and not to a floor is made once, with the active floor. `only`: just these floor ids.
    function buildAll(project, opts, only) {
        opts = opts || {};
        if (!project.import || !M.Model) return build(project, opts);
        const L = M.Model.levelsOf({ import: project.import, shell: project.shell, settings: project.settings });
        if (L.length < 2 && !only) return build(project, opts);
        const out = { batches: [], boxes: [], matList: [], cpolys: [], portals: [], lights: [], entrance: null, bounds: { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }, stats: { tris: 0, boxes: 0, portals: 0, lights: 0, warnings: [] }, shell: null, floors: [] };
        L.forEach(l => {
            if (only && only.indexOf(l.id) < 0) return;
            const o = Object.assign({}, opts, levelCtx(project, L, l), { shared: l.active }), b = l.active ? build(project, o) : M.Model.withLevel(l.id, () => build(project, o)), dz = l.z, mo = out.matList.length;
            if (l.active) out.shell = b.shell;
            b.matList.forEach(m => out.matList.push(m));
            b.batches.forEach(x => { if (dz) for (let i = 2; i < x.pos.length; i += 3) x.pos[i] += dz; x.floor = l.id; out.batches.push(x); });
            b.boxes.forEach(x => { const y = x.slice(); y[2] += dz; y[5] += dz; y[6] += mo; out.boxes.push(y); });
            (b.cpolys || []).forEach(t => out.cpolys.push([[t[0][0], t[0][1], t[0][2] + dz], [t[1][0], t[1][1], t[1][2] + dz], [t[2][0], t[2][1], t[2][2] + dz], t[3] + mo]));
            b.portals.forEach(pr => { const c = pr.corners.slice(); for (let i = 2; i < c.length; i += 3) c[i] += dz; out.portals.push(Object.assign({}, pr, { corners: c })); });
            b.lights.forEach(li => out.lights.push(Object.assign({}, li, { z: li.z + dz })));
            for (let a = 0; a < 3; a++) { out.bounds.mn[a] = Math.min(out.bounds.mn[a], b.bounds.mn[a] + (a === 2 ? dz : 0)); out.bounds.mx[a] = Math.max(out.bounds.mx[a], b.bounds.mx[a] + (a === 2 ? dz : 0)); }
            ['tris', 'boxes', 'portals', 'lights'].forEach(k => { out.stats[k] += b.stats[k] || 0; });
            out.floors.push({ id: l.id, name: l.name, z: dz, tris: b.stats.tris });
        });
        return out;
    }

    // the final region as a few rectangles (used to tell the patcher where the walkable interior is)
    function regionRects(shell) {
        const g = regionGrid(shell), used = [], out = [];
        for (let i = 0; i < g.nx; i++) used.push(new Array(g.ny).fill(false));
        for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
            if (!g.mask[i][j] || used[i][j]) continue;
            let i1 = i + 1; while (i1 < g.nx && g.mask[i1][j] && !used[i1][j]) i1++;
            let j1 = j + 1; for (; j1 < g.ny; j1++) { let ok = true; for (let x = i; x < i1; x++) if (!g.mask[x][j1] || used[x][j1]) { ok = false; break; } if (!ok) break; }
            for (let x = i; x < i1; x++) for (let y = j; y < j1; y++) used[x][y] = true;
            out.push([g.X[i], g.Y[j], g.X[i1], g.Y[j1]]);
        }
        return out;
    }

    M.Shell = { build, buildAll, levelCtx, regionGrid, regionRects, boundary, OPEN, uniq };
})(window.MLO);
