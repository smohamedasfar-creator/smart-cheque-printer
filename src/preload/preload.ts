import { contextBridge, ipcRenderer } from 'electron';
import type { ChequeApi } from './api';

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: ChequeApi = {
  listAccounts: invoke('accounts:list') as ChequeApi['listAccounts'],
  saveAccount: invoke('accounts:save') as ChequeApi['saveAccount'],
  deleteAccount: invoke('accounts:delete') as ChequeApi['deleteAccount'],
  listTemplates: invoke('templates:list') as ChequeApi['listTemplates'],
  saveTemplate: invoke('templates:save') as ChequeApi['saveTemplate'],
  deleteTemplate: invoke('templates:delete') as ChequeApi['deleteTemplate'],
  listPayees: invoke('payees:list') as ChequeApi['listPayees'],
  addPayee: invoke('payees:add') as ChequeApi['addPayee'],
  renamePayee: invoke('payees:rename') as ChequeApi['renamePayee'],
  deletePayee: invoke('payees:delete') as ChequeApi['deletePayee'],
  deleteCheque: invoke('cheques:delete') as ChequeApi['deleteCheque'],
  recordCheque: invoke('cheques:record') as ChequeApi['recordCheque'],
  listCheques: invoke('cheques:list') as ChequeApi['listCheques'],
  setChequeStatus: invoke('cheques:status') as ChequeApi['setChequeStatus'],
  getSettings: invoke('settings:get') as ChequeApi['getSettings'],
  saveSettings: invoke('settings:save') as ChequeApi['saveSettings'],
  listPrinters: invoke('printers:list') as ChequeApi['listPrinters'],
  print: invoke('print') as ChequeApi['print'],
  printCalibration: invoke('print:calibration') as ChequeApi['printCalibration'],
  printRulerSheet: invoke('print:rulerSheet') as ChequeApi['printRulerSheet'],
  exportCsv: invoke('export:csv') as ChequeApi['exportCsv'],
  appInfo: invoke('app:info') as ChequeApi['appInfo'],
  openLink: invoke('open:link') as ChequeApi['openLink'],
  copyBotimNumber: invoke('copy:botim') as ChequeApi['copyBotimNumber'],
  backupData: invoke('data:backup') as ChequeApi['backupData'],
  restoreData: invoke('data:restore') as ChequeApi['restoreData'],
};

contextBridge.exposeInMainWorld('chequeApi', api);
