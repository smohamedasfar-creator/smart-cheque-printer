# Smart Cheque Printer

Windows desktop app that prints cheques for any bank from a scan of a blank cheque leaf.
Built with Electron, React, TypeScript and SQLite (sql.js). Developed by **Asfar**, AI App & Web Developer, Digital Transformation.

**[⬇ Download the latest Windows installer](https://github.com/smohamedasfar-creator/smart-cheque-printer/releases/latest)**

## Features

- **Cheque books from a scan**: upload a blank cheque leaf (PDF, JPG or PNG; full A4 scan or cropped, any orientation). The app
  finds the cheque, turns it upright, straightens it, measures it in millimetres and finds the date (line or digit boxes),
  payee line, amount-in-words lines, amount box and "or bearer" text.
- **Layout designer with live preview** on the uploaded leaf: drag, resize or nudge fields; set where each line starts and ends.
- **Amount in words** (UK/US style, optional hyphens, fils as words or `50/100`, custom prefix/suffix) that wraps to line 2,
  never runs past a printed line, and lets you click the word that starts line 2.
- **Text size** (8 pt and up) and **any installed font**; a long payee name stays on one line and shrinks to fit (never below 8 pt).
- Crossing options: A/C Payee, Not Negotiable, strike "or bearer", cross only, none.
- **Printer calibration** with a ruler page (once per printer); cheques can be fed sideways or vertically (short edge first); optional fine-tuning per cheque book.
- **Payees** list (add, edit, delete) with autocomplete when writing cheques.
- **History** with filters (customer name, date range, cheque number, cheque book), status (printed, cleared, void), delete, totals and CSV export.
- **Backup and restore** of all data; **Help & About** page with a how-to guide.

## Using the app

1. **Settings → Printer calibration**: feed a cheque-sized plain paper like a real cheque, print the ruler page, enter the two readings.
2. **Cheque Books → Add cheque book**: drop a scan of a blank leaf, check the layout, enter the name and last cheque number.
3. **Write Cheque**: choose the cheque book, enter payee, amount and date, and print. Use a plain-paper test print the first time.

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
- Smart Cheque Printer is free and open source. If it helps you, you can support its development:
  [pay with Ziina](https://pay.ziina.com/Asfar?source=app), or with Botim in the UAE: **+971 56 368 6538**

## Contributing

Issues and pull requests are welcome. Please keep personal data out of the repository: tests use synthetic cheques,
and real scans stay on your own computer (see `tests/local`). Run `npm test` and `npm run typecheck` before opening a pull request.

## License

[MIT](LICENSE) © 2026 Asfar
