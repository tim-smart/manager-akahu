export * from "./ManagerClient.ts"
export * from "./ManagerBatchPagination.ts"
export * from "./ManagerCompatibility.ts"

export const managerApiPackageName = "manager-api" as const

export type {
  Api4BankOrCashAccountBatchParams as ManagerBankOrCashAccountBatchParams,
  Api4PaymentBatchParams as ManagerPaymentBatchParams,
  Api4ReceiptBatchParams as ManagerReceiptBatchParams,
  BankAccountClearStatus as ManagerBankAccountClearStatus,
  BankOrCashAccount as ManagerBankOrCashAccount,
  BusinessObjectsResourceOfBankOrCashAccount as ManagerBankOrCashAccountBatch,
  BusinessObjectsResourceOfPayment as ManagerPaymentBatch,
  BusinessObjectsResourceOfReceipt as ManagerReceiptBatch,
  ItemOfBankOrCashAccount as ManagerBankOrCashAccountItem,
  ItemOfPayment as ManagerPaymentItem,
  ItemOfReceipt as ManagerReceiptItem,
  Payment as ManagerPayment,
  Payment2 as ManagerPaymentCreate,
  Payment4 as ManagerPaymentUpdate,
  PostPayment as ManagerPostPayment,
  PostReceipt as ManagerPostReceipt,
  PutPayment as ManagerPutPayment,
  PutReceipt as ManagerPutReceipt,
  Receipt as ManagerReceipt,
  Receipt2 as ManagerReceiptCreate,
  Receipt4 as ManagerReceiptUpdate,
} from "./ManagerClient.ts"
