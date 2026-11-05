import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeModelIds, modelCatalogHeaders, parseModelCatalog, parseModelIds } from '../src/modelCatalog';
import { ModelConfig } from '../src/config';

const existing: ModelConfig[] = [{
	id: 'kept',
	name: 'Friendly name',
	maxInputTokens: 64000,
	maxOutputTokens: 4096,
	toolCalling: false,
	autoDetectCapabilities: true,
	imageInput: true
}];

test('parses model IDs from an OpenAI-compatible catalog', () => {
	assert.deepEqual(parseModelIds({ data: [{ id: 'model-a' }, { id: ' model-b ' }] }), ['model-a', 'model-b']);
});

test('detects vision and reasoning from catalog metadata only', () => {
	assert.deepEqual(parseModelCatalog({
		data: [
			{
				id: 'opaque-model',
				architecture: { input_modalities: ['text', 'image'] },
				supported_parameters: ['tools', 'reasoning_effort']
			},
			{ id: 'gpt-4o' },
			{ id: 'o3-mini' },
			{ id: 'qwen3-vl' }
		]
	}), [
		{
			id: 'opaque-model',
			imageInput: true,
			reasoning: true,
			capabilityMetadata: { imageInput: true, reasoning: true }
		},
		{ id: 'gpt-4o', imageInput: false, reasoning: false, capabilityMetadata: { imageInput: false, reasoning: false } },
		{ id: 'o3-mini', imageInput: false, reasoning: false, capabilityMetadata: { imageInput: false, reasoning: false } },
		{ id: 'qwen3-vl', imageInput: false, reasoning: false, capabilityMetadata: { imageInput: false, reasoning: false } }
	]);
});

test('catalog metadata can explicitly declare capabilities as unsupported', () => {
	assert.deepEqual(parseModelCatalog({
		data: [{ id: 'gpt-4o', capabilities: { vision: false, reasoning: false } }]
	}), [{
		id: 'gpt-4o',
		imageInput: false,
		reasoning: false,
		capabilityMetadata: { imageInput: false, reasoning: false }
	}]);
});

test('only sends authorization when a non-empty API key is configured', () => {
	assert.deepEqual(modelCatalogHeaders(), { Accept: 'application/json' });
	assert.deepEqual(modelCatalogHeaders(' key '), {
		Accept: 'application/json',
		Authorization: 'Bearer key'
	});
});

test('rejects empty or malformed catalogs to avoid replacing configured models', () => {
	assert.throws(() => parseModelIds({ data: [] }), /returned no models/);
	assert.throws(() => parseModelIds({ data: [{ name: 'missing id' }] }), /without a valid model ID/);
	assert.throws(() => parseModelIds({ data: [{ id: 'same' }, { id: 'same' }] }), /more than once/);
});

test('keeps configured model settings and applies detected capabilities to new IDs', () => {
	assert.deepEqual(mergeModelIds([
		{ id: 'new', imageInput: true, reasoning: true, capabilityMetadata: { imageInput: true, reasoning: true } },
		{ id: 'kept', imageInput: false, reasoning: true, capabilityMetadata: { imageInput: false, reasoning: true } }
	], existing), [
		{
			id: 'new',
			name: 'new',
			maxInputTokens: 128000,
			maxOutputTokens: 8192,
			toolCalling: true,
			autoDetectCapabilities: true,
			imageInput: true,
			reasoning: true,
			capabilityMetadata: { imageInput: true, reasoning: true }
		},
		{ ...existing[0], imageInput: false, reasoning: true, capabilityMetadata: { imageInput: false, reasoning: true } }
	]);
});

test('preserves explicit capability flags when automatic detection is disabled', () => {
	assert.deepEqual(mergeModelIds([
		{ id: 'kept', imageInput: true, reasoning: true, capabilityMetadata: { imageInput: true, reasoning: true } }
	], [{ ...existing[0], autoDetectCapabilities: false, imageInput: false, reasoning: false }]), [
		{
			...existing[0],
			autoDetectCapabilities: false,
			imageInput: false,
			reasoning: false,
			capabilityMetadata: { imageInput: true, reasoning: true }
		}
	]);
});

test('reads token limits and effort levels from catalog metadata', () => {
	assert.deepEqual(parseModelCatalog({
		data: [
			{
				id: 'deepseek-flash',
				name: 'DeepSeek Flash',
				context_window: 1000000,
				max_output_tokens: 393216,
				input_modalities: ['text', 'image'],
				effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' }
			},
			{
				id: 'deepseek-v4-pro',
				context_window: 1000000,
				max_output_tokens: 393216,
				input_modalities: ['text'],
				effort: { supported_levels: [] }
			},
			{ id: 'plain', context_window: -1, max_output_tokens: 1.5 }
		]
	}), [
		{
			id: 'deepseek-flash',
			name: 'DeepSeek Flash',
			imageInput: true,
			reasoning: true,
			capabilityMetadata: { imageInput: true, reasoning: true },
			maxInputTokens: 1000000,
			maxOutputTokens: 393216
		},
		{
			id: 'deepseek-v4-pro',
			imageInput: false,
			reasoning: false,
			capabilityMetadata: { imageInput: false, reasoning: false },
			maxInputTokens: 1000000,
			maxOutputTokens: 393216
		},
		{ id: 'plain', imageInput: false, reasoning: false, capabilityMetadata: { imageInput: false, reasoning: false } }
	]);
});

test('uses discovered token limits for new models and keeps configured limits', () => {
	const discovered = [{
		id: 'deepseek-flash',
		imageInput: true,
		reasoning: true,
		capabilityMetadata: { imageInput: true, reasoning: true },
		maxInputTokens: 1000000,
		maxOutputTokens: 393216
	}];

	const [added] = mergeModelIds(discovered, []);
	assert.equal(added.maxInputTokens, 1000000);
	assert.equal(added.maxOutputTokens, 393216);
	assert.equal(added.name, 'deepseek-flash');

	const [kept] = mergeModelIds(discovered, [{
		...existing[0],
		id: 'deepseek-flash'
	}]);
	assert.equal(kept.maxInputTokens, existing[0].maxInputTokens);
	assert.equal(kept.maxOutputTokens, existing[0].maxOutputTokens);
});
