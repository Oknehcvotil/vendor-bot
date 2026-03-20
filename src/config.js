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
  databaseUrl: required("DATABASE_URL"),
};

if (!Number.isInteger(config.ownerId)) {
  throw new Error("OWNER_ID must be a valid integer");
}

module.exports = {
  config,
};
