const addFlow = new Map();
const searchFlow = new Map();
const deleteSupplierFlow = new Set();
const editSupplierSelectFlow = new Set();
const editSupplierFlow = new Map();

function clearUserFlows(userId) {
  addFlow.delete(userId);
  searchFlow.delete(userId);
  deleteSupplierFlow.delete(userId);
  editSupplierSelectFlow.delete(userId);
  editSupplierFlow.delete(userId);
}

module.exports = {
  addFlow,
  searchFlow,
  deleteSupplierFlow,
  editSupplierSelectFlow,
  editSupplierFlow,
  clearUserFlows,
};
