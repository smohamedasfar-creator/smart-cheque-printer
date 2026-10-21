import { useEffect, useState } from 'react';
import { APP_LINKS, displayPhone, resolveAppLink } from '../../shared/appLinks';

const STEPS: Array<[string, string]> = [
  [
    'Add a cheque book',
    'Cheque Books → Add cheque book. Scan a blank cheque leaf (300 DPI PDF or JPG is best; a full A4 scan or a cropped image both work) and drop it in. The app measures the cheque and finds the date, payee, amount-in-words lines and amount box.',
  ],
  [
    'Check the layout',
    'Each field is shown on your cheque with sample text. Drag a box to move it, drag its corner to resize, or use the arrow keys. "Line ends at" decides where text wraps to the next line. Then enter the cheque book name and last cheque number.',
  ],
  [
    'Show how the cheque goes into your printer',
    'Cheque Books → Details. Choose the tray (back tray, front drawer or manual feed slot) and which end of the cheque goes in first, then load the cheque as the animation shows, with the guide touching it. Press Test print with a photocopy of the cheque loaded the same way. If the text lands in the wrong place, drag it on the cheque picture to where it printed and press Fix position. If it printed upside down, press "Text printed upside down". To check size and position on their own, press Print alignment marks and measure the gaps between the crosshairs with a ruler. Save one position for every way you load this cheque book.',
  ],
  [
    'Write and print',
    'Write Cheque → choose the cheque book, enter payee, amount and date. The preview shows exactly where text lands. Click a word under "Amount in words" to choose where line 2 starts. Use "Test print on plain paper" the first time, then Print cheque.',
  ],
  [
    'Keep track',
    'History lists every printed cheque with totals. Mark cheques as cleared or void, delete mistakes, and export to Excel (CSV). Payees keeps your saved payee names.',
  ],
];

const TIPS = [
  'Feed every cheque the same way: same tray, same edge against the guide, same side up.',
  'If a cheque prints slightly off, open Write Cheque → "Printed in the wrong place? Fix it by dragging" and drag the text to where it printed.',
  'Text cannot print within about 3 mm of the page edge on most printers. If the app warns about this, move the cheque away from that guide or load it the other way round.',
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
