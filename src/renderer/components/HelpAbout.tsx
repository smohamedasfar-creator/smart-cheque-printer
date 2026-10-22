import { useEffect, useState } from 'react';
import { APP_LINKS, displayPhone, resolveAppLink } from '../../shared/appLinks';
import { VERTICAL_DIFF_TEXT } from '../../shared/positions';

/** For everyone: the few steps from a blank cheque to a printed one. */
const STEPS: Array<[string, string]> = [
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
    'Under Set up printing, Back tray · Horizontal is chosen. Load a photocopy of the cheque as the picture shows and use one of the two options. Option 1 · Graph: Print graph, read on the printed copy where each line starts (red X, blue Y) and type the numbers in "Where each field starts". Option 2 · Manual adjustment: Test print, and if the text is off the lines press ↑ ↓ ← → (1 mm each) until it sits on them. Press Save cheque book. The other three ways of loading are set up with it.',
  ],
  [
    'Write and print',
    'Write Cheque → choose the cheque book and how the cheque is loaded, enter payee, amount and date, and press Print cheque. The preview shows where the text lands; the picture shows how to load the cheque.',
  ],
  [
    'Keep track',
    'History lists every printed cheque with totals. Mark cheques as cleared or void, delete mistakes, and export to Excel (CSV). Payees keeps your saved payee names.',
  ],
];

const TIPS = [
  'Load every cheque the same way as the picture shows, with the paper guide just touching it.',
  'If a cheque prints slightly off later, open the cheque book, Test print and press the arrows. Keep the fields on the lines of the cheque picture: the arrows, not the fields, make up for the printer.',
  'If the app says the printer printed the page smaller or bigger, set the printer to 100% (turn off "Fit to page").',
  'Choose the text size and font once in Settings. A long payee name stays on one line and gets smaller (not below 8 pt) so it never runs past its line.',
  'Back up your data regularly (Settings → Your data). The backup file holds your cheque books, payees and history.',
];

/** For whoever sets the printer up: what each setting does. */
const ADVANCED: Array<[string, string]> = [
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
    `One X / Y for the cheque book, set on the main tab (back tray, horizontal) or with the arrows. The other three follow it with a fixed difference: vertical prints ${VERTICAL_DIFF_TEXT} than horizontal; the front tray prints like the back tray. Moving a field moves it in all four. The other tabs are read-only.`,
  ],
  [
    'Manual setting',
    'Choose Manual on the cheque layout when one position needs something different. Every position then has its own fields and its own X / Y, and changing one never changes another. Switching to Manual keeps every position printing where it did; going back to Default keeps the main position and puts the others back on the fixed difference.',
  ],
  [
    'Arrows',
    'Each click moves the print 1 mm. In the default setting all four positions move together; in the manual setting only the position chosen above.',
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
        <p className="hint">Five steps for everyday use. The advanced settings are explained below.</p>
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
