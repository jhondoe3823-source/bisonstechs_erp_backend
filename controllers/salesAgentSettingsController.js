'use strict';

const {
  getSettings,
  updateSettings,
  previewSlabForAmount,
  normalizeSlabs,
} = require('../services/salesAgentSettingsService');

function resolveCompanyId(req) {
  return req.user?.companyId || req.companyIdFilter || null;
}

const getSalesAgentSettings = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const data = await getSettings(companyId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('getSalesAgentSettings error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to load sales agent settings',
    });
  }
};

const putSalesAgentSettings = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const data = await updateSettings(companyId, req.body || {});
    return res.status(200).json({
      success: true,
      message: 'Sales agent settings saved',
      data,
    });
  } catch (error) {
    console.error('putSalesAgentSettings error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save sales agent settings',
    });
  }
};

/** Preview which slab rate applies for a monthly sales amount (no persist). */
const previewCommissionSlab = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const monthlySales = Number(req.body?.monthlySales ?? req.query?.monthlySales ?? 0) || 0;
    const settings = await getSettings(companyId);
    const slabs =
      req.body?.commissionSlabs !== undefined
        ? normalizeSlabs(req.body.commissionSlabs)
        : settings.commissionSlabs;

    const preview = previewSlabForAmount(monthlySales, slabs);
    return res.status(200).json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('previewCommissionSlab error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to preview commission slab',
    });
  }
};

module.exports = {
  getSalesAgentSettings,
  putSalesAgentSettings,
  previewCommissionSlab,
};
