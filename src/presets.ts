export type ApiDialect = "openai" | "deepseek";

export interface SourcePreset {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly detail: string;
	readonly dialect: ApiDialect;
	readonly apiKeyPrompt: string;
}

export const sourcePresets: readonly SourcePreset[] = [
	{
		id: "deepseek",
		name: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		detail: "Thinking models with reasoning replay for tool calls.",
		dialect: "deepseek",
		apiKeyPrompt:
			"Enter your DeepSeek API key. Create one at https://platform.deepseek.com/api_keys.",
	},
];

export function findSourcePreset(id: string): SourcePreset | undefined {
	return sourcePresets.find((preset) => preset.id === id);
}

export function presetIds(): string[] {
	return sourcePresets.map((preset) => preset.id);
}

/**
 * DeepSeek sources need request handling for thinking mode, so they are
 * recognized either by the preset stored with the source or by their host.
 */
export function sourceDialect(source: {
	readonly preset?: string;
	readonly baseUrl: string;
}): ApiDialect {
	const preset = source.preset ? findSourcePreset(source.preset) : undefined;
	if (preset) {
		return preset.dialect;
	}
	return isDeepSeekHost(source.baseUrl) ? "deepseek" : "openai";
}

function isDeepSeekHost(baseUrl: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(baseUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
	return hostname === "deepseek.com" || hostname.endsWith(".deepseek.com");
}
