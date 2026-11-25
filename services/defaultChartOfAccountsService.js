// services/defaultChartOfAccountsService.js
// IFRS / IAS 1–aligned default Chart of Accounts for new companies (SME-friendly).
// Numbering: 1xxx Assets · 2xxx Liabilities · 3xxx Equity · 4xxx Income · 5xxx COGS · 6xxx Expenses

const prisma = require('../prisma/client');

/**
 * Canonical default chart. Codes are stable and referenced by posting helpers —
 * do not renumber existing codes without updating those helpers.
 */
const DEFAULT_ACCOUNTS = [
  // ─── CURRENT ASSETS ─────────────────────────────────────────────
  { code: '1001', name: 'Cash in Hand', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Petty cash and till cash' },
  { code: '1002', name: 'Bank Account', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Default operating bank account' },
  { code: '1003', name: 'Petty Cash', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Small cash float' },
  { code: '1100', name: 'Accounts Receivable', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Trade receivables (IAS 1)' },
  { code: '1105', name: 'Allowance for Doubtful Accounts', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Credit', description: 'Contra-asset for expected credit losses (IFRS 9)' },
  { code: '1120', name: 'Employee Advances', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Advances recoverable from employees' },
  { code: '1200', name: 'Inventory', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Inventories (IAS 2)' },
  { code: '1210', name: 'Raw Materials', type: 'Asset', parentAccount: 'Inventory', balanceType: 'Debit', description: 'Raw materials inventory' },
  { code: '1220', name: 'Work in Progress', type: 'Asset', parentAccount: 'Inventory', balanceType: 'Debit', description: 'Work in progress' },
  { code: '1230', name: 'Finished Goods', type: 'Asset', parentAccount: 'Inventory', balanceType: 'Debit', description: 'Finished goods inventory' },
  { code: '1300', name: 'Prepaid Expenses', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Expenses paid in advance' },
  { code: '1310', name: 'Prepaid Insurance', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Insurance premiums prepaid' },
  { code: '1320', name: 'Prepaid Rent', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Rent paid in advance' },
  { code: '1400', name: 'Input Tax / GST Receivable', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Recoverable input tax / VAT / GST' },
  { code: '1410', name: 'Deposits & Guarantees', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Refundable deposits and guarantees' },
  { code: '1450', name: 'Other Current Assets', type: 'Asset', parentAccount: 'Current Assets', balanceType: 'Debit', description: 'Other short-term assets' },

  // ─── NON-CURRENT ASSETS (PPE – IAS 16) ───────────────────────────
  { code: '1500', name: 'Fixed Assets', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Debit', description: 'PPE control account' },
  { code: '1501', name: 'Furniture & Fixtures', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Furniture and fixtures' },
  { code: '1502', name: 'Buildings', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Buildings and leasehold improvements' },
  { code: '1503', name: 'Vehicles', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Motor vehicles' },
  { code: '1504', name: 'Machinery & Equipment', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Plant and machinery' },
  { code: '1505', name: 'IT Equipment', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Computers and IT hardware' },
  { code: '1506', name: 'Land', type: 'Asset', parentAccount: 'Property, Plant & Equipment', balanceType: 'Debit', description: 'Freehold land (typically non-depreciable)' },
  { code: '1510', name: 'Accumulated Depreciation', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Credit', description: 'Accumulated depreciation – PPE contra' },
  { code: '1600', name: 'Intangible Assets', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Debit', description: 'Intangibles (IAS 38)' },
  { code: '1610', name: 'Accumulated Amortisation', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Credit', description: 'Accumulated amortisation – intangibles contra' },
  { code: '1700', name: 'Long-term Investments', type: 'Asset', parentAccount: 'Non-Current Assets', balanceType: 'Debit', description: 'Investments held long term' },

  // ─── CURRENT LIABILITIES ────────────────────────────────────────
  { code: '2010', name: 'Accounts Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Trade payables' },
  { code: '2100', name: 'Taxes Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Output tax / GST / VAT / income tax payable' },
  { code: '2110', name: 'Output GST / VAT Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Output tax collected' },
  { code: '2120', name: 'Withholding Tax Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Tax withheld from suppliers/employees' },
  { code: '2130', name: 'Customer Credit Balance', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Unapplied customer credits' },
  { code: '2140', name: 'Customer Advances', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Unearned revenue / advances from customers (IFRS 15)' },
  { code: '2150', name: 'Dividend Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Dividends declared but not paid' },
  { code: '2200', name: 'Salaries Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Accrued wages and salaries' },
  { code: '2210', name: 'Employee Benefits Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Accrued employee benefits / PF / EOBI' },
  { code: '2250', name: 'Accrued Expenses', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Expenses incurred but not yet paid' },
  { code: '2260', name: 'Interest Payable', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Interest accrued on borrowings' },
  { code: '2310', name: 'Current Portion of Long-term Debt', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Loan principal due within 12 months' },
  { code: '2400', name: 'Other Current Liabilities', type: 'Liability', parentAccount: 'Current Liabilities', balanceType: 'Credit', description: 'Other short-term liabilities' },

  // ─── NON-CURRENT LIABILITIES ────────────────────────────────────
  { code: '2300', name: 'Loan Payable', type: 'Liability', parentAccount: 'Non-Current Liabilities', balanceType: 'Credit', description: 'Long-term loans and borrowings' },
  { code: '2320', name: 'Lease Liability', type: 'Liability', parentAccount: 'Non-Current Liabilities', balanceType: 'Credit', description: 'Lease liabilities (IFRS 16)' },
  { code: '2350', name: 'Deferred Tax Liability', type: 'Liability', parentAccount: 'Non-Current Liabilities', balanceType: 'Credit', description: 'Deferred tax (IAS 12)' },

  // ─── EQUITY (IAS 1) ─────────────────────────────────────────────
  { code: '3001', name: "Owner's Capital", type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'Owner / partner capital introduced' },
  { code: '3010', name: 'Opening Balance Equity', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'Migration / opening balance clearing account' },
  { code: '3100', name: 'Retained Earnings', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'Accumulated profits retained' },
  { code: '3200', name: 'Current Year Earnings', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'Current period profit or loss (clearing)' },
  { code: '3300', name: "Owner's Drawings", type: 'Equity', parentAccount: 'Equity', balanceType: 'Debit', description: 'Owner withdrawals (contra-equity)' },
  { code: '3400', name: 'Dividends / Distributions', type: 'Equity', parentAccount: 'Equity', balanceType: 'Debit', description: 'Dividends declared / distributions' },
  { code: '3500', name: 'General Reserve', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'General / statutory reserve' },
  { code: '3600', name: 'Revaluation Surplus', type: 'Equity', parentAccount: 'Equity', balanceType: 'Credit', description: 'Revaluation surplus (IAS 16 / IAS 38)' },

  // ─── REVENUE (IFRS 15) ──────────────────────────────────────────
  { code: '4001', name: 'Sales Revenue', type: 'Revenue', parentAccount: 'Operating Revenue', balanceType: 'Credit', description: 'Revenue from sale of goods' },
  { code: '4100', name: 'Service Revenue', type: 'Revenue', parentAccount: 'Operating Revenue', balanceType: 'Credit', description: 'Revenue from services' },
  { code: '4150', name: 'Interest Income', type: 'Revenue', parentAccount: 'Other Income', balanceType: 'Credit', description: 'Interest received / receivable' },
  { code: '4160', name: 'Rental Income', type: 'Revenue', parentAccount: 'Other Income', balanceType: 'Credit', description: 'Income from property rental' },
  { code: '4200', name: 'Other Income', type: 'Revenue', parentAccount: 'Other Income', balanceType: 'Credit', description: 'Miscellaneous other income' },
  { code: '4201', name: 'Foreign Exchange Gain', type: 'Revenue', parentAccount: 'Other Income', balanceType: 'Credit', description: 'FX gains (IAS 21)' },
  { code: '4202', name: 'Gain on Asset Disposal', type: 'Revenue', parentAccount: 'Other Income', balanceType: 'Credit', description: 'Gain on disposal of PPE' },
  { code: '4300', name: 'Sales Returns & Allowances', type: 'Revenue', parentAccount: 'Operating Revenue', balanceType: 'Debit', description: 'Contra-revenue for returns' },
  { code: '4400', name: 'Sales Discounts', type: 'Revenue', parentAccount: 'Operating Revenue', balanceType: 'Debit', description: 'Contra-revenue for discounts allowed' },

  // ─── COST OF SALES ──────────────────────────────────────────────
  { code: '5001', name: 'Cost of Goods Sold', type: 'Expense', parentAccount: 'Cost of Sales', balanceType: 'Debit', description: 'Cost of inventories sold' },
  { code: '5100', name: 'Purchase Returns', type: 'Expense', parentAccount: 'Cost of Sales', balanceType: 'Credit', description: 'Contra to purchases / COGS' },
  { code: '5200', name: 'Freight In', type: 'Expense', parentAccount: 'Cost of Sales', balanceType: 'Debit', description: 'Inbound freight allocated to inventory/COGS' },
  { code: '5300', name: 'Inventory Write-down', type: 'Expense', parentAccount: 'Cost of Sales', balanceType: 'Debit', description: 'NRV write-downs (IAS 2)' },

  // ─── OPERATING EXPENSES ─────────────────────────────────────────
  { code: '6001', name: 'Rent Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Rent and occupancy' },
  { code: '6100', name: 'Salary Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Salaries and wages' },
  { code: '6110', name: 'Employee Benefits Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Benefits, PF, medical, bonuses' },
  { code: '6200', name: 'Utilities Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Electricity, gas, water' },
  { code: '6300', name: 'Office Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Office supplies and admin' },
  { code: '6400', name: 'Internet Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Internet and telecom' },
  { code: '6500', name: 'Marketing Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Advertising and marketing' },
  { code: '6600', name: 'Transportation Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Outbound transport / delivery' },
  { code: '6610', name: 'Travel Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Business travel' },
  { code: '6620', name: 'Meals & Entertainment', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Meals and client entertainment' },
  { code: '6630', name: 'Insurance Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Insurance premiums (period cost)' },
  { code: '6640', name: 'Repairs & Maintenance', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Repairs and maintenance' },
  { code: '6650', name: 'Software & Subscriptions', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Software licences and SaaS' },
  { code: '6660', name: 'Professional Fees', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Legal, audit, consulting' },
  { code: '6670', name: 'Training & Development', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Staff training' },
  { code: '6680', name: 'Bad Debt Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Impairment of receivables' },
  { code: '6700', name: 'Depreciation Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Depreciation of PPE (IAS 16)' },
  { code: '6710', name: 'Amortisation Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Amortisation of intangibles (IAS 38)' },
  { code: '6800', name: 'Bank Charges', type: 'Expense', parentAccount: 'Finance Costs', balanceType: 'Debit', description: 'Bank fees and charges' },
  { code: '6850', name: 'Interest Expense', type: 'Expense', parentAccount: 'Finance Costs', balanceType: 'Debit', description: 'Interest on borrowings (IAS 23)' },
  { code: '6860', name: 'Tax Expense', type: 'Expense', parentAccount: 'Income Tax', balanceType: 'Debit', description: 'Income / sales tax expense (IAS 12)' },
  { code: '6900', name: 'Miscellaneous Expense', type: 'Expense', parentAccount: 'Operating Expenses', balanceType: 'Debit', description: 'Other operating expenses' },
  { code: '6950', name: 'Loss on Asset Disposal', type: 'Expense', parentAccount: 'Other Expenses', balanceType: 'Debit', description: 'Loss on disposal of PPE' },
  // Keep FX loss out of 71xx — bank ledgers often use 71xx
  { code: '6960', name: 'Foreign Exchange Loss', type: 'Expense', parentAccount: 'Other Expenses', balanceType: 'Debit', description: 'FX losses (IAS 21)' },
];

/**
 * Check if default accounts have already been initialized for a company
 */
async function hasDefaultAccounts(companyId) {
  const count = await prisma.chartOfAccount.count({
    where: {
      companyId,
      code: { in: DEFAULT_ACCOUNTS.map((a) => a.code) },
    },
  });
  return count > 0;
}

/**
 * Create any missing default accounts for a company (safe to call repeatedly).
 * Does not alter existing accounts or balances.
 */
async function ensureDefaultChartOfAccounts(companyId, userId) {
  if (!companyId) {
    throw new Error('companyId is required to ensure default Chart of Accounts');
  }

  const existingAccounts = await prisma.chartOfAccount.findMany({
    where: {
      companyId,
      code: { in: DEFAULT_ACCOUNTS.map((a) => a.code) },
    },
    select: { code: true },
  });
  const existingCodes = new Set(existingAccounts.map((a) => a.code));
  const accountsToCreate = DEFAULT_ACCOUNTS.filter((a) => !existingCodes.has(a.code));

  if (accountsToCreate.length === 0) {
    return { success: true, message: 'Default chart already complete', created: 0, accounts: [] };
  }

  const createdAccounts = [];
  const batchSize = 15;
  for (let i = 0; i < accountsToCreate.length; i += batchSize) {
    const batch = accountsToCreate.slice(i, i + batchSize);
    const batchCreated = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const account of batch) {
        try {
          const newAccount = await tx.chartOfAccount.create({
            data: {
              code: account.code,
              name: account.name,
              type: account.type,
              parentAccount: account.parentAccount,
              openingBalance: 0,
              currentBalance: 0,
              balanceType: account.balanceType,
              description: account.description || `Default ${account.type} account`,
              taxCode: 'N/A',
              isActive: true,
              createdBy: userId || 'SYSTEM',
              companyId,
            },
          });
          out.push(newAccount);
          console.log(`✅ [DefaultCOA] Ensured account: ${account.code} - ${account.name}`);
        } catch (err) {
          // Race / unique: skip
          if (err.code !== 'P2002') throw err;
          console.log(`⏭️ [DefaultCOA] Skip existing ${account.code}`);
        }
      }
      return out;
    });
    createdAccounts.push(...batchCreated);
  }

  try {
    const { syncCompanyEquityAccounts } = require('../utils/equityAccountHelper');
    await syncCompanyEquityAccounts(companyId, userId);
  } catch (syncErr) {
    console.log('⚠️ [DefaultCOA] Equity sync skipped:', syncErr.message);
  }

  return {
    success: true,
    message: `Added ${createdAccounts.length} missing default accounts`,
    created: createdAccounts.length,
    accounts: createdAccounts,
  };
}

/**
 * Initialize default Chart of Accounts for a new company.
 * Also fills gaps if a partial chart already exists.
 */
async function initializeDefaultChartOfAccounts(companyId, userId) {
  console.log('📊 [DefaultCOA] Starting initialization for company:', companyId);
  const result = await ensureDefaultChartOfAccounts(companyId, userId);
  console.log(
    `✅ [DefaultCOA] Initialization complete. Created ${result.created} accounts for company: ${companyId}`
  );
  return result;
}

/**
 * Get account code by name for transaction mapping
 */
function getAccountCodeByName(accountName) {
  const account = DEFAULT_ACCOUNTS.find((a) => a.name === accountName);
  return account ? account.code : null;
}

/**
 * Get all default account codes for a category
 */
function getAccountCodesByType(type) {
  return DEFAULT_ACCOUNTS.filter((a) => a.type === type).map((a) => a.code);
}

module.exports = {
  initializeDefaultChartOfAccounts,
  ensureDefaultChartOfAccounts,
  hasDefaultAccounts,
  getAccountCodeByName,
  getAccountCodesByType,
  DEFAULT_ACCOUNTS,
};
