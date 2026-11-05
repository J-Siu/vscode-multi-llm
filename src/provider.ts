import * as vscode from "vscode";
import { ModelConfig, parseSources, SourceConfig } from "./config";
import {
	OpenAIChatCompletionRequest,
	OpenAIChatCompletionTool,
	OpenAIChatRequestMessage,
	OpenAIImageContentPart,
	OpenAITextContentPart,
} from "./openai-compatible";
import { ApiDialect, sourceDialect } from "./presets";
import { assistantMessageKey, ReasoningStore } from "./reasoning";

const secretPrefix = "apiKey:";

interface ProviderModel extends vscode.LanguageModelChatInformation {
	readonly sourceId: string;
	readonly modelId: string;
	readonly baseUrl: string;
}

interface StreamToolCall {
	id: string;
	name: string;
	arguments: string;
}

interface StreamedMessage {
	text: string;
	reasoning: string;
}

interface ConvertedMessages {
	readonly messages: OpenAIChatRequestMessage[];
	readonly missingReasoning: boolean;
}

export class OpenAIChatProvider
	implements vscode.LanguageModelChatProvider<ProviderModel>, vscode.Disposable
{
	private readonly informationChanged = new vscode.EventEmitter<void>();
	private readonly reasonings = new ReasoningStore();
	readonly onDidChangeLanguageModelChatInformation =
		this.informationChanged.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	dispose(): void {
		this.informationChanged.dispose();
	}

	refresh(): void {
		this.informationChanged.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken,
	): Promise<ProviderModel[]> {
		const sources = readSources();
		const models: ProviderModel[] = [];
		for (const source of sources) {
			if (token.isCancellationRequested) {
				return models;
			}
			models.push(
				...source.models.map((model) => toProviderModel(source, model)),
			);
		}
		return models;
	}

	async provideLanguageModelChatResponse(
		model: ProviderModel,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const sources = readSources();
		const source = sources.find((item) => item.id === model.sourceId);
		const sourceModel = source?.models.find(
			(item) => item.id === model.modelId,
		);
		if (!source || !sourceModel || source.baseUrl !== model.baseUrl) {
			throw new Error(
				"This model configuration has changed. Refresh the model list and try again.",
			);
		}

		const apiKey = await this.secrets.get(`${secretPrefix}${source.id}`);
		const dialect = sourceDialect(source);

		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() =>
			controller.abort(),
		);
		try {
			const response = await fetchWithoutAuthorization(
				`${source.baseUrl}/chat/completions`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						Accept: "text/event-stream",
					},
					body: JSON.stringify(
						buildRequest(
							sourceModel,
							messages,
							options,
							dialect,
							this.reasonings,
						),
					),
					signal: controller.signal,
					redirect: "error",
				},
				Boolean(apiKey),
			);

			if (!response.ok) {
				const responseText = await response.text();
				throw new Error(
					`Request to "${source.name}" failed (${response.status} ${response.statusText}): ${responseText.slice(0, 1000)}`,
				);
			}
			if (!response.body) {
				throw new Error(
					`The endpoint for "${source.name}" returned an empty response stream.`,
				);
			}

			const streamed = await consumeEventStream(
				response.body,
				progress,
				token,
				source.name,
			);
			if (dialect === "deepseek") {
				this.reasonings.remember(
					assistantMessageKey(streamed.text, streamed.toolCalls),
					streamed.reasoning,
				);
			}
		} catch (error) {
			if (
				token.isCancellationRequested ||
				(error instanceof Error && error.name === "AbortError")
			) {
				throw new Error("The language model request was cancelled.");
			}
			throw error;
		} finally {
			cancellation.dispose();
		}
	}

	async provideTokenCount(
		_model: ProviderModel,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		const value = typeof text === "string" ? text : messageText(text);
		return Math.ceil(value.length / 4);
	}
}

function readSources(): SourceConfig[] {
	const value: unknown = vscode.workspace
		.getConfiguration("multiLlm")
		.get("sources", []);
	return parseSources(value);
}

function fetchWithoutAuthorization(
	url: string,
	init: RequestInit,
	hasApiKey: boolean,
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (!hasApiKey) {
		headers.delete("Authorization");
	}
	return fetch(url, { ...init, headers });
}

function toProviderModel(
	source: SourceConfig,
	model: ModelConfig,
): ProviderModel {
	const imageInput = model.autoDetectCapabilities
		? (model.capabilityMetadata?.imageInput ?? false)
		: Boolean(model.imageInput);
	const reasoning = model.autoDetectCapabilities
		? (model.capabilityMetadata?.reasoning ?? false)
		: Boolean(model.reasoning);
	return {
		id: `${encodeURIComponent(source.id)}/${encodeURIComponent(model.id)}`,
		name: `${source.name} · ${model.name}`,
		family: model.id,
		version: model.id,
		detail: [
			imageInput ? "Vision" : undefined,
			reasoning ? "Reasoning" : undefined,
		]
			.filter(Boolean)
			.join(" · "),
		tooltip: `${source.name} (${source.baseUrl})${imageInput ? " · Vision input" : ""}${reasoning ? " · Reasoning model" : ""}`,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		capabilities: { toolCalling: model.toolCalling, imageInput },
		sourceId: source.id,
		modelId: model.id,
		baseUrl: source.baseUrl,
	};
}

function buildRequest(
	model: ModelConfig,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: vscode.ProvideLanguageModelChatResponseOptions,
	dialect: ApiDialect,
	reasonings: ReasoningStore,
): Record<string, unknown> {
	if (options.tools?.length && !model.toolCalling) {
		throw new Error("Tool calling is disabled for this model.");
	}
	if (
		options.toolMode === vscode.LanguageModelChatToolMode.Required &&
		(!model.toolCalling || !options.tools?.length)
	) {
		throw new Error(
			"This request requires a tool call, but no tools are available for this model.",
		);
	}

	const tools: OpenAIChatCompletionTool[] | undefined =
		model.toolCalling && options.tools?.length
			? options.tools.map((tool) => ({
					type: "function",
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.inputSchema ?? { type: "object", properties: {} },
					},
				}))
			: undefined;
	// DeepSeek requires the reasoning content of earlier turns to be replayed
	// whenever tools are sent, and rejects the request when it is missing.
	const replayReasoning = dialect === "deepseek" && tools !== undefined;
	const converted = convertMessages(
		model,
		messages,
		replayReasoning ? reasonings : undefined,
	);
	const thinkingDisabled = replayReasoning && converted.missingReasoning;
	const reasoningEffort = thinkingDisabled ? undefined : model.reasoningEffort;
	return {
		...options.modelOptions,
		model: model.id,
		messages: converted.messages,
		stream: true,
		max_tokens: model.maxOutputTokens,
		...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
		...(thinkingDisabled ? { thinking: { type: "disabled" } } : {}),
		...(tools ? { tools } : {}),
		...(tools && options.toolMode === vscode.LanguageModelChatToolMode.Required
			? { tool_choice: "required" }
			: {}),
	} satisfies OpenAIChatCompletionRequest;
}

function convertMessages(
	model: ModelConfig,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	reasonings?: ReasoningStore,
): ConvertedMessages {
	const output: OpenAIChatRequestMessage[] = [];
	let missingReasoning = false;
	for (const message of messages) {
		const isAssistant =
			message.role === vscode.LanguageModelChatMessageRole.Assistant;
		const role = isAssistant ? "assistant" : "user";
		const content: Array<OpenAITextContentPart | OpenAIImageContentPart> = [];
		const toolCalls: NonNullable<
			OpenAIChatRequestMessage["tool_calls"]
		>[number][] = [];
		const toolResults: Array<{ callId: string; text: string }> = [];
		let text = "";

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				text += part.value;
				content.push({ type: "text", text: part.value });
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (part.mimeType.startsWith("image/")) {
					const imageInput = model.autoDetectCapabilities
						? (model.capabilityMetadata?.imageInput ?? false)
						: Boolean(model.imageInput);
					if (!imageInput) {
						throw new Error(`Image input is disabled for model "${model.id}".`);
					}
					content.push({
						type: "image_url",
						image_url: {
							url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`,
						},
					});
				} else {
					content.push({
						type: "text",
						text: Buffer.from(part.data).toString("utf8"),
					});
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: "function",
					function: { name: part.name, arguments: JSON.stringify(part.input) },
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolResults.push({ callId: part.callId, text: toolResultText(part) });
			} else {
				throw new Error(
					"This message contains a content type that OpenAI-compatible endpoints cannot process.",
				);
			}
		}

		const hasAssistantContent = text.length > 0 || toolCalls.length > 0;
		const reasoning =
			reasonings && isAssistant && hasAssistantContent
				? reasonings.recall(
						assistantMessageKey(
							text,
							toolCalls.map((call) => ({
								id: call.id,
								name: call.function.name,
							})),
						),
					)
				: undefined;
		if (reasonings && isAssistant && hasAssistantContent && !reasoning) {
			missingReasoning = true;
		}

		if (content.length > 0 || toolCalls.length > 0) {
			output.push({
				role,
				content: content.length > 0 ? content : null,
				...(reasoning ? { reasoning_content: reasoning } : {}),
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			});
		}
		for (const result of toolResults) {
			output.push({
				role: "tool",
				tool_call_id: result.callId,
				content: result.text,
			});
		}
	}
	return { messages: output, missingReasoning };
}

function toolResultText(result: vscode.LanguageModelToolResultPart): string {
	return result.content
		.map((part) => {
			if (part instanceof vscode.LanguageModelTextPart) {
				return part.value;
			}
			if (
				part instanceof vscode.LanguageModelDataPart &&
				part.mimeType.startsWith("text/")
			) {
				return Buffer.from(part.data).toString("utf8");
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function messageText(message: vscode.LanguageModelChatRequestMessage): string {
	return message.content
		.map((part) => {
			if (part instanceof vscode.LanguageModelTextPart) {
				return part.value;
			}
			if (part instanceof vscode.LanguageModelToolCallPart) {
				return JSON.stringify(part.input);
			}
			if (part instanceof vscode.LanguageModelToolResultPart) {
				return toolResultText(part);
			}
			if (part instanceof vscode.LanguageModelDataPart) {
				return Buffer.from(part.data).toString("utf8");
			}
			return "";
		})
		.join(" ");
}

async function consumeEventStream(
	body: ReadableStream<Uint8Array>,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	token: vscode.CancellationToken,
	sourceName: string,
): Promise<{ text: string; reasoning: string; toolCalls: StreamToolCall[] }> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const toolCalls = new Map<number, StreamToolCall>();
	const streamed: StreamedMessage = { text: "", reasoning: "" };
	let buffer = "";
	let finished = false;

	try {
		while (!finished) {
			if (token.isCancellationRequested) {
				await reader.cancel();
				throw new Error("The language model request was cancelled.");
			}

			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });

			let boundary: number;
			while ((boundary = buffer.indexOf("\n")) >= 0) {
				let line = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 1);
				if (line.endsWith("\r")) {
					line = line.slice(0, -1);
				}
				if (!line.startsWith("data:")) {
					continue;
				}

				const data = line.slice(5).trim();
				if (data === "[DONE]") {
					finished = true;
					break;
				}
				if (data.length === 0) {
					continue;
				}

				processEventData(data, progress, toolCalls, sourceName, streamed);
			}
		}
		buffer += decoder.decode();
		if (!finished && buffer.startsWith("data:")) {
			const data = buffer.slice(5).trim();
			if (data !== "[DONE]" && data.length > 0) {
				processEventData(data, progress, toolCalls, sourceName, streamed);
			}
		}
	} finally {
		reader.releaseLock();
	}

	for (const [index, call] of [...toolCalls.entries()].sort(
		(a, b) => a[0] - b[0],
	)) {
		if (!call.id || !call.name) {
			throw new Error(
				`The endpoint for "${sourceName}" returned an incomplete tool call at index ${index}.`,
			);
		}
		let input: object;
		try {
			const parsed: unknown = JSON.parse(call.arguments);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				throw new Error("Tool arguments must be a JSON object.");
			}
			input = parsed as object;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(
				`The endpoint for "${sourceName}" returned invalid arguments for tool call ${index}: ${detail}`,
			);
		}
		progress.report(
			new vscode.LanguageModelToolCallPart(call.id, call.name, input),
		);
	}

	return {
		text: streamed.text,
		reasoning: streamed.reasoning,
		toolCalls: [...toolCalls.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, call]) => call),
	};
}

function processEventData(
	data: string,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	toolCalls: Map<number, StreamToolCall>,
	sourceName: string,
	streamed: StreamedMessage,
): void {
	let event: unknown;
	try {
		event = JSON.parse(data);
	} catch {
		throw new Error(
			`The endpoint for "${sourceName}" returned invalid streaming data.`,
		);
	}
	if (isRecord(event) && "error" in event) {
		const detail =
			isRecord(event.error) && typeof event.error.message === "string"
				? event.error.message
				: JSON.stringify(event.error);
		throw new Error(
			`The endpoint for "${sourceName}" returned a streaming error: ${detail}`,
		);
	}
	processStreamEvent(event, progress, toolCalls, streamed);
}

function processStreamEvent(
	value: unknown,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	toolCalls: Map<number, StreamToolCall>,
	streamed: StreamedMessage,
): void {
	if (!isRecord(value)) {
		throw new Error("The endpoint returned an invalid streaming event.");
	}
	const choices = value.choices;
	if (!Array.isArray(choices) || !isRecord(choices[0])) {
		return;
	}
	const delta = choices[0].delta;
	if (!isRecord(delta)) {
		return;
	}

	if (typeof delta.reasoning_content === "string") {
		streamed.reasoning += delta.reasoning_content;
	}

	if (typeof delta.content === "string" && delta.content.length > 0) {
		streamed.text += delta.content;
		progress.report(new vscode.LanguageModelTextPart(delta.content));
	} else if (Array.isArray(delta.content)) {
		for (const part of delta.content) {
			if (
				isRecord(part) &&
				typeof part.text === "string" &&
				part.text.length > 0
			) {
				streamed.text += part.text;
				progress.report(new vscode.LanguageModelTextPart(part.text));
			}
		}
	}

	if (Array.isArray(delta.tool_calls)) {
		for (const rawCall of delta.tool_calls) {
			if (!isRecord(rawCall) || typeof rawCall.index !== "number") {
				continue;
			}
			const current = toolCalls.get(rawCall.index) ?? {
				id: "",
				name: "",
				arguments: "",
			};
			if (typeof rawCall.id === "string") {
				current.id += rawCall.id;
			}
			if (isRecord(rawCall.function)) {
				if (typeof rawCall.function.name === "string") {
					current.name += rawCall.function.name;
				}
				if (typeof rawCall.function.arguments === "string") {
					current.arguments += rawCall.function.arguments;
				}
			}
			toolCalls.set(rawCall.index, current);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
