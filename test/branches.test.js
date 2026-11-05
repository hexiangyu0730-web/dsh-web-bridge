import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the exact browser branch helper, not a duplicated implementation.
let module;
vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(definition) {
    module = definition.factory(name => name === 'react' ? { Component: class {}, createElement() {} } : {});
  } } },
});
const plain = value => JSON.parse(JSON.stringify(value));
const normalize = values => plain(module.branching.normalizeMessages(values));
const view = (values, choices = {}, tip) => plain(module.branching.buildView(normalize(values), choices, tip));
const ids = result => result.rows.map(row => row.message.id);
const tree = [
  { id: 1, role: 'user', text: 'question', parentId: null },
  { id: 2, role: 'assistant', text: 'old answer', parentId: 1 },
  { id: 3, role: 'assistant', text: 'new answer', parentId: 1 },
  { id: 4, role: 'user', text: 'old followup', parentId: 2 },
  { id: 5, role: 'assistant', text: 'old child', parentId: 4 },
  { id: 6, role: 'user', text: 'new followup', parentId: 3 },
  { id: 7, role: 'assistant', text: 'new child', parentId: 6 },
];

test('server-selected older tip takes precedence over chronological message order', () => {
  assert.deepEqual(ids(view(tree, {}, '5')), ['1', '2', '4', '5']);
  assert.deepEqual(ids(view(tree, {}, '7')), ['1', '3', '6', '7']);
});

test('answer selectors show siblings and only descendants of the selected answer', () => {
  const selected = view(tree, { 1: '3' }, '5');
  assert.deepEqual(ids(selected), ['1', '3', '6', '7']);
  assert.equal(selected.rows[1].index, 1);
  assert.deepEqual(selected.rows[1].siblings.map(item => item.id), ['2', '3']);
  assert.deepEqual(ids(view(tree, { 1: '2' }, '7')), ['1', '2', '4', '5']);
  assert.equal(tree.length, 7, 'switching never deletes hidden branches');
});

test('new pending regeneration is selected immediately and hides the old future without deleting it', () => {
  const pending = [...tree, { id: 'pending', parentId: '1', role: 'assistant', streaming: true }];
  assert.deepEqual(ids(view(pending, { 1: 'pending' }, '7')), ['1', 'pending']);
  assert.equal(view(pending, { 1: 'pending' }).rows[1].siblings.length, 3);
});

test('stale saved selections fall back to valid server defaults and cycles cannot hang the UI', () => {
  assert.deepEqual(ids(view(tree, { 1: 'deleted' }, '5')), ['1', '2', '4', '5']);
  const cyclic = view([{ id: 1, parentId: 2, role: 'user' }, { id: 2, parentId: 1, role: 'assistant' }]);
  assert.equal(cyclic.valid, false);
});

test('legacy histories with no parent metadata remain a linear conversation', () => {
  assert.deepEqual(ids(view([{ id: 1, role: 'user' }, { id: 2, role: 'assistant' }, { id: 3, role: 'user' }, { id: 4, role: 'assistant' }])), ['1', '2', '3', '4']);
  assert.equal(view([]).valid, true);
});
