import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantMessageKey, ReasoningStore } from '../src/reasoning';

test('keys assistant messages by text and tool calls', () => {
	const key = assistantMessageKey('Checking the weather.', [{ id: 'call-1', name: 'get_weather' }]);
	assert.equal(key, assistantMessageKey('Checking the weather.', [{ id: 'call-1', name: 'get_weather' }]));
	assert.notEqual(key, assistantMessageKey('Checking the weather.', [{ id: 'call-2', name: 'get_weather' }]));
	assert.notEqual(key, assistantMessageKey('Checking the weather.', [{ id: 'call-1', name: 'get_date' }]));
	assert.notEqual(key, assistantMessageKey('Checking the date.', [{ id: 'call-1', name: 'get_weather' }]));
	assert.equal(assistantMessageKey('', []), assistantMessageKey('', []));
});

test('stores and recalls reasoning per assistant message', () => {
	const store = new ReasoningStore();
	const key = assistantMessageKey('Answer', []);
	assert.equal(store.recall(key), undefined);
	store.remember(key, 'thinking about the answer');
	assert.equal(store.recall(key), 'thinking about the answer');
	assert.equal(store.recall(assistantMessageKey('Other', [])), undefined);
});

test('ignores empty reasoning and evicts the oldest entries', () => {
	const store = new ReasoningStore(2);
	store.remember(assistantMessageKey('empty', []), '');
	assert.equal(store.recall(assistantMessageKey('empty', [])), undefined);

	const first = assistantMessageKey('first', []);
	const second = assistantMessageKey('second', []);
	const third = assistantMessageKey('third', []);
	store.remember(first, 'one');
	store.remember(second, 'two');
	store.recall(first);
	store.remember(third, 'three');

	assert.equal(store.recall(second), undefined);
	assert.equal(store.recall(first), 'one');
	assert.equal(store.recall(third), 'three');
});
