import { ModelCapabilityMetadata } from "./modelCapabilities";
import { findSourcePreset, presetIds } from "./presets";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "max";

export interface ModelConfig {
	readonly id: string;
	readonly name: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly toolCalling: boolean;
	readonly autoDetectCapabilities: boolean;
	readonly imageInput?: boolean;
	readonly reasoning?: boolean;
	readonly capabilityMetadata?: ModelCapabilityMetadata;
	readonly reasoningEffort?: ReasoningEffort;
}

export interface SourceConfig {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly preset?: string;
	readonly models: readonly ModelConfig[];
}

interface RawModelConfig extends Record<string, unknown> {
	id?: unknown;
	name?: unknown;
	maxInputTokens?: unknown;
	maxOutputTokens?: unknown;
	toolCalling?: unknown;
	autoDetectCapabilities?: unknown;
	imageInput?: unknown;
	reasoning?: unknown;
	reasoningEffort?: unknown;
	capabilityMetadata?: unknown;
}

interface RawSourceConfig extends Record<string, unknown> {
	id?: unknown;
	name?: unknown;
	baseUrl?: unknown;
	preset?: unknown;
	models?: unknown;
}

export function parseSources(value: unknown): SourceConfig[] {
	if (!Array.isArray(value)) {
		throw new Error("The multiLlm.sources setting must be an array.");
	}

	const sourceIds = new Set<string>();
	return value.map((entry, sourceIndex) => {
		if (!isRecord(entry)) {
			throw new Error(`Source at index ${sourceIndex} must be an object.`);
		}

		const source: RawSourceConfig = entry;
		const id = requiredString(
			source.id,
			`Source at index ${sourceIndex} must have an ID.`,
		);
		if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
			throw new Error(
				`Source ID "${id}" may contain only letters, numbers, ".", "_" and "-".`,
			);
		}
		if (sourceIds.has(id)) {
			throw new Error(`Source ID "${id}" is configured more than once.`);
		}
		sourceIds.add(id);

		const name = requiredString(
			source.name,
			`Source "${id}" must have a name.`,
		);
		const baseUrl = normalizeBaseUrl(source.baseUrl, id);
		if (!Array.isArray(source.models) || source.models.length === 0) {
			throw new Error(`Source "${id}" must configure at least one model.`);
		}

		const modelIds = new Set<string>();
		const models = source.models.map((rawModel, modelIndex) => {
			if (!isRecord(rawModel)) {
				throw new Error(
					`Model at index ${modelIndex} in source "${id}" must be an object.`,
				);
			}

			const model: RawModelConfig = rawModel;
			const modelId = requiredString(
				model.id,
				`Model at index ${modelIndex} in source "${id}" must have an ID.`,
			);
			if (modelIds.has(modelId)) {
				throw new Error(
					`Model ID "${modelId}" is configured more than once in source "${id}".`,
				);
			}
			modelIds.add(modelId);
			return {
				id: modelId,
				name: optionalString(
					model.name,
					modelId,
					`Model "${modelId}" in source "${id}" has an invalid name.`,
				),
				maxInputTokens: positiveInteger(
					model.maxInputTokens,
					128000,
					`Model "${modelId}" in source "${id}" has an invalid maxInputTokens value.`,
				),
				maxOutputTokens: positiveInteger(
					model.maxOutputTokens,
					8192,
					`Model "${modelId}" in source "${id}" has an invalid maxOutputTokens value.`,
				),
				toolCalling: optionalBoolean(
					model.toolCalling,
					true,
					`Model "${modelId}" in source "${id}" has an invalid toolCalling value.`,
				),
				autoDetectCapabilities: optionalBoolean(
					model.autoDetectCapabilities,
					true,
					`Model "${modelId}" in source "${id}" has an invalid autoDetectCapabilities value.`,
				),
				...(model.imageInput === undefined
					? {}
					: {
							imageInput: optionalBooleanOverride(
								model.imageInput,
								`Model "${modelId}" in source "${id}" has an invalid imageInput value.`,
							),
						}),
				...(model.reasoning === undefined
					? {}
					: {
							reasoning: optionalBooleanOverride(
								model.reasoning,
								`Model "${modelId}" in source "${id}" has an invalid reasoning value.`,
							),
						}),
				...(model.capabilityMetadata === undefined
					? {}
					: {
							capabilityMetadata: parseCapabilityMetadata(
								model.capabilityMetadata,
								`Model "${modelId}" in source "${id}" has invalid capabilityMetadata.`,
							),
						}),
				...(model.reasoningEffort === undefined
					? {}
					: {
							reasoningEffort: reasoningEffort(
								model.reasoningEffort,
								`Model "${modelId}" in source "${id}" has an invalid reasoningEffort value.`,
							),
						}),
			};
		});

		return {
			id,
			name,
			baseUrl,
			...(source.preset === undefined
				? {}
				: { preset: parsePreset(source.preset, id) }),
			models,
		};
	});
}

export function normalizeBaseUrl(value: unknown, sourceId: string): string {
	const baseUrl = requiredString(
		value,
		`Source "${sourceId}" must have a base URL.`,
	);
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error(`Source "${sourceId}" has an invalid base URL.`);
	}

	const isLocalHttp =
		parsed.protocol === "http:" &&
		(parsed.hostname === "localhost" ||
			parsed.hostname === "127.0.0.1" ||
			parsed.hostname === "[::1]");
	if (
		(parsed.protocol !== "https:" && !isLocalHttp) ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error(
			`Source "${sourceId}" base URL must use HTTPS (HTTP is allowed for localhost) and must not contain credentials, a query, or a fragment.`,
		);
	}
	return baseUrl.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, error: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(error);
	}
	return value.trim();
}

function optionalString(
	value: unknown,
	fallback: string,
	error: string,
): string {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(error);
	}
	return value.trim();
}

function positiveInteger(
	value: unknown,
	fallback: number,
	error: string,
): number {
	if (value === undefined) {
		return fallback;
	}
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw new Error(error);
	}
	return value as number;
}

function optionalBoolean(
	value: unknown,
	fallback: boolean,
	error: string,
): boolean {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== "boolean") {
		throw new Error(error);
	}
	return value;
}

function optionalBooleanOverride(value: unknown, error: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(error);
	}
	return value;
}

function reasoningEffort(value: unknown, error: string): ReasoningEffort {
	if (
		value === "none" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "max"
	) {
		return value;
	}
	throw new Error(error);
}

function parsePreset(value: unknown, sourceId: string): string {
	const preset = requiredString(
		value,
		`Source "${sourceId}" has an invalid preset.`,
	);
	if (!findSourcePreset(preset)) {
		throw new Error(
			`Source "${sourceId}" uses the unknown preset "${preset}". Valid presets: ${presetIds().join(", ")}.`,
		);
	}
	return preset;
}

function parseCapabilityMetadata(
	value: unknown,
	error: string,
): ModelCapabilityMetadata {
	if (!isRecord(value)) {
		throw new Error(error);
	}
	const imageInput = value.imageInput;
	const reasoning = value.reasoning;
	if (imageInput !== undefined && typeof imageInput !== "boolean") {
		throw new Error(error);
	}
	if (reasoning !== undefined && typeof reasoning !== "boolean") {
		throw new Error(error);
	}
	return {
		imageInput: imageInput ?? false,
		reasoning: reasoning ?? false,
	};
}

/**
 * Replaces the raw settings entry whose `id` matches, preserving list order and
 * the source ID so the stored API key stays associated with it.
 */
export function replaceRawSource(
	rawSources: unknown,
	sourceId: string,
	updated: {
		readonly name: string;
		readonly baseUrl: string;
		readonly preset?: string;
		readonly models: readonly ModelConfig[];
	},
): unknown[] {
	if (!Array.isArray(rawSources)) {
		throw new Error("The configured source list is invalid.");
	}
	const index = rawSources.findIndex(
		(entry) =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { id?: unknown }).id === sourceId,
	);
	if (index < 0) {
		throw new Error(`Source "${sourceId}" is no longer configured.`);
	}
	const replacement: Record<string, unknown> = {
		...(rawSources[index] as Record<string, unknown>),
		id: sourceId,
		name: updated.name,
		baseUrl: updated.baseUrl,
		models: [...updated.models],
	};
	if (updated.preset) {
		replacement.preset = updated.preset;
	} else {
		delete replacement.preset;
	}
	const sources = [...rawSources];
	sources[index] = replacement;
	return sources;
}

/** Removes the raw settings entry whose `id` matches. */
export function removeRawSource(rawSources: unknown, sourceId: string): unknown[] {
	if (!Array.isArray(rawSources)) {
		throw new Error("The configured source list is invalid.");
	}
	const index = rawSources.findIndex(
		(entry) =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { id?: unknown }).id === sourceId,
	);
	if (index < 0) {
		throw new Error(`Source "${sourceId}" is no longer configured.`);
	}
	return rawSources.filter((_, sourceIndex) => sourceIndex !== index);
}
