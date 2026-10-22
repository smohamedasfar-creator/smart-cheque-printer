import { useEffect, useState } from 'react';
import { APP_LINKS, displayPhone, resolveAppLink } from '../../shared/appLinks';

/** For everyone: the few steps from a blank cheque to a printed one. */
const STEPS: Array<[string, string]> = [
  [
    'Calibrate your printer once',
    'Settings → Printer calibration. Load a plain A4 sheet in the back tray and press Print calibration sheet. Fold the printed sheet in half from left to right (edges exactly together) and read scale A at the fold; unfold, fold top to bottom and read scale B. Type both numbers and Save. Do the same for the front tray if you use it. This is done once per printer: every cheque book of every bank then prints in place, horizontally and vertically.',
  ],
  [
    'Add a cheque book',
    'Cheque Books → Add cheque book. Drop in a scan of a blank cheque leaf (300 DPI, with a dark sheet behind the cheque so its edges show). The app turns it the right way up, measures it and finds the date, payee, amount in words and amount box. FAB and RAKBANK cheques are recognised from the bank library.',
  ],
  [
    'Check the fields',
    'The cheque is shown on graph paper with sample text. If a field is not on its line, drag it there. Type the cheque book name, account number and last cheque number further down on the same screen.',
  ],
  [
    'Set up printing once',
    'Under Set up printing, load a photocopy of the cheque as the picture shows and Test print. With the printer calibrated, the text should sit on the lines. If a field is off, use Option 1 · Graph: Print graph on the copy, read where that line starts (red X, blue Y) and type it in "Where each field starts". Press Save cheque book.',
  ],
  [
    'Write and print',
    'Write Cheque → choose the cheque book and how the cheque is loaded, enter payee, amount and date, and press Print cheque. The preview shows where the text lands; the picture shows how to load the cheque.',
  ],
  [
    'Payments and reminders',
    'The Payments tab shows the cheques due soon and how much has to be paid each month: to pay (printed, not yet cleared), already cleared and the total, per cheque book, and the coming months. You are reminded 15 and 7 days before a cheque\'s date, on the day, and after it until you mark it cleared; the tab shows how many, and Windows shows a notification. Set any reminder days you like in Settings → Cheque reminders. Press Mark cleared when the cheque has been paid.',
  ],
  [
    'Keep track',
    'History lists every printed cheque with totals. Mark cheques as cleared or void, delete mistakes, and export to Excel (CSV). Payees keeps your saved payee names.',
  ],
];

const TIPS = [
  'Load every cheque the same way as the picture shows, with the paper guides just touching it.',
  'Back tray: stand the cheque printed side facing you, with the end shown in the picture going in first. Front drawer: hold the cheque printed side up with that end towards the printer, turn it over sideways like a page, and lay it flat printed side down; the picture then shows the back of the cheque. Press Show me how to see it moving.',
  'If every cheque prints off by the same amount, recalibrate the printer (Settings). If only one cheque design is off, fix its fields with the graph. Keep the fields on the lines of the cheque: the printer calibration, not the fields, makes up for the printer.',
  'If the app says the printer printed the page smaller or bigger, set the printer to 100% (turn off "Fit to page").',
  'Choose the text size and font once in Settings. A long payee name stays on one line and gets smaller (not below 8 pt) so it never runs past its line.',
  'Back up your data regularly (Settings → Your data). The backup file holds your cheque books, payees and history.',
];

/** For whoever sets the printer up: what each setting does. */
const ADVANCED: Array<[string, string]> = [
  [
    'Why the printer calibration fixes every cheque',
    'A printer puts every page a little off, the same way whatever is printed. The calibration sheet measures that once per tray, and the app moves every print back by it. When a cheque is fed vertically, the same shift falls on the cheque in another direction; the app turns it with the cheque, so horizontal and vertical are both right without separate numbers.',
  ],
  [
    'Graph and X / Y',
    'The cheque layout counts in mm from the cheque\'s bottom-left corner (0, 0): X to the right (red numbers), Y up (blue numbers). Each field starts at an X, Y and has a length. Print graph prints mm graph paper on a photocopy of the cheque in the same place as the text: the numbers you read where a line starts are exactly where the text will print, so type them in "Where each field starts". The picture of the cheque on screen can differ a little from the paper (the scan size, the printer\'s own offset); the graph shows the truth.',
  ],
  [
    'The four print positions',
    'Back tray and front tray, each horizontal (top edge goes in first) or vertical (date end goes in first). Each has a tab on the cheque layout showing where the text prints in it, and an X / Y that moves its whole print (X right, Y up, in mm).',
  ],
  [
    'Default setting',
    `One X / Y for the cheque book, set on the main tab (back tray, horizontal) or with the arrows. The other three follow it; the printer calibration (Settings) already makes vertical and the other tray land right. Moving a field moves it in all four. The other tabs are read-only.`,
  ],
  [
    'Manual setting',
    'Choose Manual on the cheque layout when one position needs something different. Every position then has its own fields and its own X / Y, and changing one never changes another. Switching to Manual keeps every position printing where it did; going back to Default keeps the main position and puts the others back on the fixed difference.',
  ],
  [
    'Arrows and X / Y (Option 2 · Manual adjustment)',
    'A cheque book\'s own move of the whole print, on top of the printer calibration, for a cheque that still prints a little off. Each arrow click moves 1 mm. In the default setting all four positions move together; in the manual setting only the position chosen above. Cheque books set up before the printer calibration keep their own adjustments until you press "Use only the printer calibration".',
  ],
  [
    'Set up from a scan',
    'Advanced → print the test page with dot rows on a photocopy, scan it on a flatbed scanner (300 DPI) and choose the scan: the app reads where the ink landed. Works for vertical loading; fed horizontally the dots print over the cheque\'s design.',
  ],
  [
    'Trays, directions and extra positions',
    'Advanced → any tray (back, front drawer, manual slot), any end first, the cheque against the left or right guide, and more saved positions. Slide the cheque on the tray picture to where it really sits. Print alignment marks prints crosshairs with their distances to check the size with a ruler.',
  ],
  [
    'Crossing',
    'Each cheque layout keeps its own crossing. If A/C PAYEE is already printed on the cheque (RAKBANK), choose the "Or Bearer" strike only, so it is not printed twice.',
  ],
];

/** Botim has no public payment link, so the number is shown with a copy button. */
function BotimPay() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await window.chequeApi.copyBotimNumber();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="botim">
      <span className="hint">In the UAE you can also pay with Botim:</span>
      <span className="phone">{displayPhone(APP_LINKS.botimNumber)}</span>
      <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy number'}</button>
    </div>
  );
}

export function HelpAbout() {
  const [info, setInfo] = useState<{ version: string; dataFolder: string } | null>(null);
  useEffect(() => {
    window.chequeApi.appInfo().then(setInfo);
  }, []);

  return (
    <section className="help">
      <div className="form">
        <h2>How to use Smart Cheque Printer</h2>
        <p className="hint">Seven steps: the first is done once per printer. The advanced settings are explained below.</p>
        <ol className="guide">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <h3>Tips</h3>
        <ul className="tips">{TIPS.map(t => <li key={t}>{t}</li>)}</ul>

        <h3>Advanced settings</h3>
        <p className="hint">For whoever sets up the printer. Everyday printing needs none of this.</p>
        <dl className="advanced-guide">
          {ADVANCED.map(([title, text]) => (
            <div key={title}>
              <dt>{title}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="form about">
        <img className="about-logo" src="./icon.png" alt="" />
        <h2>Smart Cheque Printer</h2>
        <p className="hint">Version {info?.version ?? '…'}</p>
        <p>
          Prints cheques for any bank from a scan of a blank cheque leaf: automatic layout detection, amount in words, crossing,
          printer calibration and a full cheque history.
        </p>
        <p className="privacy">
          <strong>Private by design.</strong> Works fully offline. Your cheque books, scans, payees and history are stored only on this
          computer and are never sent anywhere.
        </p>
        {info && <p className="hint">Data folder: {info.dataFolder}</p>}

        <div className="developer">
          <span className="hint">Developed by</span>
          <strong>Asfar</strong>
          <span>AI App &amp; Web Developer · Digital Transformation</span>
        </div>
        <div className="support custom">
          <strong>Need a customization?</strong>
          <p className="hint">Custom layouts, extra features, setup or training for your business.</p>
          {APP_LINKS.contactPhone ? (
            <>
              <span className="phone">{displayPhone()}</span>
              <div className="actions">
                {resolveAppLink('whatsapp') && <button className="primary" onClick={() => window.chequeApi.openLink('whatsapp')}>WhatsApp</button>}
                {resolveAppLink('call') && <button onClick={() => window.chequeApi.openLink('call')}>Call</button>}
              </div>
            </>
          ) : (
            <button className="primary" onClick={() => window.chequeApi.openLink('email')}>Email {APP_LINKS.supportEmail}</button>
          )}
        </div>
        <div className="support">
          <strong>Need help or found a problem?</strong>
          <button className="link" onClick={() => window.chequeApi.openLink('email')}>{APP_LINKS.supportEmail}</button>
          <p className="hint">Smart Cheque Printer is free and open source. If it saves you time, you can support its development.</p>
          <div className="actions">
            {resolveAppLink('support') && <button className="primary" onClick={() => window.chequeApi.openLink('support')}>❤ Support the developer</button>}
            {resolveAppLink('source') && <button onClick={() => window.chequeApi.openLink('source')}>Source code on GitHub</button>}
          </div>
          {APP_LINKS.botimNumber && <BotimPay />}
        </div>
        <p className="hint">© {new Date().getFullYear()} Asfar · Released under the MIT License</p>
      </div>
    </section>
  );
}
