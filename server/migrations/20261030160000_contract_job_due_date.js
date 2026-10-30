/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tem = await knex.schema.hasColumn("contract_job", "due_date");
  if (!tem) {
    await knex.schema.alterTable("contract_job", (table) => {
      table.timestamp("due_date", { useTz: true }).nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const tem = await knex.schema.hasColumn("contract_job", "due_date");
  if (tem) {
    await knex.schema.alterTable("contract_job", (table) => {
      table.dropColumn("due_date");
    });
  }
};
