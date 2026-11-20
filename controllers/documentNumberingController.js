'use strict';

const {
  getSettings,
  updateSettings,
  DOCUMENT_TYPE_CATALOG,
} = require('../services/documentNumberingService');

function resolveCompanyId(req) {
  return (
    req.user?.companyId ||
    req.companyIdFilter ||
    null
  );
}

const getDocumentNumberingSettings = async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required',
      });
    }

    const data = await getSettings(companyId);
    return res.status(200).json({
      success: true,
      data,
      catalog: DOCUMENT_TYPE_CATALOG,
    });
  } catch (error) {
    console.error('getDocumentNumberingSettings error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to load document numbering settings',
    });
  }
};

const putDocumentNumberingSettings = async (req, res) => {
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
      message: 'Document numbering settings saved',
      data,
    });
  } catch (error) {
    console.error('putDocumentNumberingSettings error:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to save document numbering settings',
    });
  }
};

module.exports = {
  getDocumentNumberingSettings,
  putDocumentNumberingSettings,
};
