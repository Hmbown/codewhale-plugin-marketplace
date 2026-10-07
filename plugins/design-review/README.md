# Design Review

Three focused reviews for any user interface: a design critique, an
accessibility audit and a UX copy review. Each returns findings you can act on,
with the evidence, the user cost and the specific fix.

After installing, reviewing, trusting and enabling the plugin, ask:

> Do an accessibility audit of `./public/index.html` and fix what the scanner
> finds.

You get a scanner report with line numbers and WCAG criteria, measured contrast
ratios, the manual checks that were and were not performed, and a fix list.

## What it contains

| Piece | Use it to |
| --- | --- |
| `ui-critique` skill | Get severity-ranked feedback on hierarchy, layout, type, color, states and flow |
| `accessibility-audit` skill | Audit against WCAG 2.2 AA: static scan, contrast math, keyboard, zoom, forms |
| `ux-copy-review` skill | Fix button text, errors, empty states and consistency, with a rewrite table |
| `/design-review` command | `/design-review a11y <file>`, `/design-review copy <file>`, `/design-review contrast #767676 #fff` |
| `scripts/design-review.mjs` | Node 22+ helper with no dependencies: `scan`, `contrast`, `strings` |

## Use the helper directly

```sh
node scripts/design-review.mjs scan page.html            # exit 1 if any error
node scripts/design-review.mjs scan page.html --json
node scripts/design-review.mjs contrast "#767676" "#ffffff"   # 4.54:1, passes AA text
node scripts/design-review.mjs strings page.html         # visible UI text by kind
```

## Prerequisites and data destinations

Node 22 or newer for the helper; the skills need nothing. The helper reads the
one file you name and prints to the terminal. It makes no network requests and
writes nothing. The skills run in your selected model and provider, so the
material you hand them (screenshots, markup, copy) goes where your session sends
prompts. Keep customer data and secrets out of anything you paste.

## What success and failure look like

- A clean audit says what was checked and what was not. `scan` prints
  `0 error(s)` and the review still lists manual checks as not verified when no
  browser or screen reader was available.
- A real finding names a line or selector, a WCAG criterion, a fix and a check
  that proves the fix.
- The helper exits 0 on a clean scan or an AA-passing pair, 1 on errors or a
  failing pair, and 2 on unreadable input.

## Limits

The scanner is a static, tokenizer-level check of markup. It does not run
scripts, compute styles, judge focus order or hear a screen reader, so a clean
result never proves a page is accessible. Contrast uses the WCAG relative
luminance formula and refuses colors with transparency. The plugin does not
certify conformance or give legal advice.

## Development

```sh
node --test plugins/design-review/tests/*.test.mjs
```

License: MIT. The skills and scanner are original to this repository; they cite
WCAG success criteria by number and reproduce no third-party text.
