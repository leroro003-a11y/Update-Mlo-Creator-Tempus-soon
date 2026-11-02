// Stairs between the floors of a building: a rectangle on the floor and the way it goes up. Stored with the floor's rooms (shell.stairs = [{ id, r, dir }],
// dir '+x' / '-x' / '+y' / '-y'); Shell.build makes the steps (with collision) up to the floor above, leaves the ceiling open over them and the floor above
// open where they come up, with a railing round that hole.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    const randId = () => Math.random().toString(36).slice(2, 8);
    const ST = M.Stairs = { sel: null };
    const list = () => (S.project.shell && S.project.shell.stairs) || [];
    const byId = (id) => list().find(s => s.id === id) || null;
    const DIRS = [['+y', 'North'], ['+x', 'East'], ['-y', 'South'], ['-x', 'West']];
    const SHAPES = [['straight', 'Straight'], ['l', 'L (landing)'], ['u', 'U (turns back)'], ['spiral', 'Spiral']];
    const ctx = () => M.Shell.levelCtx(S.project);
    // where the rise goes: the floor above, else the ceiling
    ST.rise = () => ctx().rise || S.project.settings.ceilH || 2.45;

    let hover = null, drag = null;
    const inside = (s, p) => p && p.x > s.r[0] && p.x < s.r[2] && p.y > s.r[1] && p.y < s.r[3];
    ST.dragging = () => !!drag;
    ST.state = () => drag ? 'new' : null;
    ST.cancel = function () { if (drag) { drag = null; return true; } return false; };
    ST.select = function (id) { ST.sel = id; M.UI.renderLeft(); };
    ST.edit = function (id, fn) { Model.edit(P => { const s = (P.shell.stairs || []).find(q => q.id === id); if (s) fn(s); }); M.UI.renderLeft(); };
    ST.remove = function (id) { Model.edit(P => { P.shell.stairs = (P.shell.stairs || []).filter(q => q.id !== id); }); if (ST.sel === id) ST.sel = null; M.UI.renderLeft(); };
    const rect = (a, b) => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    // the way up: along the longer side, towards where the drag ended
    const dirOf = (a, b) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? '+x' : '-x') : (b.y >= a.y ? '+y' : '-y');

    ST.tool = {
        scan(e) { const g = M.ShellTools.ground(e); hover = g ? { g, st: list().find(s => inside(s, g)) || null } : null; if (drag && g) drag.b = g; },
        down(e) {
            const g = M.ShellTools.ground(e); if (!g) return;
            const hit = list().find(s => inside(s, g)); if (hit) { ST.select(hit.id); return; }
            drag = { a: g, b: g };
        },
        move(e) { const g = M.ShellTools.ground(e); if (drag && g) drag.b = g; },
        up(e, commit) {
            const d = drag; drag = null; if (!d || !commit) return; const r = rect(d.a, d.b);
            if (r[2] - r[0] < 0.6 || r[3] - r[1] < 0.6) { toast('Drag a rectangle for the stairs: at least 60 cm wide, the long side is the way up (towards where you let go).', 'warn'); return; }
            const s = { id: randId(), r: r.map(r3), dir: dirOf(d.a, d.b) };
            Model.edit(P => { (P.shell.stairs = P.shell.stairs || []).push(s); }); ST.sel = s.id; M.UI.renderLeft();
            const run = s.dir[1] === 'x' ? r[2] - r[0] : r[3] - r[1], rise = ST.rise(), n = Math.max(1, Math.round(rise / 0.18));          // (a new stair is straight: its shape is set in the panel)
            toast('Stairs: ' + n + ' steps of ' + (rise / n * 100).toFixed(0) + ' cm up ' + rise.toFixed(2) + ' m over ' + run.toFixed(2) + ' m' + (ctx().rise ? ' to the floor above.' : ' (there is no floor above yet: they go up to the ceiling).') + (run / n < 0.22 ? ' The steps are steep: make the stairs longer.' : ''), run / n < 0.22 ? 'warn' : 'ok');
        },
        draw(R) {
            const z = 0.02, quad = (r, col) => R.ovQuad([r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z], col);
            const arrow = (s, col) => {
                const r = s.r, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, ax = s.dir[1] === 'x', sg = s.dir[0] === '+' ? 1 : -1, len = (ax ? r[2] - r[0] : r[3] - r[1]) * 0.35, w = (ax ? r[3] - r[1] : r[2] - r[0]) * 0.2;
                const tip = ax ? [cx + sg * len, cy, 0.05] : [cx, cy + sg * len, 0.05], tail = ax ? [cx - sg * len, cy, 0.05] : [cx, cy - sg * len, 0.05];
                const l = ax ? [cx + sg * (len - w), cy + w, 0.05] : [cx + w, cy + sg * (len - w), 0.05], rr = ax ? [cx + sg * (len - w), cy - w, 0.05] : [cx - w, cy + sg * (len - w), 0.05];
                R.ovTopLine(tail, tip, col); R.ovTopLine(l, tip, col); R.ovTopLine(rr, tip, col);
            };
            list().forEach(s => { const on = s.id === ST.sel; quad(s.r, on ? [1, 0.93, 0.45, 0.25] : [0.45, 0.75, 1, 0.16]); arrow(s, on ? [1, 0.93, 0.45, 1] : [0.6, 0.85, 1, 0.9]); });
            if (drag) { const r = rect(drag.a, drag.b); quad(r, [0.45, 0.95, 0.6, 0.3]); if (r[2] - r[0] > 0.05 && r[3] - r[1] > 0.05) arrow({ r, dir: dirOf(drag.a, drag.b) }, [0.45, 0.95, 0.6, 1]); return { text: f2(r[2] - r[0]) + ' x ' + f2(r[3] - r[1]) + ' m, up towards where you let go', at: null }; }
            if (hover && hover.st) return { text: 'Stairs (' + DIRS.find(d => d[0] === hover.st.dir)[1].toLowerCase() + '): click to select · X deletes', at: null };
            return { text: 'Drag a rectangle on the floor: the stairs go up along its long side, towards where you let go', at: null };
        },
        key(k) {
            const s = ST.sel ? byId(ST.sel) : null;
            if ((k === 'x' || k === 'Delete' || k === 'Backspace') && s) { ST.remove(s.id); return true; }
            if (k === 'r' && s) { const i = DIRS.findIndex(d => d[0] === s.dir); ST.edit(s.id, q => { q.dir = DIRS[(i + 1) % 4][0]; }); return true; }
            if (k === 'Escape') { if (drag) { drag = null; return true; } if (s) { ST.select(null); return true; } }
            return false;
        }
    };

    ST.panel = function (root) {
        const k = M.UI.kit, c = ctx(), rise = ST.rise();
        root.append(el('div', { class: 'note' }, c.rise ? 'The stairs go up ' + rise.toFixed(2) + ' m to the floor above. That floor gets a hole where they come up, with a railing round it; the ceiling here is open over them.' : 'There is no floor above this one yet: stairs go up to the ceiling. Add a floor in the Floors list first.'));
        const s = ST.sel ? byId(ST.sel) : null;
        if (s) {
            const r = s.r, run = s.dir[1] === 'x' ? r[2] - r[0] : r[3] - r[1], n = Math.max(1, Math.round(rise / Math.min(0.22, Math.max(0.15, s.step || 0.18)))), kind = s.kind || 'straight';
            root.append(el('div', { class: 'h' }, 'Selected stairs'));
            root.append(el('div', { class: 'row' }, el('label', null, 'Up towards'), k.seg(DIRS, s.dir, v => ST.edit(s.id, q => { q.dir = v; }))));
            // shape and size (Shell.build: buildStair)
            root.append(el('div', { class: 'row wrap' }, el('label', null, 'Shape'), k.seg(SHAPES, kind, v => ST.edit(s.id, q => { q.kind = v; if (v === 'spiral') { const sz = Math.max(q.r[2] - q.r[0], q.r[3] - q.r[1]); q.r = [q.r[0], q.r[1], r3(q.r[0] + sz), r3(q.r[1] + sz)]; } }))));
            if (kind !== 'straight') root.append(el('div', { class: 'row' }, el('label', null, 'Turns'), k.seg([['l', 'Left'], ['r', 'Right']], s.turn === 'r' ? 'r' : 'l', v => ST.edit(s.id, q => { q.turn = v; }))));
            const numIn = (label, val, step, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step, value: val, onchange: (ev) => { const v = parseFloat(ev.target.value); if (!isNaN(v)) set(v); } }), el('span', { class: 'note' }, unit));
            const sizeA = r[2] - r[0], sizeB = r[3] - r[1];
            root.append(numIn('Width x', f2(sizeA), 0.05, v => ST.edit(s.id, q => { q.r[2] = r3(q.r[0] + Math.max(0.6, v)); if (kind === 'spiral') q.r[3] = r3(q.r[1] + Math.max(0.6, v)); }), 'm'),
                numIn('Depth y', f2(sizeB), 0.05, v => ST.edit(s.id, q => { q.r[3] = r3(q.r[1] + Math.max(0.6, v)); if (kind === 'spiral') q.r[2] = r3(q.r[0] + Math.max(0.6, v)); }), 'm'),
                numIn('Step height', Math.round((s.step || 0.18) * 100), 1, v => ST.edit(s.id, q => { q.step = Math.min(0.22, Math.max(0.15, v / 100)); }), 'cm (15 to 22)'));
            if (kind === 'l' || kind === 'u') root.append(numIn('Flight width', f2(s.w || (kind === 'u' ? Math.min(sizeA, sizeB) / 2 : 1.0)), 0.05, v => ST.edit(s.id, q => { q.w = Math.max(0.5, v); }), 'm'));
            if (kind !== 'spiral') root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.open ? true : null, onchange: (ev) => ST.edit(s.id, q => { q.open = ev.target.checked; }) }), 'Open steps (treads on stringers)'));
            root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: s.rail ? true : null, onchange: (ev) => ST.edit(s.id, q => { q.rail = ev.target.checked; }) }), 'Handrails'));
            root.append(el('div', { class: 'note' }, n + ' steps, ' + (rise / n * 100).toFixed(0) + ' cm high and ' + (run / n * 100).toFixed(0) + ' cm deep' + (run / n < 0.22 ? ': steep, make them longer' : '') + '. ' + f2(r[2] - r[0]) + ' x ' + f2(r[3] - r[1]) + ' m.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'R', onclick: () => { const i = DIRS.findIndex(d => d[0] === s.dir); ST.edit(s.id, q => { q.dir = DIRS[(i + 1) % 4][0]; }); } }, 'Turn'), el('button', { class: 'btn sm danger', title: 'X', onclick: () => ST.remove(s.id) }, 'Delete')));
        }
        root.append(el('div', { class: 'h' }, 'On this floor (' + list().length + ')'));
        list().forEach(q => root.append(el('div', { class: 'pitem', style: { padding: '3px 8px', background: ST.sel === q.id ? 'var(--accent-soft)' : '' }, onclick: () => ST.select(q.id) },
            el('span', { class: 'grow' }, (SHAPES.find(x => x[0] === (q.kind || 'straight')) || SHAPES[0])[1] + ' stairs ' + DIRS.find(d => d[0] === q.dir)[1].toLowerCase()), el('span', { class: 'note' }, f2(q.r[2] - q.r[0]) + ' x ' + f2(q.r[3] - q.r[1])),
            el('button', { class: 'btn sm danger', onclick: (e) => { e.stopPropagation(); ST.remove(q.id); } }, 'x'))));
    };
})(window.MLO);
