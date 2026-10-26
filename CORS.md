# Backend CORS configuration

Set `CORS_ORIGIN` on the backend to a comma-separated list of exact browser origins. Each entry must include `http://` or `https://` and an optional port, with no path, query, fragment, or wildcard.

For example, after deployment configure Render with:

```text
CORS_ORIGIN=https://your-project.vercel.app
```

For a specifically permitted Vercel preview deployment, list its exact origin too:

```text
CORS_ORIGIN=https://your-project.vercel.app,https://your-project-git-branch-team.vercel.app
```

Use the actual origins shown by Vercel; these are format examples, not configured project URLs. To allow local development, include its exact origin, such as `http://localhost:5173`. Leave the value empty to disable cross-origin browser access. Requests without an `Origin` header, including command-line health checks, remain supported. Requests carrying an unlisted origin receive HTTP 403, including preflight requests.
