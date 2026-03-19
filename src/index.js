const { Telegraf, Markup } = require("telegraf");

const { config } = require("./config");
const { initDb } = require("./db");
const { encryptText, decryptText } = require("./crypto");

const db = initDb(config.databasePath);
const bot = new Telegraf(config.botToken);
const addFlow = new Map();
const searchFlow = new Map();
const deleteSupplierFlow = new Set();

function userDisplayName(from) {
  const first = from.first_name || "";
  const last = from.last_name || "";
  return `${first} ${last}`.trim() || from.username || `User ${from.id}`;
}

function ensureUser(from) {
  let role = "pending";
  if (from.id === config.ownerId) {
    role = "owner";
  }

  db.upsertUser({
    telegramId: from.id,
    username: from.username || null,
    fullName: userDisplayName(from),
    role,
  });

  const user = db.getUser(from.id);
  if (from.id === config.ownerId && user.role !== "owner") {
    return db.setRole(from.id, "owner");
  }
  return user;
}

function isApprovedRole(role) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "supplier" ||
    role === "user"
  );
}

function canApprove(role) {
  return role === "owner" || role === "admin";
}

function canManageSuppliers(role) {
  return role === "owner" || role === "admin";
}

function isOwner(role) {
  return role === "owner";
}

function roleLabel(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "supplier" || role === "user") return "Supplier";
  return "Pending";
}

function canManageUsers(role) {
  return role === "owner" || role === "admin";
}

function canRemoveTarget(actor, target) {
  if (!target) {
    return false;
  }
  if (target.role === "owner" || target.telegramId === config.ownerId) {
    return false;
  }
  if (actor.role === "owner") {
    return actor.telegramId !== target.telegramId;
  }
  if (actor.role === "admin") {
    return (
      target.role === "supplier" ||
      target.role === "user" ||
      target.role === "pending"
    );
  }
  return false;
}

function categoryButtons(parentId, mode) {
  const rows =
    parentId == null ? db.getRootCategories() : db.getChildren(parentId);
  return rows.map((c) => [Markup.button.callback(c.name, `${mode}:${c.id}`)]);
}

function addChooseButtons(categoryId, mode, canSelectCurrent) {
  const buttons = [];
  if (canSelectCurrent) {
    buttons.push([
      Markup.button.callback(
        "Select this category",
        `${mode}_choose:${categoryId}`,
      ),
    ]);
  }
  buttons.push([Markup.button.callback("Back to root", `${mode}_root`)]);
  return buttons;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function openMainMenu(ctx) {
  const role = ctx.state.user.role;
  const rows = [["Browse suppliers", "Search suppliers"]];

  if (canManageUsers(role)) {
    rows.push(["Add supplier", "Delete supplier"]);
    rows.push(["Pending users", "Users"]);
  }

  rows.push(["Help"]);
  rows.push(["Leave bot"]);

  await ctx.reply(
    "Choose an action:",
    Markup.keyboard(rows).resize(),
  );
}

async function showHelp(ctx, user) {
  const lines = [
    "Help - Main Features",
    "",
    "For all approved users:",
    "- /start: open main menu",
    "- /browse: view suppliers by category",
    "- /search: choose search mode (name or maker)",
    "- /leave: remove your own access from bot",
  ];

  if (canManageUsers(user.role)) {
    lines.push("", "Admin features:");
    lines.push(
      "- /pending: view pending access requests",
      "- /approve <telegram_id>: approve supplier access",
      "- /users: list users that can be removed",
      "- /removeuser <telegram_id>: remove user (with Yes/No confirm)",
      "- /addsupplier: add a new supplier",
      "- /deletesupplier <supplier_id>: delete supplier (with Yes/No confirm)",
      "- /listadmins: list admins and owner",
    );
  }

  if (isOwner(user.role)) {
    lines.push("", "Owner only:");
    lines.push("- /makeadmin <telegram_id>: grant admin role");
  }

  lines.push("", "Utility:", "- /cancel: cancel current add/search flow");
  await ctx.reply(lines.join("\n"));
}

async function ensureApproved(ctx, next) {
  if (!ctx.from) return;

  const user = ensureUser(ctx.from);
  ctx.state.user = user;

  if (!isApprovedRole(user.role)) {
    await ctx.reply("Access denied. Wait for admin approval.");
    return;
  }

  await next();
}

async function showPendingUsers(ctx, role) {
  if (!canApprove(role)) {
    await ctx.reply("Only admin can view pending users.");
    return;
  }

  const pending = db.listPending();
  if (pending.length === 0) {
    await ctx.reply("No pending users.");
    return;
  }

  for (const p of pending) {
    const text = `ID: ${p.telegramId}\nName: ${p.fullName}\nUsername: @${p.username || "-"}`;
    await ctx.reply(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("Approve user", `approve:${p.telegramId}`)],
        [Markup.button.callback("Make admin", `makeadmin:${p.telegramId}`)],
        [Markup.button.callback("Remove from bot", `removeuser:${p.telegramId}`)],
      ]),
    );
  }
}

async function showManageableUsers(ctx) {
  const actor = ctx.state.user;
  if (!canManageUsers(actor.role)) {
    await ctx.reply("Only admin can manage users.");
    return;
  }

  const users = db
    .listUsers()
    .filter((target) => canRemoveTarget(actor, target));

  if (users.length === 0) {
    await ctx.reply("No removable users found.");
    return;
  }

  for (const user of users) {
    const text = [
      `ID: ${user.telegramId}`,
      `Name: ${user.fullName}`,
      `Username: @${user.username || "-"}`,
      `Role: ${roleLabel(user.role)}`,
    ].join("\n");

    await ctx.reply(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("Remove from bot", `removeuser:${user.telegramId}`)],
      ]),
    );
  }
}

async function leaveBot(ctx) {
  if (!ctx.from) {
    return;
  }

  const user = db.getUser(ctx.from.id) || ensureUser(ctx.from);
  if (!user) {
    await ctx.reply("You are not registered in the bot.");
    return;
  }

  if (user.role === "owner" || user.telegramId === config.ownerId) {
    await ctx.reply("Owner cannot leave the bot.");
    return;
  }

  addFlow.delete(ctx.from.id);
  searchFlow.delete(ctx.from.id);
  db.removeUser(ctx.from.id);
  await ctx.reply("You have been removed from the bot. If needed, send /start to request access again.", Markup.removeKeyboard());
}

async function removeUserByAdmin(ctx, userId) {
  const actor = ctx.state.user;
  if (!canManageUsers(actor.role)) {
    await ctx.reply("Only admin can remove users.");
    return false;
  }

  const target = db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found.");
    return false;
  }

  if (!canRemoveTarget(actor, target)) {
    await ctx.reply("You cannot remove this user.");
    return false;
  }

  addFlow.delete(userId);
  searchFlow.delete(userId);
  db.removeUser(userId);
  await ctx.reply(`Removed from bot: ${target.fullName} (${userId}).`);
  return true;
}

function removalConfirmKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Yes", `removeconfirm:${userId}`)],
    [Markup.button.callback("No", `removecancel:${userId}`)],
  ]);
}

async function promptRemoveUserConfirmation(ctx, userId, options = {}) {
  const actor = ctx.state.user;
  if (!canManageUsers(actor.role)) {
    await ctx.reply("Only admin can remove users.");
    return false;
  }

  const target = db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found.");
    return false;
  }

  if (!canRemoveTarget(actor, target)) {
    await ctx.reply("You cannot remove this user.");
    return false;
  }

  const text = `Remove user ${target.fullName} (${userId}) from bot?`;
  if (options.editCurrentMessage) {
    await ctx.editMessageText(text, removalConfirmKeyboard(userId));
  } else {
    await ctx.reply(text, removalConfirmKeyboard(userId));
  }

  return true;
}

async function beginAddSupplier(ctx, role) {
  if (!canApprove(role)) {
    await ctx.reply("Only admin can add suppliers.");
    return;
  }

  addFlow.set(ctx.from.id, {
    step: "name",
  });

  await ctx.reply("Send supplier name (or /cancel).");
}

async function beginDeleteSupplier(ctx) {
  if (!canManageSuppliers(ctx.state.user.role)) {
    await ctx.reply("Only admin can delete suppliers.");
    return;
  }

  deleteSupplierFlow.add(ctx.from.id);
  await ctx.reply("Send supplier ID to delete (or /cancel).");
}

function searchModeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Search by supplier name", "searchmode:name")],
    [Markup.button.callback("Search by maker", "searchmode:maker")],
  ]);
}

async function askSearchMode(ctx) {
  await ctx.reply("Choose search mode:", searchModeKeyboard());
}

function renderSupplier(supplier, options = {}) {
  const email = decryptText(supplier.emailEncrypted, config.contactsSecret);
  const phone = supplier.phoneEncrypted
    ? decryptText(supplier.phoneEncrypted, config.contactsSecret)
    : null;
  const lines = [`• ${escapeHtml(supplier.name)}`];
  if (options.includeId) {
    lines.push(`  ID: ${supplier.id}`);
  }
  if (supplier.maker) {
    lines.push(`  Maker: ${escapeHtml(supplier.maker)}`);
  }
  if (supplier.remarks) {
    lines.push(`  <b>Remarks:</b> ${escapeHtml(supplier.remarks)}`);
  }
  if (options.includeCategory) {
    const categoryPath = escapeHtml(db.getCategoryPath(supplier.categoryId).join(" > "));
    lines.push(`  Category: ${categoryPath}`);
  }
  lines.push(`  Email: ${escapeHtml(email)}`);
  if (phone) {
    lines.push(`  Phone: ${escapeHtml(phone)}`);
  }
  return lines.join("\n");
}

async function runSupplierSearch(ctx, query, mode) {
  const text = (query || "").trim();
  if (text.length < 2) {
    await ctx.reply("Search text must be at least 2 characters.");
    return;
  }

  const matches = db.searchSuppliers(text, mode);
  if (matches.length === 0) {
    await ctx.reply("No suppliers found.");
    return;
  }

  const lines = matches.map((supplier) =>
    renderSupplier(supplier, {
      includeCategory: true,
      includeId: canManageSuppliers(ctx.state.user.role),
    }),
  );
  await ctx.reply(`Found ${matches.length} supplier(s):\n\n${lines.join("\n\n")}`, {
    parse_mode: "HTML",
  });
}

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

  const supplier = db.getSupplierById(supplierId);
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

bot.start(async (ctx) => {
  if (!ctx.from) return;

  const user = ensureUser(ctx.from);
  ctx.state.user = user;
  if (!isApprovedRole(user.role)) {
    await ctx.reply("Your request is pending. Admin must approve access.");
    return;
  }

  await ctx.reply(`Welcome, ${user.fullName}.`);
  await openMainMenu(ctx);
});

bot.command("help", async (ctx) => {
  if (!ctx.from) return;

  const user = ensureUser(ctx.from);
  if (!isApprovedRole(user.role)) {
    await ctx.reply("Only approved users can use this bot.");
    return;
  }
  await showHelp(ctx, user);
});

bot.command("browse", ensureApproved, async (ctx) => {
  const buttons = categoryButtons(null, "browse");
  await ctx.reply("Select category:", Markup.inlineKeyboard(buttons));
});

bot.command("search", ensureApproved, async (ctx) => {
  const query = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if (!query) {
    await askSearchMode(ctx);
    return;
  }

  await runSupplierSearch(ctx, query, "any");
});

bot.command("pending", ensureApproved, async (ctx) => {
  await showPendingUsers(ctx, ctx.state.user.role);
});

bot.command("users", ensureApproved, async (ctx) => {
  await showManageableUsers(ctx);
});

bot.command("approve", ensureApproved, async (ctx) => {
  if (!canApprove(ctx.state.user.role)) {
    await ctx.reply("Only admin can approve users.");
    return;
  }

  const value = ctx.message.text.split(" ").slice(1).join(" ").trim();
  const userId = Number(value);
  if (!Number.isInteger(userId)) {
    await ctx.reply("Usage: /approve <telegram_id>");
    return;
  }

  const target = db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found. Ask them to run /start first.");
    return;
  }

  db.setRole(userId, "supplier");
  await ctx.reply(`User ${userId} approved.`);
});

bot.command("makeadmin", ensureApproved, async (ctx) => {
  if (!isOwner(ctx.state.user.role)) {
    await ctx.reply("Only owner can grant admin role.");
    return;
  }

  const value = ctx.message.text.split(" ").slice(1).join(" ").trim();
  const userId = Number(value);
  if (!Number.isInteger(userId)) {
    await ctx.reply("Usage: /makeadmin <telegram_id>");
    return;
  }

  const target = db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found. Ask them to run /start first.");
    return;
  }

  if (target.role === "owner") {
    await ctx.reply("Owner cannot be changed.");
    return;
  }

  db.setRole(userId, "admin");
  await ctx.reply(`User ${userId} is now admin.`);
});

bot.command("addsupplier", ensureApproved, async (ctx) => {
  await beginAddSupplier(ctx, ctx.state.user.role);
});

bot.command("removeuser", ensureApproved, async (ctx) => {
  const value = ctx.message.text.split(" ").slice(1).join(" ").trim();
  const userId = Number(value);
  if (!Number.isInteger(userId)) {
    await ctx.reply("Usage: /removeuser <telegram_id>");
    return;
  }

  await promptRemoveUserConfirmation(ctx, userId);
});

bot.command("deletesupplier", ensureApproved, async (ctx) => {
  if (!canManageSuppliers(ctx.state.user.role)) {
    await ctx.reply("Only admin can delete suppliers.");
    return;
  }

  const value = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if (!value) {
    await beginDeleteSupplier(ctx);
    return;
  }

  const supplierId = Number(value);
  if (!Number.isInteger(supplierId)) {
    await ctx.reply("Usage: /deletesupplier <supplier_id>");
    return;
  }

  await promptRemoveSupplierConfirmation(ctx, supplierId);
});

bot.command("leave", async (ctx) => {
  await leaveBot(ctx);
});

bot.command("cancel", ensureApproved, async (ctx) => {
  addFlow.delete(ctx.from.id);
  searchFlow.delete(ctx.from.id);
  deleteSupplierFlow.delete(ctx.from.id);
  await ctx.reply("Action cancelled.");
});

bot.command("listadmins", ensureApproved, async (ctx) => {
  if (!canApprove(ctx.state.user.role)) {
    await ctx.reply("Only admin can view admin list.");
    return;
  }

  const owner = db.listUsersByRole("owner");
  const admins = db.listUsersByRole("admin");
  const rows = [...owner, ...admins];

  if (rows.length === 0) {
    await ctx.reply("No admins found.");
    return;
  }

  const lines = rows.map(
    (u) => `${u.fullName} (ID: ${u.telegramId}, @${u.username || "-"})`,
  );
  await ctx.reply(lines.join("\n"));
});

bot.hears("Browse suppliers", ensureApproved, async (ctx) => {
  const buttons = categoryButtons(null, "browse");
  await ctx.reply("Select category:", Markup.inlineKeyboard(buttons));
});

bot.hears("Search suppliers", ensureApproved, async (ctx) => {
  await askSearchMode(ctx);
});

bot.hears("Pending users", ensureApproved, async (ctx) => {
  await showPendingUsers(ctx, ctx.state.user.role);
});

bot.hears("Users", ensureApproved, async (ctx) => {
  await showManageableUsers(ctx);
});

bot.hears("Add supplier", ensureApproved, async (ctx) => {
  await beginAddSupplier(ctx, ctx.state.user.role);
});

bot.hears("Delete supplier", ensureApproved, async (ctx) => {
  await beginDeleteSupplier(ctx);
});

bot.hears("Leave bot", async (ctx) => {
  await leaveBot(ctx);
});

bot.hears("Help", ensureApproved, async (ctx) => {
  await showHelp(ctx, ctx.state.user);
});

bot.on("text", ensureApproved, async (ctx, next) => {
  const flow = addFlow.get(ctx.from.id);
  if (!flow) {
    if (deleteSupplierFlow.has(ctx.from.id)) {
      const supplierId = Number(ctx.message.text.trim());
      if (!Number.isInteger(supplierId)) {
        await ctx.reply("Supplier ID must be a number. Send supplier ID or /cancel.");
        return;
      }

      deleteSupplierFlow.delete(ctx.from.id);
      await promptRemoveSupplierConfirmation(ctx, supplierId);
      return;
    }

    const mode = searchFlow.get(ctx.from.id);
    if (mode) {
      searchFlow.delete(ctx.from.id);
      await runSupplierSearch(ctx, ctx.message.text, mode);
      return;
    }

    await ctx.reply("I did not understand this message. Please choose one of the actions below.");
    await openMainMenu(ctx);
    return;
  }

  if (!canApprove(ctx.state.user.role)) {
    addFlow.delete(ctx.from.id);
    await ctx.reply("Only admin can add suppliers.");
    return;
  }

  const text = ctx.message.text.trim();

  if (flow.step === "name") {
    if (!text) {
      await ctx.reply("Name cannot be empty. Send supplier name.");
      return;
    }
    flow.name = text;
    flow.step = "maker";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send maker (optional). Send '-' to skip.");
    return;
  }

  if (flow.step === "maker") {
    const normalized = text.toLowerCase();
    if (normalized === "-" || normalized === "skip" || normalized === "none" || normalized === "no" || normalized === "нет" || normalized === "пропустить") {
      flow.maker = null;
    } else {
      flow.maker = text;
    }
    flow.step = "email";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send supplier email.");
    return;
  }

  if (flow.step === "email") {
    if (!text.includes("@")) {
      await ctx.reply("Invalid email. Send again.");
      return;
    }
    flow.email = text;
    flow.step = "phone";
    addFlow.set(ctx.from.id, flow);
    await ctx.reply("Send supplier phone number (optional). Send '-' to skip.");
    return;
  }

  if (flow.step === "phone") {
    const normalized = text.toLowerCase();
    if (
      normalized === "-" ||
      normalized === "skip" ||
      normalized === "none" ||
      normalized === "no" ||
      normalized === "нет" ||
      normalized === "пропустить"
    ) {
      flow.phone = null;
    } else {
      flow.phone = text;
    }
    flow.step = "remarks";
    addFlow.set(ctx.from.id, flow);

    await ctx.reply("Send remarks (optional). Example: Egypt only. Send '-' to skip.");
    return;
  }

  if (flow.step === "remarks") {
    const normalized = text.toLowerCase();
    if (
      normalized === "-" ||
      normalized === "skip" ||
      normalized === "none" ||
      normalized === "no" ||
      normalized === "нет" ||
      normalized === "пропустить"
    ) {
      flow.remarks = null;
    } else {
      flow.remarks = text;
    }

    flow.step = "category";
    addFlow.set(ctx.from.id, flow);

    const buttons = categoryButtons(null, "addcat");
    await ctx.reply(
      "Choose category for this supplier:",
      Markup.inlineKeyboard(buttons),
    );
    return;
  }
});

bot.action(/^(browse|addcat):(\d+)$/, ensureApproved, async (ctx) => {
  const mode = ctx.match[1];
  const categoryId = Number(ctx.match[2]);
  const category = db.getCategory(categoryId);

  if (!category) {
    await ctx.answerCbQuery("Category not found");
    return;
  }

  const children = db.getChildren(categoryId);
  const buttons = children.map((child) => [
    Markup.button.callback(child.name, `${mode}:${child.id}`),
  ]);
  const isLeaf = children.length === 0;
  buttons.push(...addChooseButtons(categoryId, mode, isLeaf));

  await ctx.editMessageText(
    isLeaf
      ? `Category: ${category.name}\nThis is the final category. You can select it.`
      : `Category: ${category.name}\nChoose one of the subcategories (final path required).`,
    Markup.inlineKeyboard(buttons),
  );
  await ctx.answerCbQuery();
});

bot.action(/^(browse|addcat)_root$/, ensureApproved, async (ctx) => {
  const mode = ctx.match[1];
  const buttons = categoryButtons(null, mode);
  await ctx.editMessageText("Select category:", Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
});

bot.action(/^approve:(\d+)$/, ensureApproved, async (ctx) => {
  if (!canApprove(ctx.state.user.role)) {
    await ctx.answerCbQuery("Forbidden");
    return;
  }

  const userId = Number(ctx.match[1]);
  const target = db.getUser(userId);
  if (!target) {
    await ctx.answerCbQuery("User not found");
    return;
  }

  db.setRole(userId, "supplier");
  await ctx.editMessageText(`Approved: ${target.fullName} (${userId})`);
  await ctx.answerCbQuery("Approved");
});

bot.action(/^makeadmin:(\d+)$/, ensureApproved, async (ctx) => {
  if (!isOwner(ctx.state.user.role)) {
    await ctx.answerCbQuery("Only owner can do this");
    return;
  }

  const userId = Number(ctx.match[1]);
  const target = db.getUser(userId);
  if (!target) {
    await ctx.answerCbQuery("User not found");
    return;
  }

  if (target.role === "owner") {
    await ctx.answerCbQuery("Cannot change owner");
    return;
  }

  db.setRole(userId, "admin");
  await ctx.editMessageText(`Now admin: ${target.fullName} (${userId})`);
  await ctx.answerCbQuery("Updated");
});

bot.action(/^removeuser:(\d+)$/, ensureApproved, async (ctx) => {
  const userId = Number(ctx.match[1]);
  const ok = await promptRemoveUserConfirmation(ctx, userId, {
    editCurrentMessage: true,
  });
  await ctx.answerCbQuery(ok ? "Confirm action" : "Failed");
});

bot.action(/^removeconfirm:(\d+)$/, ensureApproved, async (ctx) => {
  const userId = Number(ctx.match[1]);
  const actor = ctx.state.user;
  const target = db.getUser(userId);

  if (!canManageUsers(actor.role)) {
    await ctx.answerCbQuery("Forbidden");
    return;
  }

  if (!target) {
    await ctx.editMessageText("User not found.");
    await ctx.answerCbQuery("Not found");
    return;
  }

  if (!canRemoveTarget(actor, target)) {
    await ctx.editMessageText("You cannot remove this user.");
    await ctx.answerCbQuery("Forbidden");
    return;
  }

  addFlow.delete(userId);
  searchFlow.delete(userId);
  db.removeUser(userId);
  await ctx.editMessageText(`Removed from bot: ${target.fullName} (${userId})`);
  await ctx.answerCbQuery("Removed");
});

bot.action(/^removecancel:(\d+)$/, ensureApproved, async (ctx) => {
  await ctx.editMessageText("Removal canceled.");
  await ctx.answerCbQuery("Canceled");
});

bot.action(/^deletesupplier:(\d+)$/, ensureApproved, async (ctx) => {
  const supplierId = Number(ctx.match[1]);
  const ok = await promptRemoveSupplierConfirmation(ctx, supplierId, {
    editCurrentMessage: true,
  });
  await ctx.answerCbQuery(ok ? "Confirm action" : "Failed");
});

bot.action(/^delsupplierconfirm:(\d+)$/, ensureApproved, async (ctx) => {
  if (!canManageSuppliers(ctx.state.user.role)) {
    await ctx.answerCbQuery("Forbidden");
    return;
  }

  const supplierId = Number(ctx.match[1]);
  const supplier = db.getSupplierById(supplierId);
  if (!supplier) {
    await ctx.editMessageText("Supplier not found.");
    await ctx.answerCbQuery("Not found");
    return;
  }

  db.removeSupplier(supplierId);
  await ctx.editMessageText(`Supplier deleted: #${supplier.id} ${supplier.name}`);
  await ctx.answerCbQuery("Deleted");
});

bot.action(/^delsuppliercancel:(\d+)$/, ensureApproved, async (ctx) => {
  await ctx.editMessageText("Supplier deletion canceled.");
  await ctx.answerCbQuery("Canceled");
});

bot.action(/^searchmode:(name|maker)$/, ensureApproved, async (ctx) => {
  const mode = ctx.match[1];
  searchFlow.set(ctx.from.id, mode);

  const prompt =
    mode === "name"
      ? "Send supplier name for search."
      : "Send maker for search.";

  await ctx.editMessageText(prompt);
  await ctx.answerCbQuery("Mode selected");
});

bot.action(/^browse_choose:(\d+)$/, ensureApproved, async (ctx) => {
  const categoryId = Number(ctx.match[1]);
  const category = db.getCategory(categoryId);

  if (!category) {
    await ctx.answerCbQuery("Category not found");
    return;
  }

  if (db.getChildren(categoryId).length > 0) {
    await ctx.answerCbQuery("Choose a final subcategory");
    return;
  }

  const suppliers = db.getSuppliersByCategory(categoryId);
  if (suppliers.length === 0) {
    await ctx.reply(`No suppliers in ${category.name}.`);
    await ctx.answerCbQuery();
    return;
  }

  const includeAdminControls = canManageSuppliers(ctx.state.user.role);
  const lines = suppliers.map((supplier) =>
    renderSupplier(supplier, {
      includeId: includeAdminControls,
    }),
  );
  await ctx.reply(`Suppliers in ${escapeHtml(category.name)}:\n\n${lines.join("\n\n")}`, {
    parse_mode: "HTML",
  });
  await ctx.answerCbQuery();
});

bot.action(/^addcat_choose:(\d+)$/, ensureApproved, async (ctx) => {
  if (!canApprove(ctx.state.user.role)) {
    await ctx.answerCbQuery("Only admin can add suppliers");
    return;
  }

  const flow = addFlow.get(ctx.from.id);
  if (!flow || flow.step !== "category") {
    await ctx.answerCbQuery("No active add flow");
    return;
  }

  const categoryId = Number(ctx.match[1]);
  const category = db.getCategory(categoryId);

  if (!category) {
    await ctx.answerCbQuery("Category not found");
    return;
  }

  if (db.getChildren(categoryId).length > 0) {
    await ctx.answerCbQuery("Choose a final subcategory");
    return;
  }

  db.addSupplier({
    name: flow.name,
    maker: flow.maker || null,
    remarks: flow.remarks || null,
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
});

bot.catch(async (err, ctx) => {
  console.error("Bot error:", err);
  if (ctx) {
    await ctx.reply("Unexpected error happened. Try again.");
  }
});

bot.launch().then(() => {
  console.log("Vendor bot started");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
