# Security policy

## Report a vulnerability

Please report a security problem privately, not in a public issue or pull request. On this
repo's GitHub page, open the **Security** tab and choose **Report a vulnerability**. Only the
maintainers see the report.

Useful details: what an attacker can do, the input or steps that show it, and the commit or
release you tested.

## What happens next

- We confirm that we received the report within 3 business days.
- We tell you whether we accept it, and the plan, within 10 business days.
- We aim to release a fix within 30 days of accepting a report, sooner for severe problems.
- We publish a GitHub security advisory when the fix is released, and credit you unless you ask
  us not to.

Please give us that time before you disclose the problem publicly.

## Supported versions

Fixes go into the latest release and `main`. Older releases are not patched.

## Scope

In scope: anything in this repo, above all the page that `build.py` builds. It puts data and
theme values into HTML, so script injection through a data file or a theme counts, as does
anything that makes a `--standalone` page load content from the network.

Out of scope: problems that need an attacker to already control your machine or your Claude
session.
