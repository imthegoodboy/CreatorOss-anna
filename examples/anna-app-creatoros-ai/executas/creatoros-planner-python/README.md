# CreatorOS Planner Executa

Python stdio Executa for the CreatorOS AI Anna App.

It exposes one method, `creatoros_plan`, with an `action` discriminator:

- `plan` - generate a deterministic creator sprint.
- `content_pack` - return one planned content item.
- `analytics` - summarize readiness from approved items.
- `save_state` / `get_state` - local development state helpers.

Run a direct protocol smoke test:

```bash
uv run --project . python creatoros_planner_plugin.py
```
