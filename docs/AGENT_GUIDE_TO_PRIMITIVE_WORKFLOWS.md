# Workflow Agent Guide

This guide explains the workflow syntax and CLI commands for creating and managing workflows in the js-bao platform. It is designed for coding agents to understand and implement workflows.

## Overview

Workflows are multi-step automation pipelines that execute sequentially. They support:

- AI/LLM calls (OpenAI, Gemini)
- External API integrations
- Data transformation
- Conditional execution
- Managed prompts

**Key concepts:**

- **Definition**: The workflow configuration (metadata + steps)
- **Draft**: Editable version of a workflow (stored in R2)
- **Revision**: Published, immutable version of a workflow
- **Run**: A single execution instance of a workflow

## Publishing Workflows

**Important:** Workflows must be **published** and set to `active` status before they can be called from the client.

Unlike prompts which only need `status = "active"`, workflows have a two-step publishing process:

### Workflow Status Lifecycle

| Status     | Has Revision | Can Run from Client | Can Preview via CLI |
| ---------- | ------------ | ------------------- | ------------------- |
| `draft`    | No           | No                  | Yes                 |
| `draft`    | Yes          | No                  | Yes                 |
| `active`   | Yes          | Yes                 | Yes                 |
| `archived` | -            | No                  | No                  |

### Publishing Steps

1. **Create/update the workflow** (creates a draft)
2. **Publish the draft** to create an immutable revision
3. **Set status to active** to allow client execution

```bash
# Step 1: Create workflow from TOML
primitive workflows create --from-file workflow.toml

# Step 2: Publish the draft (creates revision)
primitive workflows publish <workflow-id>

# Step 3: Set to active
primitive workflows update <workflow-id> --status active
```

**Via TOML sync:** Setting `status = "active"` in the TOML file will fail with "Cannot activate workflow without a revision" if you haven't published first. Always publish via CLI before setting to active.

### Common Error

If you see `HTTP 404: Workflow not found` when calling `client.workflows.start()`:

1. Verify the workflow exists with `primitive workflows list`
2. Check the workflow has `status = "active"` (not `draft`)
3. Ensure the workflow has been published (`latestRevision` should not be null)
4. If using prompts, verify those prompts also have `status = "active"`

## Workflow Definition Structure

Workflows are defined in **TOML format** for CLI operations and stored as **JSON** internally.

### Basic TOML Structure

```toml
[workflow]
key = "unique-workflow-key"           # Required: unique identifier per app
name = "Human Readable Name"          # Required: display name
description = "What this workflow does"  # Optional
status = "draft"                      # draft | active | archived

# Concurrency settings (optional)
perUserMaxRunning = 5                 # Max concurrent runs per user
perUserMaxQueued = 10                 # Max queued runs per user
perAppMaxRunning = 10                 # Max concurrent runs per app
perAppMaxQueued = 20                  # Max queued runs per app
queueTtlSeconds = 3600                # Queue TTL in seconds
dequeueOrder = "fifo"                 # fifo | lifo

# Schema validation (optional, JSON strings)
inputSchema = "{\"type\":\"object\",\"properties\":{...}}"
outputSchema = "{\"type\":\"object\",\"properties\":{...}}"

# Steps array
[[steps]]
id = "step-1"
kind = "transform"
# ... step-specific fields
```

## Step Types

### 1. `noop` - No Operation

Placeholder step for testing/debugging.

```toml
[[steps]]
id = "placeholder"
kind = "noop"
message = "This step does nothing"

[steps.payload]
debug = true
```

### 2. `transform` - Data Transformation

Transforms data using templating. Use `saveAs = "output"` for the final workflow output.

```toml
[[steps]]
id = "format-output"
kind = "transform"
saveAs = "output"           # Save result as named variable

[steps.output]
title = "{{ input.name }}"
summary = "{{ outputs.extraction.text }}"
timestamp = "{{ meta.startedAt }}"
```

### 3. `llm.chat` - OpenAI Chat Completion

Calls the internal LLM service.

```toml
[[steps]]
id = "generate-text"
kind = "llm.chat"
model = "gpt-4o-mini"       # or "gpt-4o", "gpt-4", etc.
saveAs = "response"

[[steps.messages]]
role = "system"
content = "You are a helpful assistant."

[[steps.messages]]
role = "user"
content = "{{ input.question }}"

# Optional parameters
# temperature = 0.7
# maxTokens = 1000
```

### 4. `gemini.generate` - Google Gemini Generation

Calls the Google Gemini API with structured prompts.

```toml
[[steps]]
id = "extract"
kind = "gemini.generate"
model = "models/gemini-2.5-flash"
thinkingLevel = "minimal"   # minimal | low | medium | high (Gemini 3 only)
saveAs = "summary"

[steps.prompt]
[[steps.prompt.messages]]
role = "user"

[[steps.prompt.messages.parts]]
type = "text"
text = "Summarize the following: {{ input.content }}"
```

### 5. `gemini.generateRaw` - Raw Gemini API Call

Direct Gemini API payload (advanced use).

```toml
[[steps]]
id = "raw-gemini"
kind = "gemini.generateRaw"
model = "models/gemini-2.5-flash"

[steps.prompt]
# Raw Gemini API payload structure
```

### 6. `gemini.countTokens` - Token Counting

Count tokens for a Gemini prompt.

```toml
[[steps]]
id = "count"
kind = "gemini.countTokens"
model = "models/gemini-2.5-flash"

[steps.prompt]
# Gemini prompt structure
```

### 7. `integration.call` - External API Call

Calls a configured integration (external API).

```toml
[[steps]]
id = "fetch-data"
kind = "integration.call"
integrationKey = "weather-api"   # Must match configured integration
saveAs = "weather"

[steps.request]
method = "GET"
path = "/current"

[steps.request.query]
city = "{{ input.city }}"

[steps.request.headers]
X-Custom = "value"

# [steps.request.body]
# For POST/PUT requests
```

### 8. `prompt.execute` - Execute Managed Prompt

Executes a configured AppPrompt (managed prompt template).

```toml
[[steps]]
id = "summarize"
kind = "prompt.execute"
promptKey = "summarizer"        # Must match configured prompt
saveAs = "summary"
# modelOverride = "gpt-4"       # Optional: override prompt's default model

[steps.variables]
text = "{{ input.content }}"
maxLength = 500
```

### 9. `delay` - Pause Execution

Pauses workflow execution.

```toml
[[steps]]
id = "wait"
kind = "delay"
ms = 5000                       # Milliseconds (number)
# or: ms = "5 seconds"          # Duration string
```

### 10. `event.wait` - Wait for External Event

Waits for an external event (e.g., user approval).

```toml
[[steps]]
id = "wait-approval"
kind = "event.wait"
type = "user-approval"
timeout = "24 hours"            # Optional timeout
```

## Templating Syntax

Workflows use Mustache-style `{{ }}` templates with path resolution.

### Template Context Variables

| Variable   | Description                                     |
| ---------- | ----------------------------------------------- |
| `input`    | Root input payload passed to the workflow       |
| `selected` | Result of step's `selector` (if used)           |
| `steps`    | All step outputs by step ID                     |
| `outputs`  | Named outputs (via `saveAs`)                    |
| `meta`     | Workflow metadata (`startedAt`, `userId`, etc.) |

### Path Access Examples

```toml
# Basic field access
"{{ input.fieldName }}"

# Nested access
"{{ input.user.profile.name }}"

# Array index
"{{ input.items[0] }}"

# Bracket notation (for special characters)
"{{ input['key-name'] }}"

# Access previous step output (by step ID)
"{{ steps.step-id.content }}"

# Access named output (by saveAs name)
"{{ outputs.myResult.field }}"

# Metadata
"{{ meta.startedAt }}"
"{{ meta.userId }}"
```

### Fallback Values

Use `||` for fallback/default values:

```toml
# String fallback
title = "{{ input.title || 'Untitled' }}"

# Numeric fallback
count = "{{ input.count || 0 }}"

# Empty string fallback
text = "{{ input.text || '' }}"

# Chained fallback
value = "{{ input.primary || input.fallback || 'default' }}"
```

### Single Expression Mode

When the entire value is a single template expression, the raw value is preserved (arrays/objects are not stringified):

```toml
# Returns array, not "[object Object]"
items = "{{ input.itemsList }}"
```

## Conditional Execution (`runIf`)

Each step can include a `runIf` condition to control execution.

### Truthy Check

```toml
[[steps]]
id = "optional-step"
kind = "transform"
runIf = "input.shouldRun"       # Runs if input.shouldRun is truthy
```

### Numeric Comparison

```toml
[[steps]]
id = "short-content-step"
kind = "transform"
runIf = "outputs.text.length < 1000"   # Runs if text length < 1000
```

### Fallback Logic

```toml
[[steps]]
id = "has-content"
kind = "transform"
runIf = "input.primary || input.fallback"   # Runs if either is truthy
```

**Supported operators:**

- `< number` - Less than comparison
- `||` - Fallback/OR logic
- Truthy evaluation (any path resolves to truthy value)

**Not supported:**

- Arithmetic (`+`, `-`, `*`, `/`)
- Equality comparisons (`==`, `!=`)
- Greater than (`>`, `>=`, `<=`)
- Custom functions

## Input Selectors

Steps can use `selector` to change their input context:

```toml
[[steps]]
id = "process-selected"
kind = "transform"

[steps.selector]
source = "step"
stepId = "previous-step"

[steps.output]
# Use "selected" instead of "input"
processed = "{{ selected.value }}"
```

**Selector sources:**

- `{ source = "root" }` - Use root input (default)
- `{ source = "step", stepId = "step-id" }` - Use output from specific step
- `{ source = "context", path = "outputs.namedOutput" }` - Use path into context

## Output Contract

### How outputs are stored:

1. Every step result is stored under `steps[stepId]`
2. If step has `saveAs`, also stored under `outputs[saveAs]`
3. Final workflow output is:
   - `outputs.output` if any step used `saveAs = "output"`
   - Otherwise, the full `outputs` map

### Best Practice

Always have a final `transform` step with `saveAs = "output"` to define the workflow's return value:

```toml
[[steps]]
id = "final-output"
kind = "transform"
saveAs = "output"

[steps.output]
result = "{{ steps.process.content }}"
success = true
```

---

## CLI Commands

The `primitive workflows` command manages workflows. Most commands require an app context (set with `primitive use <app-id>` or `--app <app-id>`).

### Workflow Lifecycle

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Create  │ ──▶ │ Update  │ ──▶ │ Preview │ ──▶ │ Publish │
│         │     │  Draft  │     │         │     │         │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                     │                               │
                     ▼                               ▼
                ┌─────────┐                    ┌─────────┐
                │  Test   │                    │   Run   │
                │  Cases  │                    │         │
                └─────────┘                    └─────────┘
```

### Create Workflow

```bash
# Create from TOML file (recommended)
primitive workflows create --from-file workflow.toml

# Create with inline options
primitive workflows create --key my-workflow --name "My Workflow"
```

### Update Draft Steps

```bash
primitive workflows draft update <workflow-id> --from-file workflow.toml
```

### Preview Execution (Test Draft)

```bash
# Start preview and wait for result
primitive workflows preview <workflow-id> --input '{"text":"hello"}' --wait

# Start preview (returns instance ID for polling)
primitive workflows preview <workflow-id> --input '{"text":"hello"}'
```

### Publish Draft

```bash
primitive workflows publish <workflow-id>
```

### List Workflows

```bash
primitive workflows list
primitive workflows list --status active
primitive workflows list --json
```

### Get Workflow Details

```bash
primitive workflows get <workflow-id>
primitive workflows get <workflow-id> --json
```

### Update Workflow Metadata

```bash
primitive workflows update <workflow-id> --name "New Name"
primitive workflows update <workflow-id> --status active
primitive workflows update <workflow-id> --per-user-max-running 10
```

### Delete/Archive Workflow

```bash
# Archive (soft delete)
primitive workflows delete <workflow-id>

# Permanently delete
primitive workflows delete <workflow-id> --hard --yes
```

### Monitor Runs

```bash
# List runs
primitive workflows runs list <workflow-id>
primitive workflows runs list <workflow-id> --status completed

# Get run status
primitive workflows runs status <workflow-id> <run-id>
```

### Test Cases

```bash
# List test cases
primitive workflows tests list <workflow-id>

# Create test case
primitive workflows tests create <workflow-id> \
  --name "Basic test" \
  --vars '{"input":"hello"}' \
  --contains '["expected","strings"]'

# Run single test
primitive workflows tests run <workflow-id> <test-case-id>

# Run all tests
primitive workflows tests run-all <workflow-id>

# Upload test attachment
primitive workflows tests attachments upload <workflow-id> <test-case-id> ./file.pdf
```

---

## Complete Examples

### Example 1: PDF Summarizer with Haiku

This workflow:

1. Summarizes a PDF using a managed prompt
2. Generates a haiku from the summary
3. Returns both as the final output

```toml
[workflow]
key = "pdf-haiku"
name = "PDF Haiku Generator"
description = "Summarizes a PDF and generates a haiku about its content"
status = "draft"
perUserMaxRunning = 5
perUserMaxQueued = 10
dequeueOrder = "fifo"

[[steps]]
id = "summarize-pdf"
kind = "prompt.execute"
promptKey = "pdf-summarizer"

[steps.variables]
attachments = "{{ input.attachments }}"

[[steps]]
id = "generate-haiku"
kind = "prompt.execute"
promptKey = "haiku-generator"

[steps.variables]
text = "{{ steps.summarize-pdf.content }}"

[[steps]]
id = "extract-content"
kind = "transform"
saveAs = "output"

[steps.output]
summary = "{{ steps.summarize-pdf.content }}"
haiku = "{{ steps.generate-haiku.content }}"
```

### Example 2: Conditional LLM Chain

This workflow:

1. Generates a headline with LLM
2. Conditionally rewrites it if too short

```toml
[workflow]
key = "headline-generator"
name = "Smart Headline Generator"
status = "draft"

[[steps]]
id = "first-llm"
kind = "llm.chat"
model = "gpt-4o-mini"

[[steps.messages]]
role = "user"
content = "Give me a one-line headline about {{ input.topic || 'technology' }}"

[[steps]]
id = "second-llm"
kind = "llm.chat"
model = "gpt-4o-mini"
runIf = "steps.first-llm.content < 120"   # Only run if first headline is short

[[steps.messages]]
role = "user"
content = "Rewrite this headline to be punchier: {{ steps.first-llm.content }}"

[[steps]]
id = "final"
kind = "transform"
saveAs = "output"

[steps.output]
headline = "{{ outputs.second-llm.content || steps.first-llm.content }}"
wasRewritten = "{{ outputs.second-llm.content }}"
```

### Example 3: External API Integration

This workflow:

1. Calls an external weather API
2. Transforms the response

```toml
[workflow]
key = "weather-check"
name = "Weather Checker"
status = "draft"

[[steps]]
id = "fetch-weather"
kind = "integration.call"
integrationKey = "weather-api"
saveAs = "weatherData"

[steps.request]
method = "GET"
path = "/current"

[steps.request.query]
city = "{{ input.city }}"
units = "metric"

[[steps]]
id = "format"
kind = "transform"
saveAs = "output"

[steps.output]
city = "{{ input.city }}"
temperature = "{{ outputs.weatherData.temp }}"
conditions = "{{ outputs.weatherData.description }}"
```

---

## CLI Workflow: Creating a New Workflow

### Step 1: Create the TOML file

Create a file named `my-workflow.toml`:

```toml
[workflow]
key = "my-workflow"
name = "My Workflow"
description = "Does something useful"
status = "draft"

[[steps]]
id = "step-1"
kind = "transform"
saveAs = "output"

[steps.output]
message = "Hello, {{ input.name || 'World' }}!"
```

### Step 2: Create the workflow

```bash
primitive workflows create --from-file my-workflow.toml
```

Note the workflow ID returned.

### Step 3: Preview/test the workflow

```bash
primitive workflows preview <workflow-id> --input '{"name":"Agent"}' --wait
```

### Step 4: Iterate on the draft

Edit `my-workflow.toml`, then update:

```bash
primitive workflows draft update <workflow-id> --from-file my-workflow.toml
```

Preview again to test changes.

### Step 5: Publish when ready

```bash
primitive workflows publish <workflow-id>
```

### Step 6: (Optional) Set to active

```bash
primitive workflows update <workflow-id> --status active
```

---

## Common Patterns

### Pattern: Chain multiple LLM calls

```toml
[[steps]]
id = "analyze"
kind = "llm.chat"
model = "gpt-4o"
saveAs = "analysis"

[[steps.messages]]
role = "user"
content = "Analyze this text: {{ input.text }}"

[[steps]]
id = "summarize"
kind = "llm.chat"
model = "gpt-4o-mini"
saveAs = "summary"

[[steps.messages]]
role = "user"
content = "Summarize this analysis in 2 sentences: {{ outputs.analysis.content }}"
```

### Pattern: Pass attachments to prompts

```toml
[[steps]]
id = "process-file"
kind = "prompt.execute"
promptKey = "file-processor"

[steps.variables]
attachments = "{{ input.attachments }}"
instructions = "{{ input.instructions || 'Summarize the content' }}"
```

### Pattern: Fallback values for robustness

```toml
[[steps]]
id = "format"
kind = "transform"
saveAs = "output"

[steps.output]
title = "{{ input.title || 'Untitled Document' }}"
author = "{{ input.author || 'Unknown' }}"
content = "{{ steps.generate.content || '' }}"
```

### Pattern: Conditional processing

```toml
# Only run expensive processing if input meets criteria
[[steps]]
id = "expensive-step"
kind = "gemini.generate"
runIf = "input.processDeep"
# ...

# Use simple fallback if condition not met
[[steps]]
id = "simple-step"
kind = "transform"
runIf = "input.processDeep"   # Negation not supported, use separate logic
# ...
```

---

## Troubleshooting

### "Workflow not found"

- Verify the workflow ID is correct
- Ensure you're using the correct app context

### "Draft has no steps"

- Run `primitive workflows draft update` to add steps before preview/publish

### Template not resolving

- Check path exists in context (`input`, `steps`, `outputs`)
- Use fallback values: `{{ input.field || 'default' }}`
- Verify step IDs match exactly

### runIf not working

- Only supports: truthy checks, `< number`, `||` fallback
- Does not support: `>`, `>=`, `<=`, `==`, `!=`, arithmetic

### Integration call failing

- Verify `integrationKey` matches a configured integration
- Check the integration is active
- Verify request path/method are correct

---

## Limitations

1. **No loops**: Workflows execute steps sequentially only
2. **No branching**: Use `runIf` for conditional execution (no goto/jump)
3. **Limited expressions**: Only path access, fallbacks, and `< number` comparisons
4. **No custom functions**: No string manipulation, date functions, etc.
5. **No arithmetic**: Cannot do `{{ input.a + input.b }}`
6. **Sequential only**: Steps cannot run in parallel
