const { config } = require("./config");

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

function canManageUsers(role) {
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

function canRemoveTarget(actor, target) {
  if (!target) return false;
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

module.exports = {
  isApprovedRole,
  canApprove,
  canManageSuppliers,
  canManageUsers,
  isOwner,
  roleLabel,
  canRemoveTarget,
};
