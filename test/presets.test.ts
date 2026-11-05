import assert from 'node:assert/strict';
import test from 'node:test';
import { findSourcePreset, presetIds, sourceDialect, sourcePresets } from '../src/presets';

test('exposes a DeepSeek preset with the official OpenAI-compatible base URL', () => {
	const preset = findSourcePreset('deepseek');
	assert.ok(preset);
	assert.equal(preset.name, 'DeepSeek');
	assert.equal(preset.baseUrl, 'https://api.deepseek.com');
	assert.equal(preset.dialect, 'deepseek');
	assert.deepEqual(sourcePresets.map((item) => item.id), ['deepseek']);
	assert.deepEqual(presetIds(), ['deepseek']);
});

test('resolves the DeepSeek dialect from the preset or the endpoint host', () => {
	assert.equal(sourceDialect({ preset: 'deepseek', baseUrl: 'https://example.com/v1' }), 'deepseek');
	assert.equal(sourceDialect({ baseUrl: 'https://api.deepseek.com' }), 'deepseek');
	assert.equal(sourceDialect({ baseUrl: 'https://api.deepseek.com/v1' }), 'deepseek');
	assert.equal(sourceDialect({ baseUrl: 'https://api.openai.com/v1' }), 'openai');
	assert.equal(sourceDialect({ baseUrl: 'http://localhost:1234/v1' }), 'openai');
});

test('does not treat look-alike hosts or invalid URLs as DeepSeek', () => {
	assert.equal(sourceDialect({ baseUrl: 'https://notdeepseek.com/v1' }), 'openai');
	assert.equal(sourceDialect({ baseUrl: 'https://example.com/deepseek.com' }), 'openai');
	assert.equal(sourceDialect({ baseUrl: 'not a url' }), 'openai');
});
