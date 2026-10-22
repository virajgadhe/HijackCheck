## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Git workflow for completed milestones

Apply this workflow to every completed HijackCheck milestone without separately
asking for routine commit/push approval.

1. Inspect `git status --short --branch`, the current branch, remotes,
   `git log -5 --oneline`, and the configured author identity. Do not change the
   author identity.
2. Run relevant automated tests, exercise the actual application behavior, fix
   practical failures, and confirm documentation matches the implementation.
3. Run `git diff --check`, inspect `git status`, and review the actual diff.
4. Confirm `.env` and `.venv/` are ignored and scan changed files for secrets.
   Never stage generated reports, credentials, or unrelated user changes.
5. Stage explicit milestone files only, then review the staged diff and author
   identity. Create one meaningful Conventional Commit per completed milestone.
6. Push to the existing configured upstream branch. Never force-push, rewrite
   history, or change repository visibility.
7. After pushing, verify `git status --short --branch` and
   `git log -1 --format='%h %an <%ae> %s'`. Confirm the remote actually received
   the commit and that no secrets were committed.
8. Report what changed, tests actually run and their results, commit hash and
   message, branch and remote, push status, working-tree status, and remaining
   issues.

Stop and ask the user only for meaningful ambiguity, destructive actions,
security risks, or external configuration blockers.
