// The hint bar above the status line, like Blender's status bar: what the current tool does and which keys change it.
// It follows what you are doing (a drag in progress, a selected room) and has a second, dim line for the camera.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state;
    const NAV = [['Middle-drag', 'Orbit'], ['Shift+middle-drag', 'Pan'], ['Wheel', 'Zoom'], ['Home', 'Frame all']];
    const CANCEL = ['Esc / right-click', 'Cancel'];

    // tools of a project built inside an imported model: [name, [[key, what it does], ...]]
    const IMPORT = {
        building: ['Select building', [['Click', 'Pick the building'], ['Shift+click', 'Add or remove a part']]],
        frame: ['Frame', [['Click a floor', 'Set the corner and floor height'], ['Click a wall', 'Square the grid to it'], ['Shift+click a wall', 'Floor at its bottom edge'], ['Alt+click', 'Move the corner here']]],
        level: ['Raise / lower rooms', [['Drag the arrow', 'Move the rooms up or down'], ['Click a floor of the model', 'Match its height']]],
        room: ['Add room', [['Drag', 'Draw a rectangle, it snaps to the model\'s walls']]],
        cut: ['Cut out', [['Drag', 'Draw the part to take out of the interior']]],
        fill: ['Fill gaps', [['Click a green area', 'Fill the gap'], ['Shift+click', 'Fill a closed hole of any size']]],
        part: ['Partition', [['Drag', 'Draw a straight interior wall']]],
        door: ['Door', [['Click the faces of a door', 'Cut out and fill with the door model'], ['Shift+click', 'One triangle only'], ['Click an opening', 'Select it']]],
        window: ['Window', [['Click the faces of a window', 'Cut out and fill with glass'], ['Shift+click', 'One triangle only'], ['Click an opening', 'Select it']]],
        arch: ['Archway', [['Click a wall', 'Cut an archway'], ['Drag the box', 'Move it']]],
        floor: ['Floor paint', [['Drag', 'Give an area the floor texture']]],
        light: ['Light', [['Click the floor', 'Hang or remove a ceiling light']]],
        figure: ['Scale figure', [['Click', 'Stand the figure there'], ['Drag the figure', 'Move it'], ['R', 'Turn it 45°']]],
        faces: ['Delete faces', [['Click', 'Select the flat patch'], ['Shift+click', 'Add or remove'], ['Drag', 'Box select'], ['Alt+click', 'Connected piece'], ['A', 'All'], ['Shift+G', 'Same texture'], ['X', 'Delete']]],
        parts: ['Model parts', [['Click', 'Choose the part under the pointer'], ['Hover a row', 'See where it is'], ['Remove / Restore', 'In the panel']]],
        collision: ['Collision', [['Click', 'Select a piece'], ['Shift+click', 'Add or remove'], ['Drag', 'Box select'], ['A', 'All'], ['Shift+G', 'Same material'], ['X', 'Delete']]],
        cbox: ['Collision box', [['Drag on the floor', 'Draw a box'], ['Click', 'Select a box'], ['Drag a box', 'Move it'], ['Drag a handle', 'Resize'], ['Shift+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy, paste at the pointer'], ['R', 'Turn 90°'], ['X', 'Delete']]],
        stair: ['Stairs', [['Drag on the floor', 'Stairs up along the long side, towards where you let go'], ['Click', 'Select'], ['R', 'Turn'], ['X', 'Delete']]],
        furniture: ['Furniture', [['Click the floor', 'Put the chosen piece there'], ['Click a piece', 'Select it'], ['Drag a piece', 'Move it'], ['R', 'Turn 90°'], ['Shift+R', 'Turn 15°'], ['Shift+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy, paste at the pointer'], ['X', 'Delete']]],
        plants: ['Props and plants', [['Click', 'Select a model'], ['Shift+click', 'Add or remove'], ['A', 'All'], ['Alt+A', 'None'], ['X', 'Remove'], ['R', 'Keep']]],
        fit: ['Window / door models', [['Click a wall', 'Put the chosen model there'], ['Click a model', 'Select it'], ['Drag a model', 'Slide it'], ['Arrows / cubes / ring', 'Move / size / turn'], ['R', 'Turn 90°'], ['Shift+D', 'Duplicate'], ['Ctrl+C / Ctrl+V', 'Copy, paste at the pointer'], ['X', 'Delete']]],
        walk: ['Walk check', [['Click the floor', 'Start the walk there'], ['Run the check', 'In the panel'], ['Show', 'Jump to a problem']]],
        edges: ['Edges', [['Click', 'Select an edge'], ['Shift+click', 'Add or remove'], ['Alt+click', 'The whole loop'], ['A', 'Select all'], ['F', 'Fill the hole'], ['Esc', 'Select none']]],
        eraser: ['Eraser', [['Click', 'Remove a cutter, light, partition or opening']]],
        paint: ['Paint', [['Click a wall', 'Apply the chosen texture']]]
    };
    const GRID = {
        wall: ['Wall', [['Drag', 'Build walls along the grid lines']]],
        room: ['Room', [['Drag', 'Draw a room: floor and walls']]],
        floor: ['Floor', [['Drag', 'Lay floor cells']]],
        door: ['Door', [['Click a wall', 'Put a door in it']]],
        window: ['Window', [['Click a wall', 'Put a window in it']]],
        arch: ['Archway', [['Click a wall', 'Make an opening']]],
        entrance: ['Entrance', [['Click a door', 'Make it the entrance']]],
        stairs: ['Stairs', [['Click a cell', 'Place stairs'], ['R', 'Turn them']]],
        roof: ['Roof', [['Drag', 'Cover cells with roof']]],
        light: ['Light', [['Click a cell', 'Place or remove a light']]],
        eraser: ['Eraser', [['Click', 'Remove a wall'], ['Drag', 'Clear cells']]],
        paint: ['Paint', [['Click', 'Apply the chosen texture']]]
    };
    const VANILLA = {
        room: ['Add room', [['Drag', 'Add a rectangle to the interior']]],
        cut: ['Cut out', [['Drag', 'Take a rectangle out of the interior']]],
        part: ['Partition', [['Drag', 'Draw a straight interior wall']]],
        door: ['Door', [['Click a wall', 'Put a door in it']]],
        window: ['Window', [['Click a wall', 'Put a window in it']]],
        arch: ['Archway', [['Click a wall', 'Make an opening']]],
        floor: ['Floor paint', [['Drag', 'Give an area the floor texture']]],
        select: ['Select', [['Click', 'Select a partition or opening']]],
        eraser: ['Eraser', [['Click', 'Remove a partition or opening']]],
        paint: ['Paint', [['Click a wall', 'Apply the chosen texture']]]
    };

    // what the hint bar says right now: [title, [[key, text], ...]] or null
    function current() {
        const kind = S.project.kind;
        if (kind === 'game') {
            const GM = M.GameMlo; if (S.tab !== 'game') return null;
            const st = GM.tool.state(), GE = M.GameEdit;
            if (GE.room) return ['New room', [['Drag on the floor', 'Its rectangle'], ['Esc', 'Stop']]];
            if (GE.mode && GE.mode.cut) return ['Cut an opening', [['Click the selected object\'s wall', 'Cut it there'], ['Esc', 'Stop']]];
            if (GE.mode && GE.mode.faces) return ['Pick faces', [['Click', 'The flat patch'], ['Shift+click', 'Add or take away'], ['X', 'Take them out'], ['Esc', 'Stop']]];
            if (st === 'draw') return ['Draw walls', [['Drag on the floor', 'A wall from where you press to where you let go'], ['Esc', 'Stop drawing']]];
            if (st === 'drawing') return ['Drawing a wall', [['Shift', 'Any angle, no snapping'], ['Release', 'Make it'], CANCEL]];
            if (st === 'wall') return ['Moving the wall', [['Shift', 'No snapping'], ['Release', 'Put it down'], CANCEL]];
            if (st) return ['Moving the object', [['Shift', 'No snapping'], ['Release', 'Put it down'], CANCEL]];
            if (M.GameWalls.sel) return ['New wall', [['Drag it', 'Move'], ['X', 'Delete'], ['Esc', 'Select none'], ['Panel', 'Doors, windows, size']]];
            if (GM.chosen) return ['Add ' + GM.chosen, [['Click', 'Put it there'], ['R', 'Turn it 90°'], ['Esc', 'Stop adding']]];
            if (GM.sel != null) return ['Object', [['Drag it', 'Move'], ['R', 'Turn 90°'], ['Shift+R', 'Turn 15°'], ['PageUp / PageDown', 'Raise / lower'], ['Shift+D', 'Duplicate'], ['X', 'Delete'], ['F', 'Look at it'], ['H', 'Hide'], ['Esc', 'Select none']]];
            return ['Interior', [['Click', 'Select an object'], ['Alt+H', 'Show hidden ones again'], ['Ctrl+Z', 'Undo']]];
        }
        if (S.tab !== 'build') return null;
        if (kind === 'grid') { const e = GRID[S.tool]; return e ? [e[0], e[1]] : null; }
        if (kind === 'vanilla') { const e = VANILLA[S.shellTool]; return e ? [e[0], e[1]] : null; }
        const t = S.shellTool, IT = M.ImportTools, st = IT && IT.state ? IT.state() : {};
        // a drag in progress: only what matters now
        if (st.level) return ['Moving the rooms', [['Ctrl', '5 cm steps'], ['Shift', 'Fine'], CANCEL]];
        if (st.room) return [st.room === 'move' ? 'Moving a room' : 'Resizing a room', [['Shift', 'No snapping'], CANCEL]];
        if (st.shell) return [({ room: 'Adding a room', cut: 'Cutting out', floor: 'Painting the floor', part: 'Drawing a wall' })[st.shell] || 'Dragging', [['Release', 'Apply'], CANCEL]];
        if (st.cutter) return ['Moving the box', [['Release', 'Apply'], CANCEL]];
        if (st.figure) return ['Moving the figure', [['Release', 'Put it down'], CANCEL]];
        if (st.stair) return ['Drawing stairs', [['Release', 'Make them'], CANCEL]];
        if (st.furniture) return ['Moving the furniture', [['Shift', 'No snapping'], ['Release', 'Put it down'], CANCEL]];
        if (st.fit) return [({ move: 'Moving the model', arrow: 'Moving along an axis', face: 'Changing the size', uni: 'Scaling it all together', ring: 'Turning the model' })[st.fit] || 'Dragging the model', [['Shift', 'Fine / no snapping'], st.fit === 'face' ? ['Alt', 'From the middle'] : ['Release', 'Apply'], CANCEL]];
        if (st.cbox) return [st.cbox === 'new' ? 'Drawing a collision box' : (st.cbox === 'move' ? 'Moving a collision box' : (st.cbox === 'top' ? 'Changing the height' : 'Resizing a collision box')), [['Shift', st.cbox === 'top' ? 'Fine' : 'No snapping'], CANCEL]];
        if (t === 'select') {
            if (S.opSel != null && S.project.shell.ops[S.opSel]) return ['Select', [['Click', 'Select another'], ['Drag an edge or corner', 'Resize'], ['Drag the inside', 'Move'], ['Shift', 'No snapping'], ['Del / X', 'Delete'], ['Esc', 'Deselect']]];
            return ['Select', [['Click', 'Select a room, a cutter, a partition or an opening']]];
        }
        const e = IMPORT[t]; return e ? [e[0], e[1]] : null;
    }

    let bar = null, last = '';
    function chip(key, text, cls) {
        const s = document.createElement('span'); s.className = 'hk' + (cls ? ' ' + cls : '');
        const k = document.createElement('kbd'); k.textContent = key; s.append(k, document.createTextNode(' ' + text)); return s;
    }
    function update() {
        bar = bar || document.getElementById('keys'); if (!bar) return;
        const cur = current(), imp = S.project.kind === 'import';
        const state = JSON.stringify([cur, imp]); if (state === last) return; last = state;
        bar.textContent = ''; bar.style.display = cur ? '' : 'none'; if (!cur) return;
        const row1 = document.createElement('div'), row2 = document.createElement('div'); row1.className = 'row'; row2.className = 'row nav';
        const title = document.createElement('span'); title.className = 'hk t'; title.textContent = cur[0]; row1.append(title);
        cur[1].forEach(h => row1.append(chip(h[0], h[1])));
        NAV.concat(imp ? [['C', 'Cutaway']] : []).forEach(h => row2.append(chip(h[0], h[1], 'dim')));
        bar.append(row1, row2);
    }

    M.Hints = { update, current };
})(window.MLO);
