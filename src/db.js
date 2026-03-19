const fs = require("fs");
const path = require("path");

const { CATEGORY_TREE } = require("./categories");

function nowIso() {
  return new Date().toISOString();
}

function buildCategoryIndex() {
  const categories = [];
  let nextId = 1;

  function walk(nodes, parentId) {
    for (const node of nodes) {
      const id = nextId;
      nextId += 1;
      categories.push({ id, name: node.name, parentId });
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, id);
      }
    }
  }

  walk(CATEGORY_TREE, null);
  return categories;
}

function syncCategoryTree(state) {
  if (!Array.isArray(state.categories)) {
    state.categories = [];
  }

  let changed = false;
  let nextId = state.categories.reduce((max, c) => Math.max(max, c.id || 0), 0) + 1;

  function findCategory(name, parentId) {
    return state.categories.find((c) => c.name === name && c.parentId === parentId) || null;
  }

  function walk(nodes, parentId) {
    for (const node of nodes) {
      let current = findCategory(node.name, parentId);
      if (!current) {
        current = { id: nextId, name: node.name, parentId };
        nextId += 1;
        state.categories.push(current);
        changed = true;
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, current.id);
      }
    }
  }

  walk(CATEGORY_TREE, null);
  return changed;
}

function initDb(databasePath) {
  const dir = path.dirname(databasePath);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(databasePath)) {
    const initial = {
      users: [],
      categories: buildCategoryIndex(),
      suppliers: [],
      counters: {
        supplierId: 1,
      },
    };
    fs.writeFileSync(databasePath, JSON.stringify(initial, null, 2), "utf8");
  }

  function load() {
    const text = fs.readFileSync(databasePath, "utf8");
    const state = JSON.parse(text);
    if (!Array.isArray(state.categories) || state.categories.length === 0) {
      state.categories = buildCategoryIndex();
    }
    const categoriesUpdated = syncCategoryTree(state);
    if (!state.counters || typeof state.counters.supplierId !== "number") {
      state.counters = {
        supplierId: Math.max(1, ...state.suppliers.map((s) => s.id + 1), 1),
      };
    }

    let suppliersUpdated = false;
    if (Array.isArray(state.suppliers)) {
      for (const supplier of state.suppliers) {
        if (!("maker" in supplier)) {
          supplier.maker = null;
          suppliersUpdated = true;
        }
        if (!("remarks" in supplier)) {
          supplier.remarks = null;
          suppliersUpdated = true;
        }
        if (!("phoneEncrypted" in supplier)) {
          supplier.phoneEncrypted = null;
          suppliersUpdated = true;
        }
      }
    }

    if (categoriesUpdated || suppliersUpdated) {
      save(state);
    }
    return state;
  }

  function save(state) {
    const tmp = `${databasePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, databasePath);
  }

  function getUser(telegramId) {
    const state = load();
    return state.users.find((u) => u.telegramId === telegramId) || null;
  }

  function upsertUser({ telegramId, username, fullName, role }) {
    const state = load();
    const existing = state.users.find((u) => u.telegramId === telegramId);
    if (!existing) {
      state.users.push({
        telegramId,
        username,
        fullName,
        role,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    } else {
      existing.username = username;
      existing.fullName = fullName;
      existing.updatedAt = nowIso();
    }
    save(state);
    return state.users.find((u) => u.telegramId === telegramId);
  }

  function setRole(telegramId, role) {
    const state = load();
    const user = state.users.find((u) => u.telegramId === telegramId);
    if (!user) {
      return null;
    }
    user.role = role;
    user.updatedAt = nowIso();
    save(state);
    return user;
  }

  function listPending() {
    const state = load();
    return state.users
      .filter((u) => u.role === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function listUsersByRole(role) {
    const state = load();
    return state.users
      .filter((u) => u.role === role)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function listUsers() {
    const state = load();
    return [...state.users].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function removeUser(telegramId) {
    const state = load();
    const index = state.users.findIndex((u) => u.telegramId === telegramId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.users.splice(index, 1);
    save(state);
    return removed;
  }

  function getRootCategories() {
    const state = load();
    return state.categories
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getChildren(parentId) {
    const state = load();
    return state.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCategory(id) {
    const state = load();
    return state.categories.find((c) => c.id === id) || null;
  }

  function addSupplier({
    name,
    maker,
    remarks,
    categoryId,
    emailEncrypted,
    phoneEncrypted,
    createdBy,
  }) {
    const state = load();
    const supplier = {
      id: state.counters.supplierId,
      name,
      maker: maker || null,
      remarks: remarks || null,
      categoryId,
      emailEncrypted,
      phoneEncrypted: phoneEncrypted || null,
      createdBy,
      createdAt: nowIso(),
    };

    state.counters.supplierId += 1;
    state.suppliers.push(supplier);
    save(state);
    return supplier;
  }

  function clearSuppliers() {
    const state = load();
    state.suppliers = [];
    state.counters.supplierId = 1;
    save(state);
  }

  function getSuppliersByCategory(categoryId) {
    const state = load();
    return state.suppliers
      .filter((s) => s.categoryId === categoryId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getSupplierById(supplierId) {
    const state = load();
    return state.suppliers.find((s) => s.id === supplierId) || null;
  }

  function removeSupplier(supplierId) {
    const state = load();
    const index = state.suppliers.findIndex((s) => s.id === supplierId);
    if (index === -1) {
      return null;
    }

    const [removed] = state.suppliers.splice(index, 1);
    save(state);
    return removed;
  }

  function searchSuppliers(query, mode = "any") {
    const state = load();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [];
    }

    return state.suppliers
      .filter((supplier) => {
        const byName = supplier.name.toLowerCase().includes(needle);
        const byMaker = (supplier.maker || "").toLowerCase().includes(needle);

        if (mode === "name") {
          return byName;
        }
        if (mode === "maker") {
          return byMaker;
        }
        return byName || byMaker;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCategoryPath(categoryId) {
    const state = load();
    const byId = new Map(state.categories.map((c) => [c.id, c]));

    const path = [];
    let current = byId.get(categoryId) || null;
    while (current) {
      path.unshift(current.name);
      current = current.parentId == null ? null : byId.get(current.parentId) || null;
    }

    return path;
  }

  return {
    getUser,
    upsertUser,
    setRole,
    listPending,
    listUsers,
    listUsersByRole,
    removeUser,
    getRootCategories,
    getChildren,
    getCategory,
    addSupplier,
    clearSuppliers,
    getSuppliersByCategory,
    getSupplierById,
    removeSupplier,
    searchSuppliers,
    getCategoryPath,
  };
}

module.exports = {
  initDb,
};
