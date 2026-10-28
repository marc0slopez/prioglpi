import 'dotenv/config';

const BASE_URL = 'http://localhost:8787';
const DASHBOARDS = ['/dashboard/admin', '/dashboard/coordinador', '/dashboard/referente', '/dashboard/supervisor'];
const USERS = [
  { username: 'admin', expectedDashboard: '/dashboard/admin' },
  { username: 'coordinator_demo', expectedDashboard: '/dashboard/coordinador' },
  { username: 'julianc', expectedDashboard: '/dashboard/referente' },
  { username: 'carolinar', expectedDashboard: '/dashboard/supervisor' },
];

async function testProxy() {
  console.log('Testing proxy access control...');

  for (const user of USERS) {
    console.log(`\n--- Test user: ${user.username} ---`);
    // 1. Login to get cookie
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: `${user.username}123` })
    });

    if (!loginRes.ok) {
      console.error(`Login failed for ${user.username}`);
      continue;
    }

    const setCookie = loginRes.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0]; // simple extraction

    // 2. Test dashboards
    for (const dashboard of DASHBOARDS) {
      const res = await fetch(`${BASE_URL}${dashboard}`, {
        headers: { Cookie: cookie },
        redirect: 'manual' // Do not follow redirects so we can assert the status
      });

      const isExpected = dashboard === user.expectedDashboard;
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (isExpected) {
          console.error(`âŒ Expected to access ${dashboard} but got redirected to ${location}`);
        } else {
          console.log(`âœ… Correctly redirected from ${dashboard} to ${location}`);
        }
      } else if (res.status === 200) {
        if (isExpected) {
          console.log(`âœ… Correctly accessed ${dashboard}`);
        } else {
          console.error(`âŒ Expected to be blocked from ${dashboard} but got 200`);
        }
      } else {
        console.error(`â“ Unexpected status ${res.status} for ${dashboard}`);
      }
    }
  }
}

testProxy().catch(console.error);
