# mssqlCli

CLI automation tool for MSSQL ORM workspace. Handles changelog generation, release automation, and LLM-powered commit messages across multiple repositories.

## Features

- **Release automation** — Changelog generation, commit, push for single repos
- **Workspace orchestration** — Process all submodules in one command
- **LLM commit messages** — AI-generated conventional commit messages
- **GitHub login** — Browser-based or PAT authentication
- **Script runner** — Execute custom workspace scripts

## Installation

```bash
cd mssqlCli
npm install
npm run build
```

## Commands

### `release`

Generate changelog, commit, and push for a single repository.

```bash
mssql-cli release [path] [options]

Options:
  --dry-run         Preview without committing
  --push            Push after commit
  --pull            Pull latest before processing
  --tag <name>      Create and push a git tag
  --message <text>  Override LLM-generated message
  --branch <name>   Specify branch (default: auto-detect)
  --skip-llm        Skip LLM commit message generation
```

### `ws` (Workspace)

Run release across all repositories in the workspace.

```bash
mssql-cli ws [path] [options]

Options:
  Same as release, plus:
  --all             Report all repos, even unchanged ones
```

### `login`

Store GitHub credentials and update all remote URLs.

```bash
mssql-cli login [username] [token]
```

If no arguments provided, attempts browser login via `gh` CLI.

### `run`

Run a custom script from `workspace.json`.

```bash
mssql-cli run <script-name>
```

### `format`

Auto-format `.mssql` files using premium alignment rules (same as VS Code).

```bash
mssql-cli format [path]
```

## Examples

```bash
# Release current repo
mssql-cli release

# Release and push
mssql-cli release --push

# Release with custom message
mssql-cli release --message "feat: add new feature"

# Release all repos in workspace
mssql-cli ws . --push

# Preview changes without committing
mssql-cli ws . --dry-run

# Login via browser
mssql-cli login
```

## Configuration

### `.mssqlcli.json`

```json
{
  "defaultTarget": "../mssqlOrm",
  "defaultBranch": "main",
  "dryRun": false,
  "push": false,
  "skipPrompt": false
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `openai`, `gemini`, or `custom` |
| `LLM_API_KEY` | API key for LLM provider |
| `OPENAI_API_KEY` | Alternative for OpenAI |
| `GEMINI_API_KEY` | Alternative for Gemini |
| `LLM_MODEL` | Model name (e.g., `gpt-4o-mini`) |
| `LLM_ENDPOINT` | Custom endpoint URL |

## Testing

```bash
npm test
```

## License

MIT
