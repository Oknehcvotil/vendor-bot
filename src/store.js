const { config } = require("./config");
const { initDb } = require("./db");

const db = initDb(config.databaseUrl);
console.log("Using Postgres DB");

module.exports = { db };
