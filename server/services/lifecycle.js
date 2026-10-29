'use strict';

const ENTERPRISE = {
  pending: ['active', 'inactive'],
  active: ['suspended', 'inactive'],
  suspended: ['active', 'inactive'],
  inactive: ['pending']
};

const DOCUMENT = {
  draft: ['pending', 'archived'],
  pending: ['signed', 'refused', 'expired', 'draft', 'archived'],
  signed: ['expired', 'archived'],
  refused: ['draft', 'archived'],
  expired: ['archived'],
  archived: []
};

const SIGNATURE = {
  pending_submission: ['waiting_signature', 'expired'],
  waiting_signature: ['signed', 'expired', 'pending_submission'],
  signed: ['expired'],
  expired: ['pending_submission']
};

const MAQUINAS = { enterprise: ENTERPRISE, document: DOCUMENT, signature: SIGNATURE };

class TransitionError extends Error {
  constructor(code, de, para) {
    super(code);
    this.status = 409;
    this.code = code;
    this.details = { from: de, to: para };
  }
}

function estados(maquina) {
  return Object.keys(MAQUINAS[maquina]);
}

function isState(maquina, estado) {
  return Object.prototype.hasOwnProperty.call(MAQUINAS[maquina], estado);
}

function allowedFrom(maquina, de) {
  const mapa = MAQUINAS[maquina];
  return Object.prototype.hasOwnProperty.call(mapa, de) ? mapa[de] : [];
}

function canTransition(maquina, de, para) {
  if (!isState(maquina, para)) return false;
  if (de === para) return true;
  return allowedFrom(maquina, de).includes(para);
}

function assertTransition(maquina, de, para) {
  if (!isState(maquina, para)) throw new TransitionError('invalid_status', de, para);
  if (!isState(maquina, de)) throw new TransitionError('invalid_transition', de, para);
  if (!canTransition(maquina, de, para)) throw new TransitionError('invalid_transition', de, para);
}

module.exports = {
  MAQUINAS,
  TransitionError,
  estados,
  isState,
  allowedFrom,
  canTransition,
  assertTransition
};
