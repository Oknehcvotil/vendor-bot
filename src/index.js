const { Telegraf, Markup } = require("telegraf");

const { config } = require("./config");
const { db } = require("./store");
const {
  isApprovedRole,
  canApprove,
  canManageSuppliers,
  isOwner,
} = require("./roles");
const { ensureUser, ensureApproved } = require("./middleware");
const {
  addFlow,
  searchFlow,
  deleteSupplierFlow,
  editSupplierSelectFlow,
  editSupplierFlow,
  clearUserFlows,
} = require("./flows");
const {
  categoryButtons,
  askSearchMode,
  openMainMenu,
  showHelp,
} = require("./handlers/menu");
const {
  showPendingUsers,
  showManageableUsers,
  leaveBot,
  promptRemoveUserConfirmation,
} = require("./handlers/users");
const {
  runSupplierSearch,
  promptRemoveSupplierConfirmation,
  beginDeleteSupplier,
  openSupplierEditMenu,
  beginEditSupplierSelectById,
  beginAddSupplier,
  handleAddSupplierText,
  handleEditSupplierText,
} = require("./handlers/suppliers");
const { registerInlineActions } = require("./handlers/actions");

const bot = new Telegraf(config.botToken);

function getCommandArg(ctx) {
  return ctx.message.text.split(" ").slice(1).join(" ").trim();
}

async function requireCommandRole(ctx, checkRole, denyMessage) {
  if (!checkRole(ctx.state.user.role)) {
    await ctx.reply(denyMessage);
    return false;
  }
  return true;
}

async function parseCommandId(ctx, usageMessage) {
  const id = Number(getCommandArg(ctx));
  if (!Number.isInteger(id)) {
    await ctx.reply(usageMessage);
    return null;
  }
  return id;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  if (!ctx.from) return;
  const user = await ensureUser(ctx.from);
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
  const user = await ensureUser(ctx.from);
  if (!isApprovedRole(user.role)) {
    await ctx.reply("Only approved users can use this bot.");
    return;
  }
  await showHelp(ctx, user);
});

bot.command("browse", ensureApproved, async (ctx) => {
  const buttons = await categoryButtons(null, "browse");
  await ctx.reply("Select category:", Markup.inlineKeyboard(buttons));
});

bot.command("search", ensureApproved, async (ctx) => {
  const query = getCommandArg(ctx);
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
  if (
    !(await requireCommandRole(
      ctx,
      canApprove,
      "Only admin can approve users.",
    ))
  ) {
    return;
  }
  const userId = await parseCommandId(ctx, "Usage: /approve <telegram_id>");
  if (userId == null) {
    return;
  }
  const target = await db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found. Ask them to run /start first.");
    return;
  }
  await db.setRole(userId, "supplier");
  await ctx.reply(`User ${userId} approved.`);
});

bot.command("makeadmin", ensureApproved, async (ctx) => {
  if (
    !(await requireCommandRole(
      ctx,
      isOwner,
      "Only owner can grant admin role.",
    ))
  ) {
    return;
  }
  const userId = await parseCommandId(ctx, "Usage: /makeadmin <telegram_id>");
  if (userId == null) {
    return;
  }
  const target = await db.getUser(userId);
  if (!target) {
    await ctx.reply("User not found. Ask them to run /start first.");
    return;
  }
  if (target.role === "owner") {
    await ctx.reply("Owner cannot be changed.");
    return;
  }
  await db.setRole(userId, "admin");
  await ctx.reply(`User ${userId} is now admin.`);
});

bot.command("addsupplier", ensureApproved, async (ctx) => {
  await beginAddSupplier(ctx, ctx.state.user.role);
});

bot.command("editsupplier", ensureApproved, async (ctx) => {
  if (
    !(await requireCommandRole(
      ctx,
      canManageSuppliers,
      "Only admin can edit suppliers.",
    ))
  ) {
    return;
  }
  const value = getCommandArg(ctx);
  if (!value) {
    await beginEditSupplierSelectById(ctx);
    return;
  }
  const supplierId = Number(value);
  if (!Number.isInteger(supplierId)) {
    await ctx.reply("Usage: /editsupplier <supplier_id>");
    return;
  }
  editSupplierSelectFlow.delete(ctx.from.id);
  editSupplierFlow.delete(ctx.from.id);
  await openSupplierEditMenu(ctx, supplierId);
});

bot.command("removeuser", ensureApproved, async (ctx) => {
  const userId = await parseCommandId(ctx, "Usage: /removeuser <telegram_id>");
  if (userId == null) {
    return;
  }
  await promptRemoveUserConfirmation(ctx, userId);
});

bot.command("deletesupplier", ensureApproved, async (ctx) => {
  if (
    !(await requireCommandRole(
      ctx,
      canManageSuppliers,
      "Only admin can delete suppliers.",
    ))
  ) {
    return;
  }
  const value = getCommandArg(ctx);
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
  clearUserFlows(ctx.from.id);
  await ctx.reply("Action cancelled.");
});

bot.command("listadmins", ensureApproved, async (ctx) => {
  if (
    !(await requireCommandRole(
      ctx,
      canApprove,
      "Only admin can view admin list.",
    ))
  ) {
    return;
  }
  const owner = await db.listUsersByRole("owner");
  const admins = await db.listUsersByRole("admin");
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

// ─── Keyboard buttons ─────────────────────────────────────────────────────────

bot.hears("Browse suppliers", ensureApproved, async (ctx) => {
  const buttons = await categoryButtons(null, "browse");
  await ctx.reply("Select category:", Markup.inlineKeyboard(buttons));
});
bot.hears("Search suppliers", ensureApproved, (ctx) => askSearchMode(ctx));
bot.hears("Pending users", ensureApproved, (ctx) =>
  showPendingUsers(ctx, ctx.state.user.role),
);
bot.hears("Users", ensureApproved, (ctx) => showManageableUsers(ctx));
bot.hears("Add supplier", ensureApproved, (ctx) =>
  beginAddSupplier(ctx, ctx.state.user.role),
);
bot.hears("Edit supplier", ensureApproved, (ctx) =>
  beginEditSupplierSelectById(ctx),
);
bot.hears("Delete supplier", ensureApproved, (ctx) => beginDeleteSupplier(ctx));
bot.hears("Leave bot", (ctx) => leaveBot(ctx));
bot.hears("Help", ensureApproved, (ctx) => showHelp(ctx, ctx.state.user));

// ─── Text input ───────────────────────────────────────────────────────────────

bot.on("text", ensureApproved, async (ctx) => {
  const { id } = ctx.from;
  const text = ctx.message.text.trim();

  const addFlowData = addFlow.get(id);
  if (addFlowData) {
    if (!canApprove(ctx.state.user.role)) {
      addFlow.delete(id);
      await ctx.reply("Only admin can add suppliers.");
      return;
    }
    await handleAddSupplierText(ctx, addFlowData, text);
    return;
  }

  const editFlow = editSupplierFlow.get(id);
  if (editFlow && editFlow.step === "field") {
    if (!canManageSuppliers(ctx.state.user.role)) {
      editSupplierFlow.delete(id);
      await ctx.reply("Only admin can edit suppliers.");
      return;
    }
    await handleEditSupplierText(ctx, editFlow, text);
    return;
  }

  if (editSupplierSelectFlow.has(id)) {
    if (!canManageSuppliers(ctx.state.user.role)) {
      editSupplierSelectFlow.delete(id);
      await ctx.reply("Only admin can edit suppliers.");
      return;
    }
    const supplierId = Number(text);
    if (!Number.isInteger(supplierId)) {
      await ctx.reply(
        "Supplier ID must be a number. Send supplier ID or /cancel.",
      );
      return;
    }
    editSupplierSelectFlow.delete(id);
    await openSupplierEditMenu(ctx, supplierId);
    return;
  }

  if (deleteSupplierFlow.has(id)) {
    const supplierId = Number(text);
    if (!Number.isInteger(supplierId)) {
      await ctx.reply(
        "Supplier ID must be a number. Send supplier ID or /cancel.",
      );
      return;
    }
    deleteSupplierFlow.delete(id);
    await promptRemoveSupplierConfirmation(ctx, supplierId);
    return;
  }

  const searchMode = searchFlow.get(id);
  if (searchMode) {
    searchFlow.delete(id);
    await runSupplierSearch(ctx, text, searchMode);
    return;
  }

  await ctx.reply(
    "I did not understand this message. Please choose one of the actions below.",
  );
  await openMainMenu(ctx);
});

registerInlineActions(bot);

// ─── Error handler & launch ───────────────────────────────────────────────────

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
