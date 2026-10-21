import { useEffect, useState } from 'react';
import { APP_LINKS, displayPhone, resolveAppLink } from '../../shared/appLinks';

const STEPS: Array<[string, string]> = [
  [
    'Add a cheque book',
    'Cheque Books → Add cheque book. Drop in a scan of a blank cheque leaf (300 DPI PDF or JPG; a full A4 scan or a cropped image both work). With a phone instead, print the ruler sheet, lay the cheque on it and take the photo from above. The app measures the cheque, finds the date, payee, amount-in-words lines and amount box, and recognises FAB and RAKBANK cheques from its bank library.',
  ],
  [
    'Check the layout',
    'Each field is shown on your cheque with sample text. Drag a box to move it or its corner to resize it. "Line ends at" decides where text wraps to the next line. Then enter the cheque book name and last cheque number.',
  ],
  [
    'Set up printing once',
    'In the cheque book details, load a photocopy of the cheque (cut to size) as the picture shows and press Print test page. Scan the printed cheque and choose the scan. The app finds where your printer put the ink and moves the print to match, whichever tray you use and whichever way the cheque went in.',
  ],
  [
    'Write and print',
    'Write Cheque → choose the cheque book, enter payee, amount and date. The preview shows exactly where text lands. Click a word under "Amount in words" to choose where line 2 starts, then Print cheque.',
  ],
  [
    'Keep track',
    'History lists every printed cheque with totals. Mark cheques as cleared or void, delete mistakes, and export to Excel (CSV). Payees keeps your saved payee names.',
  ],
];

const TIPS = [
  'Load every cheque the same way as the picture shows, with the paper guide just touching it.',
  'If a cheque prints slightly off later, print the test page again and choose its scan: the app corrects itself.',
  'If the app says the printer printed the page smaller or bigger, set the printer to 100% (turn off "Fit to page").',
  'Choose the text size and font once in Settings. A long payee name stays on one line and gets smaller (not below 8 pt) so it never runs past its line.',
  'Back up your data regularly (Settings → Your data). The backup file holds your cheque books, payees and history.',
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
