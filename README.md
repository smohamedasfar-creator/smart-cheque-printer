# Smart Cheque Printer

Windows desktop app that prints cheques for any bank from a scan of a blank cheque leaf.
Built with Electron, React, TypeScript and SQLite (sql.js). Developed by **Asfar**, AI App & Web Developer, Digital Transformation.

**[⬇ Download the latest Windows installer](https://github.com/smohamedasfar-creator/smart-cheque-printer/releases/latest)**

## Features

- **Simple printer setup, once per printer** (Settings → Printer setup, four steps):
  1. choose the printer;
  2. the tray cheques go in (back tray, front drawer or manual slot), suggested from the printer model;
  3. where a cheque sits in that tray: centre, left side or right side, suggested from the model
     (HP ink printers and Canon PIXMA: right side; Epson, Canon G-series and laser printers: centre);
  4. the calibration sheet: print an A4 sheet, fold it in half each way and type the two numbers read at the folds.

  Every cheque of every bank then prints in place, horizontal and vertical (the printer's shift turns with the cheque).
  Each printer keeps its own tray, paper side and calibration.
- **Cheque books from a scan**: upload a blank cheque leaf (PDF, JPG or PNG; full A4 scan or cropped, any orientation). The app
  finds the cheque, turns it upright, straightens it, measures it in millimetres and finds the date (line or digit boxes),
  payee line, amount-in-words lines, amount box and "or bearer" text. FAB and RAKBANK cheques are recognised from the bank library.
- **Drag to adjust**: if a field is not on its line, drag it on the cheque picture.
- **Horizontal or vertical**: one click per cheque book and on Write Cheque, with a picture and animation of how to load the
  cheque for the chosen printer and tray (guides, paper side, which end goes in first).
- **One test print** on a photocopy to check; a 1 mm "Move the whole print" fine-tune if needed.
- **Amount in words** (UK/US style, optional hyphens, fils as words or `50/100`, custom prefix/suffix) that wraps to line 2,
  never runs past a printed line, and lets you click the word that starts line 2.
- **Text size** (8 pt and up) and **any installed font**; a long payee name stays on one line and shrinks to fit (never below 8 pt).
- Crossing options: A/C Payee, Not Negotiable, strike "or bearer", strike "or bearer" only (when A/C PAYEE is already printed on
  the cheque), cross only, none. Each cheque layout keeps its own default, so A/C PAYEE prints once.
- Cheques of any size: A4 page when the cheque fits, Letter or a page of its own size for wider cheques. Warns when text would
  land off the page or in the printer's unprintable edge.
- **Payments and reminders**: cheques due soon (reminders any number of days before, 15 and 7 by default, on the day and
  after it until cleared, with a Windows notification) and how much is to be paid each month, per cheque book.
- **Payees** list (add, edit, delete) with autocomplete when writing cheques.
- **History** with filters (customer name, date range, cheque number, cheque book), status (printed, cleared, void), totals and CSV export;
  tick cheques (or select all) and **Delete selected**.
- **Admin password** (optional): choose what needs it: deleting cheques, cheque books and payees (and restoring a backup),
  changing settings, and opening the app. Stored only as a salted scrypt hash and checked by the main process, so the
  screens cannot skip it. Accepted for 10 minutes after it is typed.
- **Backup and restore** of all data; **Help & About** page with a how-to guide.

## How to use

1. **Settings → Printer setup** (once per printer): choose the printer, the tray you put cheques in and where a cheque sits in it
   (the app suggests both), then print the calibration sheet, fold it left to right and top to bottom, type the numbers on
   scales **A** and **B**, and Save. In the print window use A4, margins None, scale 100%.
2. **Cheque Books → Add cheque book** (once per bank account): drop a scan of a blank leaf (300 DPI, dark sheet behind it).
   Drag any field that is not on its line, then enter the name, account number and last cheque number.
3. **Set up printing** (same screen): choose **Horizontal** or **Vertical**, load a photocopy of the cheque as the picture shows,
   press **Test print** and hold it over a real cheque against the light. If it is still a little off, use **Move the whole print**
   (1 mm per click). Press **Save cheque book**.
4. **Write Cheque**: choose the cheque book and Horizontal or Vertical, enter payee, amount and date, load the cheque as shown
   and print.

Tips: use photocopies for tests; if every cheque is off by the same amount, redo the calibration sheet; if a horizontal cheque
does not feed, use Vertical; with two printers, choose the printer in Settings (each keeps its own setup).

Developers: `npm test` runs the unit tests (including a virtual-printer physics model); `npm run test:print` prints real PDFs through
Chromium and measures every field.

Scan blank leaves at 300 DPI for exact sizes. Images without a recorded resolution (most phone photos) ask for the cheque width.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).
Releases are built by GitHub Actions from this repository and approved by the maintainer before publishing.
See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) for team roles and the privacy policy: this program will not transfer
any information to other networked systems unless specifically requested by the user or the person installing or operating it.

## Security and privacy

- Works fully offline: no network requests, no API keys, no telemetry. Data stays in `%APPDATA%\Smart Cheque Printer`.
- The interface runs sandboxed with context isolation; only a small, typed API is exposed through the preload script, and the
  main process accepts calls only from the app's own window.
- Navigation, new windows and device permissions are blocked; strict Content Security Policy.
- Print pages run with JavaScript disabled; user text is HTML-escaped and font names are filtered.
- CSV export neutralises spreadsheet formulas; template images must be embedded pictures.
- Packaged with Electron fuses: no `RunAsNode`, no `NODE_OPTIONS`, no inspector flags, ASAR integrity validation, load only from ASAR.
- Only one copy of the app runs at a time, so two windows cannot overwrite each other's data.

## Development

```bash
npm install
npm start              # build and launch
npm test               # unit tests
npm run test:coverage
npm run typecheck
npm run dist           # Windows installer in release/
```

After `npm run build`, `npx electron scripts/smoke.cjs out scan.pdf` drives the real app with a scan and saves screenshots.
`SCAN_JPEG=path SCAN_OUT=dir npx vitest run tests/local` runs detection checks against a real scan (never committed).

| Path | Purpose |
|---|---|
| `src/shared` | Pure logic: amount in words, cheque rendering, print HTML, layout editing |
| `src/shared/detect` | Cheque detection from scans: region, orientation, skew, lines, boxes, labels, DPI |
| `src/main` | Electron main process: SQLite store, IPC, printing, backup |
| `src/preload` | Typed bridge exposing `window.chequeApi` |
| `src/renderer` | React UI |
| `build` | App icon |
| `tests` | Vitest unit tests with synthetic cheques (no real cheque images or personal data) |

## Support

- Help and bug reports: **support@optizer.ae** (please never send real cheque scans or account details)
- Customization (custom layouts, features, setup, training): **support@optizer.ae**
- Smart Cheque Printer is free and open source.

## Contributing

Issues and pull requests are welcome. Please keep personal data out of the repository: tests use synthetic cheques,
and real scans stay on your own computer (see `tests/local`). Run `npm test` and `npm run typecheck` before opening a pull request.

## License

[MIT](LICENSE) © 2026 Asfar
