import { useEffect, useState } from 'react';
import { APP_LINKS, displayPhone, resolveAppLink } from '../../shared/appLinks';

/** For everyone: the few steps from a blank cheque to a printed one. */
const STEPS: Array<[string, string]> = [
  [
    'Set up your printer (once per printer)',
    'Settings → Printer setup, four steps. 1 Printer: choose it. 2 Which tray do you put cheques in: the app suggests one from the printer model (Back tray for Epson, HP Smart Tank and Canon ink printers). 3 Where does a cheque sit in that tray: Centre if both paper guides close towards the middle (Epson, Canon G, most lasers), Right side or Left side if one side is fixed and only one guide slides (HP ink printers: right side). 4 Calibrate: put a plain A4 sheet in that tray, press Print calibration sheet (A4, margins None, scale 100%), fold it in half left to right with the edges exactly together and type the number where the fold crosses scale A; unfold, fold top to bottom and type the number on scale B. Press Save. Every cheque book of every bank then prints in place, horizontal and vertical.',
  ],
  [
    'Add a cheque book (once per bank account)',
    'Cheque Books → Add cheque book. Drop in a scan of a blank cheque leaf (300 DPI, with a dark sheet behind the cheque so its edges show). The app turns it the right way up, measures it and finds the date, payee, amount in words and amount box. FAB and RAKBANK cheques are recognised from the bank library. If a field is not on its line, drag it there. Choose the crossing and whether the date is a line or boxes, then type the cheque book name, account number and last cheque number.',
  ],
  [
    'Check the print once',
    'On the same screen, under Set up printing, choose Horizontal (lying sideways, top edge first) or Vertical (standing up, date end first). Load a photocopy of the cheque exactly as the picture shows (press Show me how to see it moving) and press Test print. Hold it over a real cheque against the light: the text should sit on the lines. Only if everything is still a little off, open Move the whole print and use Up / Down / Left / Right (1 mm each), then test again. Press Save cheque book.',
  ],
  [
    'Write and print',
    'Write Cheque → choose the cheque book, choose Horizontal or Vertical, enter the payee, amount and date, and press Print cheque. The preview shows where the text lands and the picture shows how to put the cheque in. Before printing, the app asks you to confirm the cheque is loaded that way.',
  ],
  [
    'Payments and reminders',
    'The Payments tab shows the cheques due soon and how much has to be paid each month: to pay (printed, not yet cleared), already cleared and the total, per cheque book, and the coming months. You are reminded 15 and 7 days before a cheque\'s date, on the day, and after it until you mark it cleared; Windows also shows a notification. Change the reminder days in Settings → More settings. Press Mark cleared when the cheque has been paid.',
  ],
  [
    'Keep track',
    'History lists every printed cheque with totals. Mark cheques as cleared or void, and export to Excel (CSV). To delete, tick the cheques (or the box at the top to select all) and press Delete selected. Payees keeps your saved payee names.',
  ],
  [
    'Admin password (optional)',
    'Settings → Admin password. Set a password, then choose what needs it: deleting cheques, cheque books and payees (and restoring a backup), changing settings, and opening the app. Once typed it is accepted for 10 minutes. Keep it safe: it cannot be recovered. To change or remove it you need the current password.',
  ],
];

const TIPS = [
  'Always put the cheque in exactly as the picture shows, with the paper guide just touching it (not loose, not bending it).',
  'Back tray: stand the cheque printed side facing you, the end shown in the picture going in first. Front drawer: lay it flat, printed side down (most printers). If your drawer prints on the side facing up, choose Up in Settings → Printer setup → step 3.',
  'Use a photocopy of the cheque for test prints, never a real cheque.',
  'If every cheque prints off by the same amount, do the calibration sheet again (Settings → Printer setup). If only one cheque book is off, use Move the whole print in that cheque book.',
  'If the print looks smaller or bigger than the cheque, the print window was not at 100%: turn off "Fit to page" and set margins to None.',
  'Using two printers? Choose the printer in Settings → Printer setup. Each printer keeps its own tray, paper side and calibration.',
  'Very short paper can jam: if a horizontal cheque does not feed, use Vertical (date end first).',
  'Choose the text size and font once in Settings → More settings. A long payee name stays on one line and gets smaller (not below 8 pt).',
  'Back up your data regularly (Settings → More settings → Your data). The backup file holds your cheque books, payees and history.',
];

/** For whoever sets the printer up: why it works. */
const ADVANCED: Array<[string, string]> = [
  [
    'Why one calibration works for every cheque',
    'A printer puts every page a little off, the same way whatever is printed. The folded calibration sheet measures that once per printer and tray, and the app moves every print back by it. When a cheque is fed vertically, the same shift falls on the cheque in another direction; the app turns it with the cheque, so horizontal and vertical are both right without separate settings.',
  ],
  [
    'Why the paper side matters',
    'An A4 sheet fills the tray, but a cheque is narrower. In a tray whose guides close from both sides (Epson) the cheque sits in the middle; in a tray with one fixed side (HP ink printers) it sits against that side. The app moves the print to where the cheque really is, for any cheque size, horizontal or vertical. The picture and the loading steps show the same.',
  ],
  [
    'Cheque books set up before the calibration',
    'They keep their own settings (they still print as before). To use only the printer calibration, the same for horizontal and vertical, press "Use only the printer calibration" under Set up printing.',
  ],
  [
    'Crossing',
    'Each cheque layout keeps its own crossing. If A/C PAYEE is already printed on the cheque (RAKBANK), choose the "Or Bearer" strike only, so it is not printed twice.',
  ],
];

/** Unbranded build (VITE_UNBRANDED=1): no developer name, contact, support or payment details on this page. */
const UNBRANDED = import.meta.env.VITE_UNBRANDED === '1';

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
        <p className="hint">Steps 1 to 3 are done once (per printer, per cheque book). After that, everyday printing is step 4 only.</p>
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

        <h3>How it works</h3>
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

        {APP_LINKS.developerName && (
          <div className="developer">
            <span className="hint">Developed by</span>
            <strong>{APP_LINKS.developerName}</strong>
          </div>
        )}
        {!UNBRANDED && (
          <>
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
          </>
        )}
        <p className="hint">Released under the MIT License</p>
      </div>
    </section>
  );
}
