import type { ReasoningEffort } from "./config";

export interface OpenAIModelEffort {
	readonly supported_levels?: readonly string[];
	readonly default_level?: string;
	readonly [key: string]: unknown;
}

export interface OpenAIModelArchitecture {
	readonly input_modalities?: readonly string[];
	readonly inputModalities?: readonly string[];
	readonly modalities?: readonly string[];
	readonly [key: string]: unknown;
}

export interface OpenAIModelCapabilities {
	readonly imageInput?: boolean;
	readonly image_input?: boolean;
	readonly vision?: boolean;
	readonly supports_vision?: boolean;
	readonly supportsVision?: boolean;
	readonly reasoning?: boolean;
	readonly thinking?: boolean;
	readonly supports_reasoning?: boolean;
	readonly supportsReasoning?: boolean;
	readonly supportsThinking?: boolean;
	readonly [key: string]: unknown;
}

export interface OpenAIModelRecord {
	readonly id: string;
	readonly name?: string;
	readonly architecture?: OpenAIModelArchitecture;
	readonly capabilities?: OpenAIModelCapabilities;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly supported_parameters?: readonly string[];
	readonly context_window?: number;
	readonly max_output_tokens?: number;
	readonly input_modalities?: readonly string[];
	readonly effort?: OpenAIModelEffort;
	readonly [key: string]: unknown;
}

export interface OpenAIModelCatalogResponse {
	readonly data: readonly unknown[];
	readonly [key: string]: unknown;
}

export interface OpenAITextContentPart {
	readonly type: "text";
	readonly text: string;
}

export interface OpenAIImageContentPart {
	readonly type: "image_url";
	readonly image_url: {
		readonly url: string;
	};
}

export interface OpenAIFunctionToolCall {
	readonly id: string;
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export interface OpenAIChatRequestMessage {
	readonly role: "user" | "assistant" | "tool";
	readonly content?:
		| string
		| readonly (OpenAITextContentPart | OpenAIImageContentPart)[]
		| null;
	readonly reasoning_content?: string;
	readonly tool_calls?: readonly OpenAIFunctionToolCall[];
	readonly tool_call_id?: string;
}

export interface OpenAIChatCompletionTool {
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: object;
	};
}

export interface OpenAIChatCompletionRequest {
	readonly model: string;
	readonly messages: readonly OpenAIChatRequestMessage[];
	readonly stream: true;
	readonly max_tokens: number;
	readonly tools?: readonly OpenAIChatCompletionTool[];
	readonly tool_choice?: "required";
	readonly reasoning_effort?: ReasoningEffort;
	readonly thinking?: { readonly type: "enabled" | "disabled" };
	readonly [key: string]: unknown;
}
