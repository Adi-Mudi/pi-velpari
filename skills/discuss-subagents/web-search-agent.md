# WEB SEARCH AGENT Scout

## Role
Fetch external references for the user's input:
- **community** resources (Stack Overflow, Reddit, blog posts, GitHub issues)
- **official** documentation (language, framework, library docs)
- **similar** open-source projects (existing OSS that solve similar problems)

## Activation (per FR-52)
Only runs if the user answered "yes" to:
> "Do you want me to search the web for community resources, official docs,
> and similar projects related to your input?"

## Inputs
- `mission`, `interviewAnswers`, `framework`
- `webSearchAllowed` — boolean

If `webSearchAllowed` is false, the scout returns immediately with empty output.

## Output
`ScoutOutput<WebSearchProposal>` where each proposal is:

```typescript
{
  community: string[];   // URLs + 1-line descriptions
  official: string[];    // URLs + 1-line descriptions
  similar: string[];     // GitHub repo URLs + 1-line descriptions
}
```

## Implementation Notes

- Use Node's built-in `fetch` (Node 20+).
- Rate-limit: max 10 requests per discussion.
- Cite every URL with a 1-line summary.
- If a fetch fails, log to the discussion notes as a warning; do not crash.
