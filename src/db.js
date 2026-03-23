const { Pool } = require("pg");

const { CATEGORY_TREE } = require("./categories");

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

function toUser(row) {
  if (!row) {
    return null;
  }

  return {
    telegramId: Number(row.telegram_id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toCategory(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
  };
}

function toSupplier(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: row.name,
    maker: row.maker,
    remarks: row.remarks,
    currency: row.currency,
    paymentTerms: row.payment_terms,
    categoryId: row.category_id,
    emailEncrypted: row.email_encrypted,
    phoneEncrypted: row.phone_encrypted,
    createdBy: Number(row.created_by),
    createdAt: row.created_at.toISOString(),
  };
}

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
      UNIQUE(name, parent_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      maker TEXT,
      remarks TEXT,
      currency TEXT,
      payment_terms TEXT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      email_encrypted TEXT NOT NULL,
      phone_encrypted TEXT,
      created_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency TEXT;",
  );
  await pool.query(
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT;",
  );

  await pool.query("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_suppliers_category_id ON suppliers(category_id);",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers(LOWER(name));",
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_suppliers_maker_lower ON suppliers(LOWER(maker));",
  );
}

async function syncCategoryTree(pool) {
  const categories = buildCategoryIndex();

  for (const category of categories) {
    await pool.query(
      `
      INSERT INTO categories (id, name, parent_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        parent_id = EXCLUDED.parent_id
      `,
      [category.id, category.name, category.parentId],
    );
  }
}

function initDb(connectionString) {
  const pool = new Pool({ connectionString });
  const ready = (async () => {
    await initSchema(pool);
    await syncCategoryTree(pool);
  })();

  async function getUser(telegramId) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT telegram_id, username, full_name, role, created_at, updated_at
      FROM users
      WHERE telegram_id = $1
      `,
      [telegramId],
    );
    return toUser(rows[0]);
  }

  async function upsertUser({ telegramId, username, fullName, role }) {
    await ready;

    const { rows } = await pool.query(
      `
      INSERT INTO users (telegram_id, username, full_name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (telegram_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        full_name = EXCLUDED.full_name,
        updated_at = NOW()
      RETURNING telegram_id, username, full_name, role, created_at, updated_at
      `,
      [telegramId, username, fullName, role],
    );

    return toUser(rows[0]);
  }

  async function setRole(telegramId, role) {
    await ready;
    const { rows } = await pool.query(
      `
      UPDATE users
      SET role = $2,
          updated_at = NOW()
      WHERE telegram_id = $1
      RETURNING telegram_id, username, full_name, role, created_at, updated_at
      `,
      [telegramId, role],
    );

    return toUser(rows[0]);
  }

  async function listPending() {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT telegram_id, username, full_name, role, created_at, updated_at
      FROM users
      WHERE role = 'pending'
      ORDER BY created_at ASC
      `,
    );

    return rows.map(toUser);
  }

  async function listUsersByRole(role) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT telegram_id, username, full_name, role, created_at, updated_at
      FROM users
      WHERE role = $1
      ORDER BY full_name ASC
      `,
      [role],
    );

    return rows.map(toUser);
  }

  async function listUsers() {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT telegram_id, username, full_name, role, created_at, updated_at
      FROM users
      ORDER BY full_name ASC
      `,
    );

    return rows.map(toUser);
  }

  async function removeUser(telegramId) {
    await ready;
    const { rows } = await pool.query(
      `
      DELETE FROM users
      WHERE telegram_id = $1
      RETURNING telegram_id, username, full_name, role, created_at, updated_at
      `,
      [telegramId],
    );

    return toUser(rows[0]);
  }

  async function getRootCategories() {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT id, name, parent_id
      FROM categories
      WHERE parent_id IS NULL
      ORDER BY name ASC
      `,
    );

    return rows.map(toCategory);
  }

  async function getChildren(parentId) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT id, name, parent_id
      FROM categories
      WHERE parent_id = $1
      ORDER BY name ASC
      `,
      [parentId],
    );

    return rows.map(toCategory);
  }

  async function getCategory(id) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT id, name, parent_id
      FROM categories
      WHERE id = $1
      `,
      [id],
    );

    return toCategory(rows[0]);
  }

  async function addSupplier({
    name,
    maker,
    remarks,
    currency,
    paymentTerms,
    categoryId,
    emailEncrypted,
    phoneEncrypted,
    createdBy,
  }) {
    await ready;

    const { rows } = await pool.query(
      `
      INSERT INTO suppliers
      (name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by, created_at
      `,
      [
        name,
        maker || null,
        remarks || null,
        currency || null,
        paymentTerms || null,
        categoryId,
        emailEncrypted,
        phoneEncrypted || null,
        createdBy,
      ],
    );

    return toSupplier(rows[0]);
  }

  async function clearSuppliers() {
    await ready;
    await pool.query("TRUNCATE TABLE suppliers RESTART IDENTITY;");
  }

  async function getSuppliersByCategory(categoryId) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT id, name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by, created_at
      FROM suppliers
      WHERE category_id = $1
      ORDER BY name ASC
      `,
      [categoryId],
    );

    return rows.map(toSupplier);
  }

  async function getSupplierById(supplierId) {
    await ready;
    const { rows } = await pool.query(
      `
      SELECT id, name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by, created_at
      FROM suppliers
      WHERE id = $1
      `,
      [supplierId],
    );

    return toSupplier(rows[0]);
  }

  async function removeSupplier(supplierId) {
    await ready;
    const { rows } = await pool.query(
      `
      DELETE FROM suppliers
      WHERE id = $1
      RETURNING id, name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by, created_at
      `,
      [supplierId],
    );

    return toSupplier(rows[0]);
  }

  async function searchSuppliers(query, mode = "any") {
    await ready;
    const needle = query.trim();
    if (!needle) {
      return [];
    }

    const likeNeedle = `%${needle.toLowerCase()}%`;
    let sql = `
      SELECT id, name, maker, remarks, currency, payment_terms, category_id, email_encrypted, phone_encrypted, created_by, created_at
      FROM suppliers
    `;
    let params = [likeNeedle];

    if (mode === "name") {
      sql += " WHERE LOWER(name) LIKE $1";
    } else if (mode === "maker") {
      sql += " WHERE LOWER(COALESCE(maker, '')) LIKE $1";
    } else {
      sql += " WHERE LOWER(name) LIKE $1 OR LOWER(COALESCE(maker, '')) LIKE $1";
    }

    sql += " ORDER BY name ASC";

    const { rows } = await pool.query(sql, params);
    return rows.map(toSupplier);
  }

  async function getCategoryPath(categoryId) {
    await ready;
    const { rows } = await pool.query(
      `
      WITH RECURSIVE category_path AS (
        SELECT id, name, parent_id, 0 AS depth
        FROM categories
        WHERE id = $1

        UNION ALL

        SELECT c.id, c.name, c.parent_id, cp.depth + 1
        FROM categories c
        JOIN category_path cp ON c.id = cp.parent_id
      )
      SELECT name
      FROM category_path
      ORDER BY depth DESC
      `,
      [categoryId],
    );

    return rows.map((row) => row.name);
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
