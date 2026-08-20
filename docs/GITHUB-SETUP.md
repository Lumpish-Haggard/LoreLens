# Running this as a public project

This is written for someone who has not maintained an open-source repository
before. It covers publishing the repo, letting other people contribute safely,
and what to actually do when a pull request shows up.

Nothing here is urgent. You can publish the repo today and set up the rest when
you need it.

---

## Part 1 — Publishing

### 1. Create the repository on GitHub

Go to [github.com/new](https://github.com/new).

- **Name:** `LoreLens`
- **Visibility:** Public
- **Do not** tick "Add a README", "Add .gitignore", or "Choose a license" —
  this repository already has all three, and ticking them creates a conflict
  you would then have to untangle.

Click **Create repository**.

### 2. Push what is on your machine

GitHub will show you a "push an existing repository" box. It is these three
commands, run in `F:\Projects\LoreLens`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/LoreLens.git
git branch -M main
git push -u origin main
```

The first time you push, Git will ask you to sign in. Let it open a browser and
authorise — that is the easiest path and you will not have to do it again.

### 3. Fill in the repository's description

On the repository page, click the gear next to **About** on the right, and add a
description and topics. Suggested topics: `lnreader`, `light-novel`, `webnovel`,
`fandom`, `userscript`, `android`, `reading`.

This is the only place GitHub search really looks, so it is worth the minute.

---

## Part 2 — Letting people contribute

Here is the thing that surprises people: **you do not need to give anyone
access.** That is not how open source works on GitHub.

Anyone can already contribute to your public repository, right now, without you
doing anything:

1. They click **Fork**, which makes their own copy.
2. They make changes in their copy.
3. They open a **pull request**, which is a request that you pull their changes
   into yours.
4. You read it, and either merge it or you don't.

They never get write access to your repository. They cannot push to your `main`.
The pull request is the whole mechanism. So the answer to "how do I grant people
push access" is: don't. It is not needed and it is not how you want this to
work.

### When you *would* add someone

Only if someone becomes a genuine co-maintainer — reviewing other people's
work, not just submitting their own. Then:

**Settings → Collaborators and teams → Add people**, and give them **Write**.
Never **Admin** unless you intend them to be able to delete the repository.

Add them to `.github/CODEOWNERS` at the same time so they get asked to review.

### Protecting `main`

This stops anyone — including you at 2am — from pushing something broken
straight to the main branch.

**Settings → Rules → Rulesets → New branch ruleset**

- **Name:** `protect main`
- **Enforcement status:** Active
- **Target branches:** Add target → Include default branch
- Then tick:
  - **Restrict deletions**
  - **Require a pull request before merging**
    - Required approvals: `1` — but see the note below
  - **Require status checks to pass**
    - Add checks: `dist is in sync with src`, `Test suite (headless Chrome)`,
      `Source constraints`
    - Tick **Require branches to be up to date before merging**
  - **Block force pushes**

**The note about required approvals:** while you are the only maintainer, one
required approval means *you cannot merge your own pull requests*, because you
cannot approve your own. Two reasonable options:

- Set required approvals to `0` for now. You still get the CI checks, which is
  the part that actually catches problems. Raise it to `1` when a second
  maintainer appears.
- Or leave it at `1` and add yourself to the ruleset's **bypass list**
  (Bypass list → Add → your account). You keep the rule for everyone else.

Either is fine. The status checks matter far more than the approval count.

### Turning on Discussions

**Settings → General → Features → Discussions**.

Worth doing. It gives people somewhere to ask "does this work with X" without
opening an issue, and the issue templates already link to it.

---

## Part 3 — When a pull request arrives

### Read the checks first

At the bottom of the pull request there is a box showing CI results. If it is
red, the contributor's change broke something, and you can say exactly that
before reading a single line of code:

> Thanks! CI is failing on `Test suite` — could you take a look? You can run it
> locally with `npm test`.

If CI is red because of the `dist is in sync` check, the fix is always the same
and it is the most common failure by far:

> You'll need to run `npm run build` and commit the updated `dist/lorelens.js` —
> it's generated from `src/` and CI checks the two match.

### Read the diff

**Files changed** shows what actually changed. You are looking for a small
number of things:

- Does it do what the description says, and only that?
- Does it touch `dist/lorelens.js` **without** touching `src/`? That is always
  wrong — `dist/` is generated.
- Does it add a dependency, a new network destination, or `innerHTML` with
  wiki text interpolated into it? Those need a conversation. `tools/check.mjs`
  catches most of it automatically, which is why it exists.
- Would it break text selection or text-to-speech? Anything touching
  `src/70-highlighter.js` deserves a real look.

You do not have to understand every line to merge something. "This is in an
area I don't know well, the tests pass, and the author says they tested it on a
real device" is a legitimate basis for merging a small change.

### Ask for changes without being discouraging

Click **Review changes** and pick **Comment** or **Request changes**. A useful
review comment says what and why:

> Could this go in `src/45-entity.js` instead? Everything that turns wiki data
> into an entity lives there, and it'll be easier to find later.

If someone's first contribution is nearly right, it is usually faster and kinder
to merge it and fix the last detail yourself than to send them round again.

### Merging

Use **Squash and merge**. It turns their branch into a single tidy commit on
`main`, regardless of how many "wip" commits they made along the way. You can
edit the commit message in the box before confirming — make it read like the
other commits.

Then say thank you. It costs nothing and it is why people come back.

### Declining

Some pull requests should not be merged, and saying so plainly is better than
letting it rot:

> Thanks for taking the time on this. I'd rather not add a dependency here —
> the file gets pasted into a phone app by hand and staying dependency-free is
> the constraint the whole project is built around. If you're up for it, the
> same thing without the library would be very welcome.

---

## Part 4 — Cutting a release

When you have accumulated changes worth shipping:

```bash
git pull
# bump the version in BOTH places — CI checks they match:
#   src/10-constants.js   → const VERSION = '2.1.0';
#   package.json          → "version": "2.1.0"
npm run build
npm test
git commit -am "chore: release 2.1.0"
git tag v2.1.0
git push && git push origin v2.1.0
```

Pushing the tag triggers `.github/workflows/release.yml`, which rebuilds,
re-runs the tests, checks the tag matches the version in the source, and
publishes a GitHub Release with `lorelens.js` attached and notes generated from
the merged pull requests.

Version numbers: bump the last number for fixes, the middle one for new
features, the first one only if you change something that breaks existing
users' setups.

---

## Part 5 — Things that will happen

**Someone opens an issue that is really a question.** Answer it, then convert it
to a Discussion (there is a button in the sidebar).

**Someone reports a bug you cannot reproduce.** Ask for the diagnostics from
the settings panel. That is exactly what they are for, and the bug template
already asks for them.

**Someone posts a spoiler in an issue.** Edit the comment, add `[spoilers]` to
the title, and point at the Code of Conduct. This project of all projects should
hold that line.

**A pull request goes quiet.** After a few weeks, comment asking if they are
still interested, and close it after another few if not. Say it is fine to
reopen. Closing is not a judgement.

**Someone offers to rewrite the whole thing.** Thank them, and ask them to open
an issue describing what they want to change and why, before writing any of it.
This is the single most common way maintainers end up with a large pull request
they cannot merge and cannot decline gracefully.

**You lose interest for three months.** That is completely normal and it is
allowed. Add a line to the README saying what the current state is, so nobody
is left guessing.
