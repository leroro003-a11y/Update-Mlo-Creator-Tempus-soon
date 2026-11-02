const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('opening review model identity is transient, not a serialized mesh', () => {
    const tools = fs.readFileSync(path.join(root, 'ui/js/importtools.js'), 'utf8');
    const fit = fs.readFileSync(path.join(root, 'ui/js/fitmodels.js'), 'utf8');
    assert.match(tools, /const openingReviewModels = new WeakMap\(\)/);
    assert.match(tools, /openingReviewModels\.set\(k, modelSnapshot\)/);
    assert.doesNotMatch(tools, /k\.reviewModel\s*=/);
    assert.match(tools, /function copyOpeningReview\(from, to\)/);
    assert.match(fit, /copyOpeningReview\(c, copy\)/);
    assert.match(tools, /clearOpeningReview\(k\);\s*P\.import\.cutters\.push\(k\)/);
});

test('loading a project strips legacy review payloads from active and saved buildings', () => {
    const source = fs.readFileSync(path.join(root, 'ui/js/model.js'), 'utf8');
    const start = source.indexOf('    function stripOpeningReviewMetadata(P) {');
    const end = source.indexOf('    function upgrade(p) {', start);
    assert.ok(start >= 0 && end > start, 'migration helper exists');
    const helper = source.slice(start, end).trim();
    const context = {};
    vm.runInNewContext(helper + '\nthis.stripOpeningReviewMetadata = stripOpeningReviewMetadata;', context);
    const heavy = { file: 'model.ydr', geoms: [{ pos: [1, 2, 3], idx: [0, 1, 2] }] };
    const makeCutter = () => ({ id: 'opening', reviewModel: heavy, reviewTarget: 'model.ydr', reviewFrame: '{}', reviewDeletes: 17, face: { tris: [1, 2] } });
    const project = { import: { cutters: [makeCutter()], buildings: [{ snap: { import: { cutters: [makeCutter()] } } }] } };
    const removed = context.stripOpeningReviewMetadata(project);
    assert.equal(removed, 8);
    const saved = JSON.stringify(project);
    assert.doesNotMatch(saved, /reviewModel|reviewTarget|reviewFrame|reviewDeletes/);
    assert.match(saved, /"tris":\[1,2\]/, 'real opening geometry remains');
});
