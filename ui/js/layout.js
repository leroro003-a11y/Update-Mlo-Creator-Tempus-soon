// The frame round the 3D view: the tool rail on the left, the tool panel next to it, the inspector (Selected / Scene / Project) on the right,
// the view bar over the 3D view and the status bar at the bottom. Each kind of project hands it its groups, tabs and buttons; the contents stay in their own files.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state;
    const $ = (id) => document.getElementById(id);
    const L = M.Layout = {};

    // line icons on a 24 x 24 grid (stroke only, the colour comes from the button)
    const ICON = {
        select: '<path d="M5 3l6.5 17 2.4-7.1L21 10.5z"/>',
        eraser: '<path d="M20 20H9.5L4.2 14.7a2 2 0 0 1 0-2.8l8.5-8.5a2 2 0 0 1 2.8 0l4.6 4.6a2 2 0 0 1 0 2.8L12 18.5"/><path d="M8.5 9.5l6 6"/>',
        building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9.5 21v-4h5v4M8 7.5h2M14 7.5h2M8 11.5h2M14 11.5h2"/>',
        grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
        rooms: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 12h7M10 3v5M10 12v9M14 12h7"/>',
        door: '<path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21"/><path d="M3 21h18"/><circle cx="15" cy="12.5" r="1"/>',
        window: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18M4 12h16"/>',
        clean: '<path d="M19.5 3.5 10 13"/><path d="M7.5 11.5l5 5-2.3 3.2a1.6 1.6 0 0 1-2.4.2l-4.2-4.2a1.6 1.6 0 0 1 .2-2.4z"/><path d="M4 9.5V8M2.5 8.5H4M6 6V4.5"/>',
        sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v5H3z"/><path d="M5.5 18v2M18.5 18v2"/>',
        check: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
        wall: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 12h18M9 5v7M15 12v7"/>',
        stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
        roof: '<path d="M2.5 12.5 12 4l9.5 8.5"/><path d="M5.5 10v10h13V10"/>',
        pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',
        light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
        paint: '<path d="M18.5 2.5l3 3-9 9-3-3z"/><path d="M9.2 11.8C6 11.8 5 14 5 16s-1 3-2.5 4c3.5 0 7.5-1 7.5-4.5"/>',
        cube: '<path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
        cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
        top: '<rect x="4" y="12" width="16" height="9" rx="1.5"/><path d="M12 2.5v7M9 6.5l3 3 3-3"/>',
        frame: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>',
        shield: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/>',
        moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
        portal: '<path d="M6 21V9a6 6 0 0 1 12 0v12"/><path d="M3 21h18"/>',
        box: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2.5"/>',
        eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        person: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7.5M12 14.5 9 21M12 14.5l3 6.5M7.5 10h9"/>',
        walls: '<path d="M4 20V8l4-3v15M10 20V6l4-2v16M16 20V9l4-2v13"/>',
        more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.9M12 17.2h.01"/>',
        house: '<path d="M3 11 12 3.5 21 11"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
        outside: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-5h6v5"/><path d="M1.5 11.5 12 3.5l10.5 8"/>'
    };
    L.icon = function (name, cls) { return el('span', { class: 'ico' + (cls ? ' ' + cls : ''), html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || ICON.cube) + '</svg>' }); };

    // ---------------- the tool rail ----------------
    // groups: [{ id, name, short, icon, tools: [[tool, label, key], ...], pick?: fn, on?: bool }] or '|' for a gap. Clicking a group goes to the tool last used in it.
    L.groupOf = function (groups, tool) { return (groups || []).find(g => g !== '|' && g.tools && g.tools.some(t => t[0] === tool)) || null; };
    L.remember = function (groups, tool) { const g = L.groupOf(groups, tool); if (g) (S.railLast = S.railLast || {})[g.id] = tool; };
    L.renderRail = function (groups, cur) {
        const r = $('rail'); if (!r) return; r.innerHTML = '';
        document.body.classList.toggle('norail', !groups);
        if (!groups) return;
        L.remember(groups, cur);
        groups.forEach(g => {
            if (g === '|') { r.append(el('div', { class: 'rsep' })); return; }
            const on = g.on != null ? g.on : !!(g.tools && g.tools.some(t => t[0] === cur));
            const tip = g.name + (g.tools && g.tools.length ? '\n' + g.tools.map(t => '· ' + t[1] + (t[2] ? '  [' + t[2] + ']' : '')).join('\n') : (g.key ? '  [' + g.key + ']' : ''));
            const go = () => { if (g.pick) { g.pick(); return; } const last = (S.railLast || {})[g.id]; M.App.setTool(on ? cur : (last && g.tools.some(t => t[0] === last) ? last : g.tools[0][0])); };
            r.append(el('button', { class: 'rb' + (on ? ' on' : ''), title: tip, 'aria-label': g.name, onclick: go }, L.icon(g.icon), el('span', { class: 'rl' }, g.short || g.name)));
        });
    };
    // the head of the tool panel: the group's name and a chip per tool in it (with its key)
    L.toolHead = function (root, group, cur, onPick) {
        if (!group) return;
        root.append(el('div', { class: 'thead' }, L.icon(group.icon, 'big'), el('div', { class: 'grow' }, el('div', { class: 'tt' }, group.name), group.sub ? el('div', { class: 'ts' }, group.sub) : null)));
        if (group.tools && group.tools.length > 1) {
            const row = el('div', { class: 'tchips' });
            group.tools.forEach(t => row.append(el('button', { class: 'tchip' + (t[0] === cur ? ' on' : ''), title: t[1] + (t[2] ? ' (' + t[2] + ')' : ''), onclick: () => (onPick || M.App.setTool)(t[0]) }, t[1], t[2] ? el('kbd', null, t[2]) : null)));
            root.append(row);
        }
    };
    // the card at the bottom of the tool panel: what to do next
    L.nextCard = function (root, o) {
        if (!o) return;
        const card = el('div', { class: 'nextcard' });
        card.append(el('div', { class: 'ntop' }, el('span', { class: 'nt' }, o.head || 'Next step'), o.count ? el('span', { class: 'nn' }, o.count) : null));
        if (o.progress != null) card.append(el('div', { class: 'rbar' }, el('i', { style: { width: Math.round(o.progress * 100) + '%' } })));
        card.append(el('div', { class: 'nbody' }, el('div', { class: 'grow' }, el('div', { class: 'nttl' }, o.title), o.why ? el('div', { class: 'note' }, o.why) : null),
            o.go ? el('button', { class: 'btn sm primary', onclick: o.go }, o.label || 'Go') : null));
        if (o.more) o.more(card);
        root.append(card);
    };

    // ---------------- the inspector ----------------
    // tabs: [{ id, label, badge?, render(root) }]. The chosen tab is remembered; a new selection opens "Selected" (see L.watch).
    L.inspector = function (root, tabs) {
        tabs = tabs.filter(Boolean);
        let cur = S.inspTab; if (!tabs.some(t => t.id === cur)) cur = tabs[0].id;
        const bar = el('div', { class: 'itabs' });
        tabs.forEach(t => bar.append(el('button', { class: t.id === cur ? 'on' : '', onclick: () => { S.inspTab = t.id; M.UI.renderRight(); } }, t.label, t.badge ? el('span', { class: 'bd' }, t.badge) : null)));
        root.append(bar);
        const body = el('div', { class: 'ibody' }); root.append(body);
        tabs.find(t => t.id === cur).render(body);
    };
    L.openTab = function (id) { S.inspTab = id; M.UI.renderRight(); };
    // something new got selected: show it
    let lastSel = null;
    L.watch = function (key) { if (key != null && key !== lastSel) S.inspTab = 'sel'; lastSel = key; };
    L.empty = function (root, text) { root.append(el('div', { class: 'iempty' }, L.icon('select', 'big'), el('div', null, text))); };

    // ---------------- the view bar over the 3D view ----------------
    // items: { label, icon, on, act, title } a button; { seg: [[v, label]], cur, pick, title } a switch; '|' a gap; a DOM node as it is
    let viewFn = null;
    L.setView = function (fn) { viewFn = fn; L.renderView(); };
    L.renderView = function () {
        const v = $('viewbar'); if (!v) return; v.innerHTML = '';
        const items = viewFn ? (viewFn() || []) : [];
        v.hidden = !items.length; if (!items.length) return;
        const bar = el('div', { class: 'vbar' });
        const again = (fn) => (e) => { fn(e); L.renderView(); };
        items.filter(x => x != null && x !== false).forEach(it => {
            if (it === '|') { bar.append(el('span', { class: 'vsep' })); return; }
            if (it.nodeType) { bar.append(it); return; }
            if (it.seg) {
                const s = el('div', { class: 'vseg', title: it.title || '' }); if (it.label) s.append(el('span', { class: 'vl' }, it.label));
                it.seg.forEach(o => s.append(el('button', { class: o[0] === it.cur ? 'on' : '', onclick: again(() => it.pick(o[0])) }, o[1])));
                bar.append(s); return;
            }
            bar.append(el('button', { class: 'vb' + (it.on ? ' on' : ''), title: it.title || it.label, onclick: again(it.act) }, it.icon ? L.icon(it.icon) : null, it.label ? el('span', null, it.label) : null));
        });
        v.append(bar);
    };

    // ---------------- the status bar ----------------
    let statusFn = null;
    L.setStatus = function (fn) { statusFn = fn; L.renderStatus(); };
    L.renderStatus = function () { const s = $('sleft'); if (!s) return; s.innerHTML = ''; if (statusFn) { const r = statusFn(); if (r) [].concat(r).filter(Boolean).forEach(x => s.append(x)); } };

    // ---------------- the top: the workflow as numbered steps ----------------
    // steps: [[tab, label, done?]]
    L.renderSteps = function (steps, cur) {
        const tabs = $('tabs'); tabs.innerHTML = '';
        if (steps.length === 1) { tabs.append(el('span', { class: 'step one' }, el('span', { class: 'sl' }, steps[0][1]))); return; }
        const ci = steps.findIndex(s => s[0] === cur);
        steps.forEach((s, i) => {
            if (i) tabs.append(el('span', { class: 'sline' + (i <= ci ? ' past' : '') }));
            tabs.append(el('button', { class: 'step' + (s[0] === cur ? ' on' : '') + (s[2] ? ' done' : ''), onclick: () => M.App.setTab(s[0]) },
                el('span', { class: 'sn' }, s[2] && s[0] !== cur ? '✓' : String(i + 1)), el('span', { class: 'sl' }, s[1])));
        });
    };
})(window.MLO);
