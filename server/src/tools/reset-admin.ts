/**
 * Emergency admin PIN reset — for when the admin PIN is forgotten and the
 * web UI is therefore unreachable. Runs directly against the database, so it
 * must be executed on the host (shell access is the authentication here).
 *
 * Usage (from the release bundle root or the repo's server/ directory):
 *   LUMEN_DATA_DIR=./data node server/dist/tools/reset-admin.js <新的6位PIN>
 *
 * Resets the FIRST admin account's PIN and revokes all of that admin's
 * sessions. Creates the admin account if the users table is empty.
 */
import {
  createUser,
  destroyAllSessionsForUser,
  listUsers,
  setUserPin
} from '../auth.js';

const pin = process.argv[2] ?? '';

if (!/^\d{6}$/.test(pin)) {
  console.error('用法: node dist/tools/reset-admin.js <新的6位数字PIN>');
  console.error('注意: 登录界面只接受 6 位数字。');
  process.exit(1);
}

const users = listUsers();
const admin = users
  .filter(u => u.role === 'admin')
  .sort((a, b) => a.id - b.id)[0];

try {
  if (admin) {
    setUserPin(admin.id, pin); // rejects PINs already used by another user
    destroyAllSessionsForUser(admin.id);
    console.log(`✓ 管理员 "${admin.username}" (id=${admin.id}) 的 PIN 已重置，旧登录会话已全部注销。`);
  } else if (users.length === 0) {
    const u = createUser('admin', pin, 'admin');
    console.log(`✓ 数据库中没有任何用户 — 已创建管理员 "${u.username}" (id=${u.id})。`);
  } else {
    console.error('✗ 存在用户但没有管理员账号 — 数据库状态异常，请手动检查 users 表。');
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ 重置失败: ${(e as Error).message}`);
  process.exit(1);
}
