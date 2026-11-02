// The live editor's panel: what is selected, the steps, the keys, and the box to type a prop's name into.
(function () {
    const $ = (id) => document.getElementById(id);
    const f2 = (v) => (+v).toFixed(2);
    const post = (name, data) => fetch('https://' + GetParentResourceName() + '/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).catch(() => { });
    const KEYS = [['Mouse', 'Look'], ['W A S D', 'Fly'], ['Space / C', 'Up / down'], ['Shift / Ctrl', 'Faster / slower'], ['Left click', 'Select'], ['Right click / Esc', 'Select none'],
        ['Arrows', 'Move it along the view'], ['PageUp / PageDown', 'Raise / lower'], ['Q / E', 'Turn'], ['G', 'Hold it at the crosshair, click puts it down'], ['F', 'Copy'], ['X / Del', 'Delete or bring back'],
        ['B', 'Add a prop'], ['Z', 'Undo'], ['1 / 2', 'Move step'], ['3 / 4', 'Turn step'], ['H', 'Hide these keys']];
    function toast(text, kind) {
        const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = text; $('toasts').append(t);
        setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, kind === 'error' ? 6000 : 3500);
    }
    function state(s) {
        $('panel').hidden = !s.open; if (!s.open) return;
        $('name').textContent = 'Project: ' + s.name + (s.undo ? ' · ' + s.undo + ' change' + (s.undo === 1 ? '' : 's') + ' to undo' : '');
        const e = s.sel;
        const sel = $('sel'); sel.replaceChildren();
        if (e) {
            const name = document.createElement('b'); name.textContent = e.n || '(unnamed)'; sel.append(name);
            if (e.del) { const del = document.createElement('span'); del.className = 'del'; del.textContent = ' deleted'; sel.append(del); }
            sel.append(document.createTextNode((e.game ? '' : ' · added') + (s.grab ? ' · held: click puts it down' : '')));
            sel.append(document.createElement('br'));
            sel.append(document.createTextNode(f2(e.x) + ', ' + f2(e.y) + ', ' + f2(e.z) + ' · heading ' + Math.round(e.h) + '°'));
        } else sel.textContent = s.hover ? 'Click to select ' + s.hover : 'Point the crosshair at an object and click.';
        $('steps').textContent = 'Move step ' + s.move + ' m · turn step ' + s.turn + '°';
        $('help').hidden = !s.help;
        if (s.help && !$('help').childElementCount) KEYS.forEach(k => { const d = document.createElement('div'), a = document.createElement('kbd'), b = document.createElement('span'); a.textContent = k[0]; b.textContent = k[1]; d.append(a, b); $('help').append(d); });
    }
    window.addEventListener('message', (ev) => {
        const m = ev.data || {};
        if (m.type === 'state') state(m);
        else if (m.type === 'toast') toast(m.text, m.kind);
        else if (m.type === 'ask') { $('ask').hidden = false; $('model').value = ''; setTimeout(() => $('model').focus(), 30); }
    });
    $('model').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { $('ask').hidden = true; post('add', { model: $('model').value.trim() }); }
        else if (e.key === 'Escape') { $('ask').hidden = true; post('cancel'); }
    });
})();
