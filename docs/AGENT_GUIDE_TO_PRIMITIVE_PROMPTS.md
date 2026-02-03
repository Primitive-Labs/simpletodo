# Prompt Feature Guide for Coding Agents

This guide explains the Primitive CLI prompt system—how to create, configure, test, and manage LLM prompts using the `primitive` CLI.

## Overview

The prompt feature provides:

- **Prompt definitions** with multiple configurations (different models, providers, parameters)
- **Template-based prompts** with variable substitution using `{{ }}` syntax
- **Test cases** with verification (pattern matching, contains checks, JSON subset matching, LLM-based evaluation)
- **Versioning** via multiple configs per prompt
- **TOML file sync** for version-controlled prompt management

## Publishing Prompts

**Important:** Prompts must be set to `active` status before they can be called from workflows or the client.

By default, new prompts are created with `status = "draft"`. Draft prompts can be tested using the CLI but cannot be executed in production workflows.

### Prompt Status Lifecycle

| Status     | Can Execute from Workflow | Can Test via CLI | Editable |
| ---------- | ------------------------- | ---------------- | -------- |
| `draft`    | No                        | Yes              | Yes      |
| `active`   | Yes                       | Yes              | Yes      |
| `archived` | No                        | No               | No       |

### Activating a Prompt

**Option 1: Via TOML file**

```toml
[prompt]
key = "my-prompt"
status = "active"  # Change from "draft" to "active"
```

Then push with `primitive sync push --dir ./config`

**Option 2: Via CLI**

```bash
primitive prompts update <prompt-id> --status active
```

### Common Error

If you see `HTTP 404: Workflow not found` when running a workflow that uses a prompt, check:

1. The prompt exists and has `status = "active"` (not `draft`)
2. The workflow exists and has `status = "active"` (not `draft`)
3. The workflow has been published (use `primitive workflows publish <workflow-id>`)

## Template Syntax

Prompts use `{{ }}` double-brace syntax for variable interpolation.

### Basic Variable Access

```
{{ input.variableName }}
```

### Nested Properties

```
{{ input.user.name }}
{{ input.data.nested.value }}
```

### Array Access

```
{{ input.items[0] }}
{{ input.attachments[0].name }}
{{ input.users[2].email }}
```

### Fallback Values

Use `||` to provide fallback values when a variable is empty or undefined:

```
{{ input.text || "default value" }}
{{ input.name || input.username || "Anonymous" }}
{{ input.count || 0 }}
```

### Template Context

When templates are rendered, they have access to this context structure:

```typescript
{
  input: Record<string, any>,     // User-provided variables
  selected: any,                  // Alias for input
  steps: Record<string, any>,     // Workflow step outputs (when used in workflows)
  outputs: Record<string, any>,   // Workflow outputs
  meta: Record<string, any>       // Metadata
}
```

Most prompts access variables via `input.*`:

```
User request: {{ input.userMessage }}
Document content: {{ input.documentText }}
```

### Raw Value Preservation

If the entire template is a single expression, arrays and objects are preserved (not stringified):

```
{{ input.items }}       // Returns the actual array
{{ input.config }}      // Returns the actual object
```

If mixed with other text, values are converted to strings:

```
Items: {{ input.items }}  // Converts array to string
```

---

## TOML File Format

Prompts can be defined in TOML files for version control and batch sync.

### Basic Structure

```toml
[prompt]
key = "my-prompt-key"
displayName = "Human Readable Name"
description = "What this prompt does"
status = "draft"  # draft | active | archived
inputSchema = '{"type": "object", "properties": {"text": {"type": "string"}}}'  # Optional

[[configs]]
name = "default"
description = "Default configuration"
provider = "gemini"  # gemini | openrouter
model = "models/gemini-3-flash-preview"
temperature = "0.7"
systemPrompt = "You are a helpful assistant."
userPromptTemplate = "Respond to: {{ input.text }}"
```

### Prompt Section Fields

| Field          | Required | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| `key`          | Yes      | Unique identifier within the app (use kebab-case) |
| `displayName`  | Yes      | Human-readable name                               |
| `description`  | No       | Description of what the prompt does               |
| `status`       | No       | `draft` (default), `active`, or `archived`        |
| `inputSchema`  | No       | JSON Schema string for input validation           |
| `outputSchema` | No       | JSON Schema string for structured output          |

### Config Section Fields

| Field                | Required | Description                              |
| -------------------- | -------- | ---------------------------------------- |
| `name`               | Yes      | Config name (unique within prompt)       |
| `description`        | No       | Description of this configuration        |
| `provider`           | Yes      | `gemini` or `openrouter`                 |
| `model`              | Yes      | Model identifier                         |
| `userPromptTemplate` | Yes      | User prompt with `{{ }}` variables       |
| `systemPrompt`       | No       | System prompt                            |
| `temperature`        | No       | Temperature as string (e.g., `"0.7"`)    |
| `topP`               | No       | Top-p sampling as string (e.g., `"0.9"`) |
| `maxTokens`          | No       | Max output tokens (integer)              |
| `outputFormat`       | No       | `text` (default) or `json`               |

### Multiple Configs Example

```toml
[prompt]
key = "summarizer"
displayName = "Document Summarizer"

[[configs]]
name = "default"
provider = "gemini"
model = "models/gemini-3-flash-preview"
temperature = "0.3"
userPromptTemplate = "Summarize: {{ input.text }}"

[[configs]]
name = "creative"
provider = "gemini"
model = "models/gemini-3-pro-preview"
temperature = "0.8"
userPromptTemplate = "Write an engaging summary of: {{ input.text }}"

[[configs]]
name = "openrouter-claude"
provider = "openrouter"
model = "anthropic/claude-3-5-sonnet"
temperature = "0.5"
userPromptTemplate = "Provide a concise summary: {{ input.text }}"
```

### Evaluator Prompt Example

Evaluator prompts judge other prompt outputs:

```toml
[prompt]
key = "output-evaluator"
displayName = "Output Evaluator"

[[configs]]
name = "default"
provider = "gemini"
model = "models/gemini-3-flash-preview"
temperature = "1"
systemPrompt = "You are an evaluator that judges the quality of LLM outputs."
userPromptTemplate = """
**Output to Evaluate:**
{{ input.output }}

Respond with JSON:
{
  "passed": true,
  "reasoning": "Brief overall assessment",
  "checks": [
    {"name": "Check Name", "passed": true, "message": "Explanation"}
  ]
}
"""
```

---

## CLI Commands Reference

All commands are under `primitive prompts`. Most commands require an app context—set it with `primitive use <app-id>` or pass `--app <app-id>`.

### Prompt CRUD Operations

#### List Prompts

```bash
primitive prompts list [app-id] [--status draft|active|archived] [--json]
```

#### Create Prompt

From CLI flags:

```bash
primitive prompts create [app-id] \
  --key "my-prompt" \
  --name "My Prompt" \
  --provider gemini \
  --model "models/gemini-3-flash-preview" \
  --user-template "Generate: {{ input.text }}" \
  [--system-prompt "You are helpful."] \
  [--temperature "0.7"] \
  [--max-tokens 1000] \
  [--output-format text|json] \
  [--input-schema '{"type": "object", ...}'] \
  [--output-schema '{"type": "object", ...}']
```

From TOML file:

```bash
primitive prompts create [app-id] --from-file ./my-prompt.toml
```

#### Get Prompt Details

```bash
primitive prompts get <prompt-id> [--json]
```

#### Update Prompt Metadata

```bash
primitive prompts update <prompt-id> \
  [--name "New Name"] \
  [--description "New description"] \
  [--status draft|active|archived] \
  [--input-schema '{"type": "object", ...}'] \
  [--output-schema '{"type": "object", ...}']
```

#### Delete/Archive Prompt

```bash
primitive prompts delete <prompt-id> [-y]        # Archive (soft delete)
primitive prompts delete <prompt-id> --hard [-y]  # Permanent delete
```

### Prompt Execution

#### Execute a Prompt

```bash
primitive prompts execute <prompt-id> \
  --vars '{"text": "Hello world"}' \
  [--config <config-id>] \
  [--json]
```

#### Preview Rendered Prompt (Without Executing)

```bash
primitive prompts preview <prompt-id> \
  --vars '{"text": "Hello world"}' \
  [--config <config-id>] \
  [--json]
```

#### Get Prompt Schema

```bash
primitive prompts schema <prompt-id> [--json]
```

### Config Management

#### List Configs

```bash
primitive prompts configs list <prompt-id> [--json]
```

#### Create Config

```bash
primitive prompts configs create <prompt-id> \
  --name "config-name" \
  --provider gemini \
  --model "models/gemini-3-flash-preview" \
  --user-template "Template: {{ input.text }}" \
  [--system-prompt "System prompt"] \
  [--temperature "0.7"] \
  [--max-tokens 1000] \
  [--output-format text|json]
```

#### Update Config

```bash
primitive prompts configs update <prompt-id> <config-id> \
  [--name "new-name"] \
  [--model "new-model"] \
  [--temperature "0.5"] \
  [--system-prompt "New system prompt"] \
  [--user-template "New template: {{ input.text }}"] \
  [--status active|archived]
```

#### Activate a Config

Sets a config as the default for prompt execution:

```bash
primitive prompts configs activate <prompt-id> <config-id>
```

#### Duplicate a Config

```bash
primitive prompts configs duplicate <prompt-id> <config-id> [--name "new-name"]
```

### Test Case Management

#### List Test Cases

```bash
primitive prompts tests list <prompt-id> [--json]
```

#### Create Test Case

```bash
primitive prompts tests create <prompt-id> \
  --name "Test Name" \
  --vars '{"text": "test input"}' \
  [--pattern "regex-pattern"] \
  [--contains '["expected", "strings"]'] \
  [--json-subset '{"key": "value"}'] \
  [--config <config-id>] \
  [--evaluator-prompt <prompt-id>] \
  [--evaluator-config <config-id>]
```

#### Get Test Case

```bash
primitive prompts tests get <prompt-id> <test-case-id> [--json]
```

#### Update Test Case

```bash
primitive prompts tests update <prompt-id> <test-case-id> \
  [--name "Updated Name"] \
  [--vars '{"text": "new input"}'] \
  [--pattern "new-regex"] \
  [--contains '["new", "strings"]'] \
  [--json-subset '{"new": "value"}'] \
  [--config <config-id>] \
  [--clear-pattern] \
  [--clear-contains] \
  [--clear-json-subset]
```

#### Delete Test Case

```bash
primitive prompts tests delete <prompt-id> <test-case-id> [-y]
```

### Running Tests

#### Run Single Test

```bash
primitive prompts tests run <prompt-id> <test-case-id> [--config <config-id>] [--json]
```

#### Run All Tests

```bash
primitive prompts tests run-all <prompt-id> \
  [--config <config-id>] \
  [--test-cases "id1,id2,id3"] \
  [--json]
```

#### List Test Run History

```bash
primitive prompts tests runs <prompt-id> [--limit 20] [--group <comparison-group>] [--json]
```

### Test Case Attachments

For prompts that process files (e.g., PDF summarizer):

```bash
# List attachments
primitive prompts tests attachments list <prompt-id> <test-case-id>

# Upload attachment
primitive prompts tests attachments upload <prompt-id> <test-case-id> ./document.pdf [--name "custom.pdf"]

# Download attachment
primitive prompts tests attachments download <prompt-id> <test-case-id> document.pdf [output-path]

# Delete attachment
primitive prompts tests attachments delete <prompt-id> <test-case-id> document.pdf [-y]
```

---

## Sync Commands

Sync prompts from TOML files in a config directory.

### Directory Structure

```
config/
├── prompts/
│   ├── summarizer.toml
│   ├── translator.toml
│   └── evaluator.toml
├── workflows/
│   └── ...
└── .primitive-sync.json  # Auto-generated sync state
```

### Pull Configuration from Server

```bash
primitive sync pull [app-id] [--dir ./config]
```

Downloads prompts, workflows, and integrations to TOML files.

### Push Configuration to Server

```bash
primitive sync push [app-id] [--dir ./config] [--dry-run]
```

Creates or updates prompts from TOML files. Use `--dry-run` to preview changes.

---

## Test Case Verification Types

### Pattern Matching (Regex)

```bash
--pattern "^Hello.*world$"
```

### Contains Check

```bash
--contains '["expected phrase", "another phrase"]'
```

All strings must appear in the output.

### JSON Subset Matching

```bash
--json-subset '{"status": "success", "data": {"valid": true}}'
```

Output JSON must contain matching keys/values.

### LLM-Based Evaluation

Use an evaluator prompt to judge output quality:

```bash
--evaluator-prompt <evaluator-prompt-id> [--evaluator-config <config-id>]
```

The evaluator prompt receives `{{ input.output }}` containing the generated output.

---

## Common Workflows

### Create a New Prompt from Scratch

```bash
# Create TOML file
cat > my-prompt.toml << 'EOF'
[prompt]
key = "greeting-generator"
displayName = "Greeting Generator"
description = "Generates personalized greetings"

[[configs]]
name = "default"
provider = "gemini"
model = "models/gemini-3-flash-preview"
temperature = "0.7"
userPromptTemplate = "Generate a friendly greeting for {{ input.name }} who works as a {{ input.occupation }}."
EOF

# Create in Primitive
primitive prompts create --from-file my-prompt.toml
```

### Test a Prompt

```bash
# Execute directly
primitive prompts execute <prompt-id> --vars '{"name": "Alice", "occupation": "engineer"}'

# Preview without executing
primitive prompts preview <prompt-id> --vars '{"name": "Alice", "occupation": "engineer"}'
```

### Set Up Automated Testing

```bash
# Create test case
primitive prompts tests create <prompt-id> \
  --name "Basic greeting test" \
  --vars '{"name": "Bob", "occupation": "teacher"}' \
  --contains '["Bob", "teacher"]'

# Run test
primitive prompts tests run <prompt-id> <test-case-id>

# Run all tests
primitive prompts tests run-all <prompt-id>
```

### Compare Different Configurations

```bash
# Create alternative config
primitive prompts configs create <prompt-id> \
  --name "high-creativity" \
  --provider gemini \
  --model "models/gemini-3-pro-preview" \
  --temperature "0.9" \
  --user-template "Generate a creative, unique greeting for {{ input.name }} ({{ input.occupation }})."

# Test with specific config
primitive prompts tests run-all <prompt-id> --config <new-config-id>
```

### Version Control with Sync

```bash
# Pull current state
primitive sync pull --dir ./config

# Edit TOML files
vim ./config/prompts/my-prompt.toml

# Push changes
primitive sync push --dir ./config --dry-run  # Preview
primitive sync push --dir ./config            # Apply
```

---

## Provider and Model Reference

### Gemini Provider

```toml
provider = "gemini"
model = "models/gemini-3-flash-preview"  # Fast, efficient
model = "models/gemini-3-pro-preview"    # More capable
```

### OpenRouter Provider

```toml
provider = "openrouter"
model = "anthropic/claude-3-5-sonnet"
model = "openai/gpt-4o"
model = "google/gemini-2.0-flash-001"
```

---

## Tips for Coding Agents

1. **Always use `--json` flag** when parsing output programmatically
2. **Set app context first** with `primitive use <app-id>` to avoid passing `--app` repeatedly
3. **Use TOML files** for complex prompts—easier to edit and version control
4. **Preview before execute** to verify template rendering
5. **Create test cases** for critical prompts to catch regressions
6. **Use evaluator prompts** for subjective quality checks that simple pattern matching can't handle
7. **Duplicate configs** when experimenting—preserve working configurations
