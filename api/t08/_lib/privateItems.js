'use strict';

const { query } = require('./db');

const TITLE_MAX = 200;
const CATEGORY_MAX = 60;
const CONTENT_MAX = 8000;

// Server-side validation — the client also checks this, but ownership and
// content rules are only real if enforced here too.
function validateFields(body) {
  const title = body && typeof body.title === 'string' ? body.title.trim() : '';
  const category = body && typeof body.category === 'string' ? body.category.trim() : '';
  const content = body && typeof body.content === 'string' ? body.content.trim() : '';

  if (!title) return 'title_required';
  if (title.length > TITLE_MAX) return 'title_too_long';
  if (!category) return 'category_required';
  if (category.length > CATEGORY_MAX) return 'category_too_long';
  if (!content) return 'content_required';
  if (content.length > CONTENT_MAX) return 'content_too_long';
  return null;
}

async function listByUser(userId) {
  const result = await query(
    `select id, title, content, category, created_at, updated_at
       from t08_private_items
      where user_id = $1
      order by created_at asc`,
    [userId]
  );
  return result.rows;
}

async function insert(userId, { title, content, category }) {
  const result = await query(
    `insert into t08_private_items (user_id, title, content, category)
     values ($1, $2, $3, $4)
     returning id, title, content, category, created_at, updated_at`,
    [userId, title.trim(), content.trim(), category.trim()]
  );
  return result.rows[0];
}

// Updates only a row that both matches itemId AND belongs to userId in the
// same statement. Returns the updated row, or null if nothing matched —
// covering "doesn't exist" and "belongs to someone else" identically, so
// callers never learn which one it was.
async function updateOwned(userId, itemId, { title, content, category }) {
  const result = await query(
    `update t08_private_items
        set title = $3, content = $4, category = $5, updated_at = now()
      where id = $1 and user_id = $2
      returning id, title, content, category, created_at, updated_at`,
    [itemId, userId, title.trim(), content.trim(), category.trim()]
  );
  return result.rows[0] || null;
}

async function deleteOwned(userId, itemId) {
  const result = await query(
    `delete from t08_private_items where id = $1 and user_id = $2 returning id`,
    [itemId, userId]
  );
  return result.rows.length > 0;
}

module.exports = {
  validateFields,
  listByUser,
  insert,
  updateOwned,
  deleteOwned,
  TITLE_MAX,
  CATEGORY_MAX,
  CONTENT_MAX,
};
