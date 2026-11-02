const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: { MLO: {} } };
vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'ui', 'js', 'opening-geometry.js'), 'utf8'),
    context,
    { filename: 'opening-geometry.js' }
);
const OG = context.window.MLO.OpeningGeometry;

function opening(id, type, extra = {}) {
    return { id, type, cx: 0, cy: 0, zb: 0, w: 1, h: 2, yaw: 0, ...extra };
}

test('cross-type candidates for the same physical opening are flagged', () => {
    const door = opening('d1', 'door', { autoDetection: { source: 'named' } });
    const window = opening('w1', 'window', { autoDetection: { source: 'geometry' } });
    OG.markTypeConflicts([door, window], []);
    assert.equal(door.typeConflict.peers[0].id, 'w1');
    assert.equal(window.typeConflict.peers[0].id, 'd1');
});

test('separate door and window openings are not treated as conflicts', () => {
    const door = opening('d1', 'door');
    const window = opening('w1', 'window', { cx: 2 });
    OG.markTypeConflicts([door, window], []);
    assert.equal(door.typeConflict, undefined);
    assert.equal(window.typeConflict, undefined);
});

test('a detected opening conflicting with an existing opposite-type cutter is flagged', () => {
    const window = opening('w1', 'window', { zb: 0.2, h: 1.9 });
    const door = opening('d1', 'door', { zb: 0, h: 2.1 });
    OG.markTypeConflicts([window], [door]);
    assert.equal(window.typeConflict.existing[0].id, 'd1');
});

test('same-type overlapping surfaces are not cross-type conflicts', () => {
    const first = opening('w1', 'window');
    const duplicate = opening('w2', 'window', { w: 0.9 });
    OG.markTypeConflicts([first, duplicate], []);
    assert.equal(first.typeConflict, undefined);
    assert.equal(duplicate.typeConflict, undefined);
});
