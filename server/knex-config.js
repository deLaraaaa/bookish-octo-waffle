const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const connection = process.env.DATABASE_URL;

const config = {
  client: "pg",
  connection: connection,
  migrations: {
    tableName: "knex_migrations",
    directory: path.resolve(__dirname, "./migrations")
  },
  seeds: {
    directory: path.resolve(__dirname, "./seeds")
  }
};

module.exports = config;
