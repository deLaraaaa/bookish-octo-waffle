const MARCOS = ["3_meses", "1_mes", "1_semana"];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_milestone') THEN
      CREATE TYPE notification_milestone AS ENUM (${MARCOS.map((m) => `'${m}'`).join(", ")});
    END IF;
  END $$;`);

  if (!(await knex.schema.hasTable("contract_notification"))) {
    await knex.schema.createTable("contract_notification", (table) => {
      table.comment("Aviso de contrato se aproximando do vencimento.");
      table.bigIncrements("id").primary();
      table.uuid("uuid").notNullable().defaultTo(knex.raw("gen_random_uuid()"));
      table.unique(["uuid"], { indexName: "uq_contract_notification_uuid" });
      table.bigInteger("document_id").notNullable();
      table
        .specificType("milestone", "notification_milestone")
        .notNullable();
      table.timestamp("due_date", { useTz: true }).notNullable();
      table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));

      table
        .foreign("document_id", "fk_contract_notification_document")
        .references("id")
        .inTable("document")
        .onDelete("CASCADE");

      table.unique(["document_id", "milestone"], {
        indexName: "uq_contract_notification_document_milestone"
      });
      table.index(["insert_date"], "ix_contract_notification_insert_date");
    });
  }

  if (!(await knex.schema.hasTable("contract_notification_read"))) {
    await knex.schema.createTable("contract_notification_read", (table) => {
      table.comment("Marca que uma pessoa visualizou um aviso.");
      table.bigIncrements("id").primary();
      table.bigInteger("notification_id").notNullable();
      table.bigInteger("person_id").notNullable();
      table.timestamp("read_at", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));

      table
        .foreign("notification_id", "fk_contract_notification_read_notification")
        .references("id")
        .inTable("contract_notification")
        .onDelete("CASCADE");
      table
        .foreign("person_id", "fk_contract_notification_read_person")
        .references("id")
        .inTable("person")
        .onDelete("CASCADE");

      table.unique(["notification_id", "person_id"], {
        indexName: "uq_contract_notification_read_pessoa"
      });
      table.index(["person_id"], "ix_contract_notification_read_person_id");
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("contract_notification_read");
  await knex.schema.dropTableIfExists("contract_notification");
  await knex.raw("DROP TYPE IF EXISTS notification_milestone");
};
