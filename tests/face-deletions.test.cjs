const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: { MLO: {} } };
vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'ui', 'js', 'face-deletions.js'), 'utf8'),
    context,
    { filename: 'face-deletions.js' }
);
const FD = context.window.MLO.FaceDeletions;
const plain = value => JSON.parse(JSON.stringify(value));

function project(extra = {}) {
    return {
        import: {
            target: 'building.ydr',
            deletes: [],
            mdeletes: [],
            ...extra
        }
    };
}

test('shared owners keep a face deleted until the last owner releases it', () => {
    const P = project();
    assert.deepEqual(plain(FD.claimMany(P, 'building.ydr', 2, [0, 1], 'cutter:a')), [0, 1]);
    assert.deepEqual(plain(FD.claimMany(P, 'building.ydr', 2, [1], 'plant:bush')), []);
    assert.deepEqual(plain(P.import.deletes), [[2, 0], [2, 1]]);

    assert.equal(FD.release(P, 'building.ydr', 2, 1, 'cutter:a'), false);
    assert.deepEqual(plain(P.import.deletes), [[2, 0], [2, 1]]);
    assert.equal(FD.release(P, 'building.ydr', 2, 1, 'plant:bush'), true);
    assert.deepEqual(plain(P.import.deletes), [[2, 0]]);
    assert.equal(FD.releaseOwner(P, 'cutter:a'), 1);
    assert.deepEqual(plain(P.import.deletes), []);
});

test('manual deletion remains after a cutter that shares the face is removed', () => {
    const P = project();
    FD.claim(P, 'building.ydr', 4, 9, 'cutter:door');
    FD.claim(P, 'building.ydr', 4, 9, 'manual');
    assert.equal(FD.releaseOwner(P, 'cutter:door'), 0);
    assert.deepEqual(plain(P.import.deletes), [[4, 9]]);
    assert.equal(FD.release(P, 'building.ydr', 4, 9, 'manual'), true);
    assert.deepEqual(plain(P.import.deletes), []);
});

test('a manual deletion added after a plant claim is also retained', () => {
    const P = project();
    FD.claim(P, 'building.ydr', 6, 4, 'plant:bush');
    FD.claim(P, 'building.ydr', 6, 4, 'manual');
    FD.release(P, 'building.ydr', 6, 4, 'plant:bush');
    assert.deepEqual(plain(P.import.deletes), [[6, 4]]);
    FD.restoreFile(P, 'building.ydr');
    assert.deepEqual(plain(P.import.deletes), []);
});

test('legacy unowned deletions are conservatively retained', () => {
    const P = project({ deletes: [[3, 7]] });
    FD.claim(P, 'building.ydr', 3, 7, 'plant:legacy');
    assert.equal(FD.release(P, 'building.ydr', 3, 7, 'plant:legacy'), false);
    assert.deepEqual(plain(P.import.deletes), [[3, 7]]);
    assert.equal(P.import.faceDeleteOwners['building.ydr|3|7'].unowned, true);
});

test('legacy cutter and part metadata migrates into the common owner ledger', () => {
    const P = project({
        deletes: [[5, 11], [5, 12]],
        cutters: [{ id: 'old-door', face: { g: 5, tris: [11], added: [11] } }],
        parts: [{ f: 'building.ydr', g: 5, added: [12] }]
    });
    assert.equal(FD.releaseOwner(P, 'cutter:old-door'), 1);
    assert.deepEqual(plain(P.import.deletes), [[5, 12]]);
    assert.equal(FD.releaseOwner(P, 'part:building.ydr:5'), 1);
    assert.deepEqual(plain(P.import.deletes), []);
    assert.equal(P.import.faceDeleteOwnersMigrated, true);
});

test('legacy plant ownership migrates and preserves a prior independent deletion', () => {
    const P = project({
        deletes: [[1, 2], [1, 3]],
        plantFaceOwners: {
            'building.ydr|1|2': { file: 'building.ydr', g: 1, tri: 2, preexisting: false, owners: ['bush-a'] },
            'building.ydr|1|3': { file: 'building.ydr', g: 1, tri: 3, preexisting: true, owners: ['bush-b'] }
        }
    });
    assert.equal(FD.release(P, 'building.ydr', 1, 2, 'plant:bush-a'), true);
    assert.equal(FD.release(P, 'building.ydr', 1, 3, 'plant:bush-b'), false);
    assert.deepEqual(plain(P.import.deletes), [[1, 3]]);
    assert.equal(P.import.plantFaceOwners, undefined);
});

test('detail-model faces are isolated by file and share ownership independently', () => {
    const P = project();
    FD.claimMany(P, 'detail_a.ydr', 1, [2, 3], 'part:detail-a');
    FD.claim(P, 'detail_a.ydr', 1, 3, 'plant:bush');
    FD.claim(P, 'detail_b.ydr', 1, 3, 'manual');
    assert.deepEqual(plain(P.import.mdeletes), [['detail_a.ydr', 1, 2], ['detail_a.ydr', 1, 3], ['detail_b.ydr', 1, 3]]);
    assert.equal(FD.releaseOwner(P, 'part:detail-a'), 1);
    assert.deepEqual(plain(P.import.mdeletes), [['detail_a.ydr', 1, 3], ['detail_b.ydr', 1, 3]]);
    FD.restoreFile(P, 'detail_a.ydr');
    assert.deepEqual(plain(P.import.mdeletes), [['detail_b.ydr', 1, 3]]);
    assert.equal(P.import.faceDeleteOwners['detail_a.ydr|1|3'], undefined);
});

test('target ownership keeps its array routing if the active target name changes', () => {
    const P = project();
    FD.claim(P, 'building.ydr', 2, 8, 'cutter:old');
    P.import.target = 'new-building.ydr';
    assert.equal(FD.releaseOwner(P, 'cutter:old'), 1);
    assert.deepEqual(plain(P.import.deletes), []);
    assert.deepEqual(plain(P.import.mdeletes), []);
});

test('restore all clears sidecar and does not resurrect old owner claims', () => {
    const P = project();
    FD.claim(P, 'building.ydr', 9, 1, 'part:building.ydr:9');
    FD.restoreFile(P, 'building.ydr');
    assert.deepEqual(plain(P.import.deletes), []);
    assert.equal(P.import.faceDeleteOwners && P.import.faceDeleteOwners['building.ydr|9|1'], undefined);

    FD.claim(P, 'building.ydr', 9, 1, 'cutter:new');
    assert.equal(FD.releaseOwner(P, 'cutter:new'), 1);
    assert.deepEqual(plain(P.import.deletes), []);
});

test('duplicate claims are idempotent and owner release is batched', () => {
    const P = project();
    FD.claimMany(P, 'detail_a.ydr', 8, [0, 1, 2, 3], 'owner:a');
    FD.claimMany(P, 'detail_a.ydr', 8, [0, 1, 2, 3], 'owner:a');
    assert.equal(P.import.mdeletes.length, 4);
    assert.equal(FD.releaseMany(P, 'detail_a.ydr', 8, [0, 1, 2, 3], 'owner:a'), 4);
    assert.deepEqual(plain(P.import.mdeletes), []);
});

test('project JSON snapshots preserve ownership across undo and redo', () => {
    const P = project();
    const before = JSON.stringify(P);
    FD.claim(P, 'building.ydr', 7, 2, 'cutter:window');
    const after = JSON.stringify(P);
    assert.deepEqual(plain(JSON.parse(after).import.deletes), [[7, 2]]);

    const undone = JSON.parse(before);
    assert.deepEqual(undone.import.deletes, []);
    const redone = JSON.parse(after);
    assert.deepEqual(redone.import.deletes, [[7, 2]]);
    assert.deepEqual(redone.import.faceDeleteOwners['building.ydr|7|2'].owners, ['cutter:window']);
});

test('application producers and restorers route through the shared API', () => {
    const root = path.join(__dirname, '..');
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const html = read('ui/index.html');
    const tools = read('ui/js/importtools.js');
    const importModel = read('ui/js/importmodel.js');
    const fitModels = read('ui/js/fitmodels.js');
    const plants = read('ui/js/plants.js');
    const importUi = read('ui/js/importui.js');

    assert.ok(html.indexOf('js/face-deletions.js') < html.indexOf('js/importmodel.js'));
    assert.match(tools, /claimMany\(P, file, p\.g, p\.tris, k\.face\.owner\)/);
    assert.match(tools, /claimMany\(P, \(IM\.targetModel\(\) \|\| \{\}\)\.file \|\| P\.import\.target/);
    assert.match(tools, /claimMany\(P, rec\.file, rec\.g, rec\.tris, 'manual'\)/);
    assert.match(fitModels, /claimMany\(P, \(IM\.targetModel\(\) \|\| \{\}\)\.file \|\| P\.import\.target/);
    assert.match(importModel, /releaseOwner\(P, c\.face\.owner \|\| \('cutter:' \+ c\.id\)\)/);
    assert.match(importModel, /releaseMany\(P, file, g/);
    assert.match(plants, /FaceDeletions\.claimMany/);
    assert.match(plants, /FaceDeletions\.releaseMany/);
    assert.match(importUi, /FaceDeletions\.restoreFile/);
    assert.doesNotMatch(tools + fitModels + importModel + plants, /(?:I|P\.import)\.(?:m?deletes)\.push/);
});
