export interface ReasoningToolCall {
	readonly id: string;
	readonly name: string;
}

/**
 * DeepSeek requires the `reasoning_content` of earlier turns to be replayed
 * when a request carries tools. VS Code does not expose thinking content in
 * chat history, so responses are cached and matched against later requests.
 */
export function assistantMessageKey(
	text: string,
	toolCalls: readonly ReasoningToolCall[],
): string {
	return JSON.stringify([text, toolCalls.map((call) => [call.id, call.name])]);
}

export class ReasoningStore {
	private readonly entries = new Map<string, string>();

	constructor(private readonly maxEntries = 500) {}

	remember(key: string, reasoning: string): void {
		if (reasoning.length === 0) {
			return;
		}
		this.entries.delete(key);
		this.entries.set(key, reasoning);
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
	}

	recall(key: string): string | undefined {
		const reasoning = this.entries.get(key);
		if (reasoning !== undefined) {
			this.entries.delete(key);
			this.entries.set(key, reasoning);
		}
		return reasoning;
	}
}
