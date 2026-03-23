const { Markup } = require("telegraf");
const { db } = require("../store");
const {
  canApprove,
  canManageUsers,
  canRemoveTarget,
  roleLabel,
} = require("../roles");
const { ensureUser } = require("../middleware");
const { clearUserFlows } = require("../flows");

function removalConfirmKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Yes", `removeconfirm:${userId}`)],
    [Markup.button.callback("No", `removecancel:${userId}`)],
  ]);
}

async function showPendingUsers(ctx, role) {
  if (!canApprove(role)) {
    await ctx.reply("Only admin can view pending users.");
    return;
  }

  const pending = await db.listPending();
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
        [
          Markup.button.callback(
            "Remove from bot",
            `removeuser:${p.telegramId}`,
          ),
        ],
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

  const users = (await db.listUsers()).filter((target) =>
    canRemoveTarget(actor, target),
  );

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
        [
          Markup.button.callback(
            "Remove from bot",
            `removeuser:${user.telegramId}`,
          ),
        ],
      ]),
    );
  }
}

async function leaveBot(ctx) {
  if (!ctx.from) return;

  const user = (await db.getUser(ctx.from.id)) || (await ensureUser(ctx.from));
  if (!user) {
    await ctx.reply("You are not registered in the bot.");
    return;
  }

  if (user.role === "owner") {
    await ctx.reply("Owner cannot leave the bot.");
    return;
  }

  clearUserFlows(ctx.from.id);
  await db.removeUser(ctx.from.id);
  await ctx.reply(
    "You have been removed from the bot. If needed, send /start to request access again.",
    Markup.removeKeyboard(),
  );
}

async function promptRemoveUserConfirmation(ctx, userId, options = {}) {
  const actor = ctx.state.user;
  if (!canManageUsers(actor.role)) {
    await ctx.reply("Only admin can remove users.");
    return false;
  }

  const target = await db.getUser(userId);
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

module.exports = {
  removalConfirmKeyboard,
  showPendingUsers,
  showManageableUsers,
  leaveBot,
  promptRemoveUserConfirmation,
};
