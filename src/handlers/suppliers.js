const { Markup } = require("telegraf");
const { config } = require("../config");
const { db } = require("../store");
const { encryptText, decryptText } = require("../crypto");
const { canManageSuppliers, canApprove } = require("../roles");
const {
  escapeHtml,
  isSkipValue,
  isValidEmail,
  normalizePhone,
} = require("../utils");
const {
  addFlow,
  deleteSupplierFlow,
  editSupplierSelectFlow,
  editSupplierFlow,
  clearUserFlows,
} = require("../flows");
const { categoryButtons } = require("./menu");

const MAX_LEN = {
  name: 150,
  maker: 120,
  remarks: 500,
  currency: 20,
  paymentTerms: 200,
};

function normalizeText(value) {
  return String(value || "").trim();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function renderSupplier(supplier, options = {}) {
  const email = decryptText(supplier.emailEncrypted, config.contactsSecret);
  const phone = supplier.phoneEncrypted
    ? decryptText(supplier.phoneEncrypted, config.contactsSecret)
    : null;

  const lines = [`• ${escapeHtml(supplier.name)}`];
  if (options.includeId) {
    lines.push(`  ID: ${supplier.id}`);
  }
  if (options.includeCategory) {
    const categoryPath = escapeHtml(
      (await db.getCategoryPath(supplier.categoryId)).join(" > "),
    );
    lines.push(`  Category: ${categoryPath}`);
  }
  lines.push(`  Email: ${escapeHtml(email)}`);
  if (phone) {
    lines.push(`  Phone: ${escapeHtml(phone)}`);
  }
  if (supplier.remarks) {
    lines.push(`  <b>Remarks:</b> ${escapeHtml(supplier.remarks)}`);
  }
  if (supplier.maker) {
    lines.push(`  Maker: ${escapeHtml(supplier.maker)}`);
  }
  if (supplier.currency) {
    lines.push(`  Currency: ${escapeHtml(supplier.currency)}`);
  }
  if (supplier.paymentTerms) {
    lines.push(`  Payment terms: ${escapeHtml(supplier.paymentTerms)}`);
  }
  return lines.join("\n");
}

async function runSupplierSearch(ctx, query, mode) {
  const text = (query || "").trim();
  if (text.length < 2) {
    await ctx.reply("Search text must be at least 2 characters.");
    return;
  }

  const matches = await db.searchSuppliers(text, mode);
  if (matches.length === 0) {
    await ctx.reply("No suppliers found.");
    return;
  }

  const lines = await Promise.all(
    matches.map((s) =>
      renderSupplier(s, {
        includeCategory: true,
        includeId: canManageSuppliers(ctx.state.user.role),
      }),
    ),
  );
  await ctx.reply(
    `Found ${matches.length} supplier(s):\n\n${lines.join("\n\n")}`,
    { parse_mode: "HTML" },
  );
}

// ─── Delete flow ──────────────────────────────────────────────────────────────

function supplierRemovalConfirmKeyboard(supplierId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Yes", `delsupplierconfirm:${supplierId}`)],
    [Markup.button.callback("No", `delsuppliercancel:${supplierId}`)],
  ]);
}

async function promptRemoveSupplierConfirmation(ctx, supplierId, options = {}) {
  if (!canManageSuppliers(ctx.state.user.role)) {
    if (options.editCurrentMessage) {
      await ctx.editMessageText("Only admin can delete suppliers.");
    } else {
      await ctx.reply("Only admin can delete suppliers.");
    }
    return false;
  }

  const supplier = await db.getSupplierById(supplierId);
  if (!supplier) {
    if (options.editCurrentMessage) {
      await ctx.editMessageText("Supplier not found.");
    } else {
      await ctx.reply("Supplier not found.");
    }
    return false;
  }

  const text = `Delete supplier #${supplier.id}: ${supplier.name}?`;
  if (options.editCurrentMessage) {
    await ctx.editMessageText(text, supplierRemovalConfirmKeyboard(supplierId));
  } else {
    await ctx.reply(text, supplierRemovalConfirmKeyboard(supplierId));
  }
  return true;
}

async function beginDeleteSupplier(ctx) {
  if (!canManageSuppliers(ctx.state.user.role)) {
    await ctx.reply("Only admin can delete suppliers.");
    return;
  }
  clearUserFlows(ctx.from.id);
  deleteSupplierFlow.add(ctx.from.id);
  await ctx.reply("Send supplier ID to delete (or /cancel).");
}

// ─── Edit flow ────────────────────────────────────────────────────────────────

function supplierEditKeyboard(supplierId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Name", `editsupplierfield:${supplierId}:name`),
      Markup.button.callback("Maker", `editsupplierfield:${supplierId}:maker`),
    ],
    [
      Markup.button.callback("Email", `editsupplierfield:${supplierId}:email`),
      Markup.button.callback("Phone", `editsupplierfield:${supplierId}:phone`),
    ],
    [
      Markup.button.callback(
        "Remarks",
        `editsupplierfield:${supplierId}:remarks`,
      ),
      Markup.button.callback(
        "Currency",
        `editsupplierfield:${supplierId}:currency`,
      ),
    ],
    [
      Markup.button.callback(
        "Payment terms",
        `editsupplierfield:${supplierId}:paymentTerms`,
      ),
    ],
    [Markup.button.callback("Category", `editsuppliercat:${supplierId}`)],
    [Markup.button.callback("Done", `editsupplierdone:${supplierId}`)],
  ]);
}

function editFieldPrompt(field) {
  const prompts = {
    name: "Send new supplier name.",
    email: "Send new supplier email.",
    maker: "Send maker value. Send '-' to clear this field.",
    phone: "Send phone value. Send '-' to clear this field.",
    remarks: "Send remarks value. Send '-' to clear this field.",
    currency: "Send currency value. Send '-' to clear this field.",
    paymentTerms: "Send payment terms value. Send '-' to clear this field.",
  };
  return prompts[field] || "Send new value.";
}

function fieldDisplayName(field) {
  const names = {
    name: "name",
    maker: "maker",
    email: "email",
    phone: "phone",
    remarks: "remarks",
    currency: "currency",
    paymentTerms: "payment terms",
    category: "category",
  };
  return names[field] || field;
}

async function openSupplierEditMenu(ctx, supplierId, options = {}) {
  if (!canManageSuppliers(ctx.state.user.role)) {
    if (options.editCurrentMessage) {
      await ctx.editMessageText("Only admin can edit suppliers.");
    } else {
      await ctx.reply("Only admin can edit suppliers.");
    }
    return false;
  }

  const supplier = await db.getSupplierById(supplierId);
  if (!supplier) {
    if (options.editCurrentMessage) {
      await ctx.editMessageText("Supplier not found.");
    } else {
      await ctx.reply("Supplier not found.");
    }
    return false;
  }

  const details = await renderSupplier(supplier, {
    includeId: true,
    includeCategory: true,
  });
  const text = `Editing supplier:\n\n${details}\n\nChoose a field to update:`;
  const keyboard = supplierEditKeyboard(supplierId);

  if (options.editCurrentMessage) {
    await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
  }
  return true;
}

async function beginEditSupplierSelectById(ctx) {
  if (!canManageSuppliers(ctx.state.user.role)) {
    await ctx.reply("Only admin can edit suppliers.");
    return;
  }
  clearUserFlows(ctx.from.id);
  editSupplierSelectFlow.add(ctx.from.id);
  await ctx.reply("Send supplier ID to edit (or /cancel).");
}

// ─── Add flow ─────────────────────────────────────────────────────────────────

async function beginAddSupplier(ctx, role) {
  if (!canApprove(role)) {
    await ctx.reply("Only admin can add suppliers.");
    return;
  }
  clearUserFlows(ctx.from.id);
  addFlow.set(ctx.from.id, { step: "name" });
  await ctx.reply("Send supplier name (or /cancel).");
}

async function handleAddSupplierText(ctx, flow, text) {
  if (flow.step === "name") {
    const name = normalizeText(text);
    if (!name) {
      await ctx.reply("Name cannot be empty. Send supplier name.");
      return;
    }
    if (name.length > MAX_LEN.name) {
      await ctx.reply(`Name is too long (max ${MAX_LEN.name} chars).`);
      return;
    }
    flow.name = name;
    flow.step = "maker";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send maker (optional). Send '-' to skip.");
    return;
  }

  if (flow.step === "maker") {
    if (isSkipValue(text)) {
      flow.maker = null;
    } else {
      const maker = normalizeText(text);
      if (maker.length > MAX_LEN.maker) {
        await ctx.reply(`Maker is too long (max ${MAX_LEN.maker} chars).`);
        return;
      }
      flow.maker = maker || null;
    }
    flow.step = "email";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send supplier email.");
    return;
  }

  if (flow.step === "email") {
    const email = normalizeText(text).toLowerCase();
    if (!isValidEmail(email)) {
      await ctx.reply("Invalid email. Send again.");
      return;
    }
    flow.email = email;
    flow.step = "phone";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send supplier phone number (optional). Send '-' to skip.");
    return;
  }

  if (flow.step === "phone") {
    if (isSkipValue(text)) {
      flow.phone = null;
    } else {
      const phone = normalizePhone(text);
      if (!phone) {
        await ctx.reply("Invalid phone. Use digits and +()- symbols (5-20 digits).");
        return;
      }
      flow.phone = phone;
    }
    flow.step = "remarks";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply(
      "Send remarks (optional). Example: Egypt only. Send '-' to skip.",
    );
    return;
  }

  if (flow.step === "remarks") {
    if (isSkipValue(text)) {
      flow.remarks = null;
    } else {
      const remarks = normalizeText(text);
      if (remarks.length > MAX_LEN.remarks) {
        await ctx.reply(`Remarks are too long (max ${MAX_LEN.remarks} chars).`);
        return;
      }
      flow.remarks = remarks || null;
    }
    flow.step = "currency";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply(
      "Send payment currency (optional). Example: USD. Send '-' to skip.",
    );
    return;
  }

  if (flow.step === "currency") {
    if (isSkipValue(text)) {
      flow.currency = null;
    } else {
      const currency = normalizeText(text).toUpperCase();
      if (currency.length > MAX_LEN.currency) {
        await ctx.reply(`Currency is too long (max ${MAX_LEN.currency} chars).`);
        return;
      }
      flow.currency = currency || null;
    }
    flow.step = "paymentTerms";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply(
      "Send payment terms (optional). Example: credit / prepayment. Send '-' to skip.",
    );
    return;
  }

  if (flow.step === "paymentTerms") {
    if (isSkipValue(text)) {
      flow.paymentTerms = null;
    } else {
      const paymentTerms = normalizeText(text);
      if (paymentTerms.length > MAX_LEN.paymentTerms) {
        await ctx.reply(
          `Payment terms are too long (max ${MAX_LEN.paymentTerms} chars).`,
        );
        return;
      }
      flow.paymentTerms = paymentTerms || null;
    }
    flow.step = "category";
    addFlow.set(ctx.from.id, flow);
    const buttons = await categoryButtons(null, "addcat");
    await ctx.reply(
      "Choose category for this supplier:",
      Markup.inlineKeyboard(buttons),
    );
  }
}

async function handleEditSupplierText(ctx, flow, text) {
  const supplier = await db.getSupplierById(flow.supplierId);
  if (!supplier) {
    editSupplierFlow.delete(ctx.from.id);
    await ctx.reply("Supplier not found.");
    return;
  }

  const { field } = flow;
  const updates = {};

  if (field === "name") {
    const name = normalizeText(text);
    if (!name || isSkipValue(name)) {
      await ctx.reply("Name cannot be empty.");
      return;
    }
    if (name.length > MAX_LEN.name) {
      await ctx.reply(`Name is too long (max ${MAX_LEN.name} chars).`);
      return;
    }
    updates.name = name;
  } else if (field === "email") {
    const email = normalizeText(text).toLowerCase();
    if (!isValidEmail(email)) {
      await ctx.reply("Invalid email. Send again.");
      return;
    }
    updates.emailEncrypted = encryptText(email, config.contactsSecret);
  } else if (field === "phone") {
    if (isSkipValue(text)) {
      updates.phoneEncrypted = null;
    } else {
      const phone = normalizePhone(text);
      if (!phone) {
        await ctx.reply("Invalid phone. Use digits and +()- symbols (5-20 digits).");
        return;
      }
      updates.phoneEncrypted = encryptText(phone, config.contactsSecret);
    }
  } else if (field === "maker") {
    if (isSkipValue(text)) {
      updates.maker = null;
    } else {
      const maker = normalizeText(text);
      if (maker.length > MAX_LEN.maker) {
        await ctx.reply(`Maker is too long (max ${MAX_LEN.maker} chars).`);
        return;
      }
      updates.maker = maker || null;
    }
  } else if (field === "remarks") {
    if (isSkipValue(text)) {
      updates.remarks = null;
    } else {
      const remarks = normalizeText(text);
      if (remarks.length > MAX_LEN.remarks) {
        await ctx.reply(`Remarks are too long (max ${MAX_LEN.remarks} chars).`);
        return;
      }
      updates.remarks = remarks || null;
    }
  } else if (field === "currency") {
    if (isSkipValue(text)) {
      updates.currency = null;
    } else {
      const currency = normalizeText(text).toUpperCase();
      if (currency.length > MAX_LEN.currency) {
        await ctx.reply(`Currency is too long (max ${MAX_LEN.currency} chars).`);
        return;
      }
      updates.currency = currency || null;
    }
  } else if (field === "paymentTerms") {
    if (isSkipValue(text)) {
      updates.paymentTerms = null;
    } else {
      const paymentTerms = normalizeText(text);
      if (paymentTerms.length > MAX_LEN.paymentTerms) {
        await ctx.reply(
          `Payment terms are too long (max ${MAX_LEN.paymentTerms} chars).`,
        );
        return;
      }
      updates.paymentTerms = paymentTerms || null;
    }
  } else {
    await ctx.reply("Unknown field.");
    return;
  }

  await db.updateSupplier(flow.supplierId, updates);
  editSupplierFlow.delete(ctx.from.id);
  await ctx.reply(`Updated ${fieldDisplayName(field)}.`);
  await openSupplierEditMenu(ctx, flow.supplierId);
}

// ─── Category actions (add & edit) ───────────────────────────────────────────

async function handleAddCategoryChoose(ctx, categoryId) {
  const flow = addFlow.get(ctx.from.id);
  if (!flow || flow.step !== "category") {
    await ctx.answerCbQuery("No active add flow");
    return;
  }

  const category = await db.getCategory(categoryId);
  if (!category) {
    await ctx.answerCbQuery("Category not found");
    return;
  }
  if ((await db.getChildren(categoryId)).length > 0) {
    await ctx.answerCbQuery("Choose a final subcategory");
    return;
  }

  await db.addSupplier({
    name: flow.name,
    maker: flow.maker || null,
    remarks: flow.remarks || null,
    currency: flow.currency || null,
    paymentTerms: flow.paymentTerms || null,
    categoryId,
    emailEncrypted: encryptText(flow.email, config.contactsSecret),
    phoneEncrypted: flow.phone
      ? encryptText(flow.phone, config.contactsSecret)
      : null,
    createdBy: ctx.from.id,
  });

  addFlow.delete(ctx.from.id);
  await ctx.reply(`Supplier added to ${category.name}.`);
  await ctx.answerCbQuery("Saved");
}

async function handleEditCategoryChoose(ctx, categoryId) {
  const flow = editSupplierFlow.get(ctx.from.id);
  if (!flow || flow.step !== "category") {
    await ctx.answerCbQuery("No active edit flow");
    return;
  }

  const category = await db.getCategory(categoryId);
  if (!category) {
    await ctx.answerCbQuery("Category not found");
    return;
  }
  if ((await db.getChildren(categoryId)).length > 0) {
    await ctx.answerCbQuery("Choose a final subcategory");
    return;
  }

  const supplier = await db.getSupplierById(flow.supplierId);
  if (!supplier) {
    editSupplierFlow.delete(ctx.from.id);
    await ctx.reply("Supplier not found.");
    await ctx.answerCbQuery("Not found");
    return;
  }

  await db.updateSupplier(flow.supplierId, { categoryId });
  editSupplierFlow.delete(ctx.from.id);
  await ctx.reply(`Updated category to ${category.name}.`);
  await openSupplierEditMenu(ctx, flow.supplierId);
  await ctx.answerCbQuery("Saved");
}

module.exports = {
  renderSupplier,
  runSupplierSearch,
  supplierRemovalConfirmKeyboard,
  promptRemoveSupplierConfirmation,
  beginDeleteSupplier,
  supplierEditKeyboard,
  editFieldPrompt,
  fieldDisplayName,
  openSupplierEditMenu,
  beginEditSupplierSelectById,
  beginAddSupplier,
  handleAddSupplierText,
  handleEditSupplierText,
  handleAddCategoryChoose,
  handleEditCategoryChoose,
};
