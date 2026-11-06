import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asArray, asRecord, asString, dig, finiteNumber, firstString, safeInt } from '../src/core/values';

test('safeInt accepts protobuf int64 numbers and decimal strings', () => {
  assert.equal(safeInt(2260), 2260);
  assert.equal(safeInt('2260'), 2260);
  assert.equal(safeInt('0'), 0);
  assert.equal(safeInt(0), 0);
  assert.equal(safeInt(' 42 '), 42);
});

test('safeInt rejects values that would silently distort a token count', () => {
  assert.equal(safeInt(-1), null);
  assert.equal(safeInt('-1'), null);
  assert.equal(safeInt(1.5), null);
  assert.equal(safeInt('1.5'), null);
  assert.equal(safeInt(''), null);
  assert.equal(safeInt('abc'), null);
  assert.equal(safeInt('12abc'), null);
  assert.equal(safeInt(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(safeInt('9007199254740993'), null);
  assert.equal(safeInt(null), null);
  assert.equal(safeInt(undefined), null);
  assert.equal(safeInt(true), null);
});

test('safeInt handles exponent notation as invalid rather than coercing', () => {
  assert.equal(safeInt('1e3'), null);
});

test('finiteNumber parses quota fractions but rejects junk', () => {
  assert.equal(finiteNumber(0.836511), 0.836511);
  assert.equal(finiteNumber('0.5'), 0.5);
  assert.equal(finiteNumber('nope'), null);
  assert.equal(finiteNumber(null), null);
});

test('asRecord and asArray are shape-strict', () => {
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  assert.equal(asRecord([]), null);
  assert.equal(asRecord(null), null);
  assert.equal(asRecord('x'), null);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray({ length: 1 }), []);
});

test('asString ignores empty strings, which protobuf uses for absent values', () => {
  assert.equal(asString('value'), 'value');
  assert.equal(asString(''), null);
  assert.equal(asString(42), null);
});

test('dig walks nested objects and stops at the first gap', () => {
  const payload = { a: { b: { c: 'deep' } } };
  assert.equal(dig(payload, 'a', 'b', 'c'), 'deep');
  assert.equal(dig(payload, 'a', 'missing', 'c'), null);
  assert.equal(dig(null, 'a'), null);
  assert.equal(dig(payload, 'a', 'b'), payload.a.b);
});

test('firstString returns the first usable candidate', () => {
  assert.equal(firstString(null, '', 'second', 'third'), 'second');
  assert.equal(firstString(null, ''), null);
});
