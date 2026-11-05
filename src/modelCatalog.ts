import { ModelConfig, SourceConfig } from "./config";
import {
	ModelCapabilityMetadata,
	readModelCapabilityMetadata,
} from "./modelCapabilities";
import {
	OpenAIModelCatalogResponse,
	OpenAIModelRecord,
} from "./openai-compatible";

export interface DiscoveredModel {
	readonly id: string;
	readonly name?: string;
	readonly imageInput: boolean;
	readonly reasoning: boolean;
	readonly capabilityMetadata: ModelCapabilityMetadata;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
}

const defaultMaxInputTokens = 128000;
const defaultMaxOutputTokens = 8192;

export async function fetchModels(
	source: SourceConfig,
	apiKey?: string,
): Promise<DiscoveredModel[]> {
	const response = await fetch(`${source.baseUrl}/models`, {
		headers: modelCatalogHeaders(apiKey),
		redirect: "error",
	});

	if (!response.ok) {
		const responseText = await response.text();
		throw new Error(
			`Request failed (${response.status} ${response.statusText}): ${responseText.slice(0, 1000)}`,
		);
	}

	return parseModelCatalog(await response.json());
}

export function modelCatalogHeaders(apiKey?: string): Record<string, string> {
	const headers: Record<string, string> = { Accept: "application/json" };
	if (apiKey?.trim()) {
		headers.Authorization = `Bearer ${apiKey.trim()}`;
	}
	return headers;
}

export function parseModelIds(value: unknown): string[] {
	return parseModelCatalog(value).map((model) => model.id);
}

export function parseModelCatalog(value: unknown): DiscoveredModel[] {
	if (!isOpenAIModelCatalogResponse(value)) {
		throw new Error("The model catalog response must contain a data array.");
	}

	const models: DiscoveredModel[] = [];
	const seen = new Set<string>();
	for (const entry of value.data as readonly unknown[]) {
		if (!isOpenAIModelRecord(entry) || entry.id.trim().length === 0) {
			throw new Error(
				"The model catalog response contains an entry without a valid model ID.",
			);
		}
		const id = entry.id.trim();
		if (seen.has(id)) {
			throw new Error(
				`The model catalog contains the model ID "${id}" more than once.`,
			);
		}
		seen.add(id);
		const capabilityMetadata = readModelCapabilityMetadata(entry);
		const name = displayName(entry.name);
		models.push({
			id,
			...(name === undefined ? {} : { name }),
			imageInput: capabilityMetadata.imageInput ?? false,
			reasoning: capabilityMetadata.reasoning ?? false,
			capabilityMetadata,
			...readTokenLimits(entry),
		});
	}
	if (models.length === 0) {
		throw new Error(
			"The model catalog returned no models; the configured list was not changed.",
		);
	}
	return models;
}

export function mergeModelIds(
	modelIds: readonly DiscoveredModel[],
	existing: readonly ModelConfig[],
): ModelConfig[] {
	const configuredById = new Map(existing.map((model) => [model.id, model]));
	return modelIds.map((discovered) => {
		const configured = configuredById.get(discovered.id);
		if (configured) {
			return {
				...configured,
				capabilityMetadata: discovered.capabilityMetadata,
				imageInput: configured.autoDetectCapabilities
					? discovered.imageInput
					: configured.imageInput,
				reasoning: configured.autoDetectCapabilities
					? discovered.reasoning
					: configured.reasoning,
			};
		}
		return modelConfigFromDiscovered(discovered);
	});
}

export function modelConfigFromDiscovered(model: DiscoveredModel): ModelConfig {
	return {
		id: model.id,
		name: model.name ?? model.id,
		maxInputTokens: model.maxInputTokens ?? defaultMaxInputTokens,
		maxOutputTokens: model.maxOutputTokens ?? defaultMaxOutputTokens,
		toolCalling: true,
		autoDetectCapabilities: true,
		imageInput: model.imageInput,
		reasoning: model.reasoning,
		capabilityMetadata: model.capabilityMetadata,
	};
}

function readTokenLimits(
	entry: OpenAIModelRecord,
): Pick<DiscoveredModel, "maxInputTokens" | "maxOutputTokens"> {
	const maxInputTokens = tokenLimit(entry.context_window);
	const maxOutputTokens = tokenLimit(entry.max_output_tokens);
	return {
		...(maxInputTokens === undefined ? {} : { maxInputTokens }),
		...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
	};
}

function tokenLimit(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: undefined;
}

function displayName(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim().length === 0) {
		return undefined;
	}
	return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAIModelCatalogResponse(
	value: unknown,
): value is OpenAIModelCatalogResponse {
	return isRecord(value) && Array.isArray(value.data);
}

function isOpenAIModelRecord(value: unknown): value is OpenAIModelRecord {
	return isRecord(value) && typeof value.id === "string";
}
