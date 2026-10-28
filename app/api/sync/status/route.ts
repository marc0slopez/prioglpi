import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSyncStatus } from '@/lib/sync-service';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const status = await getSyncStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Sync status error:', error);
    return NextResponse.json(
      { error: 'Error al obtener estado de sincronización.' },
      { status: 500 }
    );
  }
}
