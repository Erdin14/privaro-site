// Exercise the actual shared browser script with a minimal DOM adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {}, lookedUp = [], exposed = [];
const target = {classList: {remove: name => exposed.push(name)}};
const location = {hash: ''};
const document = {
  currentScript: {},
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  getElementById(id) { lookedUp.push(id); return id === 'privacy section' ? {closest: () => target} : null; },
};
class IntersectionObserver { observe() {} unobserve() {} disconnect() {} }
vm.runInNewContext(fs.readFileSync(require.resolve('../presentation.js'), 'utf8'), {
  document, location, IntersectionObserver,
  window: {IntersectionObserver, addEventListener: (name, fn) => { listeners[name] = fn; }},
  matchMedia: () => ({matches: false, addEventListener() {}}),
});
assert.equal(typeof listeners.hashchange, 'function');
for (const hash of ['#%', '#%E0%A4%A', '#%FF']) {
  location.hash = hash;
  assert.doesNotThrow(() => listeners.hashchange());
}
assert.deepEqual(lookedUp, [], 'malformed fragments must not reach DOM lookup');
location.hash = '#privacy%20section';
listeners.hashchange();
assert.deepEqual(lookedUp, ['privacy section']);
assert.deepEqual(exposed, ['reveal-pending'], 'valid anchor still reveals its destination');
for (const hash of ['#missing', '#', '']) {
  location.hash = hash;
  assert.doesNotThrow(() => listeners.hashchange());
}
console.log('Fragment regression checks passed');
