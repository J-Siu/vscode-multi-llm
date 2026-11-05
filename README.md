# Multi LLM

Configure multiple OpenAI-compatible endpoints, including DeepSeek, and act as Copilot Model Provider.

Disclaimer: This project is AI-generated.

## Command Palette

| Command Palette display name | Function |
| --- | --- |
| Multi LLM: Manage Sources | Opens source management to add or edit endpoints, refresh models, or open settings. |
| Multi LLM: Add Endpoint | Adds an endpoint and discovers its available models. |
| Multi LLM: Edit Source | Changes an endpoint's settings, API key, or model list. |
| Multi LLM: Delete Source | Deletes an endpoint and its saved API key after confirmation. |
| Multi LLM: Refresh Models from All Sources | Updates model lists from configured endpoints. |
| Multi LLM: Set API Key | Saves an endpoint's API key securely in VS Code. |
| Multi LLM: Remove API Key | Removes an endpoint's saved API key. |

## Configure sources

Open **Settings** and edit `Multi LLM: Sources` (setting ID: `multiLlm.sources`), or run **Multi LLM: Manage Sources**. Add one or more source objects:

To add an endpoint through the VS Code UI, run **Multi LLM: Add Endpoint** from the Command Palette, or select **Add Endpoint** from **Multi LLM: Manage Sources**. The wizard first asks for the provider: pick **DeepSeek** to use the official base URL, or **Custom endpoint** to enter a name and OpenAI-compatible base URL. It then asks for an API key and fetches the endpoint's model list. An API key is optional for endpoints that allow unauthenticated discovery; if a key is required, the wizard offers a retry with a key. Model IDs are discovered from the endpoint rather than entered manually. Keys are stored in VS Code SecretStorage.

To change an existing endpoint, run **Multi LLM: Edit Source** (also available from **Multi LLM: Manage Sources**) and pick the source. The wizard lets you switch the provider preset, rename the source, change the base URL, keep, replace, or remove the stored API key, and re-discover the model list. The source `id` and its stored key survive editing, so model references in chat keep working and no duplicate source is created. Existing model settings (token limits, capability overrides, reasoning effort) are preserved for models that are still offered by the endpoint. To delete an endpoint and its saved API key, run **Multi LLM: Delete Source** and confirm the deletion, or choose **Delete Source** from **Multi LLM: Manage Sources**.

```json
{
  "multiLlm.sources": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "models": [
        {
          "id": "gpt-4.1",
          "name": "GPT-4.1",
          "maxInputTokens": 1047576,
          "maxOutputTokens": 32768,
          "toolCalling": true,
          "autoDetectCapabilities": true
        }
      ]
    },
    {
      "id": "local",
      "name": "Local server",
      "baseUrl": "http://localhost:1234/v1",
      "models": [
        {
          "id": "qwen3",
          "maxInputTokens": 32768,
          "maxOutputTokens": 8192
        }
      ]
    }
  ]
}
```

`id` is a stable identifier used to associate the source with its key. It may contain letters, numbers, periods, underscores, and hyphens. `baseUrl` is the API root; requests are sent to `<baseUrl>/chat/completions`. HTTPS is required except for localhost endpoints used for local development. Model IDs are passed to the endpoint unchanged and are never used to guess capabilities. Input/output token limits and capabilities can be set per model; omitted limits default to 128,000 and 8,192, and tool calling defaults to enabled. Vision, reasoning, and token limits are detected from the metadata returned by the endpoint's `models` catalog (`input_modalities`, `effort`, `context_window`, `max_output_tokens`). If metadata is absent, vision and reasoning default to disabled. Set `autoDetectCapabilities` to `false` to use the explicit `imageInput` and `reasoning` flags instead. Detected capabilities appear in the model picker details. VS Code has no standard thinking capability flag; `reasoningEffort` optionally sends `reasoning_effort` (`none`, `low`, `medium`, `high`, or `max`) to endpoints that support it.

### DeepSeek

DeepSeek's API is OpenAI-compatible, so it is used as a regular source. Add it with **Multi LLM: Add Endpoint** and the **DeepSeek** provider option, or configure it directly:

```json
{
  "multiLlm.sources": [
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "baseUrl": "https://api.deepseek.com",
      "preset": "deepseek",
      "models": [{ "id": "deepseek-flash" }]
    }
  ]
}
```

`preset` selects DeepSeek-specific request handling. Sources without a preset are also treated as DeepSeek when their base URL host is `deepseek.com`. The preset adds the following behavior:

- Thinking mode is on by default for DeepSeek models. VS Code has no API for displaying thinking output, so `reasoning_content` is not shown in chat. It is cached and sent back on earlier assistant turns, which DeepSeek requires whenever a request carries tools.
- When earlier turns cannot be replayed, such as a chat resumed after a window reload, thinking mode is disabled for that request instead of failing with an error.
- `reasoningEffort` controls thinking: `none` disables thinking, and `low`, `medium`, `high`, or `max` set the effort (`medium` is mapped to `high` by DeepSeek). When thinking mode is disabled by the extension, `reasoning_effort` is not sent.
- Vision input is enabled only for models whose catalog metadata declares image support, such as `deepseek-flash`.
- Context and output limits come from the catalog metadata (`context_window` and `max_output_tokens`).

## API Keys Storage

Run **Multi LLM: Set API Key**, choose a configured source, and enter its key. Keys are saved using VS Code `SecretStorage` and are not written to settings. Sources without a key are still available for endpoints that allow unauthenticated requests. To rotate a key, run the set-key command again. Run **Multi LLM: Remove API Key** to delete a saved key.

## Refresh Models

Run **Multi LLM: Refresh Models from All Sources** to fetch each configured source's `/models` catalog, using its saved API key when available. Model IDs returned by the endpoint replace that source's configured list; existing display names and token limits are preserved, and catalog capability metadata is refreshed. New IDs are added with the token limits reported by the catalog when available, otherwise 128,000 input and 8,192 output tokens, and with tool calling enabled. Sources with failed/empty catalogs are left unchanged, while successful sources are updated. The endpoint must return an OpenAI-compatible `{ "data": [{ "id": "model-id" }] }` response. When the endpoint provides no vision/reasoning metadata, set `autoDetectCapabilities` to `false` and configure `imageInput`/`reasoning` manually if needed.

## Features and Limitations

- Sends streaming requests to OpenAI-compatible `/chat/completions` endpoints.
- Supports text, image input (as data URLs) when enabled for a model, and function/tool calls when enabled for a model.
- Supports DeepSeek thinking mode, including `reasoning_content` replay for tool calls.
- Token counts are estimates based on approximately four characters per token, not endpoint-specific tokenization.
- Thinking output is not displayed, because VS Code has no API for streaming reasoning parts.
- The extension uses the OpenAI Chat Completions wire format. Endpoints that implement only the Responses API or a different API schema are not compatible.
- API keys are sent to the configured endpoint as bearer credentials. Configure trusted endpoints only.

## Development

The OpenAI-compatible model-catalog and chat-completions wire types are defined in [`src/openai-compatible.d.ts`](./src/openai-compatible.d.ts). Built-in provider presets, such as DeepSeek, are defined in [`src/presets.ts`](./src/presets.ts).

### Install from source

```sh
git clone https://github.com/J-Siu/vscode-multi-llm.git
cd vscode-multi-llm
```

Generate the .vsix file:

```sh
npm ci
npm run package
```

Install the .vsix to VS Code:

```sh
code --install-extension multi-llm-1.0.0.vsix
```

You may need to reload VS Code.
