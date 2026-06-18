// server/services/institution.js
'use strict';

const crud = require('../crud');

const SYSTEM_USER = 'system:app';

function list(user) {
  return crud.list(
    'institution',
    {
      select: ['id', 'uuid', 'name'],
      where: { active: true },
      orderBy: [{ column: 'name', direction: 'ASC' }]
    },
    null,
    user || SYSTEM_USER
  );
}

module.exports = { list };
