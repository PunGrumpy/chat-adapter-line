@AGENTS.md

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

Always run "npx convex codegen" out of sandbox when added or changed a Convex function

<!-- convex-ai-end -->

## CodeGraph — Semantic Code Analysis (Preferred)

CodeGraph MCP is installed. Prefer CodeGraph tools over grep/read for symbol-level queries.

### Rules

- Who calls X? → codegraph_callers
- What does X call? → codegraph_callees
- What is affected if I change X? → codegraph_impact
- Call chain A→B? → codegraph_trace
- Where is function/class X? → codegraph_search
- Full implementation? → codegraph_node
- Batch explore? → codegraph_explore
- Log strings/comments/errors → grep
- Config files → Read
- Find by filename → Glob

### Mandatory

1. Before refactoring: codegraph_impact on every symbol you plan to change
2. Cross-module: codegraph_trace for full call chain
3. Batch: codegraph_explore, not chained codegraph_node
4. Symbol search: codegraph_search, not grep

### Auto-init

If codegraph_status says uninitialized, run codegraph init first.

## Git & Authorship

- When committing or pushing code, never add Claude or Claude Code or Happy as an author or co-author. Do not include any `Co-Authored-By` lines referencing Claude/Anthropic/Happy.
- Always use the user's GitHub account as the sole author.

## Server user-facing message contract

- Any error string that can reach a client toast via mutation / action `throw new Error(...)` MUST reference a constant from `convex/lib/serverMessages.ts` (`SERVER_ERROR.*`) or one of the templated factories there (`docNotFound`, `stepActionRequired`, etc.). Never throw a raw literal — the FE i18n map (#53/#55) matches on these strings to localise them.
- Internal dev-only `console.error` / `console.warn` strings are exempt; for any new user-facing throw site, add the entry to `serverMessages.ts` first, then reference it.

## i18n / Localization (per #53)

Every user-facing change must ship **both zh-CN and en-US** translations. Specific rules:

- **No hardcoded strings.** UI text (pages, components, toasts, `aria-label`s, `placeholder`s, form validation messages) must go through `t("ns:key")` — never embed Chinese or English literals directly in JSX or zod schemas. Identifiers persisted in Convex (e.g. `cases.testMethod`) are exempt by schema contract, but their display labels must still route through `src/lib/testMethodLabels.ts` and `t()`.
- **Both dictionaries in lockstep.** Any new or modified i18n key must land in **both** the `zhCN` and `enUS` dictionaries in `src/i18n.ts` in the same change. The two key sets stay 1:1 (compile-time enforced via `resources: typeof zhCN`). Pick the correct namespace (`common` / `nav` / `auth` / `projects` / `suites` / `cases` / `runs` / `execution` / `reports` / `imports` / `status_badge` / `priority_badge` / `errors`). When adding a new namespace, also append it to the `CustomTypeOptions.defaultNS` tuple.
- **Localized validation messages.** Wrap zod schemas in `useMemo(() => z.object({...}), [t])` so `min` / `max` / `email` errors re-localize on language switch.
- **Date and time formatting.** Use the `useDateFormatter()` / `useDateTimeFormatter()` hooks from `@/lib/formatters`. Do not introduce new singleton `Intl.DateTimeFormat` instances.
- **Server-emitted messages.** `src/lib/serverErrorMap.ts` auto-translates `SERVER_ERROR.*` to the active locale; new server messages must add a matching zh-CN / en-US pair under the `errors:*` namespace. Templated messages additionally register their regex and `translate` closure in `TEMPLATED_PATTERNS` — place narrower regexes before broader ones, or a greedy `.+` will swallow them.
- **Acceptance gate.** Before merge: `pnpm tsc -b && pnpm build` must pass, and `rg '[一-鿿]' src/pages/ src/components/` must return no matches outside the `src/i18n.ts` dictionary and persisted DB identifiers.
