import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { error: 'No autenticado.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      authSource: user.authSource,
      sectors: user.sectors,
      sectorScopes: user.sectorScopes,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor.' },
      { status: 500 }
    );
  }
}
