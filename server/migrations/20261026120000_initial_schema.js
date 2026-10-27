const ENUMS = {
  account_status: ["active", "inactive", "blocked", "pending"],
  document_status: ["draft", "pending", "signed", "refused", "expired", "archived"],
  file_status: ["uploaded", "processing", "ready", "deleted"],
  enterprise_status: ["active", "inactive", "suspended", "pending"],
  signature_status: ["signed", "pending_submission", "waiting_signature", "expired"],
  job_status: ["queued", "processing", "done", "failed"]
};

const TABELAS_EM_ORDEM_REVERSA = [
  "contract_job",
  "template",
  "ms_oauth_token",
  "audit_log",
  "role_invite",
  "seal",
  "enterprise_document",
  "enterprise",
  "document",
  "file_resource",
  "signature",
  "two_factor_code",
  "identity",
  "person",
  "institution",
  "role"
];

const uuidPadrao = (knex, table, nomeDaRestricao) => {
  table.uuid("uuid").notNullable().defaultTo(knex.raw("gen_random_uuid()"));
  table.unique(["uuid"], { indexName: nomeDaRestricao });
};

const criarSeNaoExistir = async (knex, nome, definicao) => {
  if (await knex.schema.hasTable(nome)) return;
  await knex.schema.createTable(nome, definicao);
};

const COLUNAS_TARDIAS = [
  ["person", "role_id", (table) => table.bigInteger("role_id").nullable()],
  ["enterprise", "responsible_person", (table) => table.string("responsible_person", 200)],
  ["enterprise", "phone_number", (table) => table.string("phone_number", 40)],
  ["enterprise", "created_by_person_id", (table) => table.bigInteger("created_by_person_id").nullable()],
  ["enterprise", "cnpj", (table) => table.string("cnpj", 18)],
  ["enterprise", "contact_email", (table) => table.string("contact_email", 255)]
];

const garantirColunasTardias = async (knex) => {
  for (const [tabela, coluna, definir] of COLUNAS_TARDIAS) {
    if (await knex.schema.hasColumn(tabela, coluna)) continue;
    await knex.schema.alterTable(tabela, definir);
  }
};

const enumNativo = (table, coluna, nome, padrao) =>
  table
    .enu(coluna, ENUMS[nome], { useNative: true, existingType: true, enumName: nome })
    .notNullable()
    .defaultTo(padrao);

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw("CREATE EXTENSION IF NOT EXISTS pgcrypto");

  for (const [nome, valores] of Object.entries(ENUMS)) {
    const lista = valores.map((v) => `'${v}'`).join(", ");
    await knex.raw(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${nome}') THEN
           CREATE TYPE ${nome} AS ENUM (${lista});
         END IF;
       END$$`
    );
  }

  await criarSeNaoExistir(knex, "role", (table) => {
    table.comment("Perfis de permissão. person.role_id referencia esta tabela.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_role_uuid");
    table.string("name", 120).notNullable();
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
    table.unique(["name"], { indexName: "uq_role_name" });
  });

  await criarSeNaoExistir(knex, "institution", (table) => {
    table.comment("Instituições (campus/unidade). Referenciada por person e enterprise.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_institution_uuid");
    table.string("name", 200).notNullable();
    table.string("street", 200);
    table.string("number", 40);
    table.string("neighborhood", 120);
    table.string("city", 120);
    table.string("state", 80);
    table.string("zip_code", 20);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
  });

  await criarSeNaoExistir(knex, "person", (table) => {
    table.comment("Pessoa. Dados estáveis: unidade, onboarding, papel persistido.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_person_uuid");
    table.string("full_name", 200).notNullable();
    table.string("cpf_hash", 64);
    table.boolean("onboarding_completed").notNullable().defaultTo(false);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
    table.bigInteger("institution_id").nullable();
    table.bigInteger("role_id").nullable();

    table
      .foreign("institution_id", "fk_person_institution")
      .references("id")
      .inTable("institution")
      .onDelete("SET NULL");
    table.foreign("role_id").references("id").inTable("role").onDelete("SET NULL");

    table.unique(["cpf_hash"], {
      indexName: "uq_person_cpf_hash",
      predicate: knex.whereNotNull("cpf_hash")
    });
    table.index(["institution_id"], "ix_person_institution_id");
    table.index(["role_id"], "ix_person_role_id");
  });

  await criarSeNaoExistir(knex, "identity", (table) => {
    table.comment("Conta Microsoft (login). Reusada a cada login.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_identity_uuid");
    table.bigInteger("person_id").notNullable();
    table.string("provider", 40).notNullable().defaultTo("microsoft");
    table.string("microsoft_oid", 64);
    table.string("email", 255).notNullable();
    table.string("domain", 120);
    table.boolean("email_verified").notNullable().defaultTo(false);
    table.boolean("active").notNullable().defaultTo(true);
    table.timestamp("first_seen_at", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.timestamp("last_login_at", { useTz: true }).nullable();

    table
      .foreign("person_id", "fk_identity_person")
      .references("id")
      .inTable("person")
      .onDelete("CASCADE");

    table.unique(["microsoft_oid"], {
      indexName: "uq_identity_oid",
      predicate: knex.whereNotNull("microsoft_oid")
    });
    table.unique(["email"], { indexName: "uq_identity_email" });
    table.index(["person_id"], "ix_identity_person_id");
  });

  await criarSeNaoExistir(knex, "two_factor_code", (table) => {
    table.comment("Códigos de verificação (2FA) enviados por e-mail, por identidade.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_two_factor_code_uuid");
    table.bigInteger("identity_id").notNullable();
    table.text("code_hash").notNullable();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("consumed_at", { useTz: true }).nullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);

    table
      .foreign("identity_id", "fk_two_factor_code_identity")
      .references("id")
      .inTable("identity")
      .onDelete("CASCADE");
    table.index(["identity_id"], "ix_two_factor_code_identity_id");
  });

  await criarSeNaoExistir(knex, "signature", (table) => {
    table.comment("Entidade de assinatura. document.signature_id referencia aqui.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_signature_uuid");
    enumNativo(table, "status", "signature_status", "pending_submission");
    table.timestamp("signed_date", { useTz: true }).nullable();
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
    table.index(["status"], "ix_signature_status");
  });

  await criarSeNaoExistir(knex, "file_resource", (table) => {
    table.comment("Arquivo físico (caminho ou binário). Usado por document e seal.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_file_resource_uuid");
    table.string("name", 255).notNullable();
    enumNativo(table, "status", "file_status", "uploaded");
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.timestamp("due_date", { useTz: true }).nullable();
    table.text("file_path").nullable();
    table.binary("content").nullable();
    table.text("signature").nullable();
    table.boolean("active").notNullable().defaultTo(true);
    table.check(
      "file_path IS NOT NULL OR content IS NOT NULL",
      [],
      "ck_file_resource_path_or_content"
    );
  });

  await criarSeNaoExistir(knex, "document", (table) => {
    table.comment("Documento de negócio (contrato, anexos).");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_document_uuid");
    table.string("name", 255).notNullable();
    enumNativo(table, "status", "document_status", "draft");
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.timestamp("due_date", { useTz: true }).nullable();
    table.boolean("active").notNullable().defaultTo(true);
    table.bigInteger("signature_id").nullable();
    table.bigInteger("file_resource_id").nullable();

    table
      .foreign("signature_id", "fk_document_signature")
      .references("id")
      .inTable("signature")
      .onDelete("SET NULL");
    table
      .foreign("file_resource_id", "fk_document_file_resource")
      .references("id")
      .inTable("file_resource")
      .onDelete("SET NULL");

    table.index(["signature_id"], "ix_document_signature_id");
    table.index(["file_resource_id"], "ix_document_file_resource_id");
  });

  await criarSeNaoExistir(knex, "enterprise", (table) => {
    table.comment("Empresas parceiras.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_enterprise_uuid");
    table.string("name", 200).notNullable();
    table.string("responsible_person", 200);
    table.string("phone_number", 40);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.string("street", 200);
    table.string("number", 40);
    table.string("neighborhood", 120);
    table.string("city", 120);
    table.string("state", 80);
    table.string("zip_code", 20);
    enumNativo(table, "status", "enterprise_status", "active");
    table.boolean("active").notNullable().defaultTo(true);
    table.bigInteger("institution_id").nullable();
    table.bigInteger("created_by_person_id").nullable();
    table.string("cnpj", 18);
    table.string("contact_email", 255);

    table
      .foreign("institution_id", "fk_enterprise_institution")
      .references("id")
      .inTable("institution")
      .onDelete("SET NULL");
    table
      .foreign("created_by_person_id", "fk_enterprise_created_by_person")
      .references("id")
      .inTable("person")
      .onDelete("SET NULL");

    table.index(["institution_id"], "ix_enterprise_institution_id");
    table.index(["created_by_person_id"], "ix_enterprise_created_by_person_id");
    table.unique(["cnpj"], {
      indexName: "uq_enterprise_cnpj",
      predicate: knex.whereNotNull("cnpj")
    });
  });

  await criarSeNaoExistir(knex, "enterprise_document", (table) => {
    table.comment("Ligação entre enterprise e document (1 empresa -> N documentos).");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_enterprise_document_uuid");
    table.bigInteger("enterprise_id").notNullable();
    table.bigInteger("document_id").notNullable();
    table.string("doc_type", 50).notNullable().defaultTo("attachment");
    table.boolean("is_primary").notNullable().defaultTo(false);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);

    table
      .foreign("enterprise_id", "fk_enterprise_document_enterprise")
      .references("id")
      .inTable("enterprise")
      .onDelete("CASCADE");
    table
      .foreign("document_id", "fk_enterprise_document_document")
      .references("id")
      .inTable("document")
      .onDelete("CASCADE");

    table.unique(["enterprise_id", "document_id"], {
      indexName: "uq_enterprise_document_pair"
    });
    table.unique(["document_id"], { indexName: "uq_enterprise_document_document" });
    table.index(["enterprise_id"], "ix_enterprise_document_enterprise_id");
    table.index(["document_id"], "ix_enterprise_document_document_id");
    table.index(["doc_type"], "ix_enterprise_document_doc_type");
  });

  await criarSeNaoExistir(knex, "seal", (table) => {
    table.comment("Chancelas/selos. Reutiliza file_resource para o arquivo.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_seal_uuid");
    table.string("name", 200).notNullable();
    table.timestamp("create_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
    table.bigInteger("file_resource_id").nullable();

    table
      .foreign("file_resource_id", "fk_seal_file_resource")
      .references("id")
      .inTable("file_resource")
      .onDelete("SET NULL");
    table.index(["file_resource_id"], "ix_seal_file_resource_id");
  });

  await criarSeNaoExistir(knex, "role_invite", (table) => {
    table.comment("Convite de papel por e-mail (allowlist). Consumido no primeiro login.");
    table.bigIncrements("id").primary();
    table.string("email", 255).notNullable();
    table.bigInteger("role_id").notNullable();
    table.timestamp("consumed_at", { useTz: true }).nullable();
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);

    table.foreign("role_id").references("id").inTable("role");
    table.unique(["email"], { indexName: "uq_role_invite_email" });
    table.index(["role_id"], "ix_role_invite_role_id");
  });

  await criarSeNaoExistir(knex, "audit_log", (table) => {
    table.comment("Trilha de auditoria append-only das ações administrativas e de gestão.");
    table.bigIncrements("id").primary();
    table.uuid("actor_uuid").notNullable();
    table.string("actor_email", 255).nullable();
    table.string("action", 80).notNullable();
    table.string("entity", 40).notNullable();
    table.string("entity_ref", 255).nullable();
    table.jsonb("detail").nullable();
    table.string("request_id", 64).nullable();
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
  });

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit_log (action, insert_date DESC)"
  );
  await knex.raw("CREATE INDEX IF NOT EXISTS ix_audit_log_insert_date ON audit_log (insert_date DESC)");

  await criarSeNaoExistir(knex, "ms_oauth_token", (table) => {
    table.comment("Refresh token do Microsoft Graph (delegated, cifrado em aplicação).");
    table.bigIncrements("id").primary();
    table.bigInteger("identity_id").notNullable();
    table.text("refresh_token").notNullable();
    table.text("scope");
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));

    table
      .foreign("identity_id", "fk_ms_oauth_identity")
      .references("id")
      .inTable("identity")
      .onDelete("CASCADE");
    table.unique(["identity_id"], { indexName: "uq_ms_oauth_identity" });
  });

  await criarSeNaoExistir(knex, "template", (table) => {
    table.comment("Modelo de contrato (.docx no OneDrive) com variáveis auto-detectadas.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_template_uuid");
    table.string("name", 200).notNullable();
    table.string("storage_provider", 40).notNullable().defaultTo("onedrive");
    table.string("file_path", 200).notNullable();
    table.jsonb("variables").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.boolean("active").notNullable().defaultTo(true);
    table.index(["active"], "ix_template_active");
  });

  await criarSeNaoExistir(knex, "contract_job", (table) => {
    table.comment("Fila de geração assíncrona de contratos.");
    table.bigIncrements("id").primary();
    uuidPadrao(knex, table, "uq_contract_job_uuid");
    enumNativo(table, "status", "job_status", "queued");
    table.uuid("template_uuid").notNullable();
    table.jsonb("values").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.string("out_name", 255).notNullable();
    table.boolean("as_pdf").notNullable().defaultTo(false);
    table.uuid("enterprise_uuid").nullable();
    table.string("requested_by", 255).notNullable();
    table.string("requested_by_email", 255).notNullable();
    table.jsonb("result").nullable();
    table.text("error").nullable();
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("insert_date", { useTz: true }).notNullable().defaultTo(knex.raw("now()"));
    table.timestamp("started_at", { useTz: true }).nullable();
    table.timestamp("finished_at", { useTz: true }).nullable();
    table.boolean("active").notNullable().defaultTo(true);
    table.index(["status"], "ix_contract_job_status");
  });

  await garantirColunasTardias(knex);

  await knex("role")
    .insert([{ name: "STUDENT" }, { name: "TEACHER" }, { name: "MANAGER" }, { name: "ADMIN" }])
    .onConflict("name")
    .ignore();

  for (const nome of ["Jaraguá do Sul", "Joinville"]) {
    const existe = await knex("institution").where({ name: nome }).first();
    if (!existe) await knex("institution").insert({ name: nome });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  for (const tabela of TABELAS_EM_ORDEM_REVERSA) {
    await knex.schema.dropTableIfExists(tabela);
  }
  for (const nome of Object.keys(ENUMS)) {
    await knex.raw(`DROP TYPE IF EXISTS ${nome}`);
  }
};
