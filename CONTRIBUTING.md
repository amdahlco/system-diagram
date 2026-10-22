# Contributing

Thanks for helping. This skill turns a spec into an interactive diagram page, and changes should
keep it doing that one job well.

## Report a bug or ask for a feature

Open an issue. For a bug, include the command you ran, what you expected, what happened, and the
data file if you can share it (or a small one that shows the problem).

For a security problem, do not open an issue. See `SECURITY.md`.

## Send a change

1. Fork the repo and make your change on a branch.
2. Build the example and run the checker:

   ```bash
   python3 build.py examples/skeleton/data.json --strict --out /tmp/x.html
   node tools/check.mjs /tmp/x.html /tmp/check
   ```

   Both must report no problems. The checker setup is in `README.md`.
3. If you change the data format, update `references/schema.md` and, where it helps, the example
   in `examples/skeleton/data.json`.
4. Open a pull request that says what changes for a person using the skill, and how you tested
   it. The same checks run on every pull request.

Keep the page self-contained: no external scripts, fonts or network calls, and no dependencies in
`build.py` beyond the Python standard library.

By sending a change, you agree that it is released under the MIT licence in `LICENSE`.
