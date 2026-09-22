// Inserts >= 3 fictional private items for a given t08 username. All
// content here is placeholder data for this task — never real personal
// information.
//
// Usage: npm run t08:seed-items -- <username>
'use strict';

const { query } = require('../api/t08/_lib/db');

const SAMPLE_ITEMS = [
  {
    title: '준비 중인 프로젝트 메모',
    content: '가상의 사이드 프로젝트 아이디어와 다음 스프린트 할 일 목록 (과제용 더미 데이터).',
    category: 'project-notes',
  },
  {
    title: '지원 후보 목록',
    content: '가상의 채용 지원 후보 3명과 서류 검토 메모 (과제용 더미 데이터, 실제 인물 아님).',
    category: 'candidates',
  },
  {
    title: '이번 주 작업 회고',
    content: '가상의 이번 주 진행 상황과 다음 주 계획 회고 노트 (과제용 더미 데이터).',
    category: 'retro',
  },
];

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: npm run t08:seed-items -- <username>');
    process.exit(1);
  }

  const userResult = await query(`select id from t08_users where username = $1`, [username]);
  if (userResult.rows.length === 0) {
    console.error(`No t08_users row for username "${username}". Register that account first.`);
    process.exit(1);
  }
  const userId = userResult.rows[0].id;

  const existing = await query(`select count(*)::int as n from t08_private_items where user_id = $1`, [
    userId,
  ]);
  if (existing.rows[0].n > 0) {
    console.log(`"${username}" already has ${existing.rows[0].n} private item(s); skipping seed.`);
    process.exit(0);
  }

  for (const item of SAMPLE_ITEMS) {
    await query(
      `insert into t08_private_items (user_id, title, content, category) values ($1, $2, $3, $4)`,
      [userId, item.title, item.content, item.category]
    );
  }

  console.log(`Seeded ${SAMPLE_ITEMS.length} private items for "${username}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
