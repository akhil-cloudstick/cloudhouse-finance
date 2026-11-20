# Store screenshots helper

Turns raw device screenshots into the exact sizes App Store Connect accepts (exact pixels, PNG, no transparency).

```
store-screenshots/
  make-screenshots.cjs      the script
  inbox/iphone/             put raw iPhone screenshots here
  inbox/ipad/               put raw iPad screenshots here
  ready/                    created by the script: upload these to App Store Connect
```

## Use it

PowerShell or any terminal, from this folder:

```
node make-screenshots.cjs
```

- Name the inputs `01-...`, `02-...` so the order is right.
- `node make-screenshots.cjs --mode cover` crops to fill instead of adding bars.
- `node make-screenshots.cjs --bg "#000000"` changes the bar colour (default white).
- It prints a warning when an image's shape does not match the target (for example an iPad Air 11" screenshot going into the 13" set).
- It checks every output file is the exact size with no transparency, and exits with an error if not.

## Use it in a different project

1. Copy this whole folder into the other project.
2. In the copied folder run once: `npm init -y` then `npm install sharp`.
3. Run `node make-screenshots.cjs` as above.

Needs Node 18 or newer. If Apple changes the accepted sizes, edit the `TARGETS` list at the top of the script (the sizes come from Apple's "Screenshot specifications" page).

Never put real customer data in screenshots.

Full submission guide: `../app-store-submission.md`.
