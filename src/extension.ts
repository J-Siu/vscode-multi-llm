import * as vscode from "vscode";
import {
	normalizeBaseUrl,
	parseSources,
	removeRawSource,
	replaceRawSource,
	SourceConfig,
} from "./config";
import {
	DiscoveredModel,
	fetchModels,
	mergeModelIds,
	modelConfigFromDiscovered,
} from "./modelCatalog";
import { SourcePreset, sourcePresets } from "./presets";
import { OpenAIChatProvider } from "./provider";

export function activate(context: vscode.ExtensionContext): void {
	const provider = new OpenAIChatProvider(context.secrets);
	const registration = vscode.lm.registerLanguageModelChatProvider(
		"multi-llm",
		provider,
	);

	context.subscriptions.push(
		registration,
		provider,
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("multiLlm.sources")) {
				provider.refresh();
			}
		}),
		vscode.commands.registerCommand("multiLlm.configureSources", async () => {
			const action = await vscode.window.showQuickPick(
				[
					{
						label: "Add Endpoint",
						description: "Add and configure another model source",
						command: "add",
					},
					{
						label: "Edit Source",
						description: "Change a configured source and its API key",
						command: "edit",
					},
					{
						label: "Delete Source",
						description: "Remove a source and its saved API key",
						command: "delete",
					},
					{
						label: "Refresh Models from All Sources",
						description: "Update model lists from configured endpoints",
						command: "refresh",
					},
					{
						label: "Open Sources Settings",
						description: "Edit source configuration directly",
						command: "settings",
					},
				],
				{ placeHolder: "Manage Multi LLM sources" },
			);
			if (action?.command === "add") {
				await addEndpoint(context, provider);
			} else if (action?.command === "edit") {
				await editSource(context, provider);
			} else if (action?.command === "delete") {
				await deleteSource(context, provider);
			} else if (action?.command === "refresh") {
				await refreshModels(context, provider);
			} else if (action?.command === "settings") {
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					"multiLlm.sources",
				);
			}
		}),
		vscode.commands.registerCommand("multiLlm.addEndpoint", async () => {
			await addEndpoint(context, provider);
		}),
		vscode.commands.registerCommand("multiLlm.editSource", async () => {
			await editSource(context, provider);
		}),
		vscode.commands.registerCommand("multiLlm.deleteSource", async () => {
			await deleteSource(context, provider);
		}),
		vscode.commands.registerCommand("multiLlm.refreshModels", async () => {
			await refreshModels(context, provider);
		}),
		vscode.commands.registerCommand("multiLlm.setApiKey", async () => {
			const sources = readSources();
			if (sources.length === 0) {
				void vscode.window.showWarningMessage(
					"Configure at least one source before setting an API key.",
				);
				return;
			}

			const source = await vscode.window.showQuickPick(
				sources.map((item) => ({
					label: item.name,
					description: item.id,
					sourceId: item.id,
				})),
				{ placeHolder: "Choose the source for this API key" },
			);
			if (!source) {
				return;
			}

			const apiKey = await vscode.window.showInputBox({
				prompt: `Enter the API key for ${source.label}`,
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) =>
					value.trim().length > 0 ? undefined : "API key cannot be empty.",
			});
			if (apiKey === undefined) {
				return;
			}

			await context.secrets.store(secretKey(source.sourceId), apiKey.trim());
			provider.refresh();
			void vscode.window.showInformationMessage(
				`API key saved securely for ${source.label}.`,
			);
		}),
		vscode.commands.registerCommand("multiLlm.removeApiKey", async () => {
			const sources = readSources();
			if (sources.length === 0) {
				void vscode.window.showWarningMessage(
					"No configured sources were found.",
				);
				return;
			}

			const source = await vscode.window.showQuickPick(
				sources.map((item) => ({
					label: item.name,
					description: item.id,
					sourceId: item.id,
				})),
				{ placeHolder: "Choose the source whose API key should be removed" },
			);
			if (!source) {
				return;
			}

			await context.secrets.delete(secretKey(source.sourceId));
			provider.refresh();
			void vscode.window.showInformationMessage(
				`API key removed for ${source.label}.`,
			);
		}),
	);
}

export function deactivate(): void {}

function readSources() {
	const value: unknown = vscode.workspace
		.getConfiguration("multiLlm")
		.get("sources", []);
	return parseSources(value);
}

function secretKey(sourceId: string): string {
	return `apiKey:${sourceId}`;
}

async function addEndpoint(
	context: vscode.ExtensionContext,
	provider: OpenAIChatProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("multiLlm");
	const rawSources: unknown = config.get("sources", []);
	const sources = parseSources(rawSources);

	const preset = await pickSourcePreset();
	if (preset === null) {
		return;
	}

	let name: string;
	let baseUrl: string;
	if (preset) {
		name = preset.name;
		baseUrl = preset.baseUrl;
	} else {
		const endpoint = await promptCustomEndpoint(sources);
		if (!endpoint) {
			return;
		}
		name = endpoint.name;
		baseUrl = endpoint.baseUrl;
	}

	const id = uniqueSourceId(name, sources);
	const apiKey = await vscode.window.showInputBox({
		title: preset ? "Add Model Endpoint (2/2)" : "Add Model Endpoint (4/4)",
		prompt:
			preset?.apiKeyPrompt ??
			"Enter an API key if required. Leave blank for endpoints that allow unauthenticated model discovery.",
		password: true,
		ignoreFocusOut: true,
	});
	if (apiKey === undefined) {
		return;
	}

	const source: SourceConfig = {
		id,
		name,
		baseUrl,
		...(preset ? { preset: preset.id } : {}),
		models: [],
	};
	const savedApiKey = apiKey.trim();
	const models = await discoverModels(source, savedApiKey);
	if (!models) {
		return;
	}

	const newSource = {
		id,
		name,
		baseUrl,
		...(preset ? { preset: preset.id } : {}),
		models: models.map(modelConfigFromDiscovered),
	};

	if (!Array.isArray(rawSources)) {
		throw new Error("The configured source list is invalid.");
	}
	await updateSourcesSetting(config, [...rawSources, newSource]);
	if (savedApiKey) {
		await context.secrets.store(secretKey(id), savedApiKey);
	}
	provider.refresh();
	void vscode.window.showInformationMessage(
		`Added ${name} with ${models.length} model${models.length === 1 ? "" : "s"}.`,
	);
}

async function editSource(
	context: vscode.ExtensionContext,
	provider: OpenAIChatProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("multiLlm");
	const rawSources: unknown = config.get("sources", []);
	const sources = parseSources(rawSources);
	if (sources.length === 0) {
		void vscode.window.showWarningMessage(
			"Configure at least one source before editing.",
		);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		sources.map((source) => ({
			label: source.name,
			description: formatSource(source),
			detail: presetLabel(source),
			source,
		})),
		{ title: "Edit Model Endpoint", placeHolder: "Choose the source to edit" },
	);
	if (!picked) {
		return;
	}
	const source = picked.source;

	const preset = await pickSourcePreset(source.preset);
	if (preset === null) {
		return;
	}

	let name = source.name;
	let baseUrl = source.baseUrl;
	if (preset) {
		name = presetDefaultName(source, preset);
		baseUrl = preset.baseUrl;
	}
	if (!preset) {
		const endpoint = await promptCustomEndpoint(sources, source.id, source);
		if (!endpoint) {
			return;
		}
		name = endpoint.name;
		baseUrl = endpoint.baseUrl;
	}

	const action = await vscode.window.showQuickPick(
		[
			{
				label: "Keep Current API Key",
				description: "Keep the key already stored for this source",
				command: "keep",
			},
			{
				label: "Enter New API Key",
				description: "Replace the stored key",
				command: "replace",
			},
			{
				label: "Remove API Key",
				description: "Request the endpoint without credentials",
				command: "remove",
			},
		],
		{
			title: "Edit Model Endpoint",
			placeHolder: "What should happen to the API key?",
		},
	);
	if (!action) {
		return;
	}

	let savedApiKey = await context.secrets.get(secretKey(source.id));
	if (action.command !== "keep") {
		if (action.command === "replace") {
			const apiKey = await vscode.window.showInputBox({
				title: "Edit Model Endpoint",
				prompt: preset?.apiKeyPrompt ?? "Enter the new API key.",
				password: true,
				ignoreFocusOut: true,
				validateInput: (value) =>
					value.trim().length > 0 ? undefined : "API key cannot be empty.",
			});
			if (apiKey === undefined) {
				return;
			}
			savedApiKey = apiKey.trim();
		} else {
			savedApiKey = undefined;
		}
	}

	const updated: SourceConfig = {
		...source,
		name,
		baseUrl,
		...(preset ? { preset: preset.id } : {}),
	};
	const models = await discoverModels(updated, savedApiKey ?? "");
	if (!models) {
		return;
	}

	const updatedSources = replaceRawSource(rawSources, source.id, {
		name,
		baseUrl,
		...(preset ? { preset: preset.id } : {}),
		models: mergeModelIds(models, source.models),
	});
	await updateSourcesSetting(config, updatedSources);

	if (action.command === "replace" && savedApiKey) {
		await context.secrets.store(secretKey(source.id), savedApiKey);
	} else if (action.command === "remove") {
		await context.secrets.delete(secretKey(source.id));
	}
	provider.refresh();
	void vscode.window.showInformationMessage(
		`Updated ${name} with ${models.length} model${models.length === 1 ? "" : "s"}.`,
	);
}

async function deleteSource(
	context: vscode.ExtensionContext,
	provider: OpenAIChatProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("multiLlm");
	const rawSources: unknown = config.get("sources", []);
	const sources = parseSources(rawSources);
	if (sources.length === 0) {
		void vscode.window.showWarningMessage(
			"Configure at least one source before deleting.",
		);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		sources.map((source) => ({
			label: source.name,
			description: formatSource(source),
			source,
		})),
		{ title: "Delete Model Endpoint", placeHolder: "Choose the source to delete" },
	);
	if (!picked) {
		return;
	}

	const confirmation = await vscode.window.showWarningMessage(
		`Delete ${picked.source.name} and its saved API key? This cannot be undone.`,
		{ modal: true },
		"Delete Source",
	);
	if (confirmation !== "Delete Source") {
		return;
	}

	await updateSourcesSetting(
		config,
		removeRawSource(rawSources, picked.source.id),
	);
	try {
		await context.secrets.delete(secretKey(picked.source.id));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		provider.refresh();
		void vscode.window.showErrorMessage(
			`Deleted ${picked.source.name}, but could not remove its saved API key: ${message}`,
		);
		return;
	}
	provider.refresh();
	void vscode.window.showInformationMessage(
		`Deleted ${picked.source.name} and its saved API key.`,
	);
}

/**
 * Returns the chosen preset, `undefined` for a custom endpoint, or `null` when
 * the wizard was cancelled. When editing, the source's current preset is
 * preselected.
 */
async function pickSourcePreset(
	currentPreset?: string,
): Promise<SourcePreset | undefined | null> {
	const presets = [
		...sourcePresets.filter((preset) => preset.id === currentPreset),
		...sourcePresets.filter((preset) => preset.id !== currentPreset),
	];
	const items = [
		...presets.map((preset) => ({
			label: preset.name,
			description: preset.baseUrl,
			detail: preset.detail,
			preset,
		})),
		{
			label: "Custom endpoint",
			description: "Any OpenAI-compatible API",
			detail: "Enter a name and base URL for another provider.",
			preset: undefined,
		},
	];
	const choice = await vscode.window.showQuickPick(items, {
		title: "Model Endpoint Provider",
		placeHolder: "Choose the API provider",
	});
	if (choice === undefined) {
		return null;
	}
	return choice.preset;
}

async function promptCustomEndpoint(
	sources: readonly SourceConfig[],
	id = uniqueSourceId("endpoint", sources),
	initial?: { readonly name: string; readonly baseUrl: string },
): Promise<{ name: string; baseUrl: string } | undefined> {
	const nameInput = await vscode.window.showInputBox({
		title: "Model Endpoint Name",
		prompt: "Enter a display name for this endpoint.",
		placeHolder: "OpenAI, Local LLM, Company API",
		value: initial?.name,
		ignoreFocusOut: true,
		validateInput: (value) =>
			value.trim().length > 0 ? undefined : "Enter an endpoint name.",
	});
	if (nameInput === undefined) {
		return undefined;
	}

	const baseUrlInput = await vscode.window.showInputBox({
		title: "Model Endpoint Base URL",
		prompt: "Enter the OpenAI-compatible API base URL.",
		placeHolder: "https://api.openai.com/v1",
		value: initial?.baseUrl,
		ignoreFocusOut: true,
		validateInput: (value) => {
			try {
				normalizeBaseUrl(value, id);
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		},
	});
	if (baseUrlInput === undefined) {
		return undefined;
	}
	return {
		name: nameInput.trim(),
		baseUrl: normalizeBaseUrl(baseUrlInput, id),
	};
}

/**
 * Fetches the model list, offering a retry with an API key when discovery
 * fails without credentials. Returns `undefined` when the user cancels or the
 * retry fails.
 */
async function discoverModels(
	source: SourceConfig,
	apiKey: string,
): Promise<DiscoveredModel[] | undefined> {
	try {
		return await fetchModelsWithOptionalKey(source, apiKey);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (apiKey) {
			void vscode.window.showErrorMessage(
				`Could not fetch models from ${source.name}: ${detail}`,
			);
			return undefined;
		}

		const choice = await vscode.window.showErrorMessage(
			`Could not fetch models from ${source.name}: ${detail}`,
			"Retry with API Key",
		);
		if (choice !== "Retry with API Key") {
			return undefined;
		}

		const retryApiKey = await vscode.window.showInputBox({
			title: `API Key for ${source.name}`,
			prompt: "Enter an API key to retry model discovery.",
			password: true,
			ignoreFocusOut: true,
			validateInput: (value) =>
				value.trim().length > 0 ? undefined : "Enter an API key to retry.",
		});
		if (retryApiKey === undefined) {
			return undefined;
		}
		try {
			return await fetchModelsWithOptionalKey(source, retryApiKey.trim());
		} catch (retryError) {
			const retryDetail =
				retryError instanceof Error ? retryError.message : String(retryError);
			void vscode.window.showErrorMessage(
				`Could not fetch models from ${source.name}: ${retryDetail}`,
			);
			return undefined;
		}
	}
}

/** Keeps a user-chosen name, otherwise adopts the preset name. */
function presetDefaultName(
	source: SourceConfig,
	preset: SourcePreset,
): string {
	const previous = source.preset
		? sourcePresets.find((item) => item.id === source.preset)
		: undefined;
	const custom =
		source.name !== previous?.name && source.name !== preset.name;
	return custom ? source.name : preset.name;
}

function presetLabel(source: SourceConfig): string {
	const preset = source.preset
		? sourcePresets.find((item) => item.id === source.preset)
		: undefined;
	return preset
		? `Provider: ${preset.name}`
		: "Provider: custom OpenAI-compatible endpoint";
}

function formatSource(source: SourceConfig): string {
	const count = source.models.length;
	return `${source.id} · ${source.baseUrl} · ${count} model${count === 1 ? "" : "s"}`;
}

function uniqueSourceId(
	name: string,
	sources: readonly SourceConfig[],
): string {
	const base =
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "endpoint";
	const ids = new Set(sources.map((source) => source.id));
	if (!ids.has(base)) {
		return base;
	}
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) {
		suffix++;
	}
	return `${base}-${suffix}`;
}

async function fetchModelsWithOptionalKey(
	source: SourceConfig,
	apiKey: string,
): Promise<DiscoveredModel[]> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Fetching models from ${source.name}`,
		},
		() => fetchModels(source, apiKey),
	);
}

async function refreshModels(
	context: vscode.ExtensionContext,
	provider: OpenAIChatProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("multiLlm");
	const rawSources: unknown = config.get("sources", []);
	const sources = parseSources(rawSources);
	if (sources.length === 0) {
		void vscode.window.showWarningMessage(
			"Configure at least one source before refreshing model lists.",
		);
		return;
	}

	const refreshed = new Map<string, ReturnType<typeof mergeModelIds>>();
	const failures: string[] = [];
	for (const source of sources) {
		try {
			const apiKey = await context.secrets.get(secretKey(source.id));
			const models = await fetchModels(source, apiKey);
			refreshed.set(source.id, mergeModelIds(models, source.models));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push(`${source.name}: ${message}`);
		}
	}

	if (refreshed.size === 0) {
		void vscode.window.showErrorMessage(
			`No model lists were updated. ${failures.join(" ")}`,
		);
		return;
	}
	if (!Array.isArray(rawSources)) {
		throw new Error(
			"The configured source list changed while refreshing models.",
		);
	}

	const updatedSources = rawSources.map((rawSource, index) => {
		if (
			typeof rawSource !== "object" ||
			rawSource === null ||
			Array.isArray(rawSource)
		) {
			throw new Error(`Source at index ${index} is invalid.`);
		}
		const source = sources[index];
		const models = refreshed.get(source.id);
		return models ? { ...rawSource, models } : rawSource;
	});

	await updateSourcesSetting(config, updatedSources);
	provider.refresh();

	const successMessage = `Updated model lists for ${refreshed.size} of ${sources.length} source${sources.length === 1 ? "" : "s"}.`;
	if (failures.length > 0) {
		void vscode.window.showWarningMessage(
			`${successMessage} ${failures.join(" ")}`,
		);
	} else {
		void vscode.window.showInformationMessage(successMessage);
	}
}

async function updateSourcesSetting(
	config: vscode.WorkspaceConfiguration,
	sources: unknown[],
): Promise<void> {
	const inspection = config.inspect<unknown>("sources");
	if (inspection?.workspaceFolderValue !== undefined) {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			throw new Error(
				"Cannot update workspace-folder sources without an open workspace folder.",
			);
		}
		await vscode.workspace
			.getConfiguration("multiLlm", folder.uri)
			.update("sources", sources, vscode.ConfigurationTarget.WorkspaceFolder);
	} else if (inspection?.workspaceValue !== undefined) {
		await config.update(
			"sources",
			sources,
			vscode.ConfigurationTarget.Workspace,
		);
	} else {
		await config.update("sources", sources, vscode.ConfigurationTarget.Global);
	}
}
