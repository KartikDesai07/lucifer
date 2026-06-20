# Project Hooks

Shell commands that execute automatically on Claude Code events.

## Configured Hooks

| Event | Command | Purpose |
|-------|---------|---------|
| (none yet) | — | Hooks will be added as needed |

## Common Hook Events

- `PreToolUse` — runs before a tool call (e.g., lint before edit)
- `PostToolUse` — runs after a tool call (e.g., type-check after edit)
- `Stop` — runs when Claude finishes a turn
- `Notification` — runs on desktop notification events

## How to Configure

Hooks are registered in `.claude/settings.json` under the `hooks` key.

Example:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npm run lint" }]
      }
    ]
  }
}
```
