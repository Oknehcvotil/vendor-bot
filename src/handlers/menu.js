const { Markup } = require("telegraf");
const { db } = require("../store");
const { canManageUsers, isOwner, canApprove } = require("../roles");
const { clearUserFlows } = require("../flows");

async function categoryButtons(parentId, mode) {
  const rows =
    parentId == null
      ? await db.getRootCategories()
      : await db.getChildren(parentId);
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

function searchModeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Search by supplier name", "searchmode:name")],
    [Markup.button.callback("Search by maker", "searchmode:maker")],
  ]);
}

async function askSearchMode(ctx) {
  if (ctx.from) {
    clearUserFlows(ctx.from.id);
  }
  await ctx.reply("Choose search mode:", searchModeKeyboard());
}

async function openMainMenu(ctx) {
  const { role } = ctx.state.user;
  const rows = [["Browse suppliers", "Search suppliers"]];

  if (canManageUsers(role)) {
    rows.push(["Add supplier", "Edit supplier", "Delete supplier"]);
    rows.push(["Pending users", "Users"]);
  }

  rows.push(["Help"]);
  rows.push(["Leave bot"]);

  await ctx.reply("Choose an action:", Markup.keyboard(rows).resize());
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
      "- /editsupplier <supplier_id>: edit supplier fields",
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

module.exports = {
  categoryButtons,
  addChooseButtons,
  searchModeKeyboard,
  askSearchMode,
  openMainMenu,
  showHelp,
};
