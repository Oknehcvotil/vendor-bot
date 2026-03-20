const fs = require("fs");
const path = require("path");

const { config } = require("./config");
const { initDb } = require("./db");
const { encryptText } = require("./crypto");

const db = initDb(config.databaseUrl);

function usage() {
  console.log(
    [
      "Usage:",
      "npm run import:suppliers -- <path-to-json> [--replace]",
      "",
      "Example:",
      "npm run import:suppliers -- suppliers.json --replace",
    ].join("\n"),
  );
}

function getArgs() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const fileArg = args.find((arg) => !arg.startsWith("--"));

  if (!fileArg) {
    usage();
    process.exit(1);
  }

  return {
    replace,
    filePath: path.resolve(process.cwd(), fileArg),
  };
}

async function ensureOwnerUser() {
  await db.upsertUser({
    telegramId: config.ownerId,
    username: null,
    fullName: "Owner",
    role: "owner",
  });

  const owner = await db.getUser(config.ownerId);
  if (!owner || owner.role !== "owner") {
    await db.setRole(config.ownerId, "owner");
  }
}

async function resolveCategoryPath(categoryPath) {
  if (!Array.isArray(categoryPath) || categoryPath.length === 0) {
    throw new Error("categoryPath must be a non-empty array");
  }

  let current = (await db.getRootCategories()).find(
    (category) => category.name === categoryPath[0],
  );
  if (!current) {
    throw new Error(`Unknown root category: ${categoryPath[0]}`);
  }

  for (let index = 1; index < categoryPath.length; index += 1) {
    const name = categoryPath[index];
    current = (await db.getChildren(current.id)).find(
      (category) => category.name === name,
    );
    if (!current) {
      throw new Error(`Unknown category path: ${categoryPath.join(" > ")}`);
    }
  }

  if ((await db.getChildren(current.id)).length > 0) {
    throw new Error(
      `Category path must end at a final subcategory: ${categoryPath.join(" > ")}`,
    );
  }

  return current;
}

function validateRecord(record, index) {
  if (!record || typeof record !== "object") {
    throw new Error(`Record ${index + 1} must be an object`);
  }
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error(`Record ${index + 1}: name is required`);
  }
  if (
    (typeof record.email !== "string" && !Array.isArray(record.email)) ||
    (typeof record.email === "string" && !record.email.trim()) ||
    (Array.isArray(record.email) && record.email.length === 0)
  ) {
    throw new Error(`Record ${index + 1}: email is required`);
  }
  if (record.phone !== undefined && record.phone !== null) {
    const phoneIsString =
      typeof record.phone === "string" && record.phone.trim();
    const phoneIsArray =
      Array.isArray(record.phone) &&
      record.phone.length > 0 &&
      record.phone.some((value) => typeof value === "string" && value.trim());

    if (!phoneIsString && !phoneIsArray) {
      throw new Error(
        `Record ${index + 1}: phone must be a non-empty string or array when provided`,
      );
    }
  }
  if (!Array.isArray(record.categoryPath) || record.categoryPath.length === 0) {
    throw new Error(
      `Record ${index + 1}: categoryPath must be a non-empty array`,
    );
  }
  if (record.maker !== undefined && record.maker !== null) {
    const makerIsString =
      typeof record.maker === "string" && record.maker.trim();
    const makerIsArray =
      Array.isArray(record.maker) &&
      record.maker.length > 0 &&
      record.maker.some((value) => typeof value === "string" && value.trim());

    if (!makerIsString && !makerIsArray) {
      throw new Error(
        `Record ${index + 1}: maker must be a non-empty string or array when provided`,
      );
    }
  }

  if (record.remarks !== undefined && record.remarks !== null) {
    const remarksIsString =
      typeof record.remarks === "string" && record.remarks.trim();
    const remarksIsArray =
      Array.isArray(record.remarks) &&
      record.remarks.length > 0 &&
      record.remarks.some((value) => typeof value === "string" && value.trim());

    if (!remarksIsString && !remarksIsArray) {
      throw new Error(
        `Record ${index + 1}: remarks must be a non-empty string or array when provided`,
      );
    }
  }
}

function normalizeTextField(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);

    if (normalized.length === 0) {
      return null;
    }

    return normalized.join("; ");
  }

  return null;
}

function loadImportFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Import file must contain a JSON array");
  }

  data.forEach(validateRecord);
  return data;
}

async function importSuppliers(filePath, replace) {
  const records = loadImportFile(filePath);
  await ensureOwnerUser();

  if (replace) {
    await db.clearSuppliers();
  }

  for (const record of records) {
    const category = await resolveCategoryPath(record.categoryPath);
    const email = normalizeTextField(record.email);
    if (!email) {
      throw new Error(`Record with name '${record.name}': email is required`);
    }

    const maker = normalizeTextField(record.maker);
    const remarks = normalizeTextField(record.remarks);
    const phone = normalizeTextField(record.phone);

    await db.addSupplier({
      name: record.name.trim(),
      maker,
      remarks,
      categoryId: category.id,
      emailEncrypted: encryptText(email, config.contactsSecret),
      phoneEncrypted: phone ? encryptText(phone, config.contactsSecret) : null,
      createdBy: config.ownerId,
    });
  }

  console.log(`Imported ${records.length} suppliers from ${filePath}`);
  console.log(
    replace
      ? "Mode: replace existing suppliers"
      : "Mode: append to existing suppliers",
  );
}

(async () => {
  try {
    const { filePath, replace } = getArgs();
    await importSuppliers(filePath, replace);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
