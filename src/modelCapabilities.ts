export interface ModelCapabilities {
	readonly imageInput: boolean;
	readonly reasoning: boolean;
}

export interface ModelCapabilityMetadata {
	readonly imageInput: boolean;
	readonly reasoning: boolean;
}

export function readModelCapabilityMetadata(
	value?: Record<string, unknown>,
): ModelCapabilityMetadata {
	const imageInput =
		readBoolean(value, [
			"imageInput",
			"image_input",
			"vision",
			"supports_vision",
			"supportsVision",
		]) ?? hasInputModality(value, ["image", "image_url", "vision"]);
	const reasoning =
		readBoolean(value, [
			"reasoning",
			"thinking",
			"supports_reasoning",
			"supportsReasoning",
			"supportsThinking",
		]) ??
		hasSupportedParameter(value, [
			"reasoning",
			"reasoning_effort",
			"enable_thinking",
			"thinking",
		]) ??
		hasEffortLevels(value);
	return {
		imageInput: imageInput ?? false,
		reasoning: reasoning ?? false,
	};
}

function readBoolean(
	value: unknown,
	keys: readonly string[],
): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const records = [
		value,
		asRecord(value.capabilities),
		asRecord(value.architecture),
		asRecord(value.metadata),
	].filter((record): record is Record<string, unknown> => record !== undefined);
	for (const record of records) {
		for (const key of keys) {
			if (typeof record[key] === "boolean") {
				return record[key];
			}
		}
	}
	return undefined;
}

function hasInputModality(
	value: unknown,
	modalities: readonly string[],
): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const architecture = asRecord(value.architecture);
	const records = [value, architecture, asRecord(value.metadata)].filter(
		(record): record is Record<string, unknown> => record !== undefined,
	);
	for (const record of records) {
		for (const key of ["input_modalities", "inputModalities", "modalities"]) {
			const entries = record[key];
			if (
				Array.isArray(entries) &&
				entries.every((item) => typeof item === "string")
			) {
				return entries.some((item) => modalities.includes(item.toLowerCase()));
			}
		}
	}
	return undefined;
}

function hasSupportedParameter(
	value: unknown,
	parameters: readonly string[],
): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const supported =
		value.supported_parameters ??
		asRecord(value.metadata)?.supported_parameters;
	if (
		!Array.isArray(supported) ||
		!supported.every((item) => typeof item === "string")
	) {
		return undefined;
	}
	const normalized = supported.map((item) => item.toLowerCase());
	return parameters.some((parameter) => normalized.includes(parameter));
}

function hasEffortLevels(value: unknown): boolean | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const effort = asRecord(value.effort);
	const levels = effort?.supported_levels;
	if (
		!Array.isArray(levels) ||
		!levels.every((item) => typeof item === "string")
	) {
		return undefined;
	}
	return levels.some((level) => level.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
