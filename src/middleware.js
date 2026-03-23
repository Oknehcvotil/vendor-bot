const { config } = require("./config");
const { db } = require("./store");
const { isApprovedRole } = require("./roles");
const { userDisplayName } = require("./utils");

async function ensureUser(from) {
  let role = "pending";
  if (from.id === config.ownerId) {
    role = "owner";
  }

  await db.upsertUser({
    telegramId: from.id,
    username: from.username || null,
    fullName: userDisplayName(from),
    role,
  });

  const user = await db.getUser(from.id);
  if (from.id === config.ownerId && user.role !== "owner") {
    return db.setRole(from.id, "owner");
  }
  return user;
}

async function ensureApproved(ctx, next) {
  if (!ctx.from) return;

  const user = await ensureUser(ctx.from);
  ctx.state.user = user;

  if (!isApprovedRole(user.role)) {
    await ctx.reply("Access denied. Wait for admin approval.");
    return;
  }

  await next();
}

module.exports = { ensureUser, ensureApproved };
