# Integrations Guide for Coding Agents

This guide explains how to create, configure, and manage integrations using the `primitive` CLI. Integrations allow tenant apps to securely call third-party APIs without exposing API keys to clients.

## Overview

Integrations provide:
- **Secure credential storage**: API keys stored server-side, never exposed to clients
- **Request proxying**: Platform signs requests with stored credentials
- **Security boundaries**: Enforce allowed HTTP methods, paths, and rate limits
- **Credential versioning**: Support for credential rotation

## TOML File Structure

Integrations are defined in TOML files with two main sections: `[integration]` and `[requestConfig]`.

### Complete Schema Reference

```toml
[integration]
key = "integration-key"              # Required: Unique identifier (lowercase, per app)
displayName = "Display Name"         # Required: Human-readable name
description = "Optional description" # Optional: Description text
status = "draft"                     # Optional: "draft", "active", or "archived" (default: "draft")
timeoutMs = 300_000                  # Optional: Request timeout in ms (default: 300000 = 5 min)

[requestConfig]
baseUrl = "https://api.example.com/" # Required: Base URL (must start with http://, https://, or test://)
allowedMethods = ["GET", "POST"]     # Required: Allowed HTTP methods (default: ["GET"])
allowedPaths = ["/v1/*", "/status"]  # Required: Allowed paths with wildcard support (default: ["/*"])
defaultMethod = "GET"                # Optional: Default HTTP method (default: first allowedMethod)
responsePassthrough = true           # Optional: Pass through response (default: true)
forwardHeaders = ["x-trace-id"]      # Optional: Client headers to forward (lowercased)
forwardQueryParams = ["q", "limit"]  # Optional: Client query params to forward (lowercased)

[requestConfig.defaultHeaders]       # Optional: Headers always sent
Content-Type = "application/json"
Accept = "application/json"

[requestConfig.staticQuery]          # Optional: Query params always included
apiVersion = "v2"
format = "json"

[requestConfig.exampleQuery]         # Optional: Example query params (for testing/documentation)
q = "search term"

[requestConfig.exampleBody]          # Optional: Example request body (for testing/documentation)
model = "gpt-4"
input = "Hello"
```

### Field Reference Table

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `integration.key` | string | Yes | - | Unique identifier per app (lowercase) |
| `integration.displayName` | string | Yes | - | Human-readable name |
| `integration.description` | string | No | - | Description text |
| `integration.status` | string | No | `"draft"` | `"draft"`, `"active"`, or `"archived"` |
| `integration.timeoutMs` | integer | No | `300000` | Request timeout in milliseconds |
| `requestConfig.baseUrl` | string | Yes | - | Base URL (http/https/test protocol) |
| `requestConfig.allowedMethods` | string[] | No | `["GET"]` | Array of HTTP methods |
| `requestConfig.allowedPaths` | string[] | No | `["/*"]` | Array of path patterns |
| `requestConfig.defaultMethod` | string | No | First allowed | Default HTTP method |
| `requestConfig.defaultHeaders` | object | No | `{}` | Headers always sent |
| `requestConfig.forwardHeaders` | string[] | No | `[]` | Client headers to forward |
| `requestConfig.staticQuery` | object | No | `{}` | Query params always included |
| `requestConfig.forwardQueryParams` | string[] | No | `[]` | Client query params to forward |
| `requestConfig.responsePassthrough` | boolean | No | `true` | Pass through response |
| `requestConfig.exampleQuery` | object | No | - | Example query params |
| `requestConfig.exampleBody` | any | No | - | Example request body |

## Real-World Examples

### Example 1: OpenAI API Integration

```toml
[integration]
key = "open-ai"
displayName = "Open AI"
status = "draft"
timeoutMs = 300_000

[requestConfig]
baseUrl = "https://api.openai.com/"
allowedMethods = [ "POST" ]
allowedPaths = [ "/v1/responses" ]
defaultMethod = "POST"
forwardHeaders = [ "content-type" ]
staticQuery = { }
forwardQueryParams = [ "model", "input" ]
responsePassthrough = true

  [requestConfig.defaultHeaders]
  Content-Type = "application/json"

  [requestConfig.exampleBody]
  model = "gpt-4.1-mini"
  input = "Write a limerick about a llama."
```

### Example 2: YouTube Search API Integration

```toml
[integration]
key = "youtube-search"
displayName = "YouTube Search API"
timeoutMs = 300_000

[requestConfig]
baseUrl = "https://www.googleapis.com/"
allowedMethods = [ "GET" ]
allowedPaths = [ "/youtube/v3/search" ]
defaultMethod = "GET"
forwardHeaders = [ ]
forwardQueryParams = [ "part", "q", "type", "maxresults" ]
responsePassthrough = true

  [requestConfig.defaultHeaders]
  Accept = "application/json"

  [requestConfig.staticQuery]
  part = "snippet"
  type = "video"
  maxResults = 10
```

### Example 3: Generic API with Wildcard Paths

```toml
[integration]
key = "postman-echo"
displayName = "Postman Echo"
status = "draft"
timeoutMs = 300_000

[requestConfig]
baseUrl = "https://postman-echo.com/"
allowedMethods = [ "GET", "POST" ]
allowedPaths = [ "/*", "/GET", "/POST" ]
defaultMethod = "GET"
forwardHeaders = [ "x-trace-id" ]
forwardQueryParams = [ "foo", "bar" ]
responsePassthrough = true

  [requestConfig.defaultHeaders]
  Accept = "application/json"

  [requestConfig.staticQuery]
  source = "js-bao-admin"
```

## CLI Commands Reference

### Prerequisites

1. Install the CLI: `npm install -g @anthropic/primitive-cli` (or use local installation)
2. Authenticate: `primitive login`
3. Select an app: `primitive use <app-id>` (or use `--app` flag with each command)

### Integration Management Commands

#### List Integrations

```bash
# List all integrations for current app
primitive integrations list

# List with status filter
primitive integrations list --status active
primitive integrations list --status draft
primitive integrations list --status archived

# JSON output
primitive integrations list --json
```

#### Create Integration

```bash
# Create from TOML file (recommended)
primitive integrations create --from-file path/to/integration.toml

# Create inline with required options
primitive integrations create \
  --key weather-api \
  --name "Weather API" \
  --base-url "https://api.openweathermap.org/data/2.5" \
  --allowed-methods "GET,POST" \
  --allowed-paths "/weather,/forecast" \
  --timeout-ms 30000
```

#### Get Integration Details

```bash
# Get by integration ID
primitive integrations get <integration-id>

# JSON output
primitive integrations get <integration-id> --json
```

#### Update Integration

```bash
# Update display name
primitive integrations update <integration-id> --name "New Display Name"

# Update status
primitive integrations update <integration-id> --status active
primitive integrations update <integration-id> --status draft
primitive integrations update <integration-id> --status archived

# Update description
primitive integrations update <integration-id> --description "Updated description"

# Update timeout
primitive integrations update <integration-id> --timeout-ms 60000
```

#### Delete Integration

```bash
# Soft delete (archive)
primitive integrations delete <integration-id>

# Hard delete (permanent)
primitive integrations delete <integration-id> --hard

# Skip confirmation
primitive integrations delete <integration-id> --yes
primitive integrations delete <integration-id> -y
```

#### Test Integration

```bash
# Test with defaults
primitive integrations test <integration-id>

# Test with specific method and path
primitive integrations test <integration-id> --method POST --path /v1/chat

# Test with query parameters
primitive integrations test <integration-id> --query '{"q": "hello", "limit": 10}'

# Test with request body
primitive integrations test <integration-id> --method POST --body '{"message": "Hello"}'
```

#### View Integration Logs

```bash
# View recent logs
primitive integrations logs <integration-id>

# Limit number of logs
primitive integrations logs <integration-id> --limit 50

# JSON output
primitive integrations logs <integration-id> --json
```

### Secret Management Commands

Secrets store API credentials separately from the integration configuration.

#### List Secrets

```bash
primitive integrations secrets list <integration-id>
```

#### Add Secret

```bash
# Add API key secret
primitive integrations secrets add <integration-id> \
  --data '{"apiKey": "sk-your-api-key-here"}' \
  --summary "Production API key"

# Add OAuth credentials
primitive integrations secrets add <integration-id> \
  --data '{"clientId": "xxx", "clientSecret": "yyy"}' \
  --summary "OAuth credentials"
```

#### Archive Secret

```bash
primitive integrations secrets archive <integration-id> <secret-id>
```

### Sync Commands (TOML-based Configuration Management)

Sync commands enable version-controlled integration management using TOML files.

#### Initialize Sync Directory

```bash
# Initialize with default directory (./config)
primitive sync init

# Initialize with custom directory
primitive sync init --dir ./my-config
```

This creates:
```
config/
├── .primitive-sync.json    # Sync state tracking
├── integrations/           # Integration TOML files
├── prompts/                # Prompt TOML files
└── workflows/              # Workflow TOML files
```

#### Pull Configuration from Server

```bash
# Pull all integrations to TOML files
primitive sync pull

# Pull to custom directory
primitive sync pull --dir ./my-config
```

This downloads all integrations and saves them as `config/integrations/<key>.toml`.

#### Push Configuration to Server

```bash
# Preview changes (dry run)
primitive sync push --dry-run

# Push changes
primitive sync push

# Force push (overwrite conflicts)
primitive sync push --force
```

#### Show Differences

```bash
# Compare local files with server
primitive sync diff
```

## Workflow: Managing Integrations with TOML Files

### Initial Setup

```bash
# 1. Initialize sync directory
primitive sync init --dir ./config

# 2. Pull existing integrations from server
primitive sync pull --dir ./config

# 3. View pulled files
ls config/integrations/
```

### Creating a New Integration

```bash
# 1. Create a new TOML file
cat > config/integrations/my-new-api.toml << 'EOF'
[integration]
key = "my-new-api"
displayName = "My New API"
status = "draft"
timeoutMs = 30_000

[requestConfig]
baseUrl = "https://api.example.com/"
allowedMethods = ["GET", "POST"]
allowedPaths = ["/v1/*"]
defaultMethod = "GET"
forwardHeaders = ["authorization"]
responsePassthrough = true

  [requestConfig.defaultHeaders]
  Content-Type = "application/json"
EOF

# 2. Preview the push
primitive sync push --dry-run

# 3. Push to server
primitive sync push

# 4. Add secrets (required before activation)
primitive integrations secrets add <integration-id> \
  --data '{"apiKey": "your-api-key"}' \
  --summary "Initial API key"

# 5. Activate the integration
primitive integrations update <integration-id> --status active
```

### Modifying an Existing Integration

```bash
# 1. Pull latest configuration
primitive sync pull

# 2. Edit the TOML file
vim config/integrations/my-api.toml

# 3. Preview changes
primitive sync push --dry-run

# 4. Push changes
primitive sync push
```

### Resolving Conflicts

If someone else modified the integration on the server:

```bash
# Check for conflicts
primitive sync diff

# Option 1: Pull latest and re-apply changes
primitive sync pull
# Re-edit the file
primitive sync push

# Option 2: Force push (overwrites server changes)
primitive sync push --force
```

## Validation Rules and Constraints

### Integration Key
- Must be unique per app (not globally)
- Lowercase only
- Used in API proxy URL: `/app/{appId}/api/integrations/{key}/proxy`

### Base URL
- Must start with `http://`, `https://`, or `test://`
- Trailing slash is normalized (always ends with `/`)

### Allowed Methods
- Must be uppercase HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Defaults to `["GET"]` if not specified

### Allowed Paths
- Must start with `/`
- Supports trailing wildcard: `/*` matches all subpaths
- Examples:
  - `"/*"` - matches all paths
  - `"/v1/*"` - matches `/v1/anything`
  - `"/status"` - exact match only

### Status Workflow
- `draft`: Default state, can only be called via test endpoint
- `active`: Can be called by clients via proxy endpoint
- `archived`: Disabled, cannot be called

### Secrets
- Stored separately from integration configuration
- Latest active secret (by version) is used automatically
- Secrets can be rotated by adding new secret and archiving old one

## Common Patterns

### API Key in Header

```toml
[requestConfig.defaultHeaders]
Authorization = "Bearer {{secret.apiKey}}"  # Placeholder - actual key from secrets
```

Note: The actual API key is stored in secrets and injected server-side.

### API Key in Query Parameter

```toml
[requestConfig.staticQuery]
api_key = "{{secret.apiKey}}"  # Placeholder - actual key from secrets
```

### Forward Client Authentication

```toml
[requestConfig]
forwardHeaders = ["authorization"]  # Forward client's auth header
```

### Multiple Endpoints

```toml
[requestConfig]
allowedPaths = ["/users/*", "/posts/*", "/comments/*"]
```

### Read-Only vs Read-Write

```toml
# Read-only integration
[requestConfig]
allowedMethods = ["GET"]

# Read-write integration
[requestConfig]
allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
```

## File Locations

When using sync:
- Integration TOML files: `config/integrations/<key>.toml`
- Sync state: `config/.primitive-sync.json`

Default sync directory is `./config`, customizable via `--dir` flag.

## Error Handling

### Common Errors

1. **"Integration key already exists"**: Use a different key or update existing integration
2. **"Integration not found"**: Check the integration ID or key
3. **"Conflict detected"**: Server was modified since last pull; use `--force` or re-pull
4. **"Integration not active"**: Set status to `active` before client calls
5. **"Path not allowed"**: Request path doesn't match `allowedPaths` patterns
6. **"Method not allowed"**: HTTP method not in `allowedMethods` array

### Debugging

```bash
# Check integration configuration
primitive integrations get <integration-id> --json

# Test the integration
primitive integrations test <integration-id> --method GET --path /v1/test

# View recent logs
primitive integrations logs <integration-id> --limit 10
```
