// Buildings of the game: find a building of GTA V by name (lspd, pillbox, city hall, krankenhaus...), by an interior's name or rooms, or by a point. The host
// (Buildings.cs, buildings/search) reads the game's files: every interior (MLO) its map files place, and a list of well-known places. A found interior opens
// as a project of its own (buildings/interior, shown by gamemlo.js).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M;
    const toast = (t, k) => Model.bus.emit('toast', { text: t, kind: k });
    const f2 = (v) => (+v).toFixed(2);
    const B = M.Buildings = { q: '', busy: false, err: '', status: '', results: null, open: {}, more: {}, back: null };
    const QUICK = [['LSPD', 'lspd'], ['Pillbox', 'pillbox'], ['City hall', 'city hall'], ['FIB', 'fib'], ['Sheriff', 'sheriff'], ['Hospital', 'hospital'], ['Fire station', 'fire station'], ['Bank', 'bank'], ['Vanilla Unicorn', 'vanilla unicorn']];
    const TAG = { tunnel: 'tunnel', hidden: 'under the map' };
    const keyOf = (r) => r.kind + '|' + (r.name || r.place) + '|' + f2(r.x) + '|' + f2(r.y);
    const vec = (r) => 'vector3(' + f2(r.x) + ', ' + f2(r.y) + ', ' + f2(r.z == null ? 0 : r.z) + ')';
    async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast('Copied ' + what + ': ' + text, 'ok'); } catch (e) { toast('Could not copy to the clipboard. Check browser permission.', 'warn'); } }

    B.search = async function (q) {
        B.q = q = (q || '').trim(); if (!q || B.busy) return;
        B.busy = true; B.err = ''; B.status = ''; B.open = {}; B.more = {}; B.resource = null; render();
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status && s.status !== B.status) { B.status = s.status; const st = document.getElementById('bsearch-status'); if (st) st.textContent = s.status; } } catch (e) { } }, 500);
        try { const r = await Model.api('buildings/search', 'POST', { q, gta: '' }); if (r.ok === false) throw new Error(r.error); B.results = r.results || []; }
        catch (e) { B.err = e.message; B.results = null; }
        clearInterval(poll); B.busy = false; B.status = ''; render();
    };

    // the results in groups: one per place (in the host's order), then the interiors found by name
    function groups(list) {
        const out = [], at = {};
        list.forEach(r => { const g = r.place || 'Interiors by name'; if (!at[g]) out.push(at[g] = { name: g, main: [], other: [] }); (r.tag ? at[g].other : at[g].main).push(r); });
        return out;
    }
    // two interiors at one spot: the game's own and the version a DLC puts there instead
    function twins(r, list) { return list.filter(o => o !== r && o.kind === 'interior' && Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.z - r.z) < 0.5).map(o => o.name); }

    function interiorItem(r, list) {
        const k = keyOf(r), open = !!B.open[k], tw = twins(r, list);
        const head = el('div', { class: 'pitem', style: { flexWrap: 'wrap', alignItems: 'baseline' }, title: 'Show what it holds', onclick: () => { B.open[k] = !open; render(); } },
            el('b', null, r.name),
            r.tag ? el('span', { class: 'chip', style: { cursor: 'default', padding: '0 8px' } }, TAG[r.tag] || r.tag) : null,
            el('small', null, r.rooms + ' room' + (r.rooms === 1 ? '' : 's') + ' · ' + r.entities + ' objects · ' + r.portals + ' portal' + (r.portals === 1 ? '' : 's') + (r.dist != null ? ' · ' + Math.round(r.dist) + ' m away' : '')));
        if (!open) return head;
        const info = el('div', { style: { padding: '4px 10px 8px', borderLeft: '2px solid var(--line2)', marginLeft: '8px' } },
            el('div', { class: 'note' }, 'Position ', el('b', null, f2(r.x) + ', ' + f2(r.y) + ', ' + f2(r.z)), ', heading ' + Math.round(r.heading) + '°'),
            el('div', { class: 'note' }, 'Defined in ', el('b', null, r.ytyp || '?'), ', placed by ', el('b', null, (r.ymaps || []).join(', '))),
            tw.length ? el('div', { class: 'note' }, 'At the same spot: ', el('b', null, tw.join(', ')), '. The game shows one of them (usually the newer DLC one).') : null,
            r.tag === 'hidden' ? el('div', { class: 'note' }, 'It lies far under the map: the game takes players there with a script, it is not entered through a door.') : null,
            r.roomNames && r.roomNames.length ? el('div', { class: 'note' }, 'Rooms: ', r.roomNames.join(', ')) : null,
            r.sets && r.sets.length ? el('div', { class: 'note' }, 'Entity sets: ', r.sets.join(', ')) : null,
            el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: (ev) => B.openInEditor(r, ev.target) }, 'Open in the editor'),
                el('button', { class: 'btn sm', onclick: () => copy(vec(r), 'the position') }, 'Copy position'), el('button', { class: 'btn sm', onclick: () => copy(r.name, 'the name') }, 'Copy name')));
        return el('div', null, head, info);
    }

    // a new project with the interior as the game defines it (rooms, portals, objects, entity sets); gamemlo.js shows it
    B.openInEditor = async function (r, btn) {
        if (btn) { btn.disabled = true; btn.textContent = 'Reading the interior...'; }
        try {
            // (an interior of an MLO resource: read from its folder, whose map files are copied first, see ResourceMlo.cs)
            const res = await Model.api('buildings/interior', 'POST', r.src ? { ytyp: r.ytyp, hash: r.hash, src: r.src, snapshot: true, gta: '' } : { ytyp: r.ytyp, hash: r.hash, gta: '' }); if (res.ok === false) throw new Error(res.error);
            const it = res.interior, tw = r.src ? [] : twins(r, B.results || []); B.shown = false; M.UI.closeModal();
            it.entities.forEach((e, i) => { e.o = i; });                     // (each object's place in the game's list: the export finds the game's own entry by it)
            await Model.createProject(r.place || it.name, 'game', P => {
                Object.assign(P.game, { name: it.name, hash: it.hash, ytyp: it.ytyp, ymaps: r.ymaps || [], place: r.place || '', world: { x: r.x, y: r.y, z: r.z, heading: r.heading || 0 },
                    rooms: it.rooms, portals: it.portals, entities: it.entities, sets: it.sets, setsOn: [], twin: tw.join(', '), src: it.src || '', snap: it.snap || '' });
            });
            toast('Opened ' + it.name + ': ' + it.entities.length + ' objects in ' + it.rooms.length + ' rooms. The models are read from the ' + (r.src ? 'resource and the game' : 'game') + ' now.', 'ok');
        } catch (e) { toast('Could not open it: ' + e.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Open in the editor'; } }
    };
    function exteriorItem(r) {
        const ms = r.models || [];
        return el('div', { class: 'pitem', style: { display: 'block', cursor: 'default' } },
            el('div', null, el('b', null, 'No interior in the game'), el('span', { class: 'note' }, '  only the outside of the building')),
            ms.length ? el('div', { class: 'note' }, 'Its models: ', ms.slice(0, 4).map(m => m.name).join(', ')) : null,
            el('div', { class: 'note' }, 'You can build an interior into it with a project "Interior in an imported model".'),
            el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => copy(vec(ms[0] || r), 'the position') }, 'Copy position'), ms[0] ? el('button', { class: 'btn sm', onclick: () => copy(ms[0].name, 'the model name') }, 'Copy model name') : null));
    }

    // ---------- an MLO made elsewhere: a FiveM resource folder (Buildings.OpenResource), its interiors listed like the game's ----------
    B.openResource = async function () {
        if (B.busy) return; B.busy = true; B.err = ''; B.status = 'Pick the resource folder in the window that opened...'; render();
        try {
            const r = await Model.api('buildings/open-resource', 'POST', { gta: '' });
            if (r.ok === false && !r.cancelled) throw new Error(r.error);
            if (!r.cancelled) { r.interiors.forEach(it => { it.src = r.dir; it.place = r.resource; }); B.resource = r; B.results = null; }
        } catch (e) { B.err = e.message; }
        B.busy = false; B.status = ''; render();
    };
    function resourceBox(R) {
        const box = el('div', { class: 'plist', style: { maxHeight: '52vh' } }, el('div', { class: 'h', style: { margin: '10px 0 2px' } }, 'Resource ' + R.resource),
            el('div', { class: 'note' }, R.dir + ' · ' + R.interiors.length + ' interior' + (R.interiors.length === 1 ? '' : 's') + ' · ' + R.models + ' models of its own'));
        R.interiors.forEach(it => {
            box.append(el('div', { class: 'pitem', style: { display: 'block', cursor: 'default' } },
                el('div', null, el('b', null, it.name), el('span', { class: 'note' }, '  ' + it.rooms + ' room' + (it.rooms === 1 ? '' : 's') + ' · ' + it.entities + ' objects · ' + it.portals + ' portal' + (it.portals === 1 ? '' : 's'))),
                el('div', { class: 'note' }, 'Defined in ', el('b', null, it.ytyp), it.ymaps.length ? [', placed by ', el('b', null, it.ymaps.join(', '))] : (it.game ? ', placed by the game (the resource changes an interior of the game)' : ''), ' at ' + f2(it.x) + ', ' + f2(it.y) + ', ' + f2(it.z)),
                it.roomNames && it.roomNames.length ? el('div', { class: 'note' }, 'Rooms: ', it.roomNames.join(', ')) : null,
                el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: (ev) => B.openInEditor(it, ev.target) }, 'Open in the editor'))));
        });
        (R.warnings || []).forEach(w => box.append(el('div', { class: 'note bad' }, w)));
        box.append(el('div', { class: 'note' }, 'Saving the project writes your changes back into this folder; the whole folder is zipped next to it first, as a backup.'));
        return box;
    }

    // (only while the window is open: a search that ends after it was closed leaves it closed)
    function render(force) {
        const m = document.getElementById('modal'); if (!B.shown || !m || (m.hidden && !force)) return;
        const q = el('input', { type: 'text', class: 'grow', placeholder: 'lspd, pillbox, city hall, krankenhaus, feuerwehr, v_hospital, 441 -982...', value: B.q, onkeydown: (e) => { if (e.key === 'Enter') B.search(q.value); } });
        const body = el('div', { class: 'dlg wide' }, el('h2', null, 'Building of the game'),
            el('div', { class: 'note' }, 'Find a building of GTA V: a place by name (English or German), an interior by its name or rooms, or a point (x y). The game\'s files are read from your GTA V folder; the first search builds a list of its interiors (about a minute).'),
            el('div', { class: 'row' }, q, el('button', { class: 'btn sm primary', disabled: B.busy ? true : null, onclick: () => B.search(q.value) }, B.busy ? 'Searching...' : 'Search')),
            el('div', { class: 'row wrap' }, ...QUICK.map(c => el('button', { class: 'chip' + (B.q === c[1] ? ' on' : ''), onclick: () => B.search(c[1]) }, c[0]))),
            el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', disabled: B.busy ? true : null, title: 'An MLO made elsewhere (a FiveM resource with its stream folder): open it again to change it', onclick: () => B.openResource() }, 'Open an MLO resource...'),
                el('span', { class: 'note' }, 'a finished MLO of yours (not encrypted by asset escrow)')));
        if (B.busy) body.append(el('div', { class: 'note', id: 'bsearch-status' }, B.status || 'Searching...'));
        if (B.err) body.append(el('div', { class: 'note bad' }, B.err));
        if (B.resource && !B.busy && !B.results) body.append(resourceBox(B.resource));
        if (B.results && !B.busy) {
            const list = B.results;
            if (!list.length) body.append(el('div', { class: 'note' }, 'Nothing found for "' + B.q + '". Try another word, an interior\'s name (v_...) or a point.'));
            const box = el('div', { class: 'plist', style: { maxHeight: '52vh' } });
            groups(list).forEach(g => {
                box.append(el('div', { class: 'h', style: { margin: '10px 0 2px' } }, g.name));
                g.main.forEach(r => box.append(r.kind === 'exterior' ? exteriorItem(r) : interiorItem(r, list)));
                if (g.other.length) {
                    const shown = !!B.more[g.name];
                    box.append(el('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: () => { B.more[g.name] = !shown; render(); } }, (shown ? 'Hide ' : 'Show ') + g.other.length + ' more here (tunnels, under the map)'));
                    if (shown) g.other.forEach(r => box.append(interiorItem(r, list)));
                }
            });
            body.append(box);
            body.append(el('div', { class: 'note' }, 'Click an interior, then "Open in the editor": a new project shows it with every object as a part of its own.'));
        }
        body.append(el('div', { class: 'foot' }, B.back ? el('button', { class: 'btn', onclick: () => { B.shown = false; B.back(); } }, 'Back') : null, el('button', { class: 'btn', onclick: () => { B.shown = false; M.UI.closeModal(); } }, 'Close')));
        M.UI.modal(body, { sticky: !!B.back });
        if (!B.busy) setTimeout(() => { q.focus(); }, 30);
    }

    // opts.back: a button that goes back to the dialog that opened this one
    B.dialog = function (opts) { B.back = (opts && opts.back) || null; B.shown = true; render(true); };
})(window.MLO);
