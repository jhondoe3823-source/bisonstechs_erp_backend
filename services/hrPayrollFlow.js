'use strict';

/**
 * Standard ERP-style payroll pipeline:
 *   Salary Structure Assignment → Payroll Entry → Salary Slip → (legacy sync for tax reports)
 *
 * Designed so an HR manager can:
 *  1. Get Employees on a Payroll Entry (skips active withholdings)
 *  2. Create Salary Slips from structure assignments
 *  3. Submit slips (and sync tax/register source)
 */

const prisma = require('../prisma/client');

function badRequest(message, extra) {
  const error = new Error(message);
  error.status = 400;
  error.extra = extra || {};
  throw error;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function dayStart(value) {
  const key = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  return new Date(`${key}T00:00:00.000Z`);
}

function ymd(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function periodOf(startDate) {
  return ymd(startDate).slice(0, 7);
}

function workingDaysBetween(from, to) {
  const start = dayStart(from);
  const end = dayStart(to || from);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let days = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) days += 1;
  }
  return days || 1;
}

function componentAmount(row, base, ctc) {
  const type = String(row.amountType || 'Amount');
  const amt = Number(row.amount || 0);
  if (type === 'Percentage of Base') return round2((base * amt) / 100);
  if (type === 'Percentage of CTC') return round2(((ctc || base) * amt) / 100);
  return round2(amt);
}

function rangesOverlap(aFrom, aTo, bFrom, bTo) {
  const af = dayStart(aFrom).getTime();
  const at = dayStart(aTo || aFrom).getTime();
  const bf = dayStart(bFrom).getTime();
  const bt = dayStart(bTo || bFrom).getTime();
  if ([af, at, bf, bt].some((n) => Number.isNaN(n))) return false;
  return af <= bt && bf <= at;
}

async function employeeLabel(employee) {
  if (!employee) return '';
  if (employee.employeeName) return String(employee.employeeName).trim();
  const user = employee.user;
  if (user) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || employee.employeeCode || '';
  }
  return employee.employeeCode || '';
}

async function loadActiveWithholdings(companyId, startDate, endDate) {
  const rows = await prisma.hrSalaryWithholding.findMany({
    where: { companyId, status: 'Withheld' }
  });
  return rows.filter((w) => rangesOverlap(w.fromDate, w.toDate || endDate, startDate, endDate));
}

async function latestAssignment(companyId, employeeId, onDate) {
  const on = dayStart(onDate);
  const rows = await prisma.hrSalaryStructureAssignment.findMany({
    where: {
      companyId,
      employeeId,
      status: { in: ['Submitted', 'Active'] },
      fromDate: { lte: on }
    },
    include: { salaryStructure: true },
    orderBy: { fromDate: 'desc' }
  });
  return rows[0] || null;
}

async function loadComponentsMap(companyId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await prisma.hrSalaryComponent.findMany({
    where: { companyId, id: { in: unique } }
  });
  return new Map(rows.map((c) => [c.id, c]));
}

function annualTaxFromSlab(annualTaxable, slabs) {
  const sorted = [...(Array.isArray(slabs) ? slabs : [])].sort(
    (a, b) => Number(a.fromAmount || 0) - Number(b.fromAmount || 0)
  );
  let tax = 0;
  let remaining = Math.max(0, Number(annualTaxable || 0));
  for (const slab of sorted) {
    const from = Number(slab.fromAmount || 0);
    const to = slab.toAmount == null || slab.toAmount === '' ? null : Number(slab.toAmount);
    if (remaining <= 0) break;
    if (annualTaxable < from) continue;
    const upper = to == null ? annualTaxable : Math.min(annualTaxable, to);
    const band = Math.max(0, upper - Math.max(from - 1, 0));
    if (band <= 0) continue;
    tax += Number(slab.flatTaxAmount || 0);
    tax += (band * Number(slab.percent || 0)) / 100;
  }
  return round2(tax);
}

async function computeMonthlyIncomeTax({
  companyId,
  employeeId,
  assignment,
  taxableMonthly,
  deductUnsubmittedProof
}) {
  const slabId = assignment?.incomeTaxSlabId;
  if (!slabId) return 0;
  const slab = await prisma.hrIncomeTaxSlab.findFirst({
    where: { companyId, id: slabId, status: { in: ['Submitted', 'Active'] } }
  });
  if (!slab || slab.disabled) return 0;

  const declaration = await prisma.hrTaxExemptionDeclaration.findFirst({
    where: { companyId, employeeId, status: { in: ['Submitted', 'Approved'] } },
    orderBy: { createdAt: 'desc' }
  });
  let exemption = Number(declaration?.totalExemption || 0);

  if (deductUnsubmittedProof && declaration) {
    const proof = await prisma.hrTaxExemptionProofSubmission.findFirst({
      where: {
        companyId,
        employeeId,
        declarationId: declaration.id,
        status: 'Approved'
      },
      orderBy: { createdAt: 'desc' }
    });
    if (!proof) exemption = 0;
    else exemption = Math.min(exemption, Number(proof.totalSubmitted || 0));
  }

  const standard = Number(slab.standardTaxExemptionAmount || 0);
  const annualTaxable = Math.max(0, taxableMonthly * 12 - exemption - standard);
  const annualTax = annualTaxFromSlab(annualTaxable, slab.slabs);
  return round2(annualTax / 12);
}

async function buildSlipLines({ companyId, assignment, structure, employeeId, paymentDays, totalWorkingDays, deductUnsubmittedProof }) {
  const base = Number(assignment.base || 0);
  const ctc = base;
  const ratio = totalWorkingDays > 0 ? paymentDays / totalWorkingDays : 1;

  const earnRows = Array.isArray(structure?.earnings) ? structure.earnings : [];
  const dedRows = Array.isArray(structure?.deductions) ? structure.deductions : [];
  const componentIds = [
    ...earnRows.map((r) => r.componentId),
    ...dedRows.map((r) => r.componentId)
  ];
  const components = await loadComponentsMap(companyId, componentIds);

  const earnings = [];
  let taxableMonthly = 0;
  for (const row of earnRows) {
    const comp = components.get(String(row.componentId || ''));
    if (!comp || comp.disabled) continue;
    let amount = componentAmount(row, base, ctc);
    const depends = row.dependsOnPaymentDays !== false && comp.dependsOnPaymentDays !== false;
    if (depends) amount = round2(amount * ratio);
    earnings.push({
      salaryComponentId: comp.id,
      abbr: comp.abbr || '',
      amount,
      defaultAmount: amount,
      dependsOnPaymentDays: depends,
      isTaxableComponent: comp.isTaxableComponent === true
    });
    if (comp.isTaxableComponent) taxableMonthly += amount;
  }

  const deductions = [];
  let taxLineIndex = -1;
  for (const row of dedRows) {
    const comp = components.get(String(row.componentId || ''));
    if (!comp || comp.disabled) continue;
    let amount = componentAmount(row, base, ctc);
    const depends = row.dependsOnPaymentDays !== false && comp.dependsOnPaymentDays !== false;
    if (depends) amount = round2(amount * ratio);
    const isTax =
      comp.isIncomeTaxComponent === true ||
      /tax|income tax/i.test(`${comp.name} ${comp.abbr || ''}`);
    if (isTax) taxLineIndex = deductions.length;
    deductions.push({
      salaryComponentId: comp.id,
      abbr: comp.abbr || '',
      amount,
      defaultAmount: amount,
      dependsOnPaymentDays: depends,
      isIncomeTaxComponent: isTax
    });
  }

  // Pull approved additional salary into the slip period (passed via assignment._slipPeriod)
  const period = assignment._slipPeriod || periodOf(new Date());
  const periodStart = dayStart(`${period}-01`);
  const [yy, mm] = period.split('-').map(Number);
  const periodEnd = dayStart(new Date(Date.UTC(yy, mm, 0))); // last day of month
  const extras = await prisma.hrBonus.findMany({
    where: {
      companyId,
      employeeId,
      status: 'Approved',
      OR: [
        { period },
        {
          AND: [
            { fromDate: { lte: periodEnd } },
            { OR: [{ toDate: null }, { toDate: { gte: periodStart } }] }
          ]
        }
      ]
    }
  }).catch(() => []);

  for (const extra of extras || []) {
    const comp = extra.salaryComponentId
      ? await prisma.hrSalaryComponent.findFirst({ where: { id: extra.salaryComponentId, companyId } })
      : null;
    const amount = round2(extra.amount || 0);
    if (extra.additionalType === 'Deduction') {
      deductions.push({
        salaryComponentId: comp?.id || null,
        abbr: comp?.abbr || 'ADD',
        amount,
        defaultAmount: amount,
        dependsOnPaymentDays: false,
        sourceId: extra.id
      });
    } else {
      earnings.push({
        salaryComponentId: comp?.id || null,
        abbr: comp?.abbr || 'ADD',
        amount,
        defaultAmount: amount,
        dependsOnPaymentDays: false,
        isTaxableComponent: comp?.isTaxableComponent !== false,
        sourceId: extra.id
      });
      if (comp?.isTaxableComponent !== false) taxableMonthly += amount;
    }
  }

  const monthlyTax = await computeMonthlyIncomeTax({
    companyId,
    employeeId,
    assignment,
    taxableMonthly,
    deductUnsubmittedProof: !!deductUnsubmittedProof
  });
  if (monthlyTax > 0) {
    if (taxLineIndex >= 0) {
      deductions[taxLineIndex].amount = monthlyTax;
      deductions[taxLineIndex].defaultAmount = monthlyTax;
    } else {
      const taxComp = await prisma.hrSalaryComponent.findFirst({
        where: {
          companyId,
          OR: [
            { isIncomeTaxComponent: true },
            { abbr: { equals: 'TAX', mode: 'insensitive' } },
            { name: { contains: 'Income Tax', mode: 'insensitive' } }
          ]
        }
      });
      if (taxComp) {
        deductions.push({
          salaryComponentId: taxComp.id,
          abbr: taxComp.abbr || 'TAX',
          amount: monthlyTax,
          defaultAmount: monthlyTax,
          dependsOnPaymentDays: false,
          isIncomeTaxComponent: true
        });
      }
    }
  }

  const grossPay = round2(earnings.reduce((s, r) => s + Number(r.amount || 0), 0));
  const totalDeduction = round2(deductions.reduce((s, r) => s + Number(r.amount || 0), 0));
  const netPay = round2(grossPay - totalDeduction);
  return {
    earnings,
    deductions,
    grossPay,
    totalDeduction,
    netPay,
    roundedTotal: Math.round(netPay),
    taxableMonthly: round2(taxableMonthly),
    customTax: monthlyTax
  };
}

async function syncLegacyPayrollItemFromSlip(slip, companyId, extras = {}) {
  const period = periodOf(slip.startDate || slip.postingDate);
  if (!period || !slip.employeeId) return null;

  const breakdown = [
    ...(Array.isArray(slip.earnings) ? slip.earnings : []).map((row) => ({
      name: row.abbr || 'Earning',
      amount: Number(row.amount || 0),
      isTaxableComponent: row.isTaxableComponent === true,
      taxable: row.isTaxableComponent === true
    })),
    ...(Array.isArray(slip.deductions) ? slip.deductions : []).map((row) => ({
      name: row.abbr || 'Deduction',
      amount: Number(row.amount || 0),
      isTaxableComponent: false,
      taxable: false,
      isIncomeTaxComponent: row.isIncomeTaxComponent === true
    }))
  ];

  const payload = {
    companyId,
    employeeId: slip.employeeId,
    period,
    base: round2(slip.grossPay || 0),
    totalEarning: round2(slip.grossPay || 0),
    deductions: round2(slip.totalDeduction || 0),
    net: round2(slip.netPay || 0),
    customTax: round2(extras.customTax || 0),
    salarySlipCurrency: String(slip.currency || 'PKR'),
    workingDays: Number(slip.totalWorkingDays || 0),
    paymentDays: Number(slip.paymentDays || 0),
    leaveWithoutPay: Number(slip.leaveWithoutPay || 0),
    salaryStructureId: slip.salaryStructureId || null,
    incomeTaxSlabId: extras.incomeTaxSlabId || null,
    breakdown,
    status: slip.status === 'Submitted' ? 'Approved' : slip.status === 'Cancelled' ? 'Cancelled' : 'Calculated',
    notes: `Synced from Salary Slip ${slip.id}`
  };

  const existing = await prisma.hrPayrollItem.findFirst({
    where: { companyId, employeeId: slip.employeeId, period }
  });
  if (existing) {
    return prisma.hrPayrollItem.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.hrPayrollItem.create({ data: payload });
}

async function getEmployeesForPayrollEntry({ row, companyId }) {
  const start = row.startDate || row.postingDate;
  const end = row.endDate || start;
  if (!start) badRequest('Set Start Date before getting employees');

  const withholdings = await loadActiveWithholdings(companyId, start, end);
  const withheldIds = new Set(withholdings.map((w) => w.employeeId));

  const where = {
    companyId,
    status: { in: ['active', 'Active'] }
  };
  if (row.departmentId) {
    const dept = await prisma.hrDepartment.findFirst({ where: { id: row.departmentId, companyId } });
    if (dept?.name) where.department = dept.name;
  }
  if (row.designationId) {
    const desig = await prisma.hrDesignation.findFirst({ where: { id: row.designationId, companyId } });
    if (desig?.name) where.designation = desig.name;
  }
  if (row.branchId) where.branchId = row.branchId;
  if (row.gradeId) where.employeeGradeId = row.gradeId;

  const employees = await prisma.hrEmployee.findMany({
    where,
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { employeeCode: 'asc' }
  });

  const rows = [];
  const skipped = [];
  for (const emp of employees) {
    const assignment = await latestAssignment(companyId, emp.id, start);
    if (!assignment) {
      skipped.push({ employeeId: emp.id, reason: 'No submitted salary structure assignment' });
      continue;
    }
    if (withheldIds.has(emp.id)) {
      skipped.push({ employeeId: emp.id, reason: 'Salary withheld for this period' });
      continue;
    }
    rows.push({
      employeeId: emp.id,
      employeeName: await employeeLabel(emp),
      department: emp.department || '',
      designation: emp.designation || '',
      isActive: true
    });
  }

  return prisma.hrPayrollEntry.update({
    where: { id: row.id },
    data: {
      employees: rows,
      numberOfEmployees: rows.length,
      errorMessage: skipped.length
        ? `Skipped ${skipped.length}: ${skipped
            .slice(0, 5)
            .map((s) => s.reason)
            .join('; ')}`
        : ''
    }
  });
}

async function createSalarySlipsForPayrollEntry({ row, companyId, submit = false }) {
  const start = row.startDate || row.postingDate;
  const end = row.endDate || start;
  if (!start || !end) badRequest('Payroll Entry needs Start Date and End Date');

  let employees = Array.isArray(row.employees) ? row.employees : [];
  if (!employees.length) {
    const filled = await getEmployeesForPayrollEntry({ row, companyId });
    employees = Array.isArray(filled.employees) ? filled.employees : [];
    row = filled;
  }
  if (!employees.length) badRequest('No eligible employees. Assign salary structures first (and check withholdings).');

  const totalWorkingDays = workingDaysBetween(start, end);
  const withholdings = await loadActiveWithholdings(companyId, start, end);
  const withheldByEmp = new Map(withholdings.map((w) => [w.employeeId, w]));

  const created = [];
  const errors = [];

  for (const empRow of employees) {
    const employeeId = empRow.employeeId;
    if (!employeeId || empRow.isActive === false) continue;
    try {
      const employee = await prisma.hrEmployee.findFirst({
        where: { id: employeeId, companyId },
        include: { user: { select: { firstName: true, lastName: true, email: true } } }
      });
      if (!employee) {
        errors.push(`${employeeId}: employee not found`);
        continue;
      }

      const assignment = await latestAssignment(companyId, employeeId, start);
      if (!assignment?.salaryStructure) {
        errors.push(`${employee.employeeCode || employeeId}: missing salary structure assignment`);
        continue;
      }

      const withholding = withheldByEmp.get(employeeId) || null;
      // Withheld employees still get a Draft slip linked to withholding (ERPNext-like),
      // but they are not auto-submitted for payment.
      const absentDays = 0;
      const leaveWithoutPay = 0;
      const paymentDays = Math.max(0, totalWorkingDays - absentDays - leaveWithoutPay);

      assignment._slipPeriod = periodOf(start);
      const built = await buildSlipLines({
        companyId,
        assignment,
        structure: assignment.salaryStructure,
        employeeId,
        paymentDays,
        totalWorkingDays,
        deductUnsubmittedProof: row.deductTaxForUnsubmittedProof
      });

      const payload = {
        companyId,
        employeeId,
        employeeName: await employeeLabel(employee),
        department: employee.department || '',
        designation: employee.designation || '',
        branch: employee.branch || '',
        postingDate: dayStart(row.postingDate || end),
        currency: String(row.currency || assignment.currency || assignment.salaryStructure.currency || 'PKR'),
        exchangeRate: Number(row.exchangeRate || 1),
        payrollFrequency: row.payrollFrequency || 'Monthly',
        startDate: dayStart(start),
        endDate: dayStart(end),
        salaryStructureId: assignment.salaryStructureId,
        payrollEntryId: row.id,
        salaryWithholdingId: withholding?.id || null,
        modeOfPayment: assignment.salaryStructure.modeOfPayment || 'Bank Transfer',
        totalWorkingDays,
        paymentDays,
        unmarkedDays: 0,
        leaveWithoutPay,
        absentDays,
        earnings: built.earnings,
        deductions: built.deductions,
        grossPay: built.grossPay,
        totalDeduction: built.totalDeduction,
        netPay: withholding ? 0 : built.netPay,
        roundedTotal: withholding ? 0 : built.roundedTotal,
        status: 'Draft',
        docStatus: 0
      };

      const existing = await prisma.hrSalarySlip.findFirst({
        where: {
          companyId,
          employeeId,
          payrollEntryId: row.id,
          status: { not: 'Cancelled' }
        }
      });

      let slip;
      if (existing && existing.status === 'Draft') {
        slip = await prisma.hrSalarySlip.update({ where: { id: existing.id }, data: payload });
      } else if (existing && existing.status === 'Submitted') {
        slip = existing;
      } else {
        slip = await prisma.hrSalarySlip.create({ data: payload });
      }

      if (submit && !withholding && slip.status === 'Draft') {
        slip = await prisma.hrSalarySlip.update({
          where: { id: slip.id },
          data: { status: 'Submitted', docStatus: 1 }
        });
      }

      await syncLegacyPayrollItemFromSlip(slip, companyId, {
        customTax: built.customTax,
        incomeTaxSlabId: assignment.incomeTaxSlabId
      });
      created.push(slip.id);
    } catch (error) {
      errors.push(`${employeeId}: ${error.message}`);
    }
  }

  return prisma.hrPayrollEntry.update({
    where: { id: row.id },
    data: {
      salarySlipsCreated: created.length > 0,
      salarySlipsSubmitted: submit && created.length > 0 && errors.length === 0,
      numberOfEmployees: employees.length,
      errorMessage: errors.length ? errors.slice(0, 8).join(' | ') : ''
    }
  });
}

async function submitSalarySlipsForPayrollEntry({ row, companyId }) {
  const slips = await prisma.hrSalarySlip.findMany({
    where: { companyId, payrollEntryId: row.id, status: 'Draft' }
  });
  for (const slip of slips) {
    if (slip.salaryWithholdingId) continue;
    const submitted = await prisma.hrSalarySlip.update({
      where: { id: slip.id },
      data: { status: 'Submitted', docStatus: 1 }
    });
    const assignment = slip.salaryStructureId
      ? await prisma.hrSalaryStructureAssignment.findFirst({
          where: { companyId, employeeId: slip.employeeId, salaryStructureId: slip.salaryStructureId },
          orderBy: { fromDate: 'desc' }
        })
      : null;
    const taxLine = (Array.isArray(slip.deductions) ? slip.deductions : []).find((d) => d.isIncomeTaxComponent);
    await syncLegacyPayrollItemFromSlip(submitted, companyId, {
      customTax: Number(taxLine?.amount || 0),
      incomeTaxSlabId: assignment?.incomeTaxSlabId
    });
  }
  return prisma.hrPayrollEntry.update({
    where: { id: row.id },
    data: { salarySlipsSubmitted: true, errorMessage: '' }
  });
}

async function generateSalarySlipsFromPayrollEntry({ row, companyId }) {
  // Called on Payroll Entry Submit — create + submit slips in one HR-friendly step.
  return createSalarySlipsForPayrollEntry({ row, companyId, submit: true });
}

async function preparePayrollEntry({ data, companyId }) {
  if (!data.postingDate) data.postingDate = new Date();
  if (!data.currency) data.currency = 'PKR';
  if (!data.exchangeRate) data.exchangeRate = 1;
  if (!data.payrollFrequency) data.payrollFrequency = 'Monthly';
  if (Array.isArray(data.employees)) {
    data.numberOfEmployees = data.employees.filter((e) => e && e.employeeId && e.isActive !== false).length;
  }
  // Soft validation: warn via errorMessage if withheld employees were manually included
  if (Array.isArray(data.employees) && data.startDate) {
    const withheld = await loadActiveWithholdings(companyId, data.startDate, data.endDate || data.startDate);
    const withheldIds = new Set(withheld.map((w) => w.employeeId));
    const blocked = data.employees.filter((e) => e?.employeeId && withheldIds.has(e.employeeId));
    if (blocked.length) {
      data.employees = data.employees.filter((e) => !e?.employeeId || !withheldIds.has(e.employeeId));
      data.numberOfEmployees = data.employees.length;
      data.errorMessage = `Removed ${blocked.length} withheld employee(s) from this payroll run`;
    }
  }
  return data;
}

async function applyBenefitClaimSideEffects({ row, companyId }) {
  const employee = await prisma.hrEmployee.findFirst({
    where: { id: row.employeeId, companyId },
    select: { id: true, employeeName: true, employeeCode: true }
  });
  const period = row.claimedOn ? ymd(row.claimedOn).slice(0, 7) : periodOf(new Date());
  const existingLedger = await prisma.hrEmployeeBenefitLedger.findFirst({
    where: {
      companyId,
      employeeId: row.employeeId,
      referenceDocument: row.id,
      transactionType: 'Claim'
    }
  });
  if (!existingLedger) {
    await prisma.hrEmployeeBenefitLedger.create({
      data: {
        companyId,
        postingDate: dayStart(row.claimedOn || new Date()),
        employeeId: row.employeeId,
        employeeName: employee?.employeeName || employee?.employeeCode || '',
        salaryComponentId: row.salaryComponentId || null,
        payrollPeriod: period,
        referenceDoctype: 'Employee Benefit Claim',
        referenceDocument: row.id,
        transactionType: 'Claim',
        amount: round2(row.amount || 0),
        remarks: 'Auto-posted on benefit claim approval'
      }
    });
  }

  // Prefer booking onto an open salary slip for the same month (flexible benefit payout).
  const openSlip = await prisma.hrSalarySlip.findFirst({
    where: {
      companyId,
      employeeId: row.employeeId,
      status: 'Draft',
      startDate: { gte: dayStart(`${period}-01`) }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (openSlip) {
    const earnings = Array.isArray(openSlip.earnings) ? [...openSlip.earnings] : [];
    if (!earnings.some((e) => e.sourceId === row.id)) {
      earnings.push({
        salaryComponentId: row.salaryComponentId || null,
        abbr: 'BEN',
        amount: round2(row.amount || 0),
        defaultAmount: round2(row.amount || 0),
        dependsOnPaymentDays: false,
        sourceId: row.id
      });
      const grossPay = round2(earnings.reduce((s, r) => s + Number(r.amount || 0), 0));
      const netPay = round2(grossPay - Number(openSlip.totalDeduction || 0));
      await prisma.hrSalarySlip.update({
        where: { id: openSlip.id },
        data: {
          earnings,
          grossPay,
          netPay,
          roundedTotal: Math.round(netPay)
        }
      });
    }
  }

  return prisma.hrEmployeeBenefitClaim.findFirst({ where: { id: row.id } });
}

module.exports = {
  preparePayrollEntry,
  getEmployeesForPayrollEntry,
  createSalarySlipsForPayrollEntry,
  submitSalarySlipsForPayrollEntry,
  generateSalarySlipsFromPayrollEntry,
  syncLegacyPayrollItemFromSlip,
  applyBenefitClaimSideEffects,
  helpers: {
    round2,
    periodOf,
    workingDaysBetween,
    loadActiveWithholdings,
    latestAssignment
  }
};
