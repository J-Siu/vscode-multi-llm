import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBaseUrl, parseSources, removeRawSource, replaceRawSource } from '../src/config';

test('parses multiple sources and supplies model defaults', () => {
	const sources = parseSources([
		{
			id: 'openai',
			name: 'OpenAI',
			baseUrl: 'https://api.openai.com/v1/',
			models: [{ id: 'gpt-4.1' }]
		},
		{
			id: 'local',
			name: 'Local endpoint',
			baseUrl: 'http://localhost:1234/v1',
			models: [{ id: 'local-chat', name: 'Local Chat', toolCalling: false }]
		}
	]);

	assert.equal(sources.length, 2);
	assert.equal(sources[0].baseUrl, 'https://api.openai.com/v1');
	assert.deepEqual(sources[0].models[0], {
		id: 'gpt-4.1',
		name: 'gpt-4.1',
		maxInputTokens: 128000,
		maxOutputTokens: 8192,
		toolCalling: true,
		autoDetectCapabilities: true
	});
	assert.equal(sources[1].models[0].toolCalling, false);
});

test('preserves explicit vision and reasoning overrides', () => {
	const [source] = parseSources([{
		id: 'source',
		name: 'Source',
		baseUrl: 'https://example.com/v1',
		models: [{
			id: 'gpt-4o',
			autoDetectCapabilities: false,
			imageInput: false,
			reasoning: true,
			reasoningEffort: 'high'
		}]
	}]);
	assert.equal(source.models[0].autoDetectCapabilities, false);
	assert.equal(source.models[0].imageInput, false);
	assert.equal(source.models[0].reasoning, true);
	assert.equal(source.models[0].reasoningEffort, 'high');
});

test('rejects duplicate IDs and invalid endpoint URLs', () => {
	assert.throws(() => parseSources([
		{ id: 'duplicate', name: 'One', baseUrl: 'https://example.com/v1', models: [{ id: 'm' }] },
		{ id: 'duplicate', name: 'Two', baseUrl: 'https://example.org/v1', models: [{ id: 'm' }] }
	]), /configured more than once/);
	assert.throws(() => normalizeBaseUrl('file:///tmp/api', 'local'), /must use HTTPS/);
	assert.throws(() => normalizeBaseUrl('https://user:pass@example.com/v1', 'remote'), /must not contain credentials/);
	assert.equal(normalizeBaseUrl('http://localhost:1234/v1', 'local'), 'http://localhost:1234/v1');
});

test('rejects repeated model IDs and invalid token limits', () => {
	assert.throws(() => parseSources([
		{ id: 'source', name: 'Source', baseUrl: 'https://example.com/v1', models: [{ id: 'm' }, { id: 'm' }] }
	]), /configured more than once/);
	assert.throws(() => parseSources([
		{ id: 'source', name: 'Source', baseUrl: 'https://example.com/v1', models: [{ id: 'm', maxOutputTokens: 0 }] }
	]), /invalid maxOutputTokens/);
});

test('parses built-in presets and the extended reasoning effort values', () => {
	const [source] = parseSources([{
		id: 'deepseek',
		name: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com',
		preset: 'deepseek',
		models: [
			{ id: 'deepseek-flash', reasoningEffort: 'max' },
			{ id: 'deepseek-v4-pro', reasoningEffort: 'none' }
		]
	}]);

	assert.equal(source.preset, 'deepseek');
	assert.equal(source.models[0].reasoningEffort, 'max');
	assert.equal(source.models[1].reasoningEffort, 'none');

	const [plain] = parseSources([{
		id: 'openai',
		name: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		models: [{ id: 'gpt-4.1' }]
	}]);
	assert.equal(plain.preset, undefined);
});

test('rejects unknown presets and unsupported reasoning effort values', () => {
	assert.throws(() => parseSources([{
		id: 'source',
		name: 'Source',
		baseUrl: 'https://example.com/v1',
		preset: 'openai',
		models: [{ id: 'm' }]
	}]), /unknown preset "openai"/);
	assert.throws(() => parseSources([{
		id: 'source',
		name: 'Source',
		baseUrl: 'https://example.com/v1',
		models: [{ id: 'm', reasoningEffort: 'ultra' }]
	}]), /invalid reasoningEffort/);
});

test('replaceRawSource keeps the source id, order, and unrelated fields', () => {
	const raw = [
		{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', custom: 'keep', models: [{ id: 'old' }] },
		{ id: 'local', name: 'Local', baseUrl: 'http://localhost:1234/v1', models: [{ id: 'llama' }] }
	];
	const updated = replaceRawSource(raw, 'deepseek', {
		name: 'DeepSeek API',
		baseUrl: 'https://api.deepseek.com/v1',
		preset: 'deepseek',
		models: [{ id: 'new', name: 'New', maxInputTokens: 1, maxOutputTokens: 1, toolCalling: true, autoDetectCapabilities: false }]
	});

	assert.equal(updated.length, 2);
	assert.deepEqual(updated[1], raw[1]);
	assert.equal((updated[0] as Record<string, unknown>).id, 'deepseek');
	assert.equal((updated[0] as Record<string, unknown>).name, 'DeepSeek API');
	assert.equal((updated[0] as Record<string, unknown>).custom, 'keep');
	assert.equal((updated[0] as Record<string, unknown>).preset, 'deepseek');
	assert.deepEqual((updated[0] as { models: { id: string }[] }).models.map((model) => model.id), ['new']);
	assert.equal(raw[0].name, 'DeepSeek');
});

test('replaceRawSource clears a preset when the source becomes custom', () => {
	const raw = [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', preset: 'deepseek', models: [] }];
	const updated = replaceRawSource(raw, 'deepseek', {
		name: 'Gateway',
		baseUrl: 'https://gateway.example.com/v1',
		models: []
	});

	assert.equal('preset' in (updated[0] as Record<string, unknown>), false);
	assert.equal('preset' in raw[0], true);
});

test('replaceRawSource rejects unknown ids and invalid lists', () => {
	assert.throws(() => replaceRawSource([], 'missing', { name: 'x', baseUrl: 'https://x.dev', models: [] }), /no longer configured/);
	assert.throws(() => replaceRawSource({}, 'x', { name: 'x', baseUrl: 'https://x.dev', models: [] }), /invalid/);
});

test('removeRawSource removes only the matching source and preserves the input', () => {
	const raw = [
		{ id: 'one', name: 'One', models: [] },
		{ id: 'two', name: 'Two', models: [] }
	];
	const updated = removeRawSource(raw, 'one');

	assert.deepEqual(updated, [raw[1]]);
	assert.equal(raw.length, 2);
});

test('removeRawSource rejects unknown ids and invalid lists', () => {
	assert.throws(() => removeRawSource([], 'missing'), /no longer configured/);
	assert.throws(() => removeRawSource({}, 'one'), /invalid/);
});
