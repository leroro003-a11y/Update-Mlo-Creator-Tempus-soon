// Panels, dialogs and the export form.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, TEX, Model, Mesher } = M, S = Model.state, bus = Model.bus;
    const $ = (id) => document.getElementById(id);
    const UI = {};

    const TOOLS = [['wall', 'Wall', '1'], ['room', 'Room', '2'], ['floor', 'Floor', '3'], ['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6'],
        ['stairs', 'Stairs', '7'], ['roof', 'Roof', '8'], ['light', 'Light', '9'], ['entrance', 'Entrance', '0'], ['eraser', 'Eraser', 'X']];
    const TOOL_HELP = {
        wall: 'Drag from one grid corner to another to build a straight wall. Walls stand on the grid lines.',
        room: 'Drag a rectangle: the four walls and the floor appear together. Draw a second room against the first to share a wall.',
        floor: 'Drag over cells to lay floor with no walls: terraces, porches, decks. Open floor stays outdoors.',
        door: 'Click a wall to cut a doorway (0.9 x 2.1 m). Click the same doorway again to fill it in.',
        window: 'Click a wall to put a window in it (0.8 x 1.2 m, sill at 0.9 m). Click again to remove it.',
        arch: 'Click a wall to open the whole metre of it up to 2.3 m: for open-plan rooms.',
        roof: 'Drag over cells to put a flat roof on top of the current level. Roofs show only while Roof is ticked.',
        light: 'Click a cell to add or remove a ceiling light. Rooms also get automatic lights when you export.',
        entrance: 'Click a door or archway on level 0 to mark it as the main entrance. Its position in the game decides where the house stands.',
        eraser: 'Click a wall or cell to remove it. Drag over walls to remove several, or drag from empty ground to clear a rectangle.',
        paint: 'Click a wall face, floor, ceiling or roof to paint it. Anything unpainted uses the project theme below.'
    };
    const GRID_GROUPS = [
        { id: 'build', name: 'Walls and rooms', short: 'Build', icon: 'rooms', tools: [['wall', 'Wall', '1'], ['room', 'Room', '2'], ['floor', 'Floor', '3']] },
        { id: 'open', name: 'Doors and windows', short: 'Openings', icon: 'door', tools: [['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6']] },
        { id: 'levels', name: 'Stairs and roof', short: 'Levels', icon: 'stairs', tools: [['stairs', 'Stairs', '7'], ['roof', 'Roof', '8']] },
        { id: 'finish', name: 'Lights and entrance', short: 'Finish', icon: 'light', tools: [['light', 'Light', '9'], ['entrance', 'Entrance', '0']] },
        '|',
        { id: 'eraser', name: 'Eraser', short: 'Erase', icon: 'eraser', tools: [['eraser', 'Eraser', 'X']] }
    ];
    const PAINT_TARGETS = [['wall', 'Walls'], ['floor', 'Floors'], ['ceil', 'Ceilings'], ['roof', 'Roofs']];
    const DEFAULT_ROWS = [['wallExt', 'Outside walls'], ['wallInt', 'Inside walls'], ['floor', 'Floors'], ['ceiling', 'Ceilings'], ['roof', 'Roofs'], ['trim', 'Trim & frames'], ['slab', 'Slab edges'], ['stair', 'Stair treads']];

    function toast(text, kind) {
        const t = el('div', { class: 'toast ' + (kind || '') }, text); $('toasts').append(t);
        setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, kind === 'err' ? 6000 : 2800);
    }
    bus.on('toast', (t) => toast(t.text, t.kind));

    // ---------- modal ----------
    // opts.sticky: clicking outside does not close it (start screen, where nothing is open yet)
    function modal(content, opts) { const m = $('modal'); m.innerHTML = ''; m.append(content); m.hidden = false; m.onclick = (opts && opts.sticky) ? null : (e) => { if (e.target === m) closeModal(); }; }
    function closeModal() { $('modal').hidden = true; $('modal').innerHTML = ''; }
    function confirmDlg(title, text, okLabel, danger) {
        return new Promise(res => {
            const done = (v) => { closeModal(); res(v); };
            modal(el('div', { class: 'dlg' }, el('h2', null, title), el('div', { class: 'note' }, text),
                el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, okLabel || 'OK'))));
        });
    }

    // ---------- small widgets ----------
    function stepper(text, minus, plus) {
        const v = el('div', { class: 'val' }, text());
        const upd = () => { v.textContent = text(); };
        return el('div', { class: 'stepper' }, el('button', { onclick: () => { minus(); upd(); } }, '−'), v, el('button', { onclick: () => { plus(); upd(); } }, '+'));
    }
    function seg(items, cur, onPick) {
        const root = el('div', { class: 'seg' });
        items.forEach(it => root.append(el('button', { class: it[0] === cur ? 'on' : '', onclick: () => onPick(it[0]) }, it[1])));
        return root;
    }
    function swatchEl(id, px) { const c = TEX.swatch(id, px || 48); return c; }

    // ---------- top bar ----------
    function renderTop() {
        const P = S.project, k = P.kind;
        M.Layout.renderSteps(k === 'import' ? M.ImportUI.stepTabs()
            : (k === 'vanilla' ? [['vanilla', 'House', !!(P.vanilla && P.vanilla.grabbed)], ['build', 'Build'], ['paint', 'Paint'], ['export', 'Export']]
                : (k === 'game' ? [['game', 'Interior' + (P.game && P.game.name ? ': ' + P.game.name : '')]] : [['build', 'Build'], ['paint', 'Paint'], ['export', 'Export']])), S.tab);
        $('b-undo').disabled = !Model.hist.undo.length; $('b-redo').disabled = !Model.hist.redo.length;
        const nm = $('projname'); if (document.activeElement !== nm) nm.value = S.project.name;
        $('savestate').textContent = S.saving ? 'Saving...' : (S.saved ? 'Saved' : 'Unsaved'); $('savestate').classList.toggle('unsaved', !S.saved);
    }

    // ---------- left: build ----------
    function renderBuild(root) {
        const t = S.tool;
        M.Layout.toolHead(root, M.Layout.groupOf(GRID_GROUPS, t), t);
        if (TOOL_HELP[t]) root.append(el('div', { class: 'note' }, TOOL_HELP[t]));
        if (t === 'room' || t === 'floor') {
            root.append(el('div', { class: 'row' }, el('label', null, 'Floor'), swatchEl(S.brush.floor, 28), el('span', { class: 'grow' }, TEX.def(S.brush.floor).name),
                el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'floor'; M.App.setTab('paint'); } }, 'Change')));
        }
        if (t === 'roof') {
            root.append(el('div', { class: 'row' }, el('label', null, 'Roof'), swatchEl(S.brush.roof, 28), el('span', { class: 'grow' }, TEX.def(S.brush.roof).name),
                el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'roof'; M.App.setTab('paint'); } }, 'Change')));
            root.append(el('div', { class: 'row wrap' },
                el('button', { class: 'btn sm', onclick: () => { Model.edit(P => { const L = P.levels[S.level], above = P.levels[S.level + 1]; Object.keys(L.floor).forEach(k => { if (!above || above.floor[k] === undefined) L.roof[k] = S.brush.roof; }); }); } }, 'Roof over all rooms'),
                el('button', { class: 'btn sm danger', onclick: () => { Model.edit(P => { P.levels[S.level].roof = {}; }); } }, 'Clear roof')));
        }
        if (t === 'stairs') renderStairOptions(root);
        root.append(el('div', { class: 'h' }, 'Camera'),
            el('div', { class: 'note' }, 'Right-drag orbit · middle-drag or Shift+right-drag pan · wheel zoom · WASD move · Q/E turn · T top-down.'));
    }

    function renderStairOptions(root) {
        const st = S.stair, cfg = S.project.settings;
        const info = el('div', { class: 'note' });
        const refreshInfo = () => {
            const si = Mesher.stairInfo(cfg, { i: 0, j: 0, dir: st.dir, wid: st.wid, steps: st.steps, run: st.run });
            info.textContent = (si.rise * 100).toFixed(1) + ' cm rise · ' + (si.tread * 100).toFixed(0) + ' cm run · ' + si.angle.toFixed(0) + '° · ' + si.len + ' cells long, ' + si.wc + ' wide';
        };
        const auto = () => Math.max(3, Math.round(cfg.storyHeight / 0.18));
        root.append(el('div', { class: 'h' }, 'Stair settings'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Steps'), stepper(() => st.steps === 0 ? 'auto (' + auto() + ')' : String(st.steps),
            () => { st.steps = Math.max(3, (st.steps || auto()) - 1); refreshInfo(); }, () => { st.steps = Math.min(40, (st.steps || auto()) + 1); refreshInfo(); })));
        root.append(el('div', { class: 'row' }, el('label', null, ''), el('button', { class: 'btn sm', onclick: () => { st.steps = 0; M.App.refreshPanels(); } }, 'Auto steps')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Run (cm)'), stepper(() => String(Math.round(st.run * 100)),
            () => { st.run = Math.max(0.22, st.run - 0.01); refreshInfo(); }, () => { st.run = Math.min(0.45, st.run + 0.01); refreshInfo(); })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Width (m)'), stepper(() => st.wid.toFixed(2),
            () => { st.wid = Math.max(0.6, Math.round((st.wid - 0.05) * 100) / 100); refreshInfo(); }, () => { st.wid = Math.min(3, Math.round((st.wid + 0.05) * 100) / 100); refreshInfo(); })));
        root.append(info); refreshInfo();
        root.append(el('div', { class: 'h' }, 'Climbs towards'));
        const names = ['East', 'North', 'West', 'South'], pad = el('div', { class: 'dirpad' });
        const mk = (d, label, col, row) => { const b = el('button', { class: st.dir === d ? 'on' : '', style: { gridColumn: col, gridRow: row }, onclick: () => { st.dir = d; M.App.refreshPanels(); } }, label); return b; };
        pad.append(mk(1, '↑ N', 2, 1), mk(2, '← W', 1, 2), mk(0, 'E →', 3, 2), mk(3, '↓ S', 2, 3));
        pad.append(el('button', { style: { gridColumn: 2, gridRow: 2 }, title: 'Rotate (R)', onclick: () => { st.dir = (st.dir + 3) % 4; M.App.refreshPanels(); } }, '↻'));
        root.append(pad, el('div', { class: 'note' }, 'Flight climbs ' + names[st.dir] + '. Press R to turn it. It opens a hole in the floor above.'));
        root.append(el('div', { class: 'h' }, 'Style'));
        root.append(el('div', { class: 'row' }, seg([['solid', 'Solid'], ['open', 'Open']], st.style, v => { st.style = v; M.App.refreshPanels(); })));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.rail ? true : null, onchange: (e) => { st.rail = e.target.checked; } }), 'Railings'));
        root.append(el('button', { class: 'btn sm danger', onclick: () => { Model.edit(P => { P.levels[S.level].stairs.pop(); }); } }, 'Delete last stair'));
    }

    // ---------- left: paint ----------
    function renderPaint(root) {
        const P = S.project;
        root.append(el('div', { class: 'h' }, 'Paint'), el('div', { class: 'note' }, TOOL_HELP.paint));
        root.append(el('div', { class: 'row' }, seg(PAINT_TARGETS, S.paintTarget, v => { S.paintTarget = v; S.benchSel = S.brush[v]; M.App.refreshPanels(); })));
        if (S.paintTarget !== 'roof') root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: S.paintRoom ? true : null, onchange: (e) => { S.paintRoom = e.target.checked; } }), 'Whole room at once'));
        root.append(el('div', { class: 'h' }, 'Project theme'),
            el('div', { class: 'note' }, 'What every unpainted surface looks like. Pick a texture below, then press Set.'));
        DEFAULT_ROWS.forEach(r => {
            root.append(el('div', { class: 'defrow' }, swatchEl(P.defaults[r[0]], 22), el('span', null, r[1]),
                el('button', { class: 'btn sm', onclick: () => { Model.edit(PP => { PP.defaults[r[0]] = S.benchSel || S.brush[S.paintTarget]; }); M.App.refreshPanels(); } }, 'Set')));
        });
    }

    // a picture the user picked (png, jpg) becomes a texture in the "Mine" group (stored with the project, exported like the others); done(id): what to do with
    // it then (a wall or a part of a model takes it), else it becomes the brush of the Paint tab
    function addUserImage(file, done) {
        if (!file) return; const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => {
            const id = 'my_' + (file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'image') + '_' + Math.random().toString(36).slice(2, 4);
            // the middle square of the picture, so a wide photo is not squeezed
            const s = Math.min(im.width, im.height), Z = s >= 512 ? 512 : 256, c = document.createElement('canvas'); c.width = c.height = Z;
            c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, Z, Z);
            const def = TEX.addUser(id, file.name.replace(/\.[^.]+$/, '').slice(0, 24), 1, c); URL.revokeObjectURL(url);
            S.ref = S.ref || {}; S.ref.tex = (S.ref.tex || []).concat([{ id, name: def.name, tile: def.tile, url: TEX.userUrl(id) }]);
            Model.saveRef().catch(() => { });
            if (done) { done(id); toast('Your image ' + def.name + ' is a texture now (under Mine).', 'ok'); return; }
            S.benchCat = 'Mine'; S.benchSel = id; S.brush[S.paintTarget] = id; M.App.refreshPanels();
        };
        im.onerror = () => { toast('That file is not a picture the program can read.', 'err'); URL.revokeObjectURL(url); }; im.src = url;
    }
    function renderBench() {
        const b = $('bench'); b.innerHTML = '';
        if (S.tab !== 'paint') return;
        if (!S.benchSel) S.benchSel = S.brush[S.paintTarget];
        const t = TEX.def(S.benchSel), big = el('canvas', { class: 'big', width: 120, height: 120 });
        big.getContext('2d').drawImage(TEX.swatch(S.benchSel, 120), 0, 0);
        const cats = ['All'].concat(TEX.cats); if (!S.benchCat) S.benchCat = 'All';
        const chips = el('div', { class: 'chips' }); cats.forEach(c => chips.append(el('button', { class: 'chip' + (S.benchCat === c ? ' on' : ''), onclick: () => { S.benchCat = c; renderBench(); } }, c)));
        chips.append(el('label', { class: 'chip', style: { cursor: 'pointer' }, title: 'Use a picture of your own (png, jpg) as a texture' }, '+ Add an image',
            el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: (e) => { addUserImage(e.target.files[0]); e.target.value = ''; } })));
        const grid = el('div', { class: 'sw-grid' });
        TEX.list.filter(x => S.benchCat === 'All' || x.cat === S.benchCat).forEach(x => {
            grid.append(el('div', { class: 'sw' + (x.id === S.benchSel ? ' on' : ''), title: x.name, onclick: () => { S.benchSel = x.id; S.brush[S.paintTarget] = x.id; M.App.refreshPanels(); } }, swatchEl(x.id, 64), el('span', null, x.name)));
        });
        b.append(el('div', { class: 'bench' },
            el('div', { class: 'cur' }, el('div', { class: 'h' }, 'Texture'), big, el('div', null, el('b', null, t.name), t.kind === 'user'
                ? el('div', { class: 'note' }, 'repeats every ', el('input', { type: 'number', step: '0.1', min: '0.2', max: '8', value: t.tile, style: { width: '58px' }, onchange: (e) => { const v = Math.min(8, Math.max(0.2, parseFloat(e.target.value) || 1)); t.tile = v; if (S.ref && S.ref.tex) S.ref.tex.forEach(q => { if (q.id === t.id) q.tile = v; }); Model.saveRef().catch(() => { }); M.App.remesh(); } }), ' m')
                : el('div', { class: 'note' }, t.cat + ' · repeats every ' + t.tile + ' m'))),
            el('div', null, chips, grid)));
    }

    // ---------- left: export ----------
    // accepts vec4(x, y, z, h), vector4(...), "x = 1, y = 2 ..." or plain numbers; words (and the 4 in vec4) are ignored
    function parseCoords(s) { return ((s || '').replace(/[A-Za-z_][A-Za-z_0-9]*/g, ' ').match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
    function computePlacement(P, built) {
        const X = P.export, n = parseCoords(X.coords);
        if (n.length < 3) return { error: 'Paste the game coordinates first (x, y, z and heading).' };
        const h = n.length > 3 ? n[3] : 0, floorZ = n[2] - (X.pedZ ? 1 : 0) + (+X.floorAbove || 0), ent = built.entrance;
        if (P.entrance && !(ent && ent.ok)) return { error: 'The entrance must be a door or archway in an outside wall (a floor on one side only).' };
        if (ent && ent.ok) {
            const hh = (h + (X.facing === 'out' ? 180 : 0)) * Math.PI / 180, wd = [-Math.sin(hh), Math.cos(hh)];
            const th = Math.atan2(wd[1], wd[0]) - Math.atan2(ent.inward[1], ent.inward[0]), c = Math.cos(th), s = Math.sin(th);
            const ox = n[0] - (ent.center[0] * c - ent.center[1] * s), oy = n[1] - (ent.center[0] * s + ent.center[1] * c);
            const deg = ((th * 180 / Math.PI) % 360 + 360) % 360;
            return { x: ox, y: oy, z: floorZ - ent.zFloor, heading: deg, note: 'door at ' + n[0].toFixed(2) + ', ' + n[1].toFixed(2) + ', ' + n[2].toFixed(2) + ' heading ' + h };
        }
        return { x: n[0], y: n[1], z: floorZ, heading: h, note: 'none set (project origin placed at the given coordinates)' };
    }
    function safeRes(s) { return (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

    let exportEls = {};
    function renderExport(root) {
        const P = S.project, X = P.export, E = exportEls = {};
        const text = (key, ph, w) => el('input', { type: 'text', class: 'grow', value: X[key] || '', placeholder: ph || '', oninput: (e) => { X[key] = e.target.value; Model.touch(); } });
        root.append(el('div', { class: 'h' }, 'Resource'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Folder'), text('resource', 'mlo_' + (safeRes(P.name) || 'house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Prefix'), el('input', { type: 'text', class: 'grow', value: P.prefix, maxlength: 8, title: 'Every model in the pack starts with this. Keep it unique on your server.', oninput: (e) => { P.prefix = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); Model.touch(); } })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Label'), text('label', P.name)));
        root.append(el('div', { class: 'h' }, 'Where it goes'));
        E.ent = el('div', { class: 'note' }); root.append(E.ent);
        root.append(el('div', { class: 'note' }, 'In the game, stand in the doorway of the real spot and copy your coordinates, e.g. ', el('b', null, 'vec4(x, y, z, heading)'), '.'));
        root.append(el('textarea', { placeholder: 'vec4(-24.09, -1862.60, 25.35, 141.0)', oninput: (e) => { X.coords = e.target.value; Model.touch(); updateExportInfo(); } }, X.coords || ''));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.pedZ ? true : null, onchange: (e) => { X.pedZ = e.target.checked; Model.touch(); updateExportInfo(); } }), 'Coordinates are from a standing player (floor = z − 1)'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Heading'), el('select', { class: 'grow', onchange: (e) => { X.facing = e.target.value; Model.touch(); updateExportInfo(); } },
            el('option', { value: 'in', selected: X.facing !== 'out' ? true : null }, 'taken facing into the house'), el('option', { value: 'out', selected: X.facing === 'out' ? true : null }, 'taken facing out of the house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Floor above ground'), el('input', { type: 'number', class: 'grow', step: '0.05', value: X.floorAbove, onchange: (e) => { X.floorAbove = parseFloat(e.target.value) || 0; Model.touch(); updateExportInfo(); } }), el('span', { class: 'note' }, 'm')));
        E.place = el('div', { class: 'note' }); root.append(E.place);
        root.append(el('div', { class: 'h' }, 'Options'));
        root.append(UI.ambientRow(X));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.autoLights ? true : null, onchange: (e) => { X.autoLights = e.target.checked; Model.touch(); } }), 'Automatic ceiling lights in every room'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Output folder'), el('input', { type: 'text', class: 'grow', value: X.outDir || '', placeholder: 'default: the output folder next to the program', onchange: (e) => { X.outDir = e.target.value.trim(); Model.touch(); } })));
        E.btn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px', padding: '9px' }, onclick: () => doExport() }, 'Export resource');
        root.append(E.btn);
        E.log = el('div', { class: 'log', style: { marginTop: '10px', display: 'none' } }); root.append(E.log);
        E.after = el('div', { class: 'row wrap', style: { display: 'none' } }); root.append(E.after);
        updateExportInfo();
    }
    function updateExportInfo() {
        if (S.project.kind === 'vanilla' || S.tab !== 'export' || !exportEls.ent) return;
        const P = S.project, built = M.App.exportPreview(), E = exportEls;
        E.ent.innerHTML = '';
        if (!P.entrance) E.ent.append(el('span', null, 'No entrance marked. Use the '), el('b', null, 'Entrance'), el('span', null, ' tool on a door in the Build tab, or the project origin (grid corner 0,0) is placed at the coordinates.'));
        else if (built.entrance && built.entrance.ok) E.ent.append(el('span', null, 'Entrance: '), el('b', null, 'door on level 0 at grid ' + built.entrance.center[0].toFixed(1) + ', ' + built.entrance.center[1].toFixed(1)));
        else E.ent.append(el('b', { style: { color: '#ffb3c2' } }, 'The entrance is not on an outside wall.'));
        const pl = S.project.export.coords ? computePlacement(P, built) : null;
        E.place.textContent = pl ? (pl.error ? pl.error : 'Project origin goes to ' + pl.x.toFixed(2) + ', ' + pl.y.toFixed(2) + ', ' + pl.z.toFixed(2) + ' turned ' + pl.heading.toFixed(1) + '°') : '';
    }

    async function doExport() {
        const P = S.project, X = P.export, E = exportEls;
        const built = Mesher.build(P, { mode: 'export', autoLights: X.autoLights });
        const log = (html, cls) => { E.log.style.display = 'block'; E.log.append(el('div', { class: cls || '' }, html)); E.log.scrollTop = 1e9; };
        E.log.innerHTML = ''; E.after.style.display = 'none';
        if (!built.batches.length) { toast('Nothing to export yet. Build walls and floors first.', 'warn'); return; }
        const pl = computePlacement(P, built); if (pl.error) { toast(pl.error, 'warn'); return; }
        if (!P.prefix) { toast('Give the project a prefix first.', 'warn'); return; }
        const resource = safeRes(X.resource) || ('mlo_' + (safeRes(P.name) || 'house'));
        E.btn.disabled = true; E.btn.textContent = 'Exporting...';
        try {
            log('Meshing: ' + built.stats.tris + ' triangles, ' + built.stats.boxes + ' collision boxes, ' + built.stats.portals + ' portals, ' + built.stats.lights + ' lights');
            if (!built.portals.length) log('Warning: no windows or doors on an outside wall, so the interior is never visible from outside. Add an entrance door.', 'bad');
            const model = Mesher.toExport(P, built, { light: {}, model: { resource, prefix: P.prefix, label: X.label || P.name, timecycle: 'hash_E83C53FC', ambient: X.ambient || 'normal', placement: { x: pl.x, y: pl.y, z: pl.z, heading: pl.heading }, entranceNote: pl.note, outDir: X.outDir || undefined } });
            const res = await Model.api('export', 'POST', model);
            if (!res.ok) { log('Export failed: ' + res.error, 'bad'); console.error(res.detail); }
            else {
                (res.log || []).forEach(l => log(l)); (res.warnings || []).forEach(l => log('Warning: ' + l, 'bad'));
                (res.files || []).forEach(f => log('  ' + f));
                log('Done: ' + res.dir, 'good');
                E.after.style.display = 'flex'; E.after.innerHTML = '';
                E.after.append(el('button', { class: 'btn sm', onclick: () => Model.api('reveal?name=' + encodeURIComponent(res.dir), 'POST') }, 'Open folder'),
                    el('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText('ensure ' + res.resource); toast('Copied: ensure ' + res.resource, 'ok'); } catch (e) { toast('Could not copy to the clipboard. Check browser permission.', 'warn'); } } }, 'Copy "ensure ' + res.resource + '"'));
            }
        } catch (err) { log('Export failed: ' + err.message, 'bad'); }
        E.btn.disabled = false; E.btn.textContent = 'Export resource';
    }

    // ---------- left dispatcher ----------
    function renderLeft() {
        const root = $('left'); root.innerHTML = '';
        if (S.project.kind === 'import') M.ImportUI.renderLeft(root);
        else if (S.project.kind === 'game') M.GameMlo.renderLeft(root);
        else if (S.project.kind === 'vanilla') {
            const V = M.VanillaUI;
            if (S.tab === 'vanilla') V.renderHouse(root); else if (S.tab === 'build') V.renderBuild(root); else if (S.tab === 'paint') V.renderPaint(root); else V.renderExport(root);
        }
        else if (S.tab === 'build') renderBuild(root); else if (S.tab === 'paint') renderPaint(root); else renderExport(root);
        renderFrame(); renderRight();
    }
    // the rail, the view bar and the status bar of each kind of project
    function renderFrame() {
        const k = S.project.kind, L = M.Layout;
        if (k === 'import') { L.renderRail(M.ImportUI.railGroups(), S.tab === 'build' ? S.shellTool : null); L.setView(M.ImportUI.viewItems); L.setStatus(M.ImportUI.statusItems); return; }
        if (k === 'vanilla') { L.renderRail(M.VanillaUI.railGroups(), S.tab === 'build' ? S.shellTool : null); L.setView(M.VanillaUI.viewItems); L.setStatus(null); return; }
        if (k === 'game') { L.renderRail(M.GameMlo.railGroups(), null); L.setView(M.GameMlo.viewItems); L.setStatus(M.GameMlo.statusItems); return; }
        L.renderRail(GRID_GROUPS, S.tab === 'build' ? S.tool : null); L.setView(gridView); L.setStatus(gridStatus);
    }
    function gridView() {
        const R = M.App.renderer;
        return [{ seg: [['up', 'Up'], ['half', 'Half'], ['down', 'Down']], cur: S.view.wallMode, label: 'Walls', pick: v => { S.view.wallMode = v; M.App.remesh(); renderRight(); } }, '|',
            { icon: 'layers', label: 'Floors', on: S.view.floor, act: () => { S.view.floor = !S.view.floor; renderRight(); } },
            { icon: 'roof', label: 'Roofs', on: S.view.roof, act: () => { S.view.roof = !S.view.roof; renderRight(); } },
            { icon: 'grid', label: 'Grid', on: S.view.grid, act: () => { S.view.grid = !S.view.grid; R.showGrid = S.view.grid; renderRight(); } }, '|',
            { icon: 'top', label: 'Top-down', title: 'Top-down (T)', act: () => M.App.toggleTopDown() }, { icon: 'frame', label: 'Frame', title: 'Frame the house (Home)', act: () => M.App.frameAll() }];
    }
    function gridStatus() {
        const P = S.project, lv = el('div', { class: 'slv' }, el('span', { class: 'sk' }, 'Level'));
        P.levels.forEach((l, k) => lv.append(el('button', { class: S.level === k ? 'on' : '', onclick: () => M.App.setLevel(k) }, String(k))));
        return [lv, el('span', { class: 'sc' }, Object.keys(Model.cur().walls).length + ' walls · ' + Object.keys(Model.cur().floor).length + ' floor cells')];
    }

    // ---------- right: view & levels ----------
    function renderRight() {
        const root = $('right'), P = S.project; root.innerHTML = '';
        if (P.kind === 'import') { M.ImportUI.renderRight(root); return; }
        if (P.kind === 'vanilla') { M.VanillaUI.renderRight(root); return; }
        if (P.kind === 'game') { M.GameMlo.renderRight(root); return; }
        M.Layout.inspector(root, [{ id: 'scene', label: 'Scene', render: gridScene }, { id: 'project', label: 'Project', render: gridProject }]);
    }
    function gridScene(root) {
        const P = S.project;
        root.append(el('div', { class: 'h' }, 'Levels'));
        const lv = el('div', { class: 'levels' });
        P.levels.forEach((l, k) => lv.append(el('button', { class: 'lvl' + (S.level === k ? ' on' : ''), onclick: () => M.App.setLevel(k) }, 'L' + k)));
        lv.append(el('button', { class: 'lvl', title: 'Add a level above', onclick: () => { Model.edit(PP => { PP.levels.push(Model.newLevel()); }); M.App.setLevel(P.levels.length - 1); } }, '+'));
        root.append(lv);
        root.append(el('div', { class: 'row wrap', style: { marginTop: '8px' } },
            S.level > 0 ? el('button', { class: 'btn sm', title: 'Copy the walls and floors of the level below onto this level', onclick: () => { Model.edit(PP => { const src = PP.levels[S.level - 1], dst = PP.levels[S.level]; dst.floor = JSON.parse(JSON.stringify(src.floor)); dst.walls = JSON.parse(JSON.stringify(src.walls)); dst.ceil = {}; }); } }, 'Copy level below') : null,
            P.levels.length > 1 && S.level === P.levels.length - 1 ? el('button', { class: 'btn sm danger', onclick: async () => { const L = P.levels[S.level]; if (Object.keys(L.floor).length + Object.keys(L.walls).length > 0 && !(await confirmDlg('Remove level ' + S.level + '?', 'Everything on this level will be deleted. You can undo with Ctrl+Z.', 'Remove', true))) return; Model.edit(PP => { PP.levels.pop(); }); M.App.setLevel(P.levels.length - 1); } }, 'Remove top level') : null));
        root.append(el('div', { class: 'row', style: { marginTop: '8px' } }, el('label', null, 'Level height'), el('input', { type: 'number', class: 'grow', step: '0.1', min: '2.4', max: '5', value: P.settings.storyHeight, onchange: (e) => { const v = Math.min(5, Math.max(2.4, parseFloat(e.target.value) || 3.1)); Model.edit(PP => { PP.settings.storyHeight = v; }); M.App.refreshGrid(); } }), el('span', { class: 'note' }, 'm')));
    }
    function gridProject(root) {
        const P = S.project;
        root.append(el('div', { class: 'h' }, 'Show'));
        const chk = (key, label) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: S.view[key] ? true : null, onchange: (e) => { S.view[key] = e.target.checked; if (key === 'grid') M.App.renderer.showGrid = e.target.checked; M.Layout.renderView(); } }), label);
        root.append(chk('floor', 'Floors'), chk('walls', 'Walls'), chk('roof', 'Roofs'), chk('grid', 'Grid'), chk('outside', 'Outside shell only (what the game draws from outside)'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Walls'), seg([['up', 'Up'], ['half', 'Half'], ['down', 'Down']], S.view.wallMode, v => { S.view.wallMode = v; M.App.remesh(); renderRight(); })));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.App.toggleTopDown() }, 'Top-down (T)'),
            el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDlg('Clear level ' + S.level + '?', 'Walls, floors, stairs, roof and lights on this level are removed. You can undo with Ctrl+Z.', 'Clear', true)) Model.edit(PP => { PP.levels[S.level] = Model.newLevel(); if (PP.entrance && PP.entrance.level === S.level) PP.entrance = null; }); } }, 'Clear level')));
        const b = M.App.built; if (b) root.append(el('div', { class: 'h' }, 'Model'), el('div', { class: 'kv' }, 'Triangles', el('b', null, b.stats.tris.toLocaleString()), 'Walls', el('b', null, Object.keys(Model.cur().walls).length), 'Floor cells', el('b', null, Object.keys(Model.cur().floor).length)));
    }

    // ---------- dialogs ----------
    const KIND_ART = {
        import: '<svg viewBox="0 0 120 100" aria-hidden="true"><path class="sv-wall" d="M14 92V44L60 12l46 32v48z"/><path class="sv-roof" d="M6 48L60 10l54 38"/><rect class="sv-cut" x="30" y="52" width="22" height="22" rx="2"/><rect class="sv-cut" x="68" y="58" width="18" height="34" rx="2"/></svg>',
        grid: '<svg viewBox="0 0 120 100" aria-hidden="true"><g class="sv-grid"><path d="M10 30h100M10 50h100M10 70h100M30 12v84M50 12v84M70 12v84M90 12v84"/></g><path class="sv-room" d="M30 30h40v40H30z"/><path class="sv-room2" d="M70 50h20v20H70z"/><circle class="sv-dot" cx="30" cy="30" r="4"/><circle class="sv-dot" cx="90" cy="70" r="4"/></svg>',
        game: '<svg viewBox="0 0 120 100" aria-hidden="true"><path class="sv-map" d="M10 22l30-10 40 12 30-10v66l-30 10-40-12-30 10z"/><path class="sv-fold" d="M40 12v66M80 24v66"/><path class="sv-pin" d="M60 70s-16-16-16-28a16 16 0 0132 0c0 12-16 28-16 28z"/><circle class="sv-pinhole" cx="60" cy="42" r="6"/></svg>'
    };
    // starting a project: pick the kind, optionally name it
    function newProjectDialog(opts) {
        opts = opts || {};
        const nameIn = el('input', { type: 'text', class: 'np-name', placeholder: 'Project name (optional)', maxlength: 60, 'aria-label': 'Project name' });
        const create = async (kind) => { const n = nameIn.value.trim() || (kind === 'import' ? 'My Interior' : 'New House'); closeModal(); try { await Model.createProject(n, kind); } catch (e) { toast('Could not create the project: ' + e.message, 'err'); } };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') create('import'); });
        const card = (kind, title, sub, tag, onGo, delay) => {
            const art = el('div', { class: 'scard-art' }); art.innerHTML = KIND_ART[kind];
            const c = el('div', { class: 'scard sm k-' + kind, role: 'button', tabindex: '0', style: { animationDelay: delay + 's' }, onclick: onGo,
                onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); onGo(); } } },
                el('div', { class: 'scard-in' }, tag ? el('div', { class: 'scard-tag' }, tag) : el('div'), art,
                    el('div', { class: 'scard-txt' }, el('div', { class: 'scard-t' }, title), el('div', { class: 'scard-s' }, sub))),
                el('div', { class: 'scard-glare' }));
            return tiltCard(c);
        };
        const back = opts.back ? el('button', { class: 'btn', onclick: () => opts.back() }, 'Back')
            : (opts.noCancel ? el('button', { class: 'btn', onclick: () => projectsDialog() }, 'Open a saved project') : el('button', { class: 'btn', onclick: closeModal }, 'Cancel'));
        modal(el('div', { class: 'start np' },
            el('div', { class: 'np-head' }, el('h2', null, 'New project'), nameIn),
            el('div', { class: 'start-cards' },
                card('import', 'Imported model', 'Import a building (.ydr, .ytd, .ybn, .ymap), cut doors and windows, then build inside.', 'Recommended', () => create('import'), 0),
                card('grid', 'New building', 'Build on a grid: rooms, doors, windows, stairs, floors, and roof.', '', () => create('grid'), 0.07),
                card('game', 'Game building', 'Find a GTA V building by name (LSPD, Pillbox...) and open its interior.', '', () => M.Buildings.dialog({ back: () => newProjectDialog(opts) }), 0.14)),
            el('div', { class: 'np-foot' }, back)), { sticky: !!(opts.back || opts.noCancel) });
        setTimeout(() => nameIn.focus(), 30);
    }
    // ---------- the project list: cards with a picture, the kind, when it was opened and edited; open, rename, duplicate, delete ----------
    const KIND = { import: 'Interior in an imported model', grid: 'New building', vanilla: 'House (older kind)', game: 'Building of the game' };
    function ago(iso) {
        if (!iso) return ''; const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
        if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
        if (s < 172800) return 'yesterday'; if (s < 86400 * 14) return Math.round(s / 86400) + ' days ago'; return d.toLocaleDateString();
    }
    function renameDialog(oldName, done) {
        const nameIn = el('input', { type: 'text', class: 'grow', value: oldName, maxlength: 60 });
        const go = async () => {
            const n = nameIn.value.trim(); if (!n) return;
            try { const r = await Model.renameAny(oldName, n); closeModal(); toast('Renamed to "' + r + '"', 'ok'); } catch (e) { toast('Could not rename: ' + e.message, 'err'); return; }
            done();
        };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        modal(el('div', { class: 'dlg' }, el('h2', null, 'Rename project'), el('div', { class: 'note' }, 'The project, its imported model files and its picture move to the new name.'), el('div', { class: 'row' }, nameIn),
            el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: () => done() }, 'Cancel'), el('button', { class: 'btn primary', onclick: go }, 'Rename'))), { sticky: true });
        setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
    }
    // ctx: current (name of the open project, or ''), open(name), rerender()
    function projectCards(list, ctx) {
        const grid = el('div', { class: 'pc-grid' });
        const sorted = list.map(p => ({ p, opened: Model.openedAt(p.name) })).sort((a, b) => String(b.opened || b.p.modified).localeCompare(String(a.opened || a.p.modified)));
        const action = (label, title, fn, danger) => el('button', { class: 'pc-act' + (danger ? ' danger' : ''), type: 'button', title, onclick: (e) => { e.stopPropagation(); fn(); }, onkeydown: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation() }, label);
        sorted.forEach(({ p, opened }, i) => {
            const isCur = p.name === ctx.current;
            const art = el('div', { class: 'scard-art pc-art' });
            if (p.thumb) art.append(el('img', { class: 'pc-thumb', src: p.thumb, alt: '' }));
            else { const empty = el('div', { class: 'pc-thumb none' }); empty.innerHTML = KIND_ART[p.kind] || KIND_ART.grid; art.append(empty); }
            const when = (opened ? 'Opened ' + ago(opened) : 'Edited ' + ago(p.modified));
            const c = el('div', { class: 'scard pc k-' + (p.kind || 'grid'), role: 'button', tabindex: '0', title: 'Open "' + p.name + '"', 'aria-label': 'Open ' + p.name,
                style: { animationDelay: Math.min(i * 0.05, 0.4) + 's' }, onclick: () => ctx.open(p.name),
                onkeydown: (e) => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.open(p.name); } } },
                el('div', { class: 'scard-in' },
                    el('div', { class: 'pc-top' },
                        el('div', { class: 'pc-acts' },
                            action('Rename', 'Rename this project', () => renameDialog(p.name, ctx.rerender)),
                            action('Duplicate', 'Make a copy of this project', async () => { try { const n = await Model.duplicate(p.name); toast('Created "' + n + '"', 'ok'); } catch (err) { toast('Could not copy it: ' + err.message, 'err'); } ctx.rerender(); }),
                            action('Delete', 'Delete this project', async () => {
                                if (await confirmDlg('Delete "' + p.name + '"?', 'The project file is removed. A copy is kept as .deleted in the projects folder.', 'Delete', true)) { try { await Model.deleteProject(p.name); } catch (err) { toast('Could not delete it: ' + err.message, 'err'); } }
                                ctx.rerender();
                            }, true))),
                    art,
                    el('div', { class: 'scard-txt' },
                        i === 0 ? el('div', { class: 'scard-tag pc-tag' }, 'Most recently opened') : null,
                        el('div', { class: 'scard-t pc-name' }, p.name, isCur ? el('span', { class: 'pc-current' }, ' · Open now') : null),
                        el('div', { class: 'scard-s' }, (KIND[p.kind] || 'Project') + '  ·  ' + when))),
                el('div', { class: 'scard-glare' }));
            grid.append(el('div', { class: 'pc-slot' }, tiltCard(c)));
        });
        if (!list.length) grid.append(el('div', { class: 'note' }, 'No saved projects yet.'));
        return grid;
    }
    // The classic three-card welcome screen: settings, new project, and saved projects.
    function startGearArt() {
        const box = el('div', { class: 'start-gear' });
        box.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M53 8h14l3 11a43 43 0 0 1 9 4l10-5 10 10-5 10a43 43 0 0 1 4 9l11 3v14l-11 3a43 43 0 0 1-4 9l5 10-10 10-10-5a43 43 0 0 1-9 4l-3 11H53l-3-11a43 43 0 0 1-9-4l-10 5-10-10 5-10a43 43 0 0 1-4-9L11 65V51l11-3a43 43 0 0 1 4-9l-5-10 10-10 10 5a43 43 0 0 1 9-4z"/><circle cx="60" cy="58" r="17"/></svg>';
        return box;
    }
    function welcomeCard(title, subtitle, art, onClick, extraClass) {
        const c = el('button', { type: 'button', class: 'welcome-card ' + (extraClass || ''), onclick: onClick },
            el('span', { class: 'welcome-art' }, art), el('span', { class: 'welcome-title' }, title), el('span', { class: 'welcome-sub' }, subtitle));
        c.addEventListener('pointermove', (e) => { const r=c.getBoundingClientRect(), x=(e.clientX-r.left)/r.width, y=(e.clientY-r.top)/r.height; c.style.setProperty('--rx', ((.5-y)*8)+'deg'); c.style.setProperty('--ry', ((x-.5)*10)+'deg'); });
        c.addEventListener('pointerleave', () => { c.style.setProperty('--rx','0deg'); c.style.setProperty('--ry','0deg'); });
        return c;
    }
    function tiltCard(card) {
        const reset = () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); card.style.setProperty('--gx', '50%'); card.style.setProperty('--gy', '30%'); card.classList.remove('hot'); };
        card.addEventListener('pointermove', (e) => {
            const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
            card.style.setProperty('--rx', ((0.5 - y) * 16).toFixed(2) + 'deg'); card.style.setProperty('--ry', ((x - 0.5) * 20).toFixed(2) + 'deg');
            card.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--gy', (y * 100).toFixed(1) + '%'); card.classList.add('hot');
        });
        card.addEventListener('pointerleave', reset); reset();
        return card;
    }
    function gearArt() {
        const art = el('div', { class: 'sart-gear' });
        let teeth = ''; for (let i = 0; i < 8; i++) teeth += '<rect x="51" y="8" width="18" height="24" rx="4" transform="rotate(' + (i * 45) + ' 60 60)"/>';
        art.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><g class="g-body">' + teeth + '<circle cx="60" cy="60" r="38"/></g><circle class="g-ring" cx="60" cy="60" r="20"/><circle class="g-hole" cx="60" cy="60" r="11"/></svg>';
        return art;
    }
    function keysArt() {
        const KB = M.Keys, m = KB.get(), cap = (a, cls) => el('div', { class: 'kc ' + cls }, KB.label(m[a][0]) || '·');
        return el('div', { class: 'sart-keys' }, el('div', { class: 'kc-row' }, cap('turnLeft', 'dim'), cap('forward', 'hot'), cap('turnRight', 'dim')), el('div', { class: 'kc-row' }, cap('left', 'hot'), cap('back', 'hot'), cap('right', 'hot')));
    }
    const THEME_DEFAULTS = { accent: '#8f7dff', accent2: '#6c5cf5', cyan: '#3fd4f2', bg: '#07080e', bg2: '#0d0f19', text: '#eef0f8' };
    const THEME_PRESETS = [
        { name: 'Violet Aurora', values: { accent:'#8f7dff', accent2:'#6c5cf5', cyan:'#3fd4f2', bg:'#07080e', bg2:'#0d0f19', text:'#eef0f8' } },
        { name: 'Ocean', values: { accent:'#42c7e8', accent2:'#1986c8', cyan:'#81e7df', bg:'#06121a', bg2:'#0b202b', text:'#e8f6fb' } },
        { name: 'Sunset', values: { accent:'#ff965e', accent2:'#e45c64', cyan:'#ffc36b', bg:'#170c11', bg2:'#281218', text:'#fff0e8' } },
        { name: 'Emerald', values: { accent:'#42d69a', accent2:'#15966e', cyan:'#a4ed8b', bg:'#07120e', bg2:'#102019', text:'#e9fbf1' } }
    ];
    function themeLoad() {
        try { const v=JSON.parse(localStorage.getItem('mlo.theme')||'{}'); return Object.assign({}, THEME_DEFAULTS, v); } catch(e) { return Object.assign({}, THEME_DEFAULTS); }
    }
    function themeApply(values, save) {
        const root=document.documentElement, v=Object.assign({}, THEME_DEFAULTS, values);
        const rgb=(hex)=>{ const n=parseInt(String(hex).replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
        const rgba=(hex,a)=>{ const c=rgb(hex); return 'rgba('+c[0]+', '+c[1]+', '+c[2]+', '+a+')'; };
        root.style.setProperty('--accent',v.accent); root.style.setProperty('--accent2',v.accent2); root.style.setProperty('--cyan',v.cyan);
        root.style.setProperty('--grad','linear-gradient(135deg, '+v.accent+' 0%, '+v.accent2+' 48%, '+v.cyan+' 100%)');
        root.style.setProperty('--accent-soft',rgba(v.accent,.15)); root.style.setProperty('--accent-glow',rgba(v.accent,.42));
        root.style.setProperty('--bg',v.bg); root.style.setProperty('--bg2',v.bg2); root.style.setProperty('--text',v.text);
        root.style.setProperty('--panel-solid',v.bg2);
        if(save!==false) try { localStorage.setItem('mlo.theme',JSON.stringify(v)); } catch(e) {}
    }
    themeApply(themeLoad(),false);
    function themeDialog(opts) {
        opts=opts||{}; const back=()=>opts.back?opts.back():closeModal(), values=themeLoad();
        const fields=[['accent','Couleur principale'],['accent2','Couleur secondaire'],['cyan','Couleur de contraste'],['bg','Fond principal'],['bg2','Fond des panneaux'],['text','Texte']];
        const controls=el('div',{class:'theme-controls'});
        fields.forEach(([key,label])=>{
            const input=el('input',{type:'color',value:values[key],'aria-label':label,oninput:(e)=>{values[key]=e.target.value;themeApply(values,true);}});
            controls.append(el('label',{class:'theme-field'},el('span',null,label),input,el('code',{class:'theme-hex'},values[key])));
            input.addEventListener('input',()=>{input.nextSibling.textContent=input.value;});
        });
        const presets=el('div',{class:'theme-presets'});
        THEME_PRESETS.forEach(preset=>presets.append(el('button',{type:'button',class:'theme-preset',onclick:()=>{Object.assign(values,preset.values);themeApply(values,true);controls.querySelectorAll('input[type=color]').forEach((input,i)=>{input.value=values[fields[i][0]];input.nextSibling.textContent=input.value;});}},
            el('span',{class:'theme-dots'},...['accent','accent2','cyan'].map(k=>el('i',{style:{background:preset.values[k]}}))),preset.name)));
        const reset=()=>{Object.assign(values,THEME_DEFAULTS);themeApply(values,true);controls.querySelectorAll('input[type=color]').forEach((input,i)=>{input.value=values[fields[i][0]];input.nextSibling.textContent=input.value;});};
        modal(el('div',{class:'start sp theme-dialog'},el('div',{class:'np-head'},el('h2',null,'Couleurs de l’interface'),el('div',{class:'sp-count'},'Aperçu en direct')),
            el('div',{class:'theme-body'},presets,controls,el('div',{class:'note'},'Les couleurs sont appliquées immédiatement et enregistrées sur cet ordinateur.')),
            el('div',{class:'np-foot'},el('button',{class:'btn',onclick:reset},'Réinitialiser'),el('button',{class:'btn primary',onclick:back},opts.back?'Retour':'Terminé'))),{sticky:true});
    }
    function settingsDialog(opts) {
        opts = opts || {};
        const back = () => (opts.back ? opts.back() : closeModal());
        const card = (cls, title, sub, tag, art, onGo) => {
            const c = el('div', { class: 'scard pc ' + cls, role: 'button', tabindex: '0', onclick: onGo, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); } } },
                el('div', { class: 'scard-in' }, el('div', { class: 'scard-tag' }, tag), el('div', { class: 'scard-art pc-art' }, art),
                    el('div', { class: 'scard-txt' }, el('div', { class: 'scard-t pc-name' }, title), el('div', { class: 'scard-s' }, sub))),
                el('div', { class: 'scard-glare' }));
            return el('div', { class: 'pc-slot' }, tiltCard(c));
        };
        const pn = M.Keys.presetName();
        const grid = el('div', { class: 'pc-grid' },
            el('div', { class: 'set-sec' }, 'Contrôles'),
            card('k-keys', 'Modification mouvement', 'Change tes touches de déplacement, de vue et de niveau', pn === 'azerty' ? 'AZERTY' : (pn === 'qwerty' ? 'QWERTY' : 'Personnalisé'), keysArt(), () => movementDialog({ back: () => settingsDialog(opts) })),
            card('k-theme', 'Couleurs de l’interface', 'Personnalise les couleurs sans modifier les fichiers', 'Personnalisation', el('div', { class: 'theme-card-art' }, ...['#8f7dff','#6c5cf5','#3fd4f2','#10121d'].map(c => el('i', { style: { background: c } }))), () => themeDialog({ back: () => settingsDialog(opts) })),
            el('div', { class: 'set-sec' }, 'Langue du logiciel'));
        // one card per language (31, the most spoken in the world first): a click switches the whole editor to it, at once
        const I18 = M.I18n;
        if (I18) I18.LANGS.forEach(L => {
            const on = I18.lang === L.code;
            const art = el('div', { class: 'sart-lang' }, el('div', { class: 'lg-cap' + (on ? ' hot' : ''), 'data-noi18n': '', lang: L.html || L.code }, L.glyph));
            const c = card('lang k-lang' + (on ? ' on' : ''), L.native, null, on ? '✓ Langue active' : (L.rank ? '#' + L.rank : ''), art, () => {
                if (I18.lang === L.code) return;
                I18.set(L.code); const langSelect = document.getElementById('language-select'); if (langSelect) langSelect.value = L.code; settingsDialog(opts); toast(L.native + ' ✓', 'ok');
            });
            const name = c.querySelector('.pc-name'); if (name) { name.setAttribute('data-noi18n', ''); name.setAttribute('lang', L.html || L.code); name.setAttribute('dir', 'auto'); }
            const sub = c.querySelector('.scard-s'); if (sub) { sub.innerHTML = ''; sub.append(el('span', null, L.name), L.speakers ? el('span', { class: 'lg-spk', 'data-noi18n': '' }, '  ·  ' + L.speakers) : null); }
            c.firstChild.setAttribute('aria-label', L.native + ' (' + L.name + ')');
            grid.append(c);
        });
        modal(el('div', { class: 'start sp' },
            el('div', { class: 'np-head' }, el('h2', null, 'Paramètres'), el('div', { class: 'sp-count' }, 'Réglages du logiciel')),
            grid,
            el('div', { class: 'np-foot' }, el('button', { class: 'btn', onclick: back }, opts.back ? 'Retour' : 'Fermer'))), { sticky: true });
        setTimeout(() => { const f = grid.querySelector('.scard'); if (f) f.focus({ preventScroll: true }); }, 40);
    }
    // the movement keys: two keycaps per action, click one then press a key (Esc cancels, Backspace / Suppr empties it)
    function movementDialog(opts) {
        opts = opts || {};
        const KB = M.Keys; let listen = null, msg = '';
        const panel = el('div', { class: 'kb-panel' });
        const stop = () => { if (listen) { window.removeEventListener('keydown', listen.fn, true); listen = null; } };
        const capture = (action, slot) => {
            stop(); msg = '';
            const fn = (e) => {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Tab', 'Dead', 'Unidentified'].indexOf(e.key) >= 0) return;
                stop();
                if (e.key === 'Escape') { draw(); return; }
                if (e.key === 'Backspace' || e.key === 'Delete') { KB.set(action, slot, ''); msg = '« ' + KB.name(action) + ' » : touche ' + (slot + 1) + ' retirée.'; draw(); return; }
                if (e.ctrlKey || e.metaKey || e.altKey) { msg = 'Les raccourcis avec Ctrl ou Alt ne peuvent pas servir au déplacement.'; draw(); return; }
                const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, from = KB.set(action, slot, k);
                msg = from ? '« ' + KB.label(k) + ' » a été retirée de « ' + KB.name(from) + ' ».' : '';
                draw();
            };
            listen = { action, slot, fn }; window.addEventListener('keydown', fn, true); draw();
        };
        const GROUPS = [['move', 'Déplacement'], ['view', 'Vue'], ['level', 'Niveaux']];
        function draw() {
            const m = KB.get(), pn = KB.presetName();
            panel.innerHTML = '';
            panel.append(el('div', { class: 'kb-presets' }, el('span', { class: 'kb-lab' }, 'Clavier'),
                el('button', { class: 'kb-preset' + (pn === 'qwerty' ? ' on' : ''), type: 'button', onclick: () => { stop(); KB.preset('qwerty'); msg = 'Touches QWERTY (WASD) remises.'; draw(); } }, 'QWERTY · WASD'),
                el('button', { class: 'kb-preset' + (pn === 'azerty' ? ' on' : ''), type: 'button', onclick: () => { stop(); KB.preset('azerty'); msg = 'Touches AZERTY (ZQSD) mises.'; draw(); } }, 'AZERTY · ZQSD'),
                pn ? null : el('span', { class: 'kb-custom' }, 'Personnalisé')));
            const cols = [el('div', { class: 'kb-col' }), el('div', { class: 'kb-col' })];
            GROUPS.forEach(([g, title]) => {
                const box = el('div', { class: 'kb-group' }, el('div', { class: 'kb-gt' }, title));
                KB.ACTIONS.filter(a => a[2] === g).forEach(([a, label]) => {
                    const caps = [0, 1].map(i => {
                        const k = m[a][i], on = listen && listen.action === a && listen.slot === i;
                        return el('button', { class: 'kcap' + (on ? ' listen' : '') + (k ? '' : ' empty') + (k && KB.toolKey(k) ? ' warn' : ''), type: 'button',
                            title: on ? 'Appuie sur une touche (Échap annule, Retour arrière vide)' : (k && KB.toolKey(k) ? 'Cette touche sert aussi à un outil' : 'Clique puis appuie sur une touche'),
                            onclick: (e) => { e.stopPropagation(); if (on) { stop(); draw(); } else capture(a, i); } }, on ? '…' : (KB.label(k) || '—'));
                    });
                    box.append(el('div', { class: 'kb-row' + (listen && listen.action === a ? ' on' : '') }, el('span', { class: 'kb-name' }, label), caps[0], caps[1]));
                });
                cols[g === 'move' ? 0 : 1].append(box);
            });
            const sp = KB.speed();
            cols[0].append(el('div', { class: 'kb-group' }, el('div', { class: 'kb-gt' }, 'Vitesse'),
                el('div', { class: 'kb-row kb-speed' }, el('span', { class: 'kb-name' }, 'Vitesse de déplacement'),
                    el('input', { type: 'range', min: '0.25', max: '3', step: '0.25', value: sp, 'aria-label': 'Vitesse de déplacement', oninput: (e) => { KB.setSpeed(e.target.value); e.target.nextSibling.textContent = '×' + KB.speed().toFixed(2).replace(/\.?0+$/, ''); } }),
                    el('b', { class: 'kb-sv' }, '×' + sp.toFixed(2).replace(/\.?0+$/, '')))));
            panel.append(el('div', { class: 'kb-cols' }, cols[0], cols[1]));
            panel.append(el('div', { class: 'kb-msg' + (listen ? ' live' : '') }, listen ? 'Appuie sur la nouvelle touche pour « ' + KB.name(listen.action) + ' »  ·  Échap annule  ·  Retour arrière vide la case' : (msg || 'Clique sur une touche pour la changer. Les changements sont gardés tout de suite.')));
        }
        draw();
        const back = () => { stop(); if (opts.back) opts.back(); else closeModal(); };
        modal(el('div', { class: 'start sp kb' },
            el('div', { class: 'np-head' }, el('h2', null, 'Modification mouvement'), el('div', { class: 'sp-count' }, 'Raccourcis clavier')),
            panel,
            el('div', { class: 'np-foot' }, el('button', { class: 'btn', onclick: back }, 'Retour'), el('button', { class: 'btn primary', onclick: () => { stop(); closeModal(); if (opts.back) opts.back(); } }, 'Terminé'))), { sticky: true });
    }
    // Share = "Upload Mlo Site" (siteupload.js): zip of the MLO folder + file report, sent to the TEMPUS website, pending admin review
    function shareDialog(opts) {
        if (M.SiteUpload && M.SiteUpload.dialog) return M.SiteUpload.dialog({ back: opts && opts.back });
        toast('Upload module missing (js/siteupload.js).', 'err');
    }
    async function startDialog() {
        let list = []; try { list = await Model.listProjects(); } catch (e) { toast(e.message, 'err'); }
        let auto = false; try { auto = localStorage.getItem('mlo.autoopen') === '1'; } catch (e) { }
        const plus = el('span', { class: 'welcome-plus', 'aria-hidden': 'true' }, '+');
        const stack = el('span', { class: 'start-stack', 'aria-hidden': 'true' });
        list.slice(0,3).forEach((project,i) => { const thumb=project.thumb ? el('img',{src:project.thumb,alt:''}) : el('span',{class:'start-thumb-empty'}); thumb.style.setProperty('--card-index',i); stack.append(thumb); });
        if (!list.length) stack.append(el('span',{class:'start-thumb-empty'}));
        const savedLabel = list.length ? list.length + (list.length === 1 ? ' saved project' : ' saved projects') : 'No saved projects yet';
        const shareTitle = M.I18n && M.I18n.lang === 'fr' ? 'Partager un projet' : 'Share a project';
        const shareSubtitle = M.I18n && M.I18n.lang === 'fr' ? 'Upload Mlo Site : envoie ton MLO sur le site TEMPUS' : 'Upload Mlo Site: send your MLO to the TEMPUS website';
        modal(el('div', { class: 'welcome-home' },
            el('div', { class: 'welcome-brand' }, el('img', { src: 'logo.png', alt: '', width: 34, height: 34 }), el('span', null, 'MLO ', el('b', null, 'Creator'))),
            el('div', { class: 'welcome-cards' },
                welcomeCard('New project', 'Create an interior, a new building, or edit a game interior', plus, () => newProjectDialog({ back: startDialog }), 'new'),
                welcomeCard('Saved projects', savedLabel, stack, () => projectsDialog(), 'saved'),
                welcomeCard(shareTitle, shareSubtitle, (() => { const a=el('div',{class:'share-art'}); a.innerHTML='<svg viewBox="0 0 120 100"><path d="M34 50h48M68 34l16 16-16 16"/><circle cx="25" cy="50" r="13"/><circle cx="94" cy="50" r="13"/><path d="M25 43v14m-7-7h14M94 43v14m-7-7h14"/></svg>'; return a; })(), () => shareDialog({ back: startDialog }), 'share'),
                welcomeCard('Settings', 'Language and editor preferences', startGearArt(), () => settingsDialog({ back: startDialog }), 'settings')),
            el('label', { class: 'chk welcome-auto' }, el('input', { type: 'checkbox', checked: auto ? true : null, onchange: (e) => { try { localStorage.setItem('mlo.autoopen', e.target.checked ? '1' : '0'); } catch (err) { } } }), 'Open the last project automatically when the program starts')),
            { sticky: true });
        setTimeout(() => { const f=document.querySelector('.welcome-card.new'); if(f) f.focus({preventScroll:true}); }, 40);
    }
    // a copy of the open project (with its imported files) under another name; the copy is opened
    function saveAsDialog() {
        const nameIn = el('input', { type: 'text', class: 'grow', value: S.project.name + ' copy', maxlength: 60 });
        const go = async () => { const n = nameIn.value.trim(); if (!n) return; closeModal(); try { const r = await Model.saveAs(n); toast('Saved as "' + r + '"', 'ok'); } catch (e) { toast('Could not save: ' + e.message, 'err'); } };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        modal(el('div', { class: 'dlg' }, el('h2', null, 'Save as'), el('div', { class: 'note' }, 'Saves a copy of this project, with its imported files, under a new name and switches to the copy.'), el('div', { class: 'row' }, nameIn),
            el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: closeModal }, 'Cancel'), el('button', { class: 'btn primary', onclick: go }, 'Save as'))));
        setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
    }
    async function projectsDialog() {
        try { await Model.saveThumb(true); } catch (e) { }                     // so the open project's picture shows what is on screen now
        let list = []; try { list = await Model.listProjects(); } catch (e) { toast(e.message, 'err'); }
        const plist = projectCards(list, { current: Model.safeName(S.project.name), rerender: projectsDialog, open: async (name) => { closeModal(); try { await Model.openProject(name); } catch (e) { toast('Could not open it: ' + e.message, 'err'); } } });
        modal(el('div', { class: 'dlg wide' }, el('h2', null, 'Projects'), plist,
            el('div', { class: 'foot' }, el('button', { class: 'btn primary', onclick: () => newProjectDialog() }, 'New project...'), el('button', { class: 'btn', title: 'Save a copy of the open project under another name', onclick: () => saveAsDialog() }, 'Save as...'), el('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    }
    function helpDialog() {
        const rows = [['Left mouse', 'Use the current tool'], ['Middle-drag / right-drag', 'Orbit the camera (like Blender)'], ['Shift+middle-drag / Shift+right-drag', 'Pan'], ['Ctrl+middle-drag / wheel', 'Zoom'], ['Keypad 1 / 3 / 7', 'Front / right / top view (Ctrl: opposite side). Home: frame everything'], ['G / J / H', 'Imported-model projects: raise or lower the rooms, fill gaps, stand a 1.8 m figure in the scene (R turns it)'], ['C', 'Imported-model projects: cutaway, hides the roof and upper walls of the model (it also happens by itself with the Door and Window tools)'], ['V, then click a room', 'Drag an edge or corner to resize, the inside to move (Shift: no snapping). Del or X removes it, Esc deselects'], ['W A S D / arrows', 'Move the camera'], ['Q / E', 'Turn the view 90°'], ['T', 'Top-down view'],
            ['PageUp / PageDown', 'Next / previous level  ( ] and [ too )'], ['1 … 9, 0, X, P', 'Tools: wall, room, floor, door, window, archway, stairs, roof, light, entrance, eraser, paint'], ['O / L / F', 'Imported-model projects: frame tool, light, delete faces (1-7, V, X, P as in the panel)'], ['R', 'Turn the stairs'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S', 'Save now (it also saves by itself)'], ['Esc', 'Cancel a drag']];
        const g = el('div', { class: 'helpgrid' }); rows.forEach(r => g.append(el('div', null, r[0]), el('div', null, r[1])));
        modal(el('div', { class: 'dlg' }, el('h2', null, 'How it works'), el('div', { class: 'note' }, 'Two kinds of project. "Interior in an imported model": import the building\'s model files (.ydr, .ytd, .ybn, .ymap), set the grid on its floor, cut doors and windows through its walls with boxes (the triangles inside them are removed, like a boolean in Blender), delete fake doors and walls face by face, draw the rooms, place the lights and paint. Nothing is built for you. "Whole new building": build on a grid like a house builder (rooms, doors, windows, stairs, levels, roof). Either way Export writes a FiveM resource folder you upload to your server.'), g,
            el('div', { class: 'foot' }, el('button', { class: 'btn primary', onclick: closeModal }, 'Got it'))));
    }

    UI.renderAll = function () { document.body.classList.toggle('paint', S.tab === 'paint'); renderTop(); renderLeft(); renderBench(); };
    UI.renderTop = renderTop; UI.renderRight = renderRight; UI.renderLeft = renderLeft; UI.renderBench = renderBench; UI.updateExportInfo = updateExportInfo;
    UI.addUserImage = addUserImage;
    // a prop of a later DLC than the server's game build (sv_enforceGameBuild in its server.cfg, found above the output folder) does not show on it
    UI.serverBuild = 0;
    UI.buildNote = (m) => (m && m.build && UI.serverBuild && m.build > UI.serverBuild) ? el('div', { class: 'note bad' }, 'From the DLC ' + m.dlc + ': it needs game build ' + (m.build > 9000 ? 'newer than 3889' : m.build) + ', your server runs ' + UI.serverBuild + ' (sv_enforceGameBuild in server.cfg), so it does not show there. Raise the build or pick another prop.') : null;
    // how much of the game's ambient light the exported walls, floors and ceilings take (Exporter.SetAmbient): X is the project's export settings
    UI.ambientRow = (X, onChange) => el('div', null,
        el('div', { class: 'row' }, el('label', null, 'Room light'), el('select', { class: 'grow', onchange: (e) => { X.ambient = e.target.value; Model.touch(); if (onChange) onChange(); } },
            ...[['full', 'Full (glows at night, as before)'], ['bright', 'Bright'], ['normal', 'Normal'], ['dim', 'Dim'], ['dark', 'Dark (only your lamps light it)']].map(o => el('option', { value: o[0], selected: (X.ambient || 'normal') === o[0] ? true : null }, o[1])))),
        el('div', { class: 'note' }, 'How much daylight and the game\'s own ambient light reach the new walls, floors and ceilings. Lower it when the interior glows at night; place lamps to light it.'));
    // ---------- the user's own props (the props folder next to the program, MyProps.cs): a row of them under a prop search; pick(name) places one ----------
    UI.ownProps = null;
    async function propsCall(what) {
        try { const r = await Model.api(what, what === 'props' ? 'GET' : 'POST', what === 'props' ? undefined : {}); if (r.ok === false) throw new Error(r.error); UI.ownProps = r.props || []; return r; }
        catch (e) { toast(e.message, 'err'); return null; }
    }
    UI.myPropsRow = function (pick) {
        if (UI.ownProps == null) { UI.ownProps = []; propsCall('props').then(() => M.UI.renderLeft()); }
        const box = el('div', null, el('div', { class: 'row wrap' }, el('b', null, 'Your props'),
            el('button', { class: 'btn sm', title: 'Add .ydr models (and their .ytd textures) of your own', onclick: async () => { const r = await propsCall('props/add'); if (r && r.added && r.added.length) toast('Added: ' + r.added.join(', ') + '. Click one to place it.', 'ok'); M.UI.renderLeft(); } }, '+ Add props (.ydr)'),
            el('button', { class: 'btn sm', title: 'Open the props folder', onclick: () => propsCall('props/open') }, 'Folder')));
        if (!UI.ownProps.length) box.append(el('div', { class: 'note' }, 'None yet. A .ydr with a .ytd of the same name next to it brings its textures along; collision built into the model goes with it.'));
        else box.append(el('div', { class: 'row wrap' }, ...UI.ownProps.map(n => el('button', { class: 'chip', title: 'Place ' + n, onclick: () => pick(n) }, n))));
        return box;
    };
    // a small "+ Image" button that adds a picture of the user's as a texture and hands it to done(id)
    UI.imageButton = (done) => el('label', { class: 'btn sm', style: { cursor: 'pointer' }, title: 'Use a picture of your own (png, jpg) as a texture' }, '+ Image',
        el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: (e) => { addUserImage(e.target.files[0], done); e.target.value = ''; } }));
 UI.newProjectDialog = newProjectDialog; UI.startDialog = startDialog; UI.saveAsDialog = saveAsDialog; UI.projectsDialog = projectsDialog; UI.shareDialog = shareDialog; UI.helpDialog = helpDialog; UI.confirm = confirmDlg; UI.toast = toast; UI.closeModal = closeModal; UI.modal = modal;
    UI.kit = { stepper, seg, swatchEl, confirm: confirmDlg };
    UI.updateShellInfo = function () { if (M.VanillaUI && S.project.kind === 'vanilla' && S.tab === 'export') M.VanillaUI.updatePlace(); };
    M.UI = UI;
})(window.MLO);

