import crypto from 'node:crypto'

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-nao-usar-em-producao'
process.env.TOKEN_ENC_KEY = process.env.TOKEN_ENC_KEY || crypto.randomBytes(32).toString('base64')
