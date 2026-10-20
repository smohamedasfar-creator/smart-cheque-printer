import type { ChequeFilter } from '../main/store';
import type {
  Account,
  ChequeLayout,
  ChequeRecord,
  ChequeTemplate,
  NewAccount,
  NewCheque,
  NewTemplate,
  PagePlacement,
  PrintSettings,
  RenderItem,
} from '../shared/types';

export interface PrintJob {
  items: RenderItem[];
  layout: ChequeLayout;
  settings: PrintSettings;
  testPrint: boolean;
  /** The cheque book's own feed direction and page position, when set. */
  placement?: PagePlacement;
}

export interface ChequeApi {
  listAccounts(): Promise<Account[]>;
  saveAccount(account: NewAccount & { id?: number }): Promise<Account>;
  deleteAccount(id: number): Promise<void>;
  listTemplates(): Promise<ChequeTemplate[]>;
  saveTemplate(template: NewTemplate & { id?: number }): Promise<ChequeTemplate>;
  deleteTemplate(id: number): Promise<void>;
  listPayees(): Promise<string[]>;
  addPayee(name: string): Promise<void>;
  renamePayee(oldName: string, newName: string): Promise<void>;
  deletePayee(name: string): Promise<void>;
  deleteCheque(id: number): Promise<void>;
  recordCheque(cheque: NewCheque): Promise<ChequeRecord>;
  listCheques(filter: ChequeFilter): Promise<ChequeRecord[]>;
  setChequeStatus(id: number, status: ChequeRecord['status']): Promise<void>;
  getSettings(): Promise<PrintSettings>;
  saveSettings(settings: PrintSettings): Promise<void>;
  listPrinters(): Promise<Array<{ name: string; isDefault: boolean }>>;
  print(job: PrintJob): Promise<{ ok: boolean; error?: string }>;
  printCalibration(printerName: string): Promise<{ ok: boolean; error?: string }>;
  exportCsv(csv: string): Promise<{ saved: boolean; path?: string }>;
  appInfo(): Promise<{ version: string; dataFolder: string }>;
  openLink(link: 'email' | 'whatsapp' | 'call' | 'support' | 'source'): Promise<void>;
  copyBotimNumber(): Promise<void>;
  backupData(): Promise<{ saved: boolean; path?: string }>;
  restoreData(): Promise<{ restored: boolean; error?: string }>;
}

declare global {
  interface Window {
    chequeApi: ChequeApi;
  }
}
