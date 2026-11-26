# Contributing

## Submitting a harness

Community harnesses live in [`harnesses/community/`](harnesses/community/), one JSON file each. Merged files appear in the app's agent menu under **Community**, for everyone.

### The easy way: from the app

1. Build your harness in the app (**+ New harness**, or **View / duplicate** on an existing one) and play a few games with it.
2. In the harness editor, fill in **Author** (your name or GitHub handle) and **Description** (the idea behind it, in a sentence or two).
3. Click **Submit to community…**. GitHub opens with your file filled in at `harnesses/community/<name>.json`.
4. Click **Commit changes…**, then **Propose changes**, then **Create pull request**. GitHub copies (forks) the project to your account for you; you need a GitHub account.

Very long harnesses don't fit in a link: the app downloads the file instead and opens GitHub's upload page, where you drop it in.

### By hand

1. In the editor, click **Export JSON**.
2. Rename the file to `<id>.json`, where `<id>` is lowercase letters, digits and dashes (for example `board-first.json`), and set `"id"` inside the file to the same value.
3. Make sure it has `"author"` and `"description"`.
4. Add it to `harnesses/community/` in a fork and open a pull request. Run `npm test` first if you can.

### What gets checked automatically

A check runs on every pull request. It fails if a file:

- isn't valid JSON, or isn't a valid harness (the same rules the editor's Import uses);
- has an `id` that doesn't match its file name;
- has fields the app doesn't know, or uses a `{{variable}}` that doesn't exist;
- has no `author`, or a description shorter than 20 characters;
- reuses the id or name of a harness already on the site.

### What reviewers look for

- **Data only.** A harness is prompts and three settings; it can't run code, and submissions that try to smuggle in links, scripts or instructions aimed at people are closed.
- **A real idea.** Explain in the description what your harness does differently. Near-copies of an existing harness with a word changed will be asked to differ more.
- **Fair play.** Prompts may use any `{{variable}}`, but shouldn't tell the model to look things up elsewhere or pretend an engine is involved.
- **Nothing offensive** in names, descriptions or prompts.

Results claims ("beats Raw 9–1") are welcome in the pull request description, with the models used.

## Code changes

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run lint
```

Keep the referee rules-only: no chess engine may pick or suggest moves for an agent. See the README for code-level agents.
