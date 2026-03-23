const { Markup } = require("telegraf");

const { db } = require("../store");
const {
  canApprove,
  canManageSuppliers,
  canManageUsers,
  isOwner,
  canRemoveTarget,
} = require("../roles");
const { escapeHtml } = require("../utils");
const {
  searchFlow,
  editSupplierSelectFlow,
  editSupplierFlow,
  clearUserFlows,
} = require("../flows");
const { ensureApproved } = require("../middleware");
const { categoryButtons, addChooseButtons } = require("./menu");
const { promptRemoveUserConfirmation } = require("./users");
const {
  renderSupplier,
  promptRemoveSupplierConfirmation,
  editFieldPrompt,
  openSupplierEditMenu,
  handleAddCategoryChoose,
  handleEditCategoryChoose,
} = require("./suppliers");

async function requireActionRole(ctx, checkRole, denyMessage = "Forbidden") {
  if (!checkRole(ctx.state.user.role)) {
    await ctx.answerCbQuery(denyMessage);
    return false;
  }
  return true;
}

function registerInlineActions(bot) {
  bot.action(/^(browse|addcat|editcat):(\d+)$/, ensureApproved, async (ctx) => {
    const mode = ctx.match[1];
    const categoryId = Number(ctx.match[2]);
    const category = await db.getCategory(categoryId);
    if (!category) {
      await ctx.answerCbQuery("Category not found");
      return;
    }

    const children = await db.getChildren(categoryId);
    const isLeaf = children.length === 0;

    if (mode === "browse" && isLeaf) {
      await ctx.answerCbQuery();
      const suppliers = await db.getSuppliersByCategory(categoryId);
      const backKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback("Back to root", "browse_root")],
      ]);
      if (suppliers.length === 0) {
        await ctx.editMessageText(
          `No suppliers in ${escapeHtml(category.name)}.`,
          backKeyboard,
        );
        return;
      }
      const includeId = canManageSuppliers(ctx.state.user.role);
      const lines = await Promise.all(
        suppliers.map((s) => renderSupplier(s, { includeId })),
      );
      await ctx.editMessageText(
        `Suppliers in ${escapeHtml(category.name)}:\n\n${lines.join("\n\n")}`,
        { parse_mode: "HTML", ...backKeyboard },
      );
      return;
    }

    const buttons = children.map((child) => [
      Markup.button.callback(child.name, `${mode}:${child.id}`),
    ]);
    buttons.push(...addChooseButtons(categoryId, mode, isLeaf));
    await ctx.editMessageText(
      isLeaf
        ? `Category: ${category.name}\nThis is the final category. You can select it.`
        : `Category: ${category.name}\nChoose one of the subcategories (final path required).`,
      Markup.inlineKeyboard(buttons),
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^(browse|addcat|editcat)_root$/, ensureApproved, async (ctx) => {
    const mode = ctx.match[1];
    const buttons = await categoryButtons(null, mode);
    await ctx.editMessageText(
      "Select category:",
      Markup.inlineKeyboard(buttons),
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^approve:(\d+)$/, ensureApproved, async (ctx) => {
    if (!(await requireActionRole(ctx, canApprove))) {
      return;
    }
    const userId = Number(ctx.match[1]);
    const target = await db.getUser(userId);
    if (!target) {
      await ctx.answerCbQuery("User not found");
      return;
    }
    await db.setRole(userId, "supplier");
    await ctx.editMessageText(`Approved: ${target.fullName} (${userId})`);
    await ctx.answerCbQuery("Approved");
  });

  bot.action(/^makeadmin:(\d+)$/, ensureApproved, async (ctx) => {
    if (!(await requireActionRole(ctx, isOwner, "Only owner can do this"))) {
      return;
    }
    const userId = Number(ctx.match[1]);
    const target = await db.getUser(userId);
    if (!target) {
      await ctx.answerCbQuery("User not found");
      return;
    }
    if (target.role === "owner") {
      await ctx.answerCbQuery("Cannot change owner");
      return;
    }
    await db.setRole(userId, "admin");
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
    const target = await db.getUser(userId);
    if (!(await requireActionRole(ctx, canManageUsers))) {
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
    clearUserFlows(userId);
    await db.removeUser(userId);
    await ctx.editMessageText(
      `Removed from bot: ${target.fullName} (${userId})`,
    );
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
    if (!(await requireActionRole(ctx, canManageSuppliers))) {
      return;
    }
    const supplierId = Number(ctx.match[1]);
    const supplier = await db.getSupplierById(supplierId);
    if (!supplier) {
      await ctx.editMessageText("Supplier not found.");
      await ctx.answerCbQuery("Not found");
      return;
    }
    await db.removeSupplier(supplierId);
    await ctx.editMessageText(
      `Supplier deleted: #${supplier.id} ${supplier.name}`,
    );
    await ctx.answerCbQuery("Deleted");
  });

  bot.action(/^delsuppliercancel:(\d+)$/, ensureApproved, async (ctx) => {
    await ctx.editMessageText("Supplier deletion canceled.");
    await ctx.answerCbQuery("Canceled");
  });

  bot.action(
    /^editsupplierfield:(\d+):(name|maker|email|phone|remarks|currency|paymentTerms)$/,
    ensureApproved,
    async (ctx) => {
      if (!(await requireActionRole(ctx, canManageSuppliers))) {
        return;
      }
      const supplierId = Number(ctx.match[1]);
      const supplier = await db.getSupplierById(supplierId);
      if (!supplier) {
        await ctx.answerCbQuery("Supplier not found");
        return;
      }
      const field = ctx.match[2];
      editSupplierSelectFlow.delete(ctx.from.id);
      editSupplierFlow.set(ctx.from.id, { step: "field", supplierId, field });
      await ctx.reply(editFieldPrompt(field));
      await ctx.answerCbQuery("Send new value");
    },
  );

  bot.action(/^editsuppliercat:(\d+)$/, ensureApproved, async (ctx) => {
    if (!(await requireActionRole(ctx, canManageSuppliers))) {
      return;
    }
    const supplierId = Number(ctx.match[1]);
    const supplier = await db.getSupplierById(supplierId);
    if (!supplier) {
      await ctx.answerCbQuery("Supplier not found");
      return;
    }
    editSupplierSelectFlow.delete(ctx.from.id);
    editSupplierFlow.set(ctx.from.id, { step: "category", supplierId });
    const buttons = await categoryButtons(null, "editcat");
    await ctx.reply("Choose new category:", Markup.inlineKeyboard(buttons));
    await ctx.answerCbQuery();
  });

  bot.action(/^editsupplierdone:(\d+)$/, ensureApproved, async (ctx) => {
    clearUserFlows(ctx.from.id);
    await ctx.editMessageText("Supplier editing finished.");
    await ctx.answerCbQuery("Done");
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
    const category = await db.getCategory(categoryId);
    if (!category) {
      await ctx.answerCbQuery("Category not found");
      return;
    }
    if ((await db.getChildren(categoryId)).length > 0) {
      await ctx.answerCbQuery("Choose a final subcategory");
      return;
    }
    const suppliers = await db.getSuppliersByCategory(categoryId);
    if (suppliers.length === 0) {
      await ctx.reply(`No suppliers in ${category.name}.`);
      await ctx.answerCbQuery();
      return;
    }
    const includeId = canManageSuppliers(ctx.state.user.role);
    const lines = await Promise.all(
      suppliers.map((s) => renderSupplier(s, { includeId })),
    );
    await ctx.reply(
      `Suppliers in ${escapeHtml(category.name)}:\n\n${lines.join("\n\n")}`,
      { parse_mode: "HTML" },
    );
    await ctx.answerCbQuery();
  });

  bot.action(/^addcat_choose:(\d+)$/, ensureApproved, async (ctx) => {
    if (
      !(await requireActionRole(
        ctx,
        canApprove,
        "Only admin can add suppliers",
      ))
    ) {
      return;
    }
    await handleAddCategoryChoose(ctx, Number(ctx.match[1]));
  });

  bot.action(/^editcat_choose:(\d+)$/, ensureApproved, async (ctx) => {
    if (!(await requireActionRole(ctx, canManageSuppliers))) {
      return;
    }
    await handleEditCategoryChoose(ctx, Number(ctx.match[1]));
  });
}

module.exports = {
  registerInlineActions,
};
