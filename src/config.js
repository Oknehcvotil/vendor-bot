require("dotenv").config();

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const config = {
  botToken: required("BOT_TOKEN"),
  ownerId: Number(required("OWNER_ID")),
  contactsSecret: required("CONTACTS_SECRET"),
  databasePath: (process.env.DATABASE_PATH || "data/vendors.db").trim(),
};

if (!Number.isInteger(config.ownerId)) {
  throw new Error("OWNER_ID must be a valid integer");
}

module.exports = {
  config,
};
