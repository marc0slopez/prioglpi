import { NextResponse } from 'next/server';
import { clearSessionCookie, getAuthUser } from '@/lib/auth';
import { writeAppActivity } from '@/lib/app-activity-audit';

export async function POST() {
  try {
    const user = await getAuthUser();
    await clearSessionCookie();
    if (user) {
      try {
        await writeAppActivity(user, 'logout_success', 'authentication', String(user.userId), { role: user.role });
      } catch (error) {
        console.error('Logout audit failed:', error);
      }
    }
    return NextResponse.json({ message: 'Sesión cerrada.' });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Error al cerrar sesión.' },
      { status: 500 }
    );
  }
}
